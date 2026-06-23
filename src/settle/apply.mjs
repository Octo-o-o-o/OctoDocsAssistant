import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SCHEMA_VERSION, ClaimSchema, DocumentRecordSchema, stableClaimId } from '../ledger/model.mjs';
import { applyStatePatch, StatePatchSchema } from '../ledger/state.mjs';
import { appendUniqueLedgerRecords, readLedger, splitLedger } from '../ledger/store.mjs';
import { loadUpdatePolicy, requiresReviewForPatch } from './policy.mjs';
import { enqueueReviewItems } from '../review/store.mjs';
import { defaultTaskPackagePath, readTaskPackage } from './task.mjs';
import { markJournalSettled } from './journal.mjs';

const CommonAnswerSchema = z.object({
  task_id: z.string(),
  answer_id: z.string().regex(/^ans_[a-z0-9_]+$/),
  confidence: z.number().min(0).max(1),
  evidence_ids: z.array(z.string()),
  claim_id: z.string().optional(),
  doc_status: z.string().optional(),
  state_patch: z.record(z.any()).optional(),
  on_failure: z.enum(['needs_review', 'reject', 'skip'])
});

const ExtractClaimsAnswerSchema = CommonAnswerSchema.extend({
  claims: z.array(z.object({
    subject: z.string().min(1),
    kind: z.enum(['requirement', 'feature', 'decision', 'constraint', 'behavior']),
    intent: z.enum(['idea', 'proposal', 'planned', 'abandoned']).default('proposal'),
    implementation: z.enum(['not_started', 'in_progress', 'implemented', 'removed']).default('not_started'),
    lifecycle: z.enum(['current', 'deprecated', 'superseded', 'released']).default('current')
  }))
});

const AnswersFileSchema = z.object({
  schema_version: z.literal(1),
  answers: z.array(z.record(z.any()))
});

function latestById(records, id) {
  return [...records].reverse().find((record) => record.id === id);
}

function latestDocByPath(documents, path) {
  return [...documents].reverse().find((doc) => doc.path === path);
}

export async function applyAnswers(root, { answersPath, tasksPath = defaultTaskPackagePath(root) }) {
  const answersFile = AnswersFileSchema.parse(JSON.parse(await readFile(answersPath, 'utf8')));
  const taskPackage = await readTaskPackage(tasksPath);
  const tasksById = new Map(taskPackage.tasks.map((task) => [task.task_id, task]));
  const ledger = splitLedger(await readLedger(root));
  const policy = await loadUpdatePolicy(root);
  const evidenceIds = new Set(ledger.evidences.map((ev) => ev.id));
  const records = [];
  const reviewItems = [];
  const accepted_answers = [];
  const rejected_answers = [];
  const settledJournalIds = [];

  for (const raw of answersFile.answers) {
    const common = CommonAnswerSchema.parse(raw);
    const task = tasksById.get(common.task_id);
    if (!task) {
      rejected_answers.push({ task_id: common.task_id, reason: 'unknown_task_id' });
      continue;
    }
    const missingEvidence = common.evidence_ids.filter((id) => !evidenceIds.has(id));
    if (missingEvidence.length) {
      rejected_answers.push({ task_id: common.task_id, reason: 'unknown_evidence_ids', evidence_ids: missingEvidence });
      continue;
    }

    if (task.kind === 'extract_claims') {
      if (!common.evidence_ids.length) {
        rejected_answers.push({ task_id: common.task_id, reason: 'empty_evidence_ids', expected: 'extract_claims answers must cite at least one existing evidence id' });
        continue;
      }
      const answer = ExtractClaimsAnswerSchema.parse(raw);
      const docPath = task.untrusted_content.path || 'unknown';
      for (const claimInput of answer.claims) {
        records.push(ClaimSchema.parse({
          id: stableClaimId(docPath, 'host-agent', claimInput.subject),
          schema_version: SCHEMA_VERSION,
          subject: claimInput.subject,
          kind: claimInput.kind,
          intent: claimInput.intent,
          implementation: claimInput.implementation,
          verification: 'unverified',
          lifecycle: claimInput.lifecycle === 'released' ? 'current' : claimInput.lifecycle,
          confidence: answer.confidence,
          supersedes: [],
          evidence_ids: answer.evidence_ids,
          aliases: []
        }));
      }
    } else if (task.kind === 'judge_completeness') {
      // Apply a host-agent state judgement to a claim; mandatory-status upgrades always
      // route to a prefilled review instead of auto-applying (spec §11). A "no change"
      // answer (no state_patch) is legitimate and simply settles the journal event.
      let patch = null;
      if (common.state_patch && Object.keys(common.state_patch).length) {
        try {
          patch = StatePatchSchema.parse(common.state_patch);
        } catch (error) {
          rejected_answers.push({ task_id: common.task_id, reason: 'invalid_state_patch', detail: error.message });
          continue;
        }
      }
      if (patch && common.claim_id) {
        const claim = latestById(ledger.claims, common.claim_id);
        if (!claim) {
          rejected_answers.push({ task_id: common.task_id, reason: 'unknown_claim_id', claim_id: common.claim_id });
          continue;
        }
        const merged = { ...claim, evidence_ids: Array.from(new Set([...(claim.evidence_ids || []), ...common.evidence_ids])) };
        if (requiresReviewForPatch(policy, patch)) {
          reviewItems.push({
            severity: 'needs_confirmation',
            claim_id: claim.id,
            suggested_state_patch: patch,
            suggested_current_patch: `${claim.subject}: host-agent proposes ${JSON.stringify(patch)}`,
            suggested_timeline_entry: `Confirm ${claim.subject} state change ${JSON.stringify(patch)}`,
            evidence_ids: common.evidence_ids.slice(0, 20),
            reason: 'Host-agent proposed a verified/released/superseded/removed change; requires confirmation.',
            confidence: common.confidence
          });
        } else {
          try {
            records.push(applyStatePatch(merged, patch, { evidences: ledger.evidences, events: ledger.events }));
          } catch (error) {
            rejected_answers.push({ task_id: common.task_id, reason: 'invalid_state_patch', detail: error.message });
            continue;
          }
        }
      }
    } else if (task.kind === 'classify_doc') {
      const docStatus = common.doc_status;
      const validStatus = ['current', 'draft', 'proposal', 'stale', 'superseded', 'archived', 'conflict', 'generated'].includes(docStatus);
      if (!validStatus) {
        rejected_answers.push({ task_id: common.task_id, reason: 'missing_or_invalid_doc_status', expected: 'classify_doc answers must set doc_status to a known document status' });
        continue;
      }
      const docPath = task.untrusted_content.path;
      const existing = latestDocByPath(ledger.documents, docPath);
      if (existing) records.push(DocumentRecordSchema.parse({ ...existing, doc_status: docStatus }));
    } else {
      // judge_supersede / explain_conflict → human-reviewed, never auto-applied.
      reviewItems.push({
        severity: 'needs_confirmation',
        doc_path: task.untrusted_content.path,
        suggested_current_patch: `Host-agent ${task.kind} result for ${task.untrusted_content.path || 'unknown'} needs confirmation.`,
        suggested_timeline_entry: `Review ${task.kind} for ${task.untrusted_content.path || 'unknown'}.`,
        evidence_ids: common.evidence_ids.slice(0, 20),
        reason: `Host-agent ${task.kind} judgement requires human confirmation before it affects the ledger.`,
        confidence: common.confidence
      });
    }

    if (task.context?.journal_event_id) settledJournalIds.push(task.context.journal_event_id);
    accepted_answers.push({ task_id: common.task_id, kind: task.kind });
  }

  const write = await appendUniqueLedgerRecords(root, records);
  const enqueuedReviews = reviewItems.length ? await enqueueReviewItems(root, reviewItems) : [];
  if (settledJournalIds.length) await markJournalSettled(root, settledJournalIds);
  return {
    accepted_answers,
    rejected_answers,
    accepted_records: write.accepted.length,
    skipped_records: write.skipped.length,
    review_items_created: enqueuedReviews.length,
    settled_journal_events: settledJournalIds.length
  };
}

export function parseApplyArgs(root, args) {
  const answersIndex = args.indexOf('--answers');
  const tasksIndex = args.indexOf('--tasks');
  return {
    answersPath: answersIndex >= 0 ? join(root, args[answersIndex + 1]) : null,
    tasksPath: tasksIndex >= 0 ? join(root, args[tasksIndex + 1]) : defaultTaskPackagePath(root)
  };
}

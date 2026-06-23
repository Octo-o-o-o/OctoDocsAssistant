import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { changeFingerprint, hashWithPrefix, normalizePath, nowIso } from '../ledger/model.mjs';
import { ensureParent, readTextIfExists } from '../utils/fs.mjs';

export const JournalEventSchema = z.object({
  id: z.string().regex(/^journal_[a-f0-9]{8,}$/),
  schema_version: z.literal(1),
  ts: z.string().datetime({ offset: true }),
  source: z.enum(['git_commit', 'git_merge', 'git_tag', 'deploy', 'file_change', 'ai_session']),
  type: z.enum(['doc_created', 'doc_updated', 'doc_deleted', 'code_changed', 'commit', 'merge', 'tag', 'deploy', 'release_confirmation']),
  path: z.string().optional(),
  commit: z.string().optional(),
  change_fingerprint: z.string(),
  summary: z.string(),
  settled: z.boolean().default(false)
});

export function journalPath(root) {
  return join(root, '.octodocs', 'journal', 'events.jsonl');
}

export async function readJournal(root) {
  const text = await readTextIfExists(journalPath(root));
  if (!text) return [];
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JournalEventSchema.parse(JSON.parse(line)));
}

export async function enqueueJournalEvents(root, inputs) {
  const existing = await readJournal(root);
  const fingerprints = new Set(existing.map((event) => event.change_fingerprint));
  const accepted = [];
  const skipped = [];
  for (const input of inputs) {
    const path = input.path ? normalizePath(input.path) : input.type;
    const fingerprint = input.change_fingerprint || changeFingerprint(path, input.content_hash || input.content || input.summary || input.commit || input.type);
    if (fingerprints.has(fingerprint)) {
      skipped.push({ change_fingerprint: fingerprint, reason: 'duplicate_journal_event' });
      continue;
    }
    const event = JournalEventSchema.parse({
      id: hashWithPrefix('journal', fingerprint),
      schema_version: 1,
      ts: input.ts || nowIso(),
      source: input.source,
      type: input.type,
      path,
      commit: input.commit || undefined,
      change_fingerprint: fingerprint,
      summary: input.summary || `${input.source} ${path}`,
      settled: false
    });
    accepted.push(event);
    fingerprints.add(fingerprint);
  }
  if (accepted.length) {
    const filePath = journalPath(root);
    await ensureParent(filePath);
    await appendFile(filePath, `${accepted.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  }
  return { accepted, skipped };
}

export async function markJournalSettled(root, ids) {
  const idSet = new Set(ids);
  const events = await readJournal(root);
  const next = events.map((event) => idSet.has(event.id) ? { ...event, settled: true } : event);
  await ensureParent(journalPath(root));
  await writeFile(journalPath(root), next.map((event) => JSON.stringify(JournalEventSchema.parse(event))).join('\n') + (next.length ? '\n' : ''), 'utf8');
  return next.filter((event) => idSet.has(event.id)).length;
}

export async function pendingJournal(root) {
  return (await readJournal(root)).filter((event) => !event.settled);
}

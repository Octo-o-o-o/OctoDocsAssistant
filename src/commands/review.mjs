import { ok, fail } from '../agent/output.mjs';
import { applyStatePatch } from '../ledger/state.mjs';
import { sha256, nowIso } from '../ledger/model.mjs';
import { appendUniqueLedgerRecords, readLedger, splitLedger } from '../ledger/store.mjs';
import { appendCorrection } from '../review/corrections.mjs';
import { readReviewItems, rewriteReviewItems, reviewSignature } from '../review/store.mjs';

const sigHash = (text) => sha256(text).slice(0, 16);

function groupOpen(items) {
  const open = items.filter((item) => item.status === 'open' || item.status === 'pinned');
  const groups = {
    blocking: open.filter((item) => item.severity === 'blocking').slice(0, 5),
    needs_confirmation: open.filter((item) => item.severity === 'needs_confirmation').slice(0, 5),
    informational: open.filter((item) => item.severity === 'informational').slice(0, 5)
  };
  return groups;
}

function latestClaimById(claims, id) {
  return [...claims].reverse().find((claim) => claim.id === id);
}

async function updateReviewStatus(root, id, status) {
  const items = await readReviewItems(root);
  const next = items.map((item) => item.id === id ? { ...item, status } : item);
  await rewriteReviewItems(root, next);
  return next.find((item) => item.id === id);
}

export async function reviewCommand({ root, args }) {
  const action = args[0] || 'list';
  if (action === 'list') {
    const items = await readReviewItems(root);
    return ok({ groups: groupOpen(items), total: items.length }, [
      'Confirm, reject, ignore, or pin prefilled review items; do not ask the user to write evidence from scratch.',
      'Run `octodocs review confirm <id>` for accepted state patches.',
      'Run `octodocs review reject <id> --reason <category>` to write correction memory.'
    ]);
  }
  if (action === 'explain') {
    const id = args[1];
    const item = (await readReviewItems(root)).find((candidate) => candidate.id === id);
    if (!item) return fail('REVIEW_NOT_FOUND', `Review item not found: ${id}`, 'Run `octodocs review` and choose an existing item id.');
    return ok({ item }, ['Use the prefilled suggested_current_patch and evidence_ids when discussing this item.']);
  }
  if (['ignore', 'pin', 'unpin'].includes(action)) {
    const id = args[1];
    const status = action === 'pin' ? 'pinned' : action === 'unpin' ? 'open' : 'ignored';
    const item = await updateReviewStatus(root, id, status);
    if (!item) return fail('REVIEW_NOT_FOUND', `Review item not found: ${id}`, 'Run `octodocs review` and choose an existing item id.');
    return ok({ item }, ['Run `octodocs review` to see the updated queue.']);
  }
  if (action === 'reject') {
    const id = args[1];
    const reasonIndex = args.indexOf('--reason');
    const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : 'user_rejected';
    const existing = (await readReviewItems(root)).find((candidate) => candidate.id === id);
    if (!existing) return fail('REVIEW_NOT_FOUND', `Review item not found: ${id}`, 'Run `octodocs review` and choose an existing item id.');
    const item = await updateReviewStatus(root, id, 'rejected');
    // Persist the item signature so this exact finding is never re-surfaced (correction memory).
    const signature = reviewSignature(existing);
    await appendCorrection(root, { id: `correction_${sigHash(signature)}`, review_id: id, signature, reason, created_at: nowIso() });
    return ok({ item, correction_written: '.octodocs/corrections.yml' }, ['This finding will not be re-surfaced; correction memory recorded.']);
  }
  if (action === 'confirm') {
    const id = args[1];
    const items = await readReviewItems(root);
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return fail('REVIEW_NOT_FOUND', `Review item not found: ${id}`, 'Run `octodocs review` and choose an existing item id.');
    const ledger = splitLedger(await readLedger(root));
    let accepted_records = 0;
    if (item.claim_id && Object.keys(item.suggested_state_patch || {}).length) {
      const claim = latestClaimById(ledger.claims, item.claim_id);
      if (!claim) return fail('CLAIM_NOT_FOUND', `Claim not found: ${item.claim_id}`, 'Reject this review item or rerun `octodocs update --changed` to regenerate it.');
      // Merge the review item's cited evidence into the claim so verified/released state
      // patches satisfy validateClaimState (which checks the claim's own evidence_ids).
      const mergedEvidenceIds = Array.from(new Set([...(claim.evidence_ids || []), ...(item.evidence_ids || [])]));
      const claimWithEvidence = { ...claim, evidence_ids: mergedEvidenceIds };
      const nextClaim = applyStatePatch(claimWithEvidence, item.suggested_state_patch, { evidences: ledger.evidences, events: ledger.events });
      const write = await appendUniqueLedgerRecords(root, [nextClaim]);
      accepted_records = write.accepted.length;
    }
    await updateReviewStatus(root, id, 'confirmed');
    return ok({ id, accepted_records }, ['Run `octodocs rebuild --from-ledger` to refresh generated views.', 'Confirmed state changes remain schema-validated.']);
  }
  return fail('UNKNOWN_REVIEW_ACTION', `Unknown review action: ${action}`, 'Run `octodocs review` to list items, then use confirm/reject/ignore/pin/unpin/explain.');
}

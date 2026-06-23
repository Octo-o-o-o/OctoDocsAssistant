import { ok } from '../agent/output.mjs';
import { readLedger, splitLedger } from '../ledger/store.mjs';
import { verificationEvidence } from '../ledger/state.mjs';
import { pendingJournal } from '../settle/journal.mjs';
import { readReviewItems } from '../review/store.mjs';

export async function statusCommand({ root }) {
  const ledger = splitLedger(await readLedger(root));
  const pending = await pendingJournal(root);
  const reviews = await readReviewItems(root);
  // false_verified = claims marked verified WITHOUT both implements and tests evidence (must stay 0).
  const falseVerified = ledger.claims.filter((claim) => {
    if (claim.verification !== 'verified') return false;
    const { implementsEvidence, testsEvidence } = verificationEvidence(claim, ledger.evidences);
    return !implementsEvidence.length || !testsEvidence.length;
  }).length;
  return ok(
    {
      ledger: {
        events: ledger.events.length,
        claims: ledger.claims.length,
        evidences: ledger.evidences.length,
        documents: ledger.documents.length,
        verified_count: ledger.claims.filter((claim) => claim.verification === 'verified').length,
        false_verified_count: falseVerified
      },
      journal: {
        pending: pending.length
      },
      review: {
        open: reviews.filter((item) => item.status === 'open').length,
        total: reviews.length
      }
    },
    pending.length
      ? ['Run `octodocs emit-tasks` if pending events need semantic settlement.', 'Run `octodocs update --changed` in-session to process deterministic changes.', 'Background hooks enqueue only; no LLM was called.']
      : ['Run `octodocs update --changed` after edits.', 'Run `octodocs rebuild --from-ledger` to verify views are reconstructible.']
  );
}

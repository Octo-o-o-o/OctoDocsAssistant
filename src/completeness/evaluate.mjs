import { appendUniqueLedgerRecords, readLedger, splitLedger } from '../ledger/store.mjs';
import { applyStatePatch, compositeLabel, verificationEvidence } from '../ledger/state.mjs';
import { enqueueReviewItems } from '../review/store.mjs';
import { loadUpdatePolicy, requiresReviewForPatch } from '../settle/policy.mjs';

export function coverageForClaim(claim, evidences) {
  const { implementsEvidence, testsEvidence } = verificationEvidence(claim, evidences);
  const notFound = evidences.filter((ev) => claim.evidence_ids.includes(ev.id) && ev.relation === 'unknown' && /not_found|not found|missing/i.test(ev.summary));
  const covered = (implementsEvidence.length ? 1 : 0) + (testsEvidence.length ? 1 : 0);
  return {
    claim_id: claim.id,
    subject: claim.subject,
    covered,
    total: 2,
    percent: covered / 2,
    implements_count: implementsEvidence.length,
    tests_count: testsEvidence.length,
    not_found_count: notFound.length,
    implements_evidence_ids: implementsEvidence.map((ev) => ev.id).slice(0, 20),
    tests_evidence_ids: testsEvidence.map((ev) => ev.id).slice(0, 20),
    not_found_evidence_ids: notFound.map((ev) => ev.id).slice(0, 20),
    summary: `coverage ${covered}/2 (${Math.round((covered / 2) * 100)}%)`
  };
}

export async function evaluateCompleteness(root) {
  const ledger = splitLedger(await readLedger(root));
  const policy = await loadUpdatePolicy(root);
  const reviews = [];
  const claimUpdates = [];
  const latestClaims = new Map();
  for (const claim of ledger.claims) latestClaims.set(claim.id, claim);
  const coverage = Array.from(latestClaims.values()).map((claim) => coverageForClaim(claim, ledger.evidences));

  for (const claim of latestClaims.values()) {
    const item = coverageForClaim(claim, ledger.evidences);
    if (item.percent === 1 && claim.verification !== 'verified') {
      const patch = { verification: 'verified' };
      const next = applyStatePatch(claim, patch, { evidences: ledger.evidences, events: ledger.events });
      if (requiresReviewForPatch(policy, patch)) {
        reviews.push({
          severity: 'needs_confirmation',
          claim_id: claim.id,
          suggested_state_patch: patch,
          suggested_current_patch: `${claim.subject}: ${compositeLabel(next)} with ${item.summary}`,
          suggested_timeline_entry: `Verify ${claim.subject}: ${item.summary}`,
        evidence_ids: [...item.implements_evidence_ids, ...item.tests_evidence_ids].slice(0, 20),
          reason: 'Claim has both implements and tests evidence; verification upgrade requires confirmation by policy.',
          confidence: 0.92
        });
      } else {
        claimUpdates.push(next);
      }
    }
    if (item.not_found_evidence_ids.length) {
      reviews.push({
        severity: 'needs_confirmation',
        claim_id: claim.id,
        suggested_state_patch: { implementation: claim.implementation },
        suggested_current_patch: `${claim.subject}: keep ${compositeLabel(claim)}; not_found evidence needs human/agent review.`,
        suggested_timeline_entry: `Review not_found evidence for ${claim.subject}.`,
        evidence_ids: item.not_found_evidence_ids.slice(0, 20),
        reason: 'Symbol or anchor was not found. This is ambiguous and must not be treated as not_implemented.',
        confidence: 0.6
      });
    }
  }

  const acceptedReviews = await enqueueReviewItems(root, reviews);
  const acceptedClaims = claimUpdates.length ? await appendUniqueLedgerRecords(root, claimUpdates) : { accepted: [], skipped: [] };
  return {
    coverage,
    review_items_created: acceptedReviews.length,
    claim_updates_created: acceptedClaims.accepted.length,
    skipped_claim_updates: acceptedClaims.skipped.length
  };
}

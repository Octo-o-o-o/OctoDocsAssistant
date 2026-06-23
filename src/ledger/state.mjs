import { z } from 'zod';
import { ImplementationSchema, IntentSchema, LifecycleSchema, VerificationSchema } from './model.mjs';

export const StatePatchSchema = z.object({
  intent: IntentSchema.optional(),
  implementation: ImplementationSchema.optional(),
  verification: VerificationSchema.optional(),
  lifecycle: LifecycleSchema.optional()
});

const RELEASE_EVENT_TYPES = new Set(['merge', 'tag', 'deploy', 'release_confirmation']);
const RELEASE_EVIDENCE_KINDS = new Set(['merge', 'tag', 'deploy', 'release_confirmation']);

export function compositeLabel(claim) {
  if (claim.lifecycle === 'superseded' && claim.verification === 'verified') return 'superseded_verified';
  if (claim.lifecycle === 'released' && claim.verification === 'verified') return 'released_verified';
  if (claim.verification === 'verified' && claim.lifecycle === 'current') return 'verified_current';
  if (claim.implementation === 'implemented' && claim.verification === 'unverified') return 'implemented_unverified';
  if (claim.intent === 'proposal' && claim.implementation === 'not_started') return 'designed_not_implemented';
  if (claim.implementation === 'removed') return 'removed';
  if (claim.intent === 'abandoned') return 'abandoned';
  return `${claim.intent}_${claim.implementation}_${claim.verification}_${claim.lifecycle}`;
}

export function verificationEvidence(claim, evidences) {
  const linked = evidences.filter((ev) => claim.evidence_ids.includes(ev.id));
  return {
    implementsEvidence: linked.filter((ev) => ev.relation === 'implements'),
    testsEvidence: linked.filter((ev) => ev.relation === 'tests')
  };
}

export function hasReleaseEvidence(claim, evidences, events = []) {
  const linkedEvidence = evidences.filter((ev) => claim.evidence_ids.includes(ev.id));
  if (linkedEvidence.some((ev) => RELEASE_EVIDENCE_KINDS.has(ev.kind))) return true;
  return events.some((event) => RELEASE_EVENT_TYPES.has(event.type) && event.claim_ids?.includes(claim.id));
}

export function validateClaimState(claim, { evidences = [], events = [] } = {}) {
  if (claim.verification === 'verified') {
    const { implementsEvidence, testsEvidence } = verificationEvidence(claim, evidences);
    if (!implementsEvidence.length || !testsEvidence.length) {
      throw new Error(`Claim ${claim.id} cannot be verified without both implements and tests evidence.`);
    }
  }
  if (claim.lifecycle === 'released' && !hasReleaseEvidence(claim, evidences, events)) {
    throw new Error(`Claim ${claim.id} cannot be released without merge/tag/deploy/release_confirmation evidence.`);
  }
  return claim;
}

export function applyStatePatch(claim, patch, context = {}) {
  const validPatch = StatePatchSchema.parse(patch);
  const next = { ...claim, ...validPatch };
  return validateClaimState(next, context);
}

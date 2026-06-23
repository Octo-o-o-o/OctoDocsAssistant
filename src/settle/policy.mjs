import { loadConfig } from '../config/config.mjs';

export async function loadUpdatePolicy(root) {
  return (await loadConfig(root)).update_policy;
}

export function statusChangesInPatch(patch) {
  return Object.entries(patch || {})
    .filter(([key]) => ['verification', 'lifecycle', 'implementation'].includes(key))
    .map(([, value]) => value);
}

// These four status values ALWAYS require human confirmation (spec §11). This is an
// architectural guarantee, not a configurable bypass: config can only add more.
export const MANDATORY_REVIEW_STATUSES = ['verified', 'released', 'superseded', 'removed'];

export function requiresReviewForPatch(policy, patch) {
  const required = new Set([...(policy?.require_review_for_status_changes || []), ...MANDATORY_REVIEW_STATUSES]);
  return statusChangesInPatch(patch).some((value) => required.has(value));
}

export function shouldAutoPatch({ confidence, patchLines = 0, policy, patch = {} }) {
  if (requiresReviewForPatch(policy, patch)) return false;
  if (patchLines > policy.max_auto_patch_lines) return false;
  return confidence >= policy.auto_update_current_when_confidence_above;
}

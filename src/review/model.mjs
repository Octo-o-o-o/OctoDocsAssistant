import { z } from 'zod';
import { hashWithPrefix } from '../ledger/model.mjs';

export const ReviewItemSchema = z.object({
  id: z.string().regex(/^review_[a-f0-9]{8,}$/),
  severity: z.enum(['blocking', 'needs_confirmation', 'informational']),
  claim_id: z.string().optional(),
  doc_path: z.string().optional(),
  suggested_state_patch: z.record(z.any()).default({}),
  suggested_current_patch: z.string().default(''),
  suggested_timeline_entry: z.string().default(''),
  evidence_ids: z.array(z.string()).default([]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['open', 'confirmed', 'rejected', 'ignored', 'pinned']).default('open'),
  created_at: z.string().datetime({ offset: true }).optional()
});

export function reviewId(parts) {
  return hashWithPrefix('review', JSON.stringify(parts));
}

export function makeReviewItem(input) {
  return ReviewItemSchema.parse({
    id: input.id || reviewId(input),
    severity: input.severity || 'needs_confirmation',
    claim_id: input.claim_id,
    doc_path: input.doc_path,
    suggested_state_patch: input.suggested_state_patch || {},
    suggested_current_patch: input.suggested_current_patch || '',
    suggested_timeline_entry: input.suggested_timeline_entry || '',
    evidence_ids: input.evidence_ids || [],
    reason: input.reason,
    confidence: input.confidence ?? 0.5,
    status: input.status || 'open',
    created_at: input.created_at || new Date().toISOString()
  });
}

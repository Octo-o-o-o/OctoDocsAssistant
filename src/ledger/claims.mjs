import { classifyDocument } from '../classify/doc.mjs';
import { ClaimSchema, SCHEMA_VERSION, stableClaimId } from './model.mjs';
import { validateClaimState } from './state.mjs';

function claimKindForDoc(doc) {
  const classification = classifyDocument(doc);
  if (classification.type === 'adr') return 'decision';
  if (classification.type === 'prd') return 'requirement';
  if (classification.type === 'design' || classification.type === 'solution') return 'feature';
  return 'feature';
}

function linkedEvidenceForDoc(doc, evidences) {
  return evidences.filter((ev) => ev.path === doc.path || ev.links?.includes(doc.path) || ev.summary.includes(doc.path));
}

function implementationFromEvidence(evidences) {
  if (evidences.some((ev) => ev.relation === 'removes')) return 'removed';
  if (evidences.some((ev) => ev.relation === 'implements')) return 'implemented';
  // `tests` evidence alone is ambiguous (may cover old behavior, spec §6.3) and must
  // not imply progress on its own; only `supports` is a deterministic in_progress signal.
  if (evidences.some((ev) => ev.relation === 'supports')) return 'in_progress';
  return 'not_started';
}

function intentFromDocStatus(doc) {
  if (doc.doc_status === 'draft') return 'idea';
  if (doc.doc_status === 'archived') return 'abandoned';
  return 'proposal';
}

function lifecycleFromDocStatus(doc) {
  if (doc.doc_status === 'superseded') return 'superseded';
  if (doc.doc_status === 'stale' || doc.doc_status === 'archived') return 'deprecated';
  return 'current';
}

export function buildClaimsFromDocuments(documents, evidences, events = []) {
  const claims = [];
  const latestDocs = new Map();
  for (const doc of documents) latestDocs.set(doc.path, doc);
  for (const doc of latestDocs.values()) {
    if (doc.tombstone) continue;
    const classification = classifyDocument(doc);
    if (!['prd', 'solution', 'design', 'adr'].includes(classification.type)) continue;
    const linked = linkedEvidenceForDoc(doc, evidences);
    const claim = ClaimSchema.parse({
      id: stableClaimId(doc.path, '', doc.title),
      schema_version: SCHEMA_VERSION,
      subject: doc.title,
      kind: claimKindForDoc(doc),
      intent: intentFromDocStatus(doc),
      implementation: implementationFromEvidence(linked),
      verification: 'unverified',
      lifecycle: lifecycleFromDocStatus(doc),
      confidence: Math.max(0.45, Math.min(0.85, classification.confidence)),
      supersedes: [],
      evidence_ids: linked.map((ev) => ev.id),
      aliases: []
    });
    // Recall-first: a single boundary claim must never abort the whole scan.
    try {
      claims.push(validateClaimState(claim, { evidences, events }));
    } catch {
      claims.push({ ...claim, verification: 'unverified', lifecycle: claim.lifecycle === 'released' ? 'current' : claim.lifecycle });
    }
  }
  return claims;
}

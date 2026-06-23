import { createHash } from 'node:crypto';
import { z } from 'zod';
import { toPosixPath } from '../utils/fs.mjs';

export const SCHEMA_VERSION = 1;

export const EventSourceSchema = z.enum([
  'git_commit',
  'git_merge',
  'git_tag',
  'deploy',
  'file_change',
  'ai_session'
]);

export const EventTypeSchema = z.enum([
  'doc_created',
  'doc_updated',
  'doc_deleted',
  'code_changed',
  'commit',
  'merge',
  'tag',
  'deploy',
  'release_confirmation'
]);

export const ClaimKindSchema = z.enum(['requirement', 'feature', 'decision', 'constraint', 'behavior']);
export const IntentSchema = z.enum(['idea', 'proposal', 'planned', 'abandoned']);
export const ImplementationSchema = z.enum(['not_started', 'in_progress', 'implemented', 'removed']);
export const VerificationSchema = z.enum(['unverified', 'partially_verified', 'verified', 'failed']);
export const LifecycleSchema = z.enum(['current', 'deprecated', 'superseded', 'released']);

export const EvidenceKindSchema = z.enum([
  'commit_diff',
  'code_symbol',
  'test',
  'doc',
  'html',
  'ai_session',
  'merge',
  'tag',
  'deploy',
  'release_confirmation'
]);

export const EvidenceRelationSchema = z.enum([
  'supports',
  'refutes',
  'implements',
  'tests',
  'documents',
  'mentions',
  'supersedes',
  'removes',
  'unknown'
]);

export const DocumentStatusSchema = z.enum([
  'current',
  'draft',
  'proposal',
  'stale',
  'superseded',
  'archived',
  'conflict',
  'generated'
]);

const IdSchema = z.string().regex(/^[a-z]+_[a-z0-9_]{8,}$/);
const IsoTsSchema = z.string().datetime({ offset: true });

export const EventSchema = z.object({
  id: IdSchema,
  schema_version: z.literal(SCHEMA_VERSION),
  ts: IsoTsSchema,
  source: EventSourceSchema,
  change_fingerprint: z.string().min(1),
  source_branch: z.string().optional(),
  type: EventTypeSchema,
  summary: z.string(),
  evidence_ids: z.array(z.string()).default([]),
  claim_ids: z.array(z.string()).default([])
});

export const ClaimSchema = z.object({
  id: IdSchema,
  schema_version: z.literal(SCHEMA_VERSION),
  subject: z.string().min(1),
  kind: ClaimKindSchema,
  intent: IntentSchema,
  implementation: ImplementationSchema,
  verification: VerificationSchema,
  lifecycle: LifecycleSchema,
  confidence: z.number().min(0).max(1),
  supersedes: z.array(z.string()).default([]),
  evidence_ids: z.array(z.string()).default([]),
  last_verified_at: z.string().datetime({ offset: true }).optional(),
  aliases: z.array(z.string()).default([])
});

export const EvidenceSchema = z.object({
  id: IdSchema,
  schema_version: z.literal(SCHEMA_VERSION),
  kind: EvidenceKindSchema,
  relation: EvidenceRelationSchema,
  commit: z.string().optional(),
  path: z.string().optional(),
  symbol: z.string().optional(),
  signal_confidence: z.number().min(0).max(1),
  summary: z.string(),
  links: z.array(z.string()).default([])
});

export const DocumentRecordSchema = z.object({
  id: IdSchema,
  schema_version: z.literal(SCHEMA_VERSION),
  path: z.string().min(1),
  doc_status: DocumentStatusSchema,
  title: z.string(),
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  first_seen_commit: z.string().optional(),
  last_seen_commit: z.string().optional(),
  tombstone: z.boolean(),
  superseded_by: z.string().optional(),
  render_summary: z.string()
});

export const LedgerRecordSchema = z.union([EventSchema, ClaimSchema, EvidenceSchema, DocumentRecordSchema]);

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function hashWithPrefix(prefix, text, length = 20) {
  return `${prefix}_${sha256(text).slice(0, length)}`;
}

export function normalizePath(path) {
  return toPosixPath(path).replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

export function stableClaimId(sourcePath, heading, subject) {
  return hashWithPrefix('claim', `${normalizePath(sourcePath)}\n${normalizeText(heading)}\n${normalizeText(subject)}`);
}

export function stableDocumentId(path) {
  return hashWithPrefix('doc', normalizePath(path));
}

export function stableEvidenceId(parts) {
  return hashWithPrefix('ev', JSON.stringify(parts));
}

export function stableEventId(changeFingerprint, type = 'event') {
  return hashWithPrefix('evt', `${type}:${changeFingerprint}`);
}

export function contentHash(content) {
  return `sha256:${sha256(content)}`;
}

// Dedup key shared by all three sources (commit hook / file watcher / scan).
// Commit sha is intentionally NOT part of the fingerprint so the same physical
// change detected by different mechanisms converges to one event (spec §6.2/§6.5).
export function changeFingerprint(path, contentOrHash) {
  const normalizedPath = normalizePath(path);
  const hash = String(contentOrHash).startsWith('sha256:')
    ? String(contentOrHash)
    : contentHash(contentOrHash);
  return `${normalizedPath}:${hash}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function ledgerRecordType(record) {
  if (record && typeof record === 'object') {
    if ('doc_status' in record && 'content_hash' in record) return 'document';
    if ('relation' in record && 'signal_confidence' in record) return 'evidence';
    if ('change_fingerprint' in record && 'source' in record) return 'event';
    if ('subject' in record && 'intent' in record) return 'claim';
  }
  return 'unknown';
}

export function validateLedgerRecord(record) {
  return LedgerRecordSchema.parse(record);
}

export function makeDocumentRecord({ path, title, content, doc_status = 'current', first_seen_commit, last_seen_commit, tombstone = false, superseded_by, render_summary = '' }) {
  const normalizedPath = normalizePath(path);
  return DocumentRecordSchema.parse({
    id: stableDocumentId(normalizedPath),
    schema_version: SCHEMA_VERSION,
    path: normalizedPath,
    doc_status,
    title: title || normalizedPath.split('/').pop(),
    content_hash: contentHash(content || ''),
    first_seen_commit,
    last_seen_commit,
    tombstone,
    superseded_by,
    render_summary
  });
}

export function makeEvidence({ kind, relation, path, commit, symbol, signal_confidence = 0.5, summary, links = [] }) {
  const normalizedPath = path ? normalizePath(path) : undefined;
  return EvidenceSchema.parse({
    id: stableEvidenceId({ kind, relation, path: normalizedPath, commit, symbol, summary }),
    schema_version: SCHEMA_VERSION,
    kind,
    relation,
    commit,
    path: normalizedPath,
    symbol,
    signal_confidence,
    summary: summary || `${kind} ${relation}`,
    links
  });
}

export function makeEvent({ source, type, path, content, content_hash, commit, source_branch, summary, evidence_ids = [], claim_ids = [], ts }) {
  // `commit` is kept in the call signature for callers/readability but is not part
  // of the dedup fingerprint; the change is identified by path + content hash.
  const fingerprint = changeFingerprint(path || type, content_hash || content || summary || type);
  return EventSchema.parse({
    id: stableEventId(fingerprint, type),
    schema_version: SCHEMA_VERSION,
    ts: ts || nowIso(),
    source,
    change_fingerprint: fingerprint,
    source_branch,
    type,
    summary,
    evidence_ids,
    claim_ids
  });
}

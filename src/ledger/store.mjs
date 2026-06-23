import { appendFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir, ensureParent, readTextIfExists } from '../utils/fs.mjs';
import { ledgerRecordType, validateLedgerRecord } from './model.mjs';

export function ledgerPath(root) {
  return join(root, '.octodocs', 'ledger.accepted.jsonl');
}

export async function ensureLedger(root) {
  const filePath = ledgerPath(root);
  await ensureParent(filePath);
  const existing = await readTextIfExists(filePath);
  if (existing == null) {
    await writeFile(filePath, '', 'utf8');
  }
  return filePath;
}

export async function readLedger(root) {
  const filePath = await ensureLedger(root);
  const text = await readTextIfExists(filePath);
  const records = [];
  const errors = [];
  for (const [index, line] of (text || '').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      records.push(validateLedgerRecord(parsed));
    } catch (error) {
      errors.push({ line: index + 1, message: error.message });
    }
  }
  if (errors.length) {
    const message = `Invalid ledger JSONL at ${filePath}`;
    const detail = errors.map((item) => `line ${item.line}: ${item.message}`).join('; ');
    throw new Error(`${message}. ${detail}`);
  }
  return records;
}

export function buildLedgerIndex(records) {
  const ids = new Set();
  const eventFingerprints = new Set();
  const documentContent = new Set();
  const claimStates = new Set();
  for (const record of records) {
    ids.add(record.id);
    if (record.change_fingerprint) eventFingerprints.add(record.change_fingerprint);
    if (ledgerRecordType(record) === 'document') {
      documentContent.add(documentKey(record));
    }
    if (ledgerRecordType(record) === 'claim') {
      claimStates.add(claimStateKey(record));
    }
  }
  return { ids, eventFingerprints, documentContent, claimStates };
}

function documentKey(record) {
  // doc_status is part of the key so a re-classification (same content) is recorded as a
  // new document version rather than skipped as a duplicate.
  return `${record.id}:${record.content_hash}:${record.tombstone}:${record.doc_status}`;
}

function claimStateKey(record) {
  return [
    record.id,
    record.intent,
    record.implementation,
    record.verification,
    record.lifecycle,
    record.confidence,
    ...(record.evidence_ids || []).sort()
  ].join(':');
}

export async function appendUniqueLedgerRecords(root, records) {
  await ensureLedger(root);
  const existing = await readLedger(root);
  const { accepted, skipped } = dedupeLedgerRecords(existing, records);

  if (accepted.length) {
    const text = accepted.map((record) => JSON.stringify(record)).join('\n');
    await appendFile(ledgerPath(root), `${text}\n`, 'utf8');
  }

  return { accepted, skipped };
}

export function dedupeLedgerRecords(existing, records) {
  const index = buildLedgerIndex(existing);
  const accepted = [];
  const skipped = [];

  for (const raw of records) {
    const record = validateLedgerRecord(raw);
    const type = ledgerRecordType(record);
    if (type === 'event' && index.eventFingerprints.has(record.change_fingerprint)) {
      skipped.push({ id: record.id, reason: 'duplicate_change_fingerprint' });
      continue;
    }
    if (type === 'document') {
      const docKey = documentKey(record);
      if (index.documentContent.has(docKey)) {
        skipped.push({ id: record.id, reason: 'duplicate_document_record' });
        continue;
      }
      index.documentContent.add(docKey);
    } else if (type === 'claim') {
      const key = claimStateKey(record);
      if (index.claimStates.has(key)) {
        skipped.push({ id: record.id, reason: 'duplicate_claim_state' });
        continue;
      }
      index.claimStates.add(key);
    } else if (index.ids.has(record.id)) {
      skipped.push({ id: record.id, reason: 'duplicate_id' });
      continue;
    }
    accepted.push(record);
    index.ids.add(record.id);
    if (record.change_fingerprint) index.eventFingerprints.add(record.change_fingerprint);
  }

  return { accepted, skipped };
}

export async function rewriteLedger(root, records) {
  await ensureDir(join(root, '.octodocs'));
  const filePath = ledgerPath(root);
  const tempPath = `${filePath}.tmp`;
  const lines = records.map((record) => JSON.stringify(validateLedgerRecord(record))).join('\n');
  await writeFile(tempPath, lines ? `${lines}\n` : '', 'utf8');
  await rename(tempPath, filePath);
}

export function splitLedger(records) {
  return {
    events: records.filter((record) => ledgerRecordType(record) === 'event'),
    claims: records.filter((record) => ledgerRecordType(record) === 'claim'),
    evidences: records.filter((record) => ledgerRecordType(record) === 'evidence'),
    documents: records.filter((record) => ledgerRecordType(record) === 'document')
  };
}

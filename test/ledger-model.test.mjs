import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendUniqueLedgerRecords, readLedger } from '../src/ledger/store.mjs';
import { changeFingerprint, makeDocumentRecord, makeEvent, makeEvidence, stableClaimId } from '../src/ledger/model.mjs';

test('stable claim ids are deterministic text hashes', () => {
  const a = stableClaimId('docs/Auth.md', 'OAuth', 'Callback');
  const b = stableClaimId('./docs/Auth.md', 'oauth', 'callback');
  assert.equal(a, b);
});

test('ledger append dedupes event change_fingerprint and document content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-ledger-'));
  try {
    const doc = makeDocumentRecord({
      path: 'docs/a.md',
      title: 'A',
      content: '# A',
      render_summary: 'A'
    });
    const ev = makeEvidence({
      kind: 'doc',
      relation: 'documents',
      path: 'docs/a.md',
      signal_confidence: 0.8,
      summary: 'A documents a requirement'
    });
    const event = makeEvent({
      source: 'file_change',
      type: 'doc_created',
      path: 'docs/a.md',
      content: '# A',
      summary: 'docs/a.md created',
      evidence_ids: [ev.id]
    });

    const first = await appendUniqueLedgerRecords(root, [doc, ev, event]);
    const second = await appendUniqueLedgerRecords(root, [doc, ev, event]);
    const records = await readLedger(root);

    assert.equal(first.accepted.length, 3);
    assert.equal(second.accepted.length, 0);
    assert.equal(records.length, 3);
    assert.equal(changeFingerprint('docs/a.md', '# A'), event.change_fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

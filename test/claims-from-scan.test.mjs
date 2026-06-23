import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { readLedger, splitLedger } from '../src/ledger/store.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

test('scan creates deterministic claims with stable ids and unverified status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-claims-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'auth.ts'), 'export function auth() {}\n', 'utf8');
    await writeFile(join(root, 'docs', 'auth-方案.md'), [
      '---',
      'ledger:',
      '  verify_by:',
      '    - src/auth.ts',
      '---',
      '# Auth Plan',
      '',
      'Auth should exist.'
    ].join('\n'), 'utf8');
    await initProject(root);
    const first = await scanRepository(root);
    const second = await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    const claim = ledger.claims.find((item) => item.subject === 'Auth Plan');

    assert.equal(first.claims.length, 1);
    assert.equal(second.accepted.length, 0);
    assert.equal(claim.implementation, 'implemented');
    assert.equal(claim.verification, 'unverified');
    assert.ok(claim.evidence_ids.length >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

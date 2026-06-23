import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { cachePath, queryCacheCounts, rebuildFromLedger } from '../src/ledger/cache.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

test('rebuild from ledger recreates cache and views', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-cache-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'design.md'), '# Design\n\nUses `missingThing`.\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    const first = await rebuildFromLedger(root);
    const inventory = await readFile(join(root, 'docs', 'octodocs', 'DOCS_INVENTORY.md'), 'utf8');
    await rm(cachePath(root), { force: true });
    const second = await rebuildFromLedger(root);
    const inventoryAgain = await readFile(join(root, 'docs', 'octodocs', 'DOCS_INVENTORY.md'), 'utf8');
    const counts = queryCacheCounts(root);

    assert.equal(first.cache.documents, 1);
    assert.equal(second.cache.documents, 1);
    assert.equal(inventory, inventoryAgain);
    assert.equal(counts.documents, 1);
    assert.ok(counts.evidences >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

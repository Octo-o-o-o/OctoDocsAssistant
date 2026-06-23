import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { scanRepository } from '../src/scan/repository.mjs';
import { renderPhase0 } from '../src/render/phase0.mjs';
import { readReviewItems } from '../src/review/store.mjs';

test('phase0 render writes inventory and drift idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-render-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature-方案.md'), '# Feature Plan\n\nUses `missingFeature`.\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    await renderPhase0(root);
    const firstInventory = await readFile(join(root, 'docs', 'octodocs', 'DOCS_INVENTORY.md'), 'utf8');
    const firstDrift = await readFile(join(root, 'docs', 'octodocs', 'DRIFT_REPORT.md'), 'utf8');
    const firstGaps = await readFile(join(root, 'docs', 'octodocs', 'DOCUMENTATION_GAPS.md'), 'utf8');
    const second = await renderPhase0(root);
    const secondInventory = await readFile(join(root, 'docs', 'octodocs', 'DOCS_INVENTORY.md'), 'utf8');
    const secondDrift = await readFile(join(root, 'docs', 'octodocs', 'DRIFT_REPORT.md'), 'utf8');
    const secondGaps = await readFile(join(root, 'docs', 'octodocs', 'DOCUMENTATION_GAPS.md'), 'utf8');

    assert.equal(firstInventory, secondInventory);
    assert.equal(firstDrift, secondDrift);
    assert.equal(firstGaps, secondGaps);
    assert.equal(second.warnings.length, 0);
    assert.match(firstInventory, /Feature Plan/);
    assert.match(firstDrift, /声称实现但无代码证据/);
    assert.match(firstGaps, /文档规范化缺口/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed block tamper is reviewed and not silently overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-managed-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature.md'), '# Feature\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    await renderPhase0(root);
    const inventoryPath = join(root, 'docs', 'octodocs', 'DOCS_INVENTORY.md');
    const original = await readFile(inventoryPath, 'utf8');
    await writeFile(inventoryPath, original.replace('Feature', 'Manual Edit'), 'utf8');
    const result = await renderPhase0(root);
    const after = await readFile(inventoryPath, 'utf8');
    const reviews = await readReviewItems(root);

    assert.equal(result.warnings.some((warning) => warning.warning === 'managed_block_modified'), true);
    assert.equal(after.includes('Manual Edit'), true);
    assert.equal(reviews.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { packageHandoff, verifyHandoffPackage } from '../src/handoff/package.mjs';
import { renderProjectViews } from '../src/render/project.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

test('package-handoff creates a standalone package with source snapshots and verified links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-handoff-'));
  try {
    await writeFile(
      join(root, 'README.md'),
      '# Handoff Product\n\nHandoff Product is a source-backed project handoff system.\n',
      'utf8'
    );
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(
      join(root, 'docs', 'architecture.md'),
      '# Architecture\n\nSee [Missing Detail](./missing-detail.md) for a draft that is not included.\n',
      'utf8'
    );
    await mkdir(join(root, '.pytest_cache'), { recursive: true });
    await writeFile(join(root, '.pytest_cache', 'README.md'), '# pytest cache directory\n', 'utf8');

    await initProject(root);
    const scan = await scanRepository(root);
    await renderProjectViews(root, { language: 'zh' });

    assert.equal(scan.files.includes('.pytest_cache/README.md'), false);

    const outDir = join(root, 'handoff-package');
    const result = await packageHandoff(root, { outDir, force: true, projectName: 'Handoff Product' });
    const verification = await verifyHandoffPackage(outDir);
    const overview = await readFile(join(outDir, 'PRODUCT_OVERVIEW.md'), 'utf8');
    const html = await readFile(join(outDir, 'html', 'index.html'), 'utf8');
    const sourceDoc = await readFile(join(outDir, '_source_docs', 'docs', 'architecture.md'), 'utf8');
    const audit = JSON.parse(await readFile(join(outDir, '_HANDOFF_AUDIT.json'), 'utf8'));

    await stat(join(outDir, 'HANDOFF_GUIDE.md'));
    await stat(join(outDir, 'README.md'));
    await stat(join(outDir, '_source_docs', 'README.md'));
    assert.equal(result.verification.ready, true);
    assert.equal(verification.ready, true);
    assert.equal(audit.verification.ready, true);
    assert.match(overview, /_source_docs\/README\.md/);
    assert.match(overview, /_source_docs\/docs\/architecture\.md/);
    assert.doesNotMatch(overview, /\.\.\/\.\.\/README\.md/);
    assert.match(html, /_source_docs\/README\.md/);
    assert.match(sourceDoc, /not included in handoff package/);
    assert.equal(JSON.stringify(audit).includes('.pytest_cache'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

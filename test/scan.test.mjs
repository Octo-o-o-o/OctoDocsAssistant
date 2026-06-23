import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { readLedger, splitLedger } from '../src/ledger/store.mjs';
import { parseMarkdownContent } from '../src/scan/md.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

const execFileAsync = promisify(execFile);

test('scanner finds markdown/html, ignores generated docs, and dedupes reruns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-scan-'));
  try {
    await mkdir(join(root, 'docs', 'octodocs'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'app', 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'app', '.next', 'server'), { recursive: true });
    await mkdir(join(root, '.design-sync'), { recursive: true });
    await mkdir(join(root, '.staging', 'app'), { recursive: true });
    await mkdir(join(root, '.workflow', 'intake'), { recursive: true });
    await mkdir(join(root, 'doc', 'browser-walkthrough-reports', 'run-1'), { recursive: true });
    await mkdir(join(root, 'doc', 'github-issue-drafts-0622'), { recursive: true });
    await mkdir(join(root, 'apps', 'ios', 'vendor', 'bundle'), { recursive: true });
    await mkdir(join(root, 'apps', 'harmonyos', 'oh_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'dist-mobile', 'icons'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature.md'), '# Feature\n\nUses `handleFeature`.\n', 'utf8');
    await writeFile(join(root, 'prototype.html'), '<html><head><title>Demo</title><script>alert(1)</script></head><body><h1>Demo</h1></body></html>', 'utf8');
    await writeFile(join(root, 'docs', 'octodocs', 'PROJECT_CURRENT.md'), '# Generated\n', 'utf8');
    await writeFile(join(root, 'app', 'node_modules', 'pkg', 'README.md'), '# Dependency\n', 'utf8');
    await writeFile(join(root, 'app', '.next', 'server', 'BUILD.md'), '# Build Output\n', 'utf8');
    await writeFile(join(root, '.design-sync', 'NOTES.md'), '# Design Sync Notes\n', 'utf8');
    await writeFile(join(root, '.staging', 'app', 'README.md'), '# Staged App\n', 'utf8');
    await writeFile(join(root, '.workflow', 'intake', 'plan.md'), '# Workflow Plan\n', 'utf8');
    await writeFile(join(root, 'doc', 'browser-walkthrough-reports', 'run-1', 'report.md'), '# Browser Walkthrough Report\n', 'utf8');
    await writeFile(join(root, 'doc', 'github-issue-drafts-0622', 'bug.md'), '# Issue Draft\n', 'utf8');
    await writeFile(join(root, 'apps', 'ios', 'vendor', 'bundle', 'README.md'), '# Ruby Vendor\n', 'utf8');
    await writeFile(join(root, 'apps', 'harmonyos', 'oh_modules', 'pkg', 'README.md'), '# OH Vendor\n', 'utf8');
    await writeFile(join(root, 'dist-mobile', 'icons', 'README.md'), '# Mobile Build\n', 'utf8');
    await initProject(root);

    const first = await scanRepository(root);
    const second = await scanRepository(root);
    const dryRun = await scanRepository(root, { writeLedger: false });
    const ledger = splitLedger(await readLedger(root));

    assert.equal(first.files.length, 2);
    assert.equal(second.accepted.length, 0);
    assert.equal(dryRun.accepted.length, 0);
    assert.equal(dryRun.skipped.length > 0, true);
    assert.equal(ledger.documents.length, 2);
    assert.equal(ledger.evidences.some((ev) => ev.kind === 'html' && ev.summary.includes('not product fact')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner records deleted markdown as tombstone from git history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-git-history-'));
  try {
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'old.md'), '# Old Design\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'add old doc'], { cwd: root });
    await rm(join(root, 'docs', 'old.md'));
    await execFileAsync('git', ['add', '-A'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'remove old doc'], { cwd: root });
    await initProject(root);

    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    const tombstone = ledger.documents.find((doc) => doc.path === 'docs/old.md');
    assert.equal(tombstone.tombstone, true);
    assert.equal(tombstone.doc_status, 'archived');
    assert.equal(ledger.events.some((event) => event.type === 'commit' && event.summary === 'remove old doc'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner tolerates malformed markdown frontmatter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-bad-frontmatter-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'bad.md'), [
      '---',
      'title: Bad Frontmatter',
      'lint_baseline: 0 errors / 278 warnings（多为 test 文件 `: any`；max-lines warning：renderer.ts 1295/1200）',
      'items:',
      '  - `pnpm quality-gate:quick` 本地门禁',
      '---',
      '',
      '# Bad Frontmatter Doc',
      '',
      'Still scan this document.'
    ].join('\n'), 'utf8');
    await initProject(root);

    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    const doc = ledger.documents.find((item) => item.path === 'docs/bad.md');
    const evidence = ledger.evidences.find((item) => item.path === 'docs/bad.md');

    assert.equal(doc.title, 'Bad Frontmatter Doc');
    assert.match(doc.render_summary, /frontmatter parse warning/);
    assert.match(evidence.summary, /frontmatter parse warning/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('git history tombstones respect ignore patterns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-git-ignore-'));
  try {
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
    await mkdir(join(root, 'docs', 'octodocs'), { recursive: true });
    await writeFile(join(root, 'docs', 'octodocs', 'old.md'), '# Generated Old\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'add generated old doc'], { cwd: root });
    await rm(join(root, 'docs', 'octodocs', 'old.md'));
    await execFileAsync('git', ['add', '-A'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'remove generated old doc'], { cwd: root });
    await initProject(root);

    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    assert.equal(ledger.documents.some((doc) => doc.path === 'docs/octodocs/old.md'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('changed-file scan ignores generated docs and records missing docs as tombstones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-changed-ignore-'));
  try {
    await mkdir(join(root, 'docs', 'octodocs'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature.md'), '# Feature\n\nUses `handleFeature`.\n', 'utf8');
    await writeFile(join(root, 'docs', 'delete-me.md'), '# Delete Me\n\nOld plan.\n', 'utf8');
    await writeFile(join(root, 'docs', 'octodocs', 'PROJECT_CURRENT.md'), '# Generated\n', 'utf8');
    await initProject(root);
    await rm(join(root, 'docs', 'delete-me.md'));

    const result = await scanRepository(root, {
      changedFiles: [
        'docs/feature.md',
        'docs/delete-me.md',
        'docs/octodocs/PROJECT_CURRENT.md'
      ]
    });
    const ledger = splitLedger(await readLedger(root));

    assert.deepEqual(result.files, ['docs/feature.md']);
    assert.equal(ledger.documents.some((doc) => doc.path === 'docs/octodocs/PROJECT_CURRENT.md'), false);
    assert.equal(ledger.documents.some((doc) => doc.path === 'docs/delete-me.md' && doc.tombstone), true);
    assert.equal(ledger.events.some((event) => event.type === 'doc_deleted' && event.summary.includes('docs/delete-me.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inline code symbol extraction filters paths, filenames, packages, and plain words', () => {
  const parsed = parseMarkdownContent([
    '# Symbols',
    '',
    'Keep `handleFeature`, `AuthMiddleware`, and `window.electron`.',
    'Drop `CLAUDE.md`, `node_modules/.bin/electron`, `application/json`, `get-port`, `latest`, and `API_KEY`.'
  ].join('\n'), 'docs/symbols.md');
  assert.deepEqual(parsed.code_symbols, ['AuthMiddleware', 'handleFeature', 'window.electron']);
});

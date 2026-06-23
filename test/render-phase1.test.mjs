import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { initProject } from '../src/config/config.mjs';
import { renderProjectViews } from '../src/render/project.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

const execFileAsync = promisify(execFile);

test('phase1 renders current, timeline, and handoff idempotently with baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-phase1-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'auth-方案.md'), '# Auth Plan\n\nAuth requirement.\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    await renderProjectViews(root);
    const currentPath = join(root, 'docs', 'octodocs', 'PROJECT_CURRENT.md');
    const timelinePath = join(root, 'docs', 'octodocs', 'PROJECT_TIMELINE.md');
    const handoffPath = join(root, 'docs', 'octodocs', 'AGENT_HANDOFF.md');
    const productOverviewPath = join(root, 'docs', 'octodocs', 'PRODUCT_OVERVIEW.md');
    const productIndexPath = join(root, 'docs', 'octodocs', 'PRODUCT_DOCS_INDEX.md');
    const current = await readFile(currentPath, 'utf8');
    const timeline = await readFile(timelinePath, 'utf8');
    const handoff = await readFile(handoffPath, 'utf8');
    const productOverview = await readFile(productOverviewPath, 'utf8');
    const productIndex = await readFile(productIndexPath, 'utf8');
    const second = await renderProjectViews(root);

    assert.equal(second.warnings.length, 0);
    assert.equal(current, await readFile(currentPath, 'utf8'));
    assert.match(current, /基线分支: no-git/);
    assert.match(current, /Auth Plan/);
    assert.match(current, /覆盖率/);
    assert.match(timeline, /来源分支/);
    assert.ok(handoff.length <= 2300);
    assert.match(productOverview, /产品总览/);
    assert.match(productOverview, /当前产品能力地图/);
    assert.doesNotMatch(productOverview, /ev_[a-f0-9_]{8,}/);
    assert.match(productIndex, /产品文档导航/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('phase1 can render English output explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-phase1-en-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'auth-plan.md'), '# Auth Plan\n\nAuth requirement.\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    await renderProjectViews(root, { language: 'en' });
    const current = await readFile(join(root, 'docs', 'octodocs', 'PROJECT_CURRENT.md'), 'utf8');
    const timeline = await readFile(join(root, 'docs', 'octodocs', 'PROJECT_TIMELINE.md'), 'utf8');
    const productOverview = await readFile(join(root, 'docs', 'octodocs', 'PRODUCT_OVERVIEW.md'), 'utf8');

    assert.match(current, /# Project Current/);
    assert.match(current, /Coverage/);
    assert.match(timeline, /Source Branch/);
    assert.match(productOverview, /# .* Product Overview/);
    assert.match(productOverview, /Current Product Capability Map/);
    assert.match(productOverview, /\*\*Generated From Ledger Time\*\*: /);
    assert.match(productOverview, /See \[PRODUCT_RECENT_CHANGES\.md\]/);
    assert.match(productOverview, /For engineering evidence, file paths, commits, coverage, and evidence IDs/);
    assert.doesNotMatch(productOverview, /更多变化说明|工程证据、文件路径/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('timeline and recent changes flag commits that changed code without docs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-doc-gap-'));
  try {
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'octodocs@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'OctoDocs Test'], { cwd: root });
    await initProject(root);

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'api.ts'), 'export const tokenUsage = true;\n', 'utf8');
    await execFileAsync('git', ['add', 'src/api.ts'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'feat: add token usage api'], { cwd: root });

    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'src', 'logs.ts'), 'export const logsApi = true;\n', 'utf8');
    await writeFile(join(root, 'docs', 'logs-api.md'), '# Logs API\n\nDocuments logs API behavior.\n', 'utf8');
    await execFileAsync('git', ['add', 'src/logs.ts', 'docs/logs-api.md'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'feat: document logs api'], { cwd: root });

    await scanRepository(root);
    await renderProjectViews(root, { language: 'zh' });

    const timeline = await readFile(join(root, 'docs', 'octodocs', 'PROJECT_TIMELINE.md'), 'utf8');
    const recent = await readFile(join(root, 'docs', 'octodocs', 'PRODUCT_RECENT_CHANGES.md'), 'utf8');

    assert.match(timeline, /项目时间线 \/ 历史追溯/);
    assert.match(timeline, /可能缺少文档的 commit/);
    assert.match(timeline, /feat: add token usage api/);
    assert.match(timeline, /src\/api\.ts/);
    assert.match(recent, /变更文档化缺口/);
    assert.match(recent, /feat: add token usage api/);
    assert.doesNotMatch(recent, /feat: document logs api[\s\S]{0,120}缺少文档/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

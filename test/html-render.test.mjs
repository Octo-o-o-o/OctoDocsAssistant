import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { renderProjectViews } from '../src/render/project.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

test('single-file HTML portal renders from ledger and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-html-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature-方案.md'), '# Feature Plan\n\nFeature docs.\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    await renderProjectViews(root);
    const htmlDir = join(root, 'docs', 'octodocs', 'html');
    const indexPath = join(htmlDir, 'index.html');
    const indexHtml = await readFile(indexPath, 'utf8');

    // Self-contained portal: only index.html is produced; per-view pages are removed so
    // in-page anchors can never 404 into a stale file.
    for (const gone of [
      'PROJECT_CURRENT.html', 'PRODUCT_OVERVIEW.html', 'PRODUCT_ARCHITECTURE.html',
      'PRODUCT_DOCS_INDEX.html', 'TECHNICAL_APPENDIX.html', 'DOCUMENTATION_GAPS.html',
      'project.html', 'changes.html', 'angles.html', 'current.html', 'timeline.html', 'evidence.html'
    ]) {
      await assert.rejects(() => readFile(join(htmlDir, gone), 'utf8'), /ENOENT/);
    }

    // Every scenario and Markdown view is inlined as an in-page section.
    for (const id of [
      'view-index', 'view-project', 'view-changes', 'view-angles',
      'view-PRODUCT_OVERVIEW', 'view-PRODUCT_ARCHITECTURE', 'view-PROJECT_CURRENT',
      'view-DOCUMENTATION_GAPS', 'view-TECHNICAL_APPENDIX', 'view-AGENT_HANDOFF'
    ]) {
      assert.match(indexHtml, new RegExp(`id="${id}"`));
    }

    // Inlined content from the Markdown views is present in the single file.
    assert.match(indexHtml, /项目现状/);
    assert.match(indexHtml, /Feature Plan/);
    assert.match(indexHtml, /产品总览/);
    assert.match(indexHtml, /<article class="doc">/);
    assert.match(indexHtml, /<svg class="flow-svg"/);
    assert.doesNotMatch(indexHtml, /mermaid\.min\.js|class="mermaid"/);

    // Navigation is in-page anchors only — no cross-file links to generated views.
    assert.match(indexHtml, /href="#view-project"/);
    assert.match(indexHtml, /href="#view-PRODUCT_OVERVIEW"/);
    assert.doesNotMatch(indexHtml, /href="[^"#]*PRODUCT_OVERVIEW\.html"/);

    // CSS :target switching with a default index view.
    assert.match(indexHtml, /\.view:target\{display:block\}/);
    assert.match(indexHtml, /#view-index\{display:block\}/);

    // Sidebar nav shows scenario navTitles, not the raw scenario titles.
    const nav = indexHtml.match(/<nav>[\s\S]*?<\/nav>/)?.[0] || '';
    assert.match(nav, />变化总览<\/a>/);
    assert.doesNotMatch(nav, />最近变化<\/a>/);

    // Idempotent: a second render writes no new HTML.
    const second = await renderProjectViews(root);
    const secondText = await readFile(indexPath, 'utf8');
    assert.equal(indexHtml, secondText);
    assert.equal(second.files.filter((file) => file.path.endsWith('.html') && file.written).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

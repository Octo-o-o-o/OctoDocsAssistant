import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { renderProductViews } from '../src/render/product.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

test('product views prioritize current entry docs and omit recipe internals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-product-'));
  try {
    await writeFile(
      join(root, 'README.md'),
      '# OctoTest\n\nOctoTest is a governed agent control plane with an operator dashboard, workspace pages, approvals, and audit views.\n',
      'utf8'
    );
    await writeFile(
      join(root, 'SECURITY.md'),
      '# Security Policy\n\nDocuments policy, credentials, audit, access, and permissions.\n',
      'utf8'
    );

    await mkdir(join(root, 'docs', 'security'), { recursive: true });
    await writeFile(
      join(root, 'docs', 'security', 'permissions.md'),
      '# Permission Model\n\nDocuments RBAC, credential boundaries, audit, and access reviews.\n',
      'utf8'
    );

    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(
      join(root, 'docs', 'schema-guide.md'),
      '# Schema Guide\n\nDocuments database schema, event kinds, and data migration compatibility.\n',
      'utf8'
    );
    await writeFile(
      join(root, 'docs', 'automation-design.md'),
      '# Agent Automation Design\n\nDocuments agent automation hooks, scan triggers, generated outputs, and scheduler behavior.\n',
      'utf8'
    );

    await mkdir(join(root, 'docs', 'operations'), { recursive: true });
    await writeFile(
      join(root, 'docs', 'operations', 'automation-hooks.md'),
      '# Automation Hooks\n\nDocuments agent automation hooks, scan triggers, and generated outputs.\n',
      'utf8'
    );

    await mkdir(join(root, 'docs', 'integration'), { recursive: true });
    await writeFile(
      join(root, 'docs', 'integration', 'mcp-api.md'),
      '# MCP API\n\nDocuments external MCP connectors and API integration behavior.\n',
      'utf8'
    );

    await mkdir(join(root, 'octvex-console', 'app', '(dashboard)', 'runs'), { recursive: true });
    await writeFile(
      join(root, 'octvex-console', 'app', '(dashboard)', 'runs', 'README.md'),
      '# Runs Route\n\nNested dashboard route notes for run detail pages.\n',
      'utf8'
    );

    await mkdir(join(root, 'octvex-core', 'src', 'recipe', 'blueprints', 'newsletter'), { recursive: true });
    await writeFile(
      join(root, 'octvex-core', 'src', 'recipe', 'blueprints', 'newsletter', 'SKILL.md'),
      '# Newsletter Recipe\n\nInternal recipe for a generated workflow.\n',
      'utf8'
    );
    await mkdir(join(root, 'octvex-core', 'src', 'recipe', 'blueprints', 'codegen'), { recursive: true });
    await writeFile(
      join(root, 'octvex-core', 'src', 'recipe', 'blueprints', 'codegen', 'export_archive.md'),
      '---\nstatus: archived\n---\n# codegen.export_archive\n\nArchived internal recipe notes.\n',
      'utf8'
    );

    await initProject(root);
    await scanRepository(root);
    await renderProductViews(root, { language: 'zh' });

    const index = await readFile(join(root, 'docs', 'octodocs', 'PRODUCT_DOCS_INDEX.md'), 'utf8');
    const overview = await readFile(join(root, 'docs', 'octodocs', 'PRODUCT_OVERVIEW.md'), 'utf8');
    const architecture = await readFile(join(root, 'docs', 'octodocs', 'PRODUCT_ARCHITECTURE.md'), 'utf8');

    const rootReadmeIndex = index.indexOf('../../README.md');
    const nestedRouteIndex = index.indexOf('../../octvex-console/app/(dashboard)/runs/README.md');
    assert.notEqual(rootReadmeIndex, -1);
    assert.notEqual(nestedRouteIndex, -1);
    assert.ok(rootReadmeIndex < nestedRouteIndex, 'root README should outrank nested route READMEs');

    assert.doesNotMatch(index, /newsletter\/SKILL\.md/);
    assert.doesNotMatch(index, /codegen\/export_archive\.md/);
    assert.doesNotMatch(overview, /newsletter\/SKILL\.md/);
    assert.doesNotMatch(overview, /codegen\/export_archive\.md/);
    assert.match(overview, /<\.\.\/\.\.\/README\.md>/);
    assert.match(overview, /\| 数据与存储 \| Schema Guide /);
    assert.match(overview, /\| 权限、安全与审计 \| Security Policy /);
    assert.match(architecture, /Automation Hooks/);
    assert.match(architecture, /\["自动化执行"\] --> C/);
    assert.match(architecture, /MCP API/);
    assert.match(index, /^# .*产品文档导航/);
    assert.match(index, /<!-- octodocs:managed file id="product-docs-index" hash="[a-f0-9]+" -->\s*$/);
    assert.doesNotMatch(index.slice(0, 120), /octodocs:managed|<!--/);
    assert.doesNotMatch(index.slice(0, 500), /generated_by|schema_version|doc_type|source_mode/);
    assert.doesNotMatch(index.slice(0, 500), /^---$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

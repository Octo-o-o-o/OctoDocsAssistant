import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject, loadConfig } from '../src/config/config.mjs';

test('init creates config, ledger, and gitignore rules idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-init-'));
  try {
    const first = await initProject(root);
    const second = await initProject(root);
    const config = await loadConfig(root);
    const gitignore = await readFile(join(root, '.gitignore'), 'utf8');
    const ledger = await readFile(join(root, '.octodocs', 'ledger.accepted.jsonl'), 'utf8');

    assert.equal(first.config_written, true);
    assert.equal(second.config_written, false);
    assert.equal(config.llm.mode, 'host-agent');
    assert.match(gitignore, /\.octodocs\/cache\.sqlite/);
    assert.doesNotMatch(gitignore, /^\.octodocs\/config\.yml$/m);
    assert.equal(ledger, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid config reports actionable validation error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-config-'));
  try {
    await initProject(root);
    await writeFile(join(root, '.octodocs', 'config.yml'), 'schema_version: 2\n', 'utf8');
    await assert.rejects(() => loadConfig(root), /Run `octodocs init`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { installCommand } from '../src/commands/install.mjs';

const execFileAsync = promisify(execFile);

test('install writes git hooks and agent rules idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-install-'));
  try {
    await execFileAsync('git', ['init'], { cwd: root });
    await initProject(root);
    const first = await installCommand({ root, args: [] });
    const second = await installCommand({ root, args: [] });
    const { stdout } = await execFileAsync('git', ['config', '--get', 'core.hooksPath'], { cwd: root });
    await access(join(root, '.octodocs', 'hooks', 'post-commit'));
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
    const codex = await readFile(join(root, '.codex', 'octodocs-hooks.json'), 'utf8');

    assert.equal(first.data.git.installed, true);
    assert.equal(second.data.git.installed, true);
    assert.equal(stdout.trim(), '.octodocs/hooks');
    assert.match(agents, /octodocs:agent-rules start/);
    assert.match(codex, /enqueue-only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install reports non-git without failing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-install-nongit-'));
  try {
    await initProject(root);
    const result = await installCommand({ root, args: [] });
    assert.equal(result.ok, true);
    assert.equal(result.data.git.installed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

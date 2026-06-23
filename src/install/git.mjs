import { execFile } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isGitRepo } from '../config/config.mjs';

const execFileAsync = promisify(execFile);

function hookScript(kind) {
  if (kind === 'pre-commit') {
    return [
      '#!/bin/sh',
      'ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0',
      'if [ -x "$ROOT/bin/octodocs.mjs" ]; then',
      '  node "$ROOT/bin/octodocs.mjs" status >/dev/null 2>&1 || echo "octodocs: run octodocs init/update after doc changes" >&2',
      'fi',
      'exit 0',
      ''
    ].join('\n');
  }
  if (kind === 'post-merge') {
    return [
      '#!/bin/sh',
      'ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0',
      'if [ -x "$ROOT/bin/octodocs.mjs" ]; then',
      '  node "$ROOT/bin/octodocs.mjs" hook --source git_merge --commit "$(git rev-parse HEAD)" >/dev/null 2>&1 || true',
      'fi',
      ''
    ].join('\n');
  }
  return [
    '#!/bin/sh',
    'ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0',
    'if [ -x "$ROOT/bin/octodocs.mjs" ]; then',
    '  node "$ROOT/bin/octodocs.mjs" hook --source git_commit --commit "$(git rev-parse HEAD)" >/dev/null 2>&1 || true',
    'fi',
    ''
  ].join('\n');
}

export async function installGitHooks(root) {
  const git = await isGitRepo(root);
  if (!git) {
    return { installed: false, warning: 'Not a git repository; git hooks were not installed.' };
  }
  const hooksDir = join(root, '.octodocs', 'hooks');
  await mkdir(hooksDir, { recursive: true });
  const hooks = ['pre-commit', 'post-commit', 'post-merge'];
  for (const hook of hooks) {
    const path = join(hooksDir, hook);
    await writeFile(path, hookScript(hook), 'utf8');
    await chmod(path, 0o755);
  }
  await execFileAsync('git', ['config', 'core.hooksPath', '.octodocs/hooks'], { cwd: root });
  return { installed: true, hooks_path: '.octodocs/hooks', hooks };
}

export async function uninstallGitHooks(root) {
  const git = await isGitRepo(root);
  if (!git) return { uninstalled: false, warning: 'Not a git repository; no git hooks to uninstall.' };
  await rm(join(root, '.octodocs', 'hooks'), { recursive: true, force: true });
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'core.hooksPath'], { cwd: root });
    if (stdout.trim() === '.octodocs/hooks') {
      await execFileAsync('git', ['config', '--unset', 'core.hooksPath'], { cwd: root });
    }
  } catch {
    // Already unset.
  }
  return { uninstalled: true };
}

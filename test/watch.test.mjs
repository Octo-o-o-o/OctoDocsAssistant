import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { pendingJournal } from '../src/settle/journal.mjs';
import { watchOnce } from '../src/watch/watcher.mjs';

test('watcher enqueues md changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-watch-'));
  try {
    await initProject(root);
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'new.md'), '# New\n', 'utf8');
    const once = watchOnce(root, { timeoutMs: 5000, ignoreInitial: false });
    const event = await once;
    assert.equal(event.path, 'docs/new.md');
    assert.equal((await pendingJournal(root)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('watcher ignores generated docs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-watch-ignore-'));
  try {
    await initProject(root);
    await mkdir(join(root, 'docs', 'octodocs'), { recursive: true });
    await writeFile(join(root, 'docs', 'octodocs', 'ignored.md'), '# Ignored\n', 'utf8');
    const ignored = watchOnce(root, { timeoutMs: 500, ignoreInitial: false });
    await assert.rejects(ignored, /Timed out/);
    assert.equal((await pendingJournal(root)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

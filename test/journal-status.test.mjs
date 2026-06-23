import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { statusCommand } from '../src/commands/status.mjs';
import { enqueueJournalEvents, pendingJournal } from '../src/settle/journal.mjs';

test('journal dedupes same path/content across sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-journal-'));
  try {
    await initProject(root);
    const first = await enqueueJournalEvents(root, [
      { source: 'file_change', type: 'doc_updated', path: 'docs/a.md', content: '# A', summary: 'file change' }
    ]);
    const second = await enqueueJournalEvents(root, [
      { source: 'git_commit', type: 'doc_updated', path: 'docs/a.md', content: '# A', commit: 'abc123', summary: 'commit change' }
    ]);
    const pending = await pendingJournal(root);
    const status = await statusCommand({ root });

    assert.equal(first.accepted.length, 1);
    assert.equal(second.accepted.length, 0);
    assert.equal(pending.length, 1);
    assert.equal(status.data.journal.pending, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

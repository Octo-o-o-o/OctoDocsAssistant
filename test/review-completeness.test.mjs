import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { evaluateCompleteness } from '../src/completeness/evaluate.mjs';
import { reviewCommand } from '../src/commands/review.mjs';
import { updateCommand } from '../src/commands/update.mjs';
import { readLedger, splitLedger } from '../src/ledger/store.mjs';
import { enqueueJournalEvents, pendingJournal } from '../src/settle/journal.mjs';
import { scanRepository } from '../src/scan/repository.mjs';
import { writeTaskPackage } from '../src/settle/task.mjs';

async function fixtureWithVerifiedEvidence(root) {
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'src', 'auth.ts'), 'export function auth() {}\n', 'utf8');
  await writeFile(join(root, 'test', 'auth.test.js'), 'test("auth", () => {})\n', 'utf8');
  await writeFile(join(root, 'docs', 'auth-方案.md'), [
    '---',
    'ledger:',
    '  verify_by:',
    '    - src/auth.ts',
    '    - test/auth.test.js',
    '---',
    '# Auth Plan'
  ].join('\n'), 'utf8');
}

test('completeness creates prefilled review instead of auto verified', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-review-'));
  try {
    await fixtureWithVerifiedEvidence(root);
    await initProject(root);
    await scanRepository(root);
    const result = await evaluateCompleteness(root);
    const list = await reviewCommand({ root, args: [] });
    const ledger = splitLedger(await readLedger(root));

    assert.equal(result.review_items_created, 1);
    assert.equal(ledger.claims.some((claim) => claim.verification === 'verified'), false);
    assert.equal(list.data.groups.needs_confirmation.length, 1);
    assert.ok(list.data.groups.needs_confirmation[0].suggested_current_patch.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('confirming review appends verified claim only with implements and tests evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-review-confirm-'));
  try {
    await fixtureWithVerifiedEvidence(root);
    await initProject(root);
    await scanRepository(root);
    await evaluateCompleteness(root);
    const list = await reviewCommand({ root, args: [] });
    const item = list.data.groups.needs_confirmation[0];
    const confirm = await reviewCommand({ root, args: ['confirm', item.id] });
    const ledger = splitLedger(await readLedger(root));

    assert.equal(confirm.data.accepted_records, 1);
    assert.equal(ledger.claims.some((claim) => claim.verification === 'verified'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reject writes personal corrections memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-review-reject-'));
  try {
    await fixtureWithVerifiedEvidence(root);
    await initProject(root);
    await scanRepository(root);
    await evaluateCompleteness(root);
    const item = (await reviewCommand({ root, args: [] })).data.groups.needs_confirmation[0];
    await reviewCommand({ root, args: ['reject', item.id, '--reason', 'bad_mapping'] });
    const corrections = await readFile(join(root, '.octodocs', 'corrections.yml'), 'utf8');
    assert.match(corrections, /bad_mapping/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('update --changed settles pending journal and renders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-update-'));
  try {
    await fixtureWithVerifiedEvidence(root);
    await initProject(root);
    await enqueueJournalEvents(root, [{ source: 'file_change', type: 'doc_updated', path: 'docs/auth-方案.md', content: '# Auth Plan' }]);
    assert.equal((await pendingJournal(root)).length, 1);
    const result = await updateCommand({ root, args: ['--changed'] });
    assert.equal(result.data.settled_journal_events, 1);
    assert.equal((await pendingJournal(root)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('update --summary returns compact agent-facing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-update-summary-'));
  try {
    await fixtureWithVerifiedEvidence(root);
    await initProject(root);
    await enqueueJournalEvents(root, [{ source: 'file_change', type: 'doc_updated', path: 'docs/auth-方案.md', content: '# Auth Plan' }]);
    const result = await updateCommand({ root, args: ['--changed', '--summary'] });

    assert.equal(result.data.settled_journal_events, 1);
    assert.equal(result.data.completeness.coverage_claims >= 1, true);
    assert.equal(typeof result.data.completeness.coverage_by_percent, 'object');
    assert.equal(typeof result.data.render.files, 'number');
    assert.equal(Array.isArray(result.data.completeness.coverage), false);
    assert.equal(Array.isArray(result.data.render.files), false);
    assert.match(result.data.full_report_available, /without `--summary`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('task package redacts secrets in untrusted content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-redact-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'secret.md'), '# Secret\n\napi_key = "sk-1234567890abcdefghijklmnop"\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    const { taskPackage } = await writeTaskPackage(root);
    const serialized = JSON.stringify(taskPackage);
    assert.doesNotMatch(serialized, /sk-123456/);
    assert.match(serialized, /REDACTED_SECRET/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { initProject } from '../src/config/config.mjs';
import { readLedger, splitLedger } from '../src/ledger/store.mjs';
import { renderPhase0 } from '../src/render/phase0.mjs';
import { scanRepository } from '../src/scan/repository.mjs';
import { readReviewItems } from '../src/review/store.mjs';

const execFileAsync = promisify(execFile);
const evalRoot = dirname(fileURLToPath(import.meta.url));

async function writeFixture(root, relativePath, content) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function buildFixture(root) {
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'eval@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Eval'], { cwd: root });

  await writeFixture(root, 'README.md', '# Fixture Project\n\nA small project for OctoDocs evaluation.\n');
  await writeFixture(root, 'docs/auth-需求.md', [
    '---',
    'ledger:',
    '  status: planned',
    '  verify_by:',
    '    - src/auth.ts',
    '    - test/auth.test.js',
    '---',
    '# Auth Requirement',
    '',
    'Auth callback should use `handleCallback`.'
  ].join('\n'));
  await writeFixture(root, 'docs/payments-方案.md', '# Payments Solution\n\nPayments should call `chargeCustomer`, but no implementation exists yet.\n');
  await writeFixture(root, 'docs/stale-old.md', '---\nstatus: stale\n---\n# Old Plan\n\nSuperseded notes.\n');
  await writeFixture(root, 'prototype/demo.html', '<html><head><title>Demo Prototype</title><script>throw new Error("no")</script></head><body><h1>Demo Prototype</h1></body></html>');
  await writeFixture(root, 'docs/deleted-design.md', '# Deleted Design\n\nOld deleted design.\n');
  await writeFixture(root, 'docs/octodocs/PROJECT_CURRENT.md', '# Generated should be ignored\n');
  await writeFixture(root, 'src/auth.ts', 'export function handleCallback() { return true; }\n');
  await writeFixture(root, 'test/auth.test.js', 'import assert from "node:assert/strict";\nassert.equal(true, true);\n');

  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'seed fixture docs'], { cwd: root });
  await rm(join(root, 'docs', 'deleted-design.md'));
  await execFileAsync('git', ['add', '-A'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'remove deleted design'], { cwd: root });
}

function recall(found, truth) {
  const foundSet = new Set(found);
  const hits = truth.filter((item) => foundSet.has(item)).length;
  return truth.length ? hits / truth.length : 1;
}

async function snapshotOutputs(root) {
  const files = [
    '.octodocs/ledger.accepted.jsonl',
    'docs/octodocs/DOCS_INVENTORY.md',
    'docs/octodocs/DRIFT_REPORT.md'
  ];
  const result = {};
  for (const file of files) {
    result[file] = await readFile(join(root, file), 'utf8');
  }
  return result;
}

function diffLines(a, b) {
  let diff = 0;
  for (const key of Object.keys(a)) {
    if (a[key] === b[key]) continue;
    const left = a[key].split('\n');
    const right = b[key].split('\n');
    diff += Math.max(left.length, right.length);
  }
  return diff;
}

async function main() {
  const truth = JSON.parse(await readFile(join(evalRoot, 'fixtures', 'ground-truth.json'), 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'octodocs-eval-'));
  const started = performance.now();
  try {
    await buildFixture(root);
    await initProject(root);
    await scanRepository(root);
    await renderPhase0(root);
    const firstSnapshot = await snapshotOutputs(root);
    await scanRepository(root);
    await renderPhase0(root);
    const secondSnapshot = await snapshotOutputs(root);
    const elapsedMs = performance.now() - started;

    const ledger = splitLedger(await readLedger(root));
    const latestDocs = new Map();
    for (const doc of ledger.documents) latestDocs.set(doc.path, doc);
    const foundDocs = Array.from(latestDocs.keys());
    const staleDocs = Array.from(latestDocs.values())
      .filter((doc) => doc.tombstone || ['stale', 'superseded', 'archived'].includes(doc.doc_status))
      .map((doc) => doc.path);
    const drift = await readFile(join(root, 'docs', 'octodocs', 'DRIFT_REPORT.md'), 'utf8');
    const designedNotImplemented = truth.designed_not_implemented_docs.filter((path) => drift.includes(path));
    const falseVerified = ledger.claims.filter((claim) => claim.verification === 'verified').length;
    const reviewItems = await readReviewItems(root);

    const metrics = {
      doc_discovery_recall: recall(foundDocs, truth.documents),
      stale_doc_recall: recall(staleDocs, truth.stale_docs),
      designed_not_implemented_recall: recall(designedNotImplemented, truth.designed_not_implemented_docs),
      false_verified_count: falseVerified,
      review_items_per_commit: reviewItems.length,
      repeat_run_diff_lines: diffLines(firstSnapshot, secondSnapshot),
      runtime_ms: Math.round(elapsedMs)
    };

    const thresholds = {
      doc_discovery_recall: 0.95,
      stale_doc_recall: 0.85,
      designed_not_implemented_recall: 0.8,
      false_verified_count: 0,
      review_items_per_commit: 5,
      repeat_run_diff_lines: 0,
      runtime_ms: 30000
    };

    assert.ok(metrics.doc_discovery_recall >= thresholds.doc_discovery_recall);
    assert.ok(metrics.stale_doc_recall >= thresholds.stale_doc_recall);
    assert.ok(metrics.designed_not_implemented_recall >= thresholds.designed_not_implemented_recall);
    assert.equal(metrics.false_verified_count, thresholds.false_verified_count);
    assert.ok(metrics.review_items_per_commit <= thresholds.review_items_per_commit);
    assert.equal(metrics.repeat_run_diff_lines, thresholds.repeat_run_diff_lines);
    assert.ok(metrics.runtime_ms < thresholds.runtime_ms);

    process.stdout.write(`${JSON.stringify({ ok: true, metrics, thresholds, next_actions: ['Proceed to Phase 1 only if all metrics meet thresholds.', 'Keep false_verified_count at 0 in every later phase.'] }, null, 2)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { message: error.message, instruction: 'Fix the Phase 0 deterministic scan/render regression, then rerun `npm run eval`.' }, next_actions: ['Inspect evals/run.mjs metrics and fixture expectations.'] }, null, 2)}\n`);
  process.exitCode = 1;
});

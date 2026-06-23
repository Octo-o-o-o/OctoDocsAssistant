import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA_VERSION, makeEvidence, stableClaimId } from '../src/ledger/model.mjs';
import { applyStatePatch, compositeLabel, validateClaimState } from '../src/ledger/state.mjs';

function claim(overrides = {}) {
  return {
    id: stableClaimId('docs/a.md', 'A', 'A'),
    schema_version: SCHEMA_VERSION,
    subject: 'A',
    kind: 'feature',
    intent: 'proposal',
    implementation: 'not_started',
    verification: 'unverified',
    lifecycle: 'current',
    confidence: 0.7,
    supersedes: [],
    evidence_ids: [],
    aliases: [],
    ...overrides
  };
}

test('composite labels are user-facing state summaries', () => {
  assert.equal(compositeLabel(claim()), 'designed_not_implemented');
  assert.equal(compositeLabel(claim({ implementation: 'implemented' })), 'implemented_unverified');
});

test('verified requires implements and tests evidence', () => {
  const impl = makeEvidence({ kind: 'code_symbol', relation: 'implements', path: 'src/a.ts', summary: 'impl', signal_confidence: 0.8 });
  const tests = makeEvidence({ kind: 'test', relation: 'tests', path: 'test/a.test.js', summary: 'tests', signal_confidence: 0.8 });
  assert.throws(() => validateClaimState(claim({ verification: 'verified', evidence_ids: [impl.id] }), { evidences: [impl] }), /cannot be verified/);
  assert.doesNotThrow(() => validateClaimState(claim({ verification: 'verified', evidence_ids: [impl.id, tests.id] }), { evidences: [impl, tests] }));
});

test('released requires release evidence', () => {
  const base = claim({ lifecycle: 'released' });
  assert.throws(() => validateClaimState(base, { evidences: [] }), /cannot be released/);
  const release = makeEvidence({ kind: 'tag', relation: 'supports', path: 'CHANGELOG.md', summary: 'tag release', signal_confidence: 1 });
  assert.doesNotThrow(() => validateClaimState({ ...base, evidence_ids: [release.id] }, { evidences: [release] }));
});

test('state patch rejects illegal transitions', () => {
  assert.throws(() => applyStatePatch(claim(), { verification: 'verified' }, { evidences: [] }), /cannot be verified/);
});

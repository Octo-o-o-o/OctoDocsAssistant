import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDocument } from '../src/classify/doc.mjs';

test('classifies deterministic document categories', () => {
  assert.equal(classifyDocument({ path: 'README.md', title: 'Readme' }).type, 'readme');
  assert.equal(classifyDocument({ path: 'docs/ADR-001.md', title: 'Decision' }).type, 'adr');
  assert.equal(classifyDocument({ path: 'docs/auth-需求.md', title: 'Auth' }).type, 'prd');
  assert.equal(classifyDocument({ path: 'docs/security/outbound-rbac-matrix.md', title: 'Outbound RBAC Matrix' }).type, 'security');
  assert.equal(classifyDocument({ path: 'docs/smoke-checklists/core-smoke.md', title: 'Core Smoke Checklist' }).type, 'checklist');
  assert.equal(classifyDocument({ path: '.github/ISSUE_TEMPLATE/bug_report.md', title: 'Summary' }).type, 'template');
  assert.equal(classifyDocument({ path: 'mock/prototype.html', title: 'Prototype', html_kind: 'prototype' }).type, 'demo-html');
});

test('uncertain documents are gray instead of guessed', () => {
  const result = classifyDocument({ path: 'notes/misc.md', title: 'Misc' });
  assert.equal(result.type, 'unknown');
  assert.equal(result.gray, true);
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject } from '../src/config/config.mjs';
import { readLedger, splitLedger } from '../src/ledger/store.mjs';
import { scanRepository } from '../src/scan/repository.mjs';

test('symbol not_found is recorded as unknown, not not_implemented', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-symbol-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature.md'), '# Feature\n\nNeeds `missingHandler`.\n', 'utf8');
    await initProject(root);
    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    const evidence = ledger.evidences.find((ev) => ev.symbol === 'missingHandler');
    assert.equal(evidence.relation, 'unknown');
    assert.match(evidence.summary, /not evidence of not_implemented/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ledger anchors create implements and tests evidence only for existing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-anchor-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'src', 'auth.ts'), 'export function handleCallback() {}\n', 'utf8');
    await writeFile(join(root, 'test', 'auth.test.js'), 'test("auth", () => {})\n', 'utf8');
    await writeFile(join(root, 'docs', 'auth.md'), [
      '---',
      'ledger:',
      '  status: proposal',
      '  verify_by:',
      '    - src/auth.ts',
      '    - test/auth.test.js',
      '---',
      '# Auth',
      '<!-- ledger:claim id=auth-callback verify=src/missing.ts -->'
    ].join('\n'), 'utf8');
    await initProject(root);
    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    assert.equal(ledger.evidences.some((ev) => ev.path === 'src/auth.ts' && ev.relation === 'implements'), true);
    assert.equal(ledger.evidences.some((ev) => ev.path === 'test/auth.test.js' && ev.relation === 'tests'), true);
    assert.equal(ledger.evidences.some((ev) => ev.path === 'src/missing.ts' && ev.relation === 'unknown'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('symbol matches are aggregated while retaining test evidence samples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-symbol-cap-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'docs', 'feature.md'), '# Feature\n\nUses `sharedSymbol`.\n', 'utf8');
    for (let index = 0; index < 25; index += 1) {
      await writeFile(join(root, 'src', `module-${index}.ts`), `export const value${index} = sharedSymbol;\n`, 'utf8');
    }
    for (let index = 0; index < 3; index += 1) {
      await writeFile(join(root, 'test', `module-${index}.test.js`), `test("shared", () => sharedSymbol);\n`, 'utf8');
    }
    await initProject(root);
    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    const evidences = ledger.evidences.filter((ev) => ev.symbol === 'sharedSymbol' && ev.kind === 'code_symbol');
    const tests = evidences.find((ev) => ev.relation === 'tests');
    const supports = evidences.find((ev) => ev.relation === 'supports');
    assert.equal(evidences.length, 2);
    assert.ok(tests);
    assert.ok(supports);
    assert.equal(tests.links.includes('docs/feature.md'), true);
    assert.equal(tests.links.some((path) => path.endsWith('.test.js')), true);
    assert.match(supports.summary, /sampled 17 of 25 matches/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('symbol extraction caps each source document and skips recipe sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octodocs-symbol-source-cap-'));
  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'docs', 'blueprints'), { recursive: true });
    const symbols = Array.from({ length: 15 }, (_, index) => `SymbolCap${String(index).padStart(2, '0')}`);
    await writeFile(join(root, 'docs', 'design.md'), `# Design\n\n${symbols.map((symbol) => `Uses \`${symbol}\`.`).join('\n')}\n`, 'utf8');
    await writeFile(join(root, 'docs', 'blueprints', 'sample.recipe.md'), '# Sample Recipe\n\nUses `RecipeOnlySymbol`.\n', 'utf8');
    await writeFile(join(root, 'src', 'symbols.ts'), `${symbols.map((symbol) => `export const ${symbol} = true;`).join('\n')}\nexport const RecipeOnlySymbol = true;\n`, 'utf8');
    await initProject(root);
    await scanRepository(root);
    const ledger = splitLedger(await readLedger(root));
    const capped = ledger.evidences.filter((ev) => ev.kind === 'code_symbol' && /^SymbolCap/.test(ev.symbol || ''));
    assert.equal(capped.length, 12);
    assert.equal(ledger.evidences.some((ev) => ev.symbol === 'RecipeOnlySymbol'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

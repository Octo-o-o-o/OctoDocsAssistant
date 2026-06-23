import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { normalizePath } from '../ledger/model.mjs';

const DEFAULT_IGNORES = [
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  '.next/**',
  '**/.next/**',
  '**/.next-e2e/**',
  '**/.test-dist/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.vite/**',
  '.design-sync/**',
  '**/.design-sync/**',
  '.staging/**',
  '**/.staging/**',
  '.workflow/**',
  '**/.workflow/**',
  'vendor/**',
  '**/vendor/**',
  'oh_modules/**',
  '**/oh_modules/**',
  'dist-mobile/**',
  '**/dist-mobile/**',
  '.gradle/**',
  '**/.gradle/**',
  'Pods/**',
  '**/Pods/**',
  '.yarn/**',
  '**/.yarn/**',
  '.pnpm-store/**',
  '**/.pnpm-store/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/storybook-static/**',
  'coverage/**',
  '**/coverage/**',
  'out/**',
  '**/out/**',
  'release/**',
  'release-asar/**',
  'release-local/**',
  'artifacts/**',
  '**/browser-walkthrough-reports/**',
  '**/github-issue-drafts*/**',
  'tmp/**',
  'temp/**',
  '.git/**',
  '.claude/**',
  '.codex/**',
  '.sisyphus/**',
  '**/.sisyphus/**',
  '.omo/**',
  '**/.omo/**',
  'docs/octodocs/**',
  '.octodocs/**'
];

export function defaultIgnores(extra = []) {
  return [...DEFAULT_IGNORES, ...extra];
}

function globToRegExpSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (/[.+?^${}()|[\]\\]/.test(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  return source;
}

export function matchesGlobLike(path, pattern) {
  const normalized = normalizePath(path);
  const pat = normalizePath(pattern);
  if (pat.endsWith('/**') && !pat.slice(0, -3).includes('*')) {
    const dir = pat.slice(0, -3);
    return normalized === dir || normalized.startsWith(`${dir}/`);
  }
  if (pat.startsWith('**/*.')) return normalized.endsWith(pat.slice(4));
  if (pat.includes('*')) {
    return new RegExp(`^${globToRegExpSource(pat)}$`).test(normalized);
  }
  return normalized === pat;
}

export function shouldIgnore(path, ignorePatterns = DEFAULT_IGNORES) {
  return ignorePatterns.some((pattern) => matchesGlobLike(path, pattern));
}

export async function walkFiles(root, { extensions = ['.md', '.html'], ignore = DEFAULT_IGNORES } = {}) {
  const files = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const rel = normalizePath(relative(root, absolute));
      if (shouldIgnore(rel, ignore)) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (entry.isFile() && extensions.some((ext) => rel.toLowerCase().endsWith(ext))) {
        files.push(rel);
      }
    }
  }
  await visit(root);
  return files.sort();
}

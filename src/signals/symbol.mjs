import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walkFiles, defaultIgnores } from '../scan/files.mjs';
import { normalizePath } from '../ledger/model.mjs';
import { classifyDocument } from '../classify/doc.mjs';

const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php', '.cs', '.cpp', '.c', '.h', '.css'];
const MAX_SYMBOL_SIGNALS_PER_DOC = 12;
const SKIP_SYMBOL_SOURCE_TYPES = new Set(['agent-rules', 'recipe', 'template', 'demo-html', 'generated']);

function normalizeSymbolForSearch(symbol) {
  return String(symbol).replace(/^#/, '').replace(/^[\w./-]+#/, '').trim();
}

export async function scanCodeFiles(root, ignore = defaultIgnores()) {
  return walkFiles(root, { extensions: CODE_EXTENSIONS, ignore });
}

async function readCodeFileContents(root, codeFiles) {
  const contents = [];
  for (const path of codeFiles) {
    contents.push({
      path: normalizePath(path),
      content: await readFile(join(root, path), 'utf8')
    });
  }
  return contents;
}

function findSymbolInContents(symbol, codeFileContents) {
  const target = normalizeSymbolForSearch(symbol);
  if (!target) return { symbol, status: 'not_found', matches: [] };
  const matches = [];
  for (const file of codeFileContents) {
    if (file.content.includes(target)) {
      matches.push({ path: file.path, symbol: target });
    }
  }
  return {
    symbol,
    normalized_symbol: target,
    status: matches.length ? 'found' : 'not_found',
    matches
  };
}

export async function findSymbol(root, symbol, { codeFiles = null, ignore = defaultIgnores() } = {}) {
  const files = codeFiles || await scanCodeFiles(root, ignore);
  return findSymbolInContents(symbol, await readCodeFileContents(root, files));
}

export async function collectSymbolSignals(root, parsedDocuments, options = {}) {
  const codeFiles = await scanCodeFiles(root, options.ignore);
  const codeFileContents = await readCodeFileContents(root, codeFiles);
  const symbolCache = new Map();
  const signals = [];
  for (const doc of parsedDocuments) {
    const classification = classifyDocument(doc);
    if (SKIP_SYMBOL_SOURCE_TYPES.has(classification.type)) continue;
    for (const symbol of (doc.code_symbols || []).slice(0, MAX_SYMBOL_SIGNALS_PER_DOC)) {
      const target = normalizeSymbolForSearch(symbol);
      if (!symbolCache.has(target)) {
        symbolCache.set(target, findSymbolInContents(symbol, codeFileContents));
      }
      const result = symbolCache.get(target);
      signals.push({
        type: 'symbol',
        doc_path: doc.path,
        symbol,
        status: result.status,
        matches: result.matches
      });
    }
  }
  return signals;
}

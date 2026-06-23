import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { makeEvidence, normalizePath } from '../ledger/model.mjs';

const MAX_SYMBOL_MATCH_EVIDENCES = 20;
const MAX_TEST_SYMBOL_MATCH_EVIDENCES = 10;

async function exists(root, pathWithFragment) {
  const path = String(pathWithFragment || '').split('#')[0];
  if (!path) return false;
  try {
    await access(join(root, path));
    return true;
  } catch {
    return false;
  }
}

function isTestPath(path) {
  return /(^|\/)(__tests__|test|tests|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|Test\.swift$|Tests\//.test(path);
}

function sampleSymbolMatches(matches) {
  if (matches.length <= MAX_SYMBOL_MATCH_EVIDENCES) return matches;
  const testMatches = [];
  const supportMatches = [];
  for (const match of matches) {
    if (isTestPath(match.path)) testMatches.push(match);
    else supportMatches.push(match);
  }
  const sampledTests = testMatches.slice(0, Math.min(MAX_TEST_SYMBOL_MATCH_EVIDENCES, MAX_SYMBOL_MATCH_EVIDENCES));
  const remaining = MAX_SYMBOL_MATCH_EVIDENCES - sampledTests.length;
  return [...sampledTests, ...supportMatches.slice(0, remaining)];
}

function groupSymbolMatches(matches) {
  const groups = new Map();
  for (const match of matches) {
    const relation = isTestPath(match.path) ? 'tests' : 'supports';
    const group = groups.get(relation) || [];
    group.push(match);
    groups.set(relation, group);
  }
  return groups;
}

function summarizeSymbolMatches({ symbol, docPath, relation, matches, total }) {
  const shown = matches.map((match) => match.path);
  const sampleNote = matches.length < total ? `; sampled ${matches.length} of ${total} matches` : '';
  const relationLabel = relation === 'tests' ? 'test evidence' : 'implementation support';
  return `Symbol ${symbol} referenced by ${docPath} has ${total} ${relationLabel} matches${sampleNote}: ${shown.join(', ')}`;
}

export async function evidenceFromSignals(root, signals) {
  const evidences = [];
  for (const signal of signals) {
    if (signal.type === 'symbol') {
      if (signal.status === 'found') {
        const matches = sampleSymbolMatches(signal.matches);
        const grouped = groupSymbolMatches(matches);
        const allGrouped = groupSymbolMatches(signal.matches);
        for (const [relation, relationMatches] of grouped.entries()) {
          const allRelationMatches = allGrouped.get(relation) || relationMatches;
          const samplePaths = relationMatches.map((match) => match.path);
          evidences.push(makeEvidence({
            kind: 'code_symbol',
            relation,
            path: samplePaths[0],
            symbol: signal.symbol,
            signal_confidence: 0.72,
            summary: summarizeSymbolMatches({
              symbol: signal.symbol,
              docPath: signal.doc_path,
              relation,
              matches: relationMatches,
              total: allRelationMatches.length
            }),
            links: [signal.doc_path, ...samplePaths]
          }));
        }
      } else {
        evidences.push(makeEvidence({
          kind: 'code_symbol',
          relation: 'unknown',
          path: signal.doc_path,
          symbol: signal.symbol,
          signal_confidence: 0.2,
          summary: `Symbol ${signal.symbol} referenced by ${signal.doc_path} was not found; this is not evidence of not_implemented`
        }));
      }
    }

    if (signal.type === 'frontmatter' || signal.type === 'inline') {
      const verify = signal.verify ? normalizePath(signal.verify) : null;
      if (!verify) continue;
      const fileExists = await exists(root, verify);
      evidences.push(makeEvidence({
        kind: isTestPath(verify) ? 'test' : 'code_symbol',
        relation: fileExists ? (isTestPath(verify) ? 'tests' : 'implements') : 'unknown',
        path: verify,
        signal_confidence: fileExists ? 0.78 : 0.25,
        summary: fileExists
          ? `Ledger anchor from ${signal.doc_path} points to existing ${verify}`
          : `Ledger anchor from ${signal.doc_path} points to missing ${verify}; not_found is not not_implemented`,
        links: [signal.doc_path]
      }));
    }

    if (signal.type === 'git_age') {
      evidences.push(makeEvidence({
        kind: 'commit_diff',
        relation: signal.status === 'code_newer_than_doc' ? 'unknown' : 'supports',
        path: signal.referenced_path,
        signal_confidence: signal.status === 'unknown' ? 0.2 : 0.5,
        summary: signal.status === 'unknown'
          ? `Git age could not be determined for ${signal.doc_path} -> ${signal.referenced_path}`
          : `Git age ${signal.age_days} days for ${signal.doc_path} -> ${signal.referenced_path}`
      }));
    }
  }
  return evidences;
}

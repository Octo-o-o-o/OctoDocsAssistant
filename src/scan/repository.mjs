import { join } from 'node:path';
import { loadConfig } from '../config/config.mjs';
import { appendUniqueLedgerRecords, dedupeLedgerRecords, readLedger } from '../ledger/store.mjs';
import { makeDocumentRecord, makeEvent, makeEvidence, normalizePath } from '../ledger/model.mjs';
import { parseMarkdownContent } from './md.mjs';
import { parseHtmlContent } from './html.mjs';
import { defaultIgnores, shouldIgnore, walkFiles } from './files.mjs';
import { scanGitHistory } from './git-history.mjs';
import { collectSymbolSignals } from '../signals/symbol.mjs';
import { collectAnchorSignals } from '../signals/anchor.mjs';
import { evidenceFromSignals } from '../signals/relations.mjs';
import { classifyDocument, classifyDocuments } from '../classify/doc.mjs';
import { buildClaimsFromDocuments } from '../ledger/claims.mjs';
import { readTextIfExists } from '../utils/fs.mjs';

function docStatusFromParsed(parsed) {
  const fmStatus = parsed.frontmatter?.ledger?.status || parsed.frontmatter?.status;
  if (['current', 'draft', 'proposal', 'stale', 'superseded', 'archived', 'conflict', 'generated'].includes(fmStatus)) return fmStatus;
  // Fallback heuristic only when frontmatter does not declare a status. Match on
  // path segments / whole words (not arbitrary substrings) and never downgrade
  // design/architecture docs — those are usually the current source of truth.
  // Lifecycle judgements for unmarked docs are left to evidence / host-agent tasks.
  const pathTitle = `${parsed.path} ${parsed.title}`.toLowerCase();
  if (/(^|[/\-_ ])(draft|wip)([/\-_ .]|$)/.test(pathTitle)) return 'draft';
  if (/(^|[/\-_ ])(archive|archived|deprecated|obsolete|legacy)([/\-_ .]|$)/.test(pathTitle) || /归档|废弃/.test(pathTitle)) return 'archived';
  if (/(^|[/\-_ ])(proposal|rfc)([/\-_ .]|$)/.test(pathTitle)) return 'proposal';
  return 'current';
}

function summaryFor(parsed) {
  const classification = classifyDocument(parsed);
  if (parsed.kind === 'html') return `${parsed.html_kind} HTML: ${parsed.excerpt || parsed.title}`.slice(0, 260);
  const warning = parsed.frontmatter_error ? ' [frontmatter parse warning]' : '';
  return `[${classification.type}] ${(parsed.excerpt || parsed.title || parsed.path).slice(0, 220)}${warning}`;
}

function appendAll(target, items) {
  for (const item of items) target.push(item);
}

function reportProgress(onProgress, event) {
  if (typeof onProgress === 'function') onProgress(event);
}

function parseDocumentContent(content, path) {
  return path.toLowerCase().endsWith('.html')
    ? parseHtmlContent(content, path)
    : parseMarkdownContent(content, path);
}

async function changedDocsForScan(root, changedFiles, ignore) {
  const seen = new Set();
  const existing = [];
  const missing = [];
  for (const rawPath of changedFiles || []) {
    const path = normalizePath(rawPath || '');
    if (!path || !path.match(/\.(md|html)$/i) || shouldIgnore(path, ignore) || seen.has(path)) continue;
    seen.add(path);
    const content = await readTextIfExists(join(root, path));
    if (content == null) {
      missing.push(path);
    } else {
      existing.push({ path, content });
    }
  }
  return {
    existing: existing.sort((a, b) => a.path.localeCompare(b.path)),
    missing: missing.sort()
  };
}

export async function scanRepository(root, { writeLedger = true, changedFiles = null, onProgress = null } = {}) {
  const config = await loadConfig(root);
  const ignore = defaultIgnores(config.watch.exclude);
  reportProgress(onProgress, { phase: 'git-history', message: 'reading markdown/html history' });
  const gitHistory = await scanGitHistory(root, ignore);
  const changedDocs = changedFiles ? await changedDocsForScan(root, changedFiles, ignore) : null;
  const fileEntries = changedDocs
    ? changedDocs.existing
    : (await walkFiles(root, { extensions: ['.md', '.html'], ignore })).map((path) => ({ path }));
  const files = fileEntries.map((entry) => entry.path);
  const records = [];
  const documents = [];
  const parsed_documents = [];

  for (const [index, entry] of fileEntries.entries()) {
    const { path } = entry;
    reportProgress(onProgress, { phase: 'scan-files', current: index + 1, total: files.length, path });
    const content = entry.content ?? await readTextIfExists(join(root, path));
    if (content == null) continue;
    const parsed = parseDocumentContent(content, path);
    parsed_documents.push(parsed);
    const history = gitHistory.paths.get(path) || {};
    const document = makeDocumentRecord({
      path,
      title: parsed.title,
      content,
      doc_status: docStatusFromParsed(parsed),
      first_seen_commit: history.first_seen_commit,
      last_seen_commit: history.last_seen_commit,
      tombstone: false,
      render_summary: summaryFor(parsed)
    });
    const evidence = makeEvidence({
      kind: parsed.kind === 'html' ? 'html' : 'doc',
      relation: parsed.kind === 'html' ? 'mentions' : 'documents',
      path,
      signal_confidence: parsed.kind === 'html' ? 0.45 : 0.75,
      summary: parsed.kind === 'html'
        ? `HTML artifact observed; not product fact without route/deploy/code evidence: ${parsed.title}`
        : `Document states project intent or context: ${parsed.title}${parsed.frontmatter_error ? ` (frontmatter parse warning: ${parsed.frontmatter_error})` : ''}`
    });
    const event = makeEvent({
      source: 'file_change',
      type: 'doc_updated',
      path,
      content,
      summary: `${path} scanned as ${parsed.kind}`,
      evidence_ids: [evidence.id]
    });
    documents.push(document);
    records.push(document, evidence, event);
  }

  if (changedDocs?.missing.length) {
    reportProgress(onProgress, { phase: 'changed-deletions', current: 0, total: changedDocs.missing.length, message: 'recording missing changed docs' });
    for (const [index, path] of changedDocs.missing.entries()) {
      reportProgress(onProgress, { phase: 'changed-deletions', current: index + 1, total: changedDocs.missing.length, path });
      const parsed = parseDocumentContent('', path);
      const document = makeDocumentRecord({
        path,
        title: parsed.title,
        content: '',
        doc_status: 'archived',
        tombstone: true,
        render_summary: `Deleted working-tree document observed during changed scan: ${path}`
      });
      const evidence = makeEvidence({
        kind: parsed.kind === 'html' ? 'html' : 'doc',
        relation: 'removes',
        path,
        signal_confidence: 0.65,
        summary: `Document was missing during changed-file scan: ${path}`
      });
      const event = makeEvent({
        source: 'file_change',
        type: 'doc_deleted',
        path,
        content: path,
        summary: `${path} missing during changed-file scan`,
        evidence_ids: [evidence.id]
      });
      documents.push(document);
      records.push(document, evidence, event);
    }
  }

  reportProgress(onProgress, { phase: 'deleted-docs', current: 0, total: gitHistory.deleted.length, message: 'recording tombstones' });
  const currentPaths = new Set([...files, ...(changedDocs?.missing || [])]);
  for (const [index, deleted] of gitHistory.deleted.entries()) {
    reportProgress(onProgress, { phase: 'deleted-docs', current: index + 1, total: gitHistory.deleted.length, path: deleted.path });
    if (currentPaths.has(deleted.path)) continue;
    const parsed = deleted.path.endsWith('.html')
      ? parseHtmlContent(deleted.content || '', deleted.path)
      : parseMarkdownContent(deleted.content || '', deleted.path);
    const document = makeDocumentRecord({
      path: deleted.path,
      title: parsed.title,
      content: deleted.content || '',
      doc_status: 'archived',
      last_seen_commit: deleted.commit,
      tombstone: true,
      render_summary: `Deleted historical document last seen at ${deleted.commit}`
    });
    const evidence = makeEvidence({
      kind: parsed.kind === 'html' ? 'html' : 'doc',
      relation: 'removes',
      path: deleted.path,
      commit: deleted.commit,
      signal_confidence: 0.9,
      summary: `Document was deleted in git history: ${deleted.path}`
    });
    const event = makeEvent({
      source: 'git_commit',
      type: 'doc_deleted',
      path: deleted.path,
      content: deleted.content || deleted.path,
      commit: deleted.commit,
      ts: deleted.ts,
      summary: `${deleted.path} deleted in ${deleted.commit}`,
      evidence_ids: [evidence.id]
    });
    documents.push(document);
    records.push(document, evidence, event);
  }

  if (!changedFiles) {
    const recentCommits = gitHistory.recent_commits || [];
    for (const [index, commit] of recentCommits.entries()) {
      reportProgress(onProgress, { phase: 'recent-commits', current: index + 1, total: recentCommits.length, message: commit.summary });
      const evidence = makeEvidence({
        kind: 'commit_diff',
        relation: 'unknown',
        commit: commit.commit,
        signal_confidence: 0.55,
        summary: `Git commit summary: ${commit.summary}`,
        links: commit.files.slice(0, 20)
      });
      const event = makeEvent({
        source: 'git_commit',
        type: 'commit',
        path: `git/${commit.commit}`,
        content: `${commit.ts}\n${commit.summary}\n${commit.files.join('\n')}`,
        commit: commit.commit,
        ts: commit.ts,
        summary: commit.summary,
        evidence_ids: [evidence.id]
      });
      records.push(evidence, event);
    }
  }

  reportProgress(onProgress, { phase: 'signals', message: 'collecting symbol and anchor evidence' });
  const symbolSignals = await collectSymbolSignals(root, parsed_documents, { ignore });
  const anchorSignals = collectAnchorSignals(parsed_documents);
  reportProgress(onProgress, { phase: 'evidence', message: `building evidence from ${symbolSignals.length + anchorSignals.length} signals` });
  const signalEvidences = await evidenceFromSignals(root, [...symbolSignals, ...anchorSignals]);
  appendAll(records, signalEvidences);
  const allEvidences = records.filter((record) => record.relation && record.signal_confidence != null);
  reportProgress(onProgress, { phase: 'claims', message: 'building claims from documents and evidence' });
  const claims = buildClaimsFromDocuments(documents, allEvidences, records.filter((record) => record.change_fingerprint));
  appendAll(records, claims);

  reportProgress(onProgress, { phase: 'ledger', message: writeLedger ? 'writing accepted ledger records' : 'dry run, not writing ledger' });
  const write = writeLedger
    ? await appendUniqueLedgerRecords(root, records)
    : dedupeLedgerRecords(await readLedger(root), records);
  return {
    files,
    documents,
    claims,
    parsed_documents,
    classifications: classifyDocuments(parsed_documents),
    records,
    signals: [...symbolSignals, ...anchorSignals],
    accepted: write.accepted,
    skipped: write.skipped,
    git_history_available: gitHistory.available
  };
}

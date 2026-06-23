import { classifyDocument } from '../classify/doc.mjs';
import { text, none } from './i18n.mjs';

function latestDocuments(documents) {
  const byPath = new Map();
  for (const doc of documents) byPath.set(doc.path, doc);
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function bulletList(items, language, limit = 80) {
  if (!items.length) return `${none(language)}\n`;
  const visible = items.slice(0, limit);
  const hidden = items.length - visible.length;
  const suffix = hidden > 0
    ? `\n- ${language === 'zh' ? `另有 ${hidden} 项未展开；完整记录见 DOCS_INVENTORY 或 TECHNICAL_APPENDIX。` : `${hidden} more items omitted; see DOCS_INVENTORY or TECHNICAL_APPENDIX for the full record.`}`
    : '';
  return `${visible.map((item) => `- ${item}`).join('\n')}${suffix}\n`;
}

export function renderDriftMarkdown({ documents, evidences, language = 'zh' }) {
  const docs = latestDocuments(documents);
  const codeEvidence = evidences.filter((ev) => ['implements', 'tests', 'supports'].includes(ev.relation));
  const noCodeEvidenceDocs = docs
    .filter((doc) => !doc.tombstone && ['prd', 'solution', 'design'].includes(classifyDocument(doc).type))
    .filter((doc) => !codeEvidence.some((ev) => ev.links?.includes(doc.path) || ev.summary.includes(doc.path)))
    .map((doc) => `${doc.path}: ${text(language, 'noDeterministicEvidence')}`);
  const stale = docs
    .filter((doc) => doc.tombstone || ['stale', 'superseded', 'archived', 'conflict'].includes(doc.doc_status))
    .map((doc) => `${doc.path}: ${doc.tombstone ? text(language, 'deletedTombstone') : doc.doc_status}`);
  const conflicts = docs.filter((doc) => doc.doc_status === 'conflict').map((doc) => `${doc.path}: ${text(language, 'markedConflict')}`);
  const supersededStillReadable = docs
    .filter((doc) => !doc.tombstone && doc.doc_status === 'superseded')
    .map((doc) => `${doc.path}: ${text(language, 'supersededPresent')}`);
  const gray = docs
    .map((doc) => ({ doc, classification: classifyDocument(doc) }))
    .filter((item) => item.classification.gray)
    .map((item) => `${item.doc.path}: ${item.classification.reason}`);

  return [
    `# ${text(language, 'drift')}`,
    '',
    text(language, 'driftIntro'),
    '',
    `## ${text(language, 'staleDocs')}`,
    '',
    bulletList(stale, language, 60),
    `## ${text(language, 'deletedReferenced')}`,
    '',
    `- ${text(language, 'notEvaluatedLinks')}`,
    '',
    `## ${text(language, 'noCodeEvidence')}`,
    '',
    bulletList(noCodeEvidenceDocs, language, 60),
    `## ${text(language, 'codeNoDocs')}`,
    '',
    `- ${text(language, 'notEvaluatedCode')}`,
    '',
    `## ${text(language, 'conflicts')}`,
    '',
    bulletList(conflicts, language, 60),
    `## ${text(language, 'supersededReadable')}`,
    '',
    bulletList(supersededStillReadable, language, 60),
    `## ${text(language, 'grayItems')}`,
    '',
    bulletList(gray, language, 80)
  ].join('\n');
}

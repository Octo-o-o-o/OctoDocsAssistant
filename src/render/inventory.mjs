import { classifyDocument } from '../classify/doc.mjs';
import { text, yesNo } from './i18n.mjs';

const RECOMMENDED_TYPES = new Set([
  'readme',
  'prd',
  'solution',
  'design',
  'adr',
  'api',
  'guide',
  'runbook',
  'security',
  'roadmap',
  'checklist',
  'schema',
  'recipe',
  'changelog'
]);

function latestDocuments(documents) {
  const byPath = new Map();
  for (const doc of documents) byPath.set(doc.path, doc);
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function lowPriorityPath(path) {
  return [
    /^\.github\//,
    /^\.design-sync\//,
    /^\.omo\//,
    /^\.sisyphus\//,
    /^tests?\//,
    /(^|\/)__fixtures__\//,
    /(^|\/)fixtures\//,
    /(^|\/)templates?\//,
    /(^|\/)browser-walkthrough-reports\//,
    /(^|\/)github-issue-drafts[^/]*\//,
    /(^|\/)node_modules\//,
    /(^|\/)vendor\//
  ].some((pattern) => pattern.test(String(path || '')));
}

function recommendedRead(doc, classification) {
  if (doc.tombstone) return false;
  if (!['current', 'proposal', 'draft'].includes(doc.doc_status)) return false;
  if (lowPriorityPath(doc.path)) return false;
  return RECOMMENDED_TYPES.has(classification.type);
}

export function renderInventoryMarkdown({ documents, language = 'zh' }) {
  const rows = latestDocuments(documents);
  const lines = [
    `# ${text(language, 'docsInventory')}`,
    '',
    text(language, 'inventoryIntro'),
    '',
    `| ${text(language, 'document')} | ${text(language, 'type')} | ${text(language, 'docStatus')} | ${text(language, 'subject')} | ${text(language, 'confidence')} | ${text(language, 'recommendedRead')} | ${text(language, 'supersededBy')} |`,
    '|---|---|---|---|---:|---|---|'
  ];
  for (const doc of rows) {
    const classification = classifyDocument(doc);
    const recommended = recommendedRead(doc, classification);
    lines.push([
      doc.tombstone ? `~~${doc.path}~~` : doc.path,
      classification.type,
      doc.tombstone ? `${doc.doc_status} tombstone` : doc.doc_status,
      (doc.title || '').replaceAll('|', '/'),
      classification.confidence.toFixed(2),
      yesNo(language, recommended),
      doc.superseded_by || ''
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  if (!rows.length) lines.push(`| _${text(language, 'none')}_ | ${text(language, 'unknown')} | current | ${language === 'zh' ? '未发现文档' : 'No documents discovered'} | 0.00 | ${text(language, 'no')} | |`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

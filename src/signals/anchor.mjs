import { normalizePath } from '../ledger/model.mjs';

function normalizeVerifyList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

export function extractAnchors(parsedDocument) {
  const anchors = [];
  const ledger = parsedDocument.frontmatter?.ledger || {};
  for (const verify of normalizeVerifyList(ledger.verify_by)) {
    anchors.push({
      type: 'frontmatter',
      doc_path: parsedDocument.path,
      claim_id: ledger.id || null,
      verify: normalizePath(verify),
      status: ledger.status || null
    });
  }

  const regex = /<!--\s*ledger:claim\s+([^>]+?)\s*-->/g;
  for (const match of parsedDocument.content.matchAll(regex)) {
    const attrs = {};
    for (const attrMatch of match[1].matchAll(/([a-zA-Z_][\w-]*)=("[^"]+"|'[^']+'|[^\s]+)/g)) {
      attrs[attrMatch[1]] = attrMatch[2].replace(/^['"]|['"]$/g, '');
    }
    anchors.push({
      type: 'inline',
      doc_path: parsedDocument.path,
      claim_id: attrs.id || null,
      verify: attrs.verify ? normalizePath(attrs.verify) : null,
      status: attrs.status || null
    });
  }
  return anchors;
}

export function collectAnchorSignals(parsedDocuments) {
  return parsedDocuments.flatMap((doc) => extractAnchors(doc));
}

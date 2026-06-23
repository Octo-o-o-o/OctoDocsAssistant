import { join } from 'node:path';
import { sha256 } from '../ledger/model.mjs';
import { readTextIfExists, writeText } from '../utils/fs.mjs';
import { enqueueReviewItems } from '../review/store.mjs';

const START_RE = /<!-- octodocs:managed start id="([^"]+)" hash="([a-f0-9]+)" -->/g;
const FOOTER_RE = /<!-- octodocs:managed file id="([^"]+)" hash="([a-f0-9]+)" -->\s*$/;

function normalizedManagedBody(body) {
  return `${String(body || '').trimEnd()}\n`;
}

function legacyManagedBlock(id, body) {
  const hash = sha256(body);
  return `<!-- octodocs:managed start id="${id}" hash="${hash}" -->\n${body}<!-- octodocs:managed end id="${id}" -->`;
}

export function managedBlock(id, body) {
  const normalized = normalizedManagedBody(body);
  const hash = sha256(normalized);
  return `${normalized}<!-- octodocs:managed file id="${id}" hash="${hash}" -->`;
}

function stripLegacyGeneratedPrefix(text) {
  const original = String(text || '');
  let next = original.trimStart();
  next = next.replace(/^<!-- AGENT:[\s\S]*?-->\s*/, '');
  next = next.replace(/^---\s*\ngenerated_by:\s*octodocs\s*\nschema_version:\s*1\s*\nview:\s*[A-Z0-9_ -]+\s*\n---\s*/i, '');
  return next.trim() ? original : '';
}

function findManagedBlocks(text, id) {
  const blocks = [];
  START_RE.lastIndex = 0;
  let match;
  while ((match = START_RE.exec(text)) != null) {
    const [startMarker, blockId, hash] = match;
    const contentStart = match.index + startMarker.length + 1;
    const endMarker = `<!-- octodocs:managed end id="${blockId}" -->`;
    const endIndex = text.indexOf(endMarker, contentStart);
    if (endIndex === -1) continue;
    const content = text.slice(contentStart, endIndex);
    blocks.push({ id: blockId, hash, start: match.index, end: endIndex + endMarker.length, content });
  }
  return blocks.filter((block) => block.id === id);
}

function findManagedFooter(text, id) {
  const match = String(text || '').match(FOOTER_RE);
  if (!match || match[1] !== id) return null;
  return {
    id: match[1],
    hash: match[2],
    start: match.index,
    content: String(text || '').slice(0, match.index)
  };
}

export async function renderManagedFile(root, relativePath, { id, view, body, agentComment }) {
  const filePath = join(root, relativePath);
  const existing = await readTextIfExists(filePath);
  const block = managedBlock(id, body);
  const fresh = `${block}\n`;

  if (existing) {
    const footer = findManagedFooter(existing, id);
    if (footer) {
      if (sha256(footer.content) !== footer.hash) {
        await enqueueReviewItems(root, [{
          severity: 'blocking',
          doc_path: relativePath,
          reason: `Managed file "${id}" in ${relativePath} was modified by hand; refusing to overwrite silently.`,
          suggested_current_patch: fresh,
          suggested_timeline_entry: `Review manual edits inside generated managed file ${relativePath}#${id}.`,
          confidence: 1
        }]);
        return { path: relativePath, written: false, warning: 'managed_block_modified' };
      }
      if (fresh === existing) return { path: relativePath, written: false, warning: null };
      await writeText(filePath, fresh);
      return { path: relativePath, written: true, warning: null };
    }

    const blocks = findManagedBlocks(existing, id);
    if (blocks.length > 1) {
      await enqueueReviewItems(root, [{
        severity: 'blocking',
        doc_path: relativePath,
        reason: `Duplicate managed block id "${id}" in ${relativePath}; refusing to overwrite generated view.`,
        suggested_current_patch: fresh,
        suggested_timeline_entry: `Resolve duplicate managed block id "${id}" in ${relativePath}.`,
        confidence: 1
      }]);
      return { path: relativePath, written: false, warning: 'duplicate_managed_block' };
    }
    if (blocks.length === 1) {
      if (sha256(blocks[0].content) !== blocks[0].hash) {
        await enqueueReviewItems(root, [{
          severity: 'blocking',
          doc_path: relativePath,
          reason: `Managed block "${id}" in ${relativePath} was modified by hand; refusing to overwrite silently.`,
          suggested_current_patch: fresh,
          suggested_timeline_entry: `Review manual edits inside generated managed block ${relativePath}#${id}.`,
          confidence: 1
        }]);
        return { path: relativePath, written: false, warning: 'managed_block_modified' };
      }
      // Replace only the managed block region; preserve any user content outside it (spec §12).
      const before = stripLegacyGeneratedPrefix(existing.slice(0, blocks[0].start));
      const after = existing.slice(blocks[0].end);
      const next = `${before}${fresh}${after.trim() ? after : ''}`;
      if (next === existing) return { path: relativePath, written: false, warning: null };
      await writeText(filePath, next);
      return { path: relativePath, written: true, warning: null };
    }
    // Existing file but no managed block: append ours instead of clobbering user content.
    const appended = `${existing.trimEnd()}\n\n${legacyManagedBlock(id, body)}\n`;
    await writeText(filePath, appended);
    return { path: relativePath, written: true, warning: null };
  }

  await writeText(filePath, fresh);
  return { path: relativePath, written: true, warning: null };
}

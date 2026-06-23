import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureParent, readTextIfExists } from '../utils/fs.mjs';
import { ReviewItemSchema, makeReviewItem } from './model.mjs';
import { rejectedSignatures } from './corrections.mjs';

export function reviewItemsPath(root) {
  return join(root, '.octodocs', 'review', 'items.jsonl');
}

export async function readReviewItems(root) {
  const text = await readTextIfExists(reviewItemsPath(root));
  if (!text) return [];
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => ReviewItemSchema.parse(JSON.parse(line)));
}

export async function enqueueReviewItems(root, inputs) {
  const existing = await readReviewItems(root);
  const existingIds = new Set(existing.map((item) => item.id));
  const existingSignatures = new Set(existing.map(reviewSignature));
  // Correction memory: never re-surface an item the user already rejected.
  const rejected = await rejectedSignatures(root);
  const accepted = [];
  for (const input of inputs) {
    const item = makeReviewItem(input);
    const signature = reviewSignature(item);
    if (existingIds.has(item.id) || existingSignatures.has(signature) || rejected.has(signature)) continue;
    accepted.push(item);
    existingIds.add(item.id);
    existingSignatures.add(signature);
  }
  if (accepted.length) {
    const filePath = reviewItemsPath(root);
    await ensureParent(filePath);
    await appendFile(filePath, `${accepted.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  }
  return accepted;
}

export function reviewSignature(item) {
  return JSON.stringify({
    severity: item.severity,
    claim_id: item.claim_id || null,
    doc_path: item.doc_path || null,
    reason: item.reason,
    suggested_state_patch: item.suggested_state_patch || {}
  });
}

export async function rewriteReviewItems(root, items) {
  const filePath = reviewItemsPath(root);
  await ensureParent(filePath);
  await writeFile(filePath, items.map((item) => JSON.stringify(ReviewItemSchema.parse(item))).join('\n') + (items.length ? '\n' : ''), 'utf8');
}

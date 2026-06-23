import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureParent, readTextIfExists } from '../utils/fs.mjs';

export function correctionsPath(root) {
  return join(root, '.octodocs', 'corrections.yml');
}

// Corrections are stored as a YAML sequence of flow-style JSON mappings, one per line
// (`- {"id":...}`), which is valid YAML and append-friendly.
export async function appendCorrection(root, correction) {
  await ensureParent(correctionsPath(root));
  await appendFile(correctionsPath(root), `- ${JSON.stringify(correction)}\n`, 'utf8');
  return correction;
}

export async function readCorrections(root) {
  const text = await readTextIfExists(correctionsPath(root));
  if (!text) return [];
  // Parse each `- {json}` line directly so a `#` inside a JSON value is never mistaken
  // for a YAML comment.
  const corrections = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    try {
      corrections.push(JSON.parse(trimmed.slice(2)));
    } catch {
      // Skip unparseable lines rather than failing the whole read.
    }
  }
  return corrections;
}

// Signatures of review items the user has rejected, used to suppress re-surfacing them.
export async function rejectedSignatures(root) {
  return new Set((await readCorrections(root)).map((c) => c.signature).filter(Boolean));
}

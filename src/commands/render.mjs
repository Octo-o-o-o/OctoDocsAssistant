import { ok } from '../agent/output.mjs';
import { renderProjectViews } from '../render/project.mjs';
import { languageOption } from './options.mjs';

export async function renderCommand({ root, args = [] }) {
  const result = await renderProjectViews(root, languageOption(args));
  return ok(result, [
    'Run `octodocs render` again to verify generated views are idempotent.',
    'If warnings mention managed blocks, inspect `octodocs review` before overwriting user edits.',
    'Run `octodocs rebuild --from-ledger` when cache support is enabled.'
  ]);
}

import { initProject } from '../config/config.mjs';
import { ok } from '../agent/output.mjs';

export async function initCommand({ root }) {
  const result = await initProject(root);
  return ok(result, [
    'Run `octodocs scan` to create deterministic ledger records from Markdown and HTML.',
    'Commit .octodocs/config.yml and .octodocs/ledger.accepted.jsonl; keep cache, journal, review, and corrections ignored.',
    result.git_repo ? 'Run `octodocs install` when you want local hooks.' : 'Initialize git before using commit hooks.'
  ]);
}

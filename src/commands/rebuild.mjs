import { ok, fail } from '../agent/output.mjs';
import { rebuildFromLedger } from '../ledger/cache.mjs';
import { languageOption } from './options.mjs';

export async function rebuildCommand({ root, args }) {
  if (!args.includes('--from-ledger')) {
    return fail(
      'REBUILD_SOURCE_REQUIRED',
      'Rebuild requires an explicit source.',
      'Run `octodocs rebuild --from-ledger`; ledger.accepted.jsonl is the only source of truth.',
      { args }
    );
  }
  const result = await rebuildFromLedger(root, languageOption(args));
  return ok(result, [
    'Run `octodocs rebuild --from-ledger` again to confirm idempotence.',
    'If generated views differ unexpectedly, inspect .octodocs/ledger.accepted.jsonl rather than editing views.',
    'Proceed only if false verified remains 0.'
  ]);
}

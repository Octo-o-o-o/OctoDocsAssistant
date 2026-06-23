#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  const checks = [
    ['node', ['bin/octodocs.mjs', '--help']],
    ['node', ['bin/octodocs.mjs', 'help-agent']],
    ['npm', ['test']],
    ['npm', ['run', 'eval']]
  ];
  for (const [cmd, args] of checks) {
    const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 20 * 1024 * 1024 });
    if (cmd === 'node' && !stdout.includes('"ok": true')) {
      throw new Error(`${cmd} ${args.join(' ')} did not return ok=true`);
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, next_actions: ['Run octodocs rebuild --from-ledger before handoff.'] }, null, 2) + '\n');
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: error.message, instruction: 'Fix the failing skill check, then rerun npm run check-skill.' }, next_actions: [] }, null, 2) + '\n');
  process.exitCode = 1;
});

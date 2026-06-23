import { commandHelp, fail, ok, printPayload } from './output.mjs';
import { helpAgentManifest } from './help.mjs';
import { initCommand } from '../commands/init.mjs';
import { scanCommand } from '../commands/scan.mjs';
import { renderCommand } from '../commands/render.mjs';
import { rebuildCommand } from '../commands/rebuild.mjs';
import { applyCommand, emitTasksCommand } from '../commands/settle.mjs';
import { statusCommand } from '../commands/status.mjs';
import { hookCommand } from '../commands/hook.mjs';
import { installCommand } from '../commands/install.mjs';
import { reviewCommand } from '../commands/review.mjs';
import { updateCommand } from '../commands/update.mjs';
import { watchCommand } from '../commands/watch.mjs';

const PLACEHOLDER_COMMANDS = new Set([]);

export async function runCli(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    printPayload(commandHelp());
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    printPayload(commandHelp(command));
    return;
  }
  if (command === 'help-agent') {
    printPayload(helpAgentManifest());
    return;
  }
  if (command === 'init') {
    printPayload(await initCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'scan') {
    printPayload(await scanCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'render') {
    printPayload(await renderCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'rebuild') {
    printPayload(await rebuildCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'emit-tasks') {
    printPayload(await emitTasksCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'apply') {
    printPayload(await applyCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'status') {
    printPayload(await statusCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'hook') {
    printPayload(await hookCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'install') {
    printPayload(await installCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'review') {
    printPayload(await reviewCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'update') {
    printPayload(await updateCommand({ root: process.cwd(), args }));
    return;
  }
  if (command === 'watch') {
    await watchCommand({ root: process.cwd(), args });
    return;
  }
  if (command === 'migrate') {
    printPayload(ok(
      { from_schema_version: 1, to_schema_version: 1, migrated_records: 0 },
      [
        'Ledger is already at schema_version 1; no migration is required.',
        'Run `octodocs rebuild --from-ledger` to regenerate cache and views.'
      ]
    ));
    return;
  }
  if (PLACEHOLDER_COMMANDS.has(command)) {
    printPayload(ok(
      {
        command,
        implemented: false,
        args
      },
      [
        'This command is scaffolded in P0-1 and will be implemented by the matching phase step.',
        'Continue with the implementation plan before relying on this command for project state.'
      ]
    ));
    return;
  }
  printPayload(fail(
    'UNKNOWN_COMMAND',
    `Unknown octodocs command: ${command}`,
    'Run `octodocs --help` and choose one of the listed commands.',
    { command, args }
  ));
  process.exitCode = 2;
}

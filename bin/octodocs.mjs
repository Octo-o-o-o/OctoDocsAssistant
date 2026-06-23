#!/usr/bin/env node
import { runCli } from '../src/agent/cli.mjs';

runCli(process.argv.slice(2)).catch((error) => {
  const message = error?.message || 'Unknown error';
  const payload = {
    ok: false,
    error: {
      code: 'UNHANDLED_ERROR',
      message,
      instruction: 'Run `octodocs status` to inspect the project state. If the error repeats, rerun the command with a narrower target path.'
    },
    next_actions: [
      'Read the error.instruction field and retry with the suggested command.',
      'Do not edit generated docs/octodocs files by hand; rerun octodocs render or rebuild instead.'
    ]
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});

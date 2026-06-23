#!/usr/bin/env node
import { cp, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

async function main() {
  const source = resolve('.');
  const targetRoot = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), '.codex', 'skills');
  const target = join(targetRoot, basename(source));
  await mkdir(targetRoot, { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: (path) => !path.includes('node_modules') && !path.includes('/.git') && !path.includes('.octodocs/cache.sqlite') && !path.includes('.octodocs/journal') && !path.includes('.octodocs/review')
  });
  process.stdout.write(JSON.stringify({ ok: true, data: { target }, next_actions: ['Run scripts/check-skill.mjs in the installed skill directory.'] }, null, 2) + '\n');
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: error.message, instruction: 'Pass an explicit skill target directory or ensure ~/.codex/skills is writable.' }, next_actions: [] }, null, 2) + '\n');
  process.exitCode = 1;
});

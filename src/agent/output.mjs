export function ok(data = {}, nextActions = []) {
  return {
    ok: true,
    data,
    next_actions: nextActions
  };
}

export function fail(code, message, instruction, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      instruction,
      details
    },
    next_actions: [instruction]
  };
}

export function printPayload(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function commandHelp(command = null) {
  const commands = [
    { name: 'init', summary: 'Create .octodocs config, ledger, and ignore rules.' },
    { name: 'scan', summary: 'Scan trusted file types as untrusted data and write deterministic ledger entries; use --dry-run for no-write deduped impact.' },
    { name: 'render', summary: 'Render docs/octodocs views from ledger data.' },
    { name: 'status', summary: 'Show ledger, journal, review, and generated-view status.' },
    { name: 'update', summary: 'Scan changed files or the full repo, settle deterministic items, and render views; use --dry-run for no-write preview.' },
    { name: 'rebuild', summary: 'Rebuild cache and generated views from .octodocs/ledger.accepted.jsonl.' },
    { name: 'migrate', summary: 'Migrate the ledger to the current schema_version (no-op at v1).' },
    { name: 'emit-tasks', summary: 'Emit host-agent task packages for pending semantic work.' },
    { name: 'apply', summary: 'Validate host-agent answers and write accepted ledger entries.' },
    { name: 'review', summary: 'List or act on prefilled review items.' },
    { name: 'install', summary: 'Install local git and agent hooks that only enqueue deterministic events.' },
    { name: 'watch', summary: 'Watch local Markdown/HTML changes and enqueue file-change events.' },
    { name: 'hook', summary: 'Internal hook entrypoint; enqueue only, never calls LLM.' },
    { name: 'help-agent', summary: 'Print the agent-facing capability manifest.' }
  ];

  const selected = command ? commands.filter((item) => item.name === command) : commands;
  return ok(
    {
      command,
      usage: command ? `octodocs ${command} [options]` : 'octodocs <command> [options]',
      commands: selected.length ? selected : commands
    },
    [
      'Run `octodocs init` before scanning a target project.',
      'Run `octodocs update` after editing Markdown, HTML, or code.',
      'Use `octodocs help-agent` when another agent needs the exact workflow contract.'
    ]
  );
}

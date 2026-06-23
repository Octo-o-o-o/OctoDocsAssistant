import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { ok } from '../agent/output.mjs';
import { enqueueJournalEvents } from '../settle/journal.mjs';
import { defaultIgnores, shouldIgnore } from '../scan/files.mjs';
import { normalizePath } from '../ledger/model.mjs';

// Claude Code / Codex pass absolute file paths. Convert to a repo-relative POSIX path so
// ignore rules and reads line up; return null for paths outside the repo root.
function toRepoRelative(root, p) {
  if (!p) return null;
  if (isAbsolute(p)) {
    const rel = normalizePath(relative(root, p));
    if (!rel || rel === '..' || rel.startsWith('../')) return null;
    return rel;
  }
  return normalizePath(p);
}

const execFileAsync = promisify(execFile);

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function changedFilesForCommit(root, commit) {
  try {
    const { stdout } = await execFileAsync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit], { cwd: root });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function commitMessage(root, commit) {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%B', commit], { cwd: root });
    return stdout;
  } catch {
    return '';
  }
}

// Read a Claude Code / Codex PostToolUse JSON payload from stdin and extract the edited path.
async function readStdinPath() {
  if (process.stdin.isTTY) return null;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload?.tool_input?.file_path || payload?.tool_input?.path || payload?.file_path || null;
  } catch {
    return null;
  }
}

const IGNORES = defaultIgnores();
const ignored = (file) => shouldIgnore(normalizePath(file), IGNORES);

export async function hookCommand({ root, args }) {
  const source = argValue(args, '--source') || 'file_change';
  const commit = argValue(args, '--commit');
  let rawPath = argValue(args, '--path');
  if (!rawPath && args.includes('--stdin')) rawPath = await readStdinPath();
  const path = toRepoRelative(root, rawPath);
  const events = [];
  let skippedReason = null;

  if (rawPath && !path) {
    return ok({ accepted: 0, skipped: 0, source, background_llm_called: false, skipped_reason: 'outside_repo' },
      ['Path is outside the repository root; nothing enqueued.']);
  }

  if (path) {
    if (!ignored(path)) {
      let content = '';
      try {
        content = await readFile(join(root, path), 'utf8');
      } catch {
        content = path;
      }
      events.push({ source, type: path.match(/\.(md|html)$/i) ? 'doc_updated' : 'code_changed', path, content, commit, summary: `${source} changed ${path}` });
    } else {
      skippedReason = 'ignored_path';
    }
  } else if (commit) {
    // Never re-process a bot commit that octodocs itself created (prevents loops, spec §10).
    const message = await commitMessage(root, commit);
    if (/\[skip-ledger\]/.test(message) || /^octodocs:\s*true$/m.test(message)) {
      return ok({ accepted: 0, skipped: 0, source, background_llm_called: false, skipped_reason: 'skip-ledger' },
        ['Commit marked [skip-ledger]; no journal events enqueued.']);
    }
    const files = await changedFilesForCommit(root, commit);
    for (const file of files) {
      if (ignored(file)) continue;
      if (!file.match(/\.(md|html|js|mjs|ts|tsx|jsx|py|go|rs|swift)$/i)) continue;
      let content = '';
      try {
        content = await readFile(join(root, file), 'utf8');
      } catch {
        content = file;
      }
      events.push({ source, type: file.match(/\.(md|html)$/i) ? 'doc_updated' : 'code_changed', path: file, content, commit, summary: `${source} ${commit} changed ${file}` });
    }
  } else {
    events.push({ source, type: source === 'git_merge' ? 'merge' : 'commit', path: source, content: commit || source, commit, summary: `${source} event` });
  }
  const result = await enqueueJournalEvents(root, events);
  return ok(
    {
      accepted: result.accepted.length,
      skipped: result.skipped.length,
      skipped_reason: skippedReason,
      source,
      background_llm_called: false
    },
    ['Hooks only enqueue. Run `octodocs status` or `octodocs update --changed` in an agent session to settle pending work.']
  );
}

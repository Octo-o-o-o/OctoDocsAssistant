import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizePath } from '../ledger/model.mjs';
import { defaultIgnores, shouldIgnore } from './files.mjs';

const execFileAsync = promisify(execFile);

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

function parseRecentCommitLog(stdout, ignore) {
  const commits = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    current.files = current.files.filter((path) => !shouldIgnore(path, ignore));
    if (current.files.length) commits.push(current);
  };

  for (const line of stdout.split('\n')) {
    const commitMatch = line.match(/^([a-f0-9]{7,40})\t([^\t]+)\t(.*)$/);
    if (commitMatch) {
      pushCurrent();
      current = {
        commit: commitMatch[1],
        ts: commitMatch[2],
        summary: commitMatch[3] || '(no commit summary)',
        files: []
      };
      continue;
    }
    if (!current || !line.trim()) continue;
    current.files.push(normalizePath(line.trim()));
  }
  pushCurrent();
  return commits;
}

export async function scanRecentGitCommits(root, ignore = defaultIgnores(), limit = 50) {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return [];
  }
  try {
    const stdout = await git(root, ['log', `--max-count=${limit}`, '--name-only', '--format=%H%x09%aI%x09%s']);
    return parseRecentCommitLog(stdout, ignore);
  } catch {
    return [];
  }
}

export async function scanGitHistory(root, ignore = defaultIgnores()) {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { available: false, paths: new Map(), deleted: [], recent_commits: [] };
  }

  let stdout = '';
  try {
    stdout = await git(root, ['log', '--all', '--name-status', '--format=%H%x09%aI', '--', '*.md', '*.html']);
  } catch {
    return { available: true, paths: new Map(), deleted: [], recent_commits: await scanRecentGitCommits(root, ignore) };
  }

  const paths = new Map();
  const deleted = [];
  let currentCommit = null;
  let currentTs = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const commitMatch = line.match(/^([a-f0-9]{7,40})\t(.+)$/);
    if (commitMatch) {
      currentCommit = commitMatch[1];
      currentTs = commitMatch[2];
      continue;
    }
    const [status, rawPath, maybeNewPath] = line.split('\t');
    if (!rawPath || !currentCommit) continue;
    const path = normalizePath(maybeNewPath || rawPath);
    if (shouldIgnore(path, ignore)) continue;
    const previous = paths.get(path) || { first_seen_commit: currentCommit, last_seen_commit: currentCommit, commits: [] };
    previous.first_seen_commit = currentCommit;
    if (!previous.last_seen_commit) previous.last_seen_commit = currentCommit;
    previous.commits.push({ commit: currentCommit, ts: currentTs, status, path });
    paths.set(path, previous);
    if (status?.startsWith('D')) {
      let content = '';
      try {
        content = await git(root, ['show', `${currentCommit}^:${path}`]);
      } catch {
        content = '';
      }
      deleted.push({ path, commit: currentCommit, ts: currentTs, content });
    }
    if (status?.startsWith('R') && rawPath) {
      const previousPath = normalizePath(rawPath);
      if (!shouldIgnore(previousPath, ignore)) {
        deleted.push({ path: previousPath, commit: currentCommit, ts: currentTs, content: '' });
      }
    }
  }

  return { available: true, paths, deleted, recent_commits: await scanRecentGitCommits(root, ignore) };
}

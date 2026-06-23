import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import chokidar from 'chokidar';
import { defaultIgnores, shouldIgnore } from '../scan/files.mjs';
import { enqueueJournalEvents } from '../settle/journal.mjs';
import { normalizePath } from '../ledger/model.mjs';

function eventType(eventName, path) {
  if (eventName === 'unlink') return 'doc_deleted';
  return path.match(/\.(md|html)$/i) ? 'doc_updated' : 'code_changed';
}

export function watchPatterns() {
  return ['.'];
}

export function ignoredPath(path, extraIgnore = []) {
  return shouldIgnore(normalizePath(path), defaultIgnores(extraIgnore));
}

async function enqueueForFsEvent(root, eventName, absolutePath) {
  const rel = normalizePath(relative(root, absolutePath));
  if (!rel || ignoredPath(rel)) return null;
  if (!rel.match(/\.(md|html)$/i)) return null;
  let content = rel;
  if (eventName !== 'unlink') {
    try {
      content = await readFile(join(root, rel), 'utf8');
    } catch {
      content = rel;
    }
  }
  const result = await enqueueJournalEvents(root, [{
    source: 'file_change',
    type: eventType(eventName, rel),
    path: rel,
    content,
    summary: `watch ${eventName} ${rel}`
  }]);
  return { path: rel, event: eventName, accepted: result.accepted.length, skipped: result.skipped.length };
}

export function startWatcher(root, { onEvent = () => {}, onReady = () => {}, ignoreInitial = true } = {}) {
  const watcher = chokidar.watch(watchPatterns(), {
    cwd: root,
    ignoreInitial,
    ignored: (path) => ignoredPath(path),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  });
  for (const eventName of ['add', 'change', 'unlink']) {
    watcher.on(eventName, async (path) => {
      const result = await enqueueForFsEvent(root, eventName, join(root, path));
      if (result) onEvent(result);
    });
  }
  watcher.on('ready', onReady);
  return watcher;
}

export async function watchOnce(root, { timeoutMs = 5000, onReady = () => {}, ignoreInitial = true } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const watcher = startWatcher(root, {
      onReady,
      ignoreInitial,
      onEvent: async (result) => {
        clearTimeout(timer);
        await watcher.close();
        resolve(result);
      }
    });
    timer = setTimeout(async () => {
      await watcher.close();
      reject(new Error('Timed out waiting for Markdown/HTML file change.'));
    }, timeoutMs);
  });
}

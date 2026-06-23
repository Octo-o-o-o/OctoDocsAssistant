import { ok } from '../agent/output.mjs';
import { startWatcher, watchOnce } from '../watch/watcher.mjs';

export async function watchCommand({ root, args }) {
  if (args.includes('--once')) {
    const result = await watchOnce(root, { timeoutMs: 10000 });
    return ok({ event: result, background_llm_called: false }, [
      'Watcher enqueued the file change only.',
      'Run `octodocs status` to inspect pending journal events.',
      'Run `octodocs update --changed` in an agent session to settle deterministic changes.'
    ]);
  }

  const watcher = startWatcher(root, {
    onEvent: (event) => {
      process.stdout.write(`${JSON.stringify({ ok: true, data: { event, background_llm_called: false }, next_actions: ['Run octodocs update --changed to settle.'] })}\n`);
    }
  });
  process.stdout.write(`${JSON.stringify({ ok: true, data: { watching: true, patterns: ['**/*.md', '**/*.html'] }, next_actions: ['Press Ctrl+C to stop watching.', 'Generated docs/octodocs paths are ignored.'] }, null, 2)}\n`);
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await watcher.close();
}

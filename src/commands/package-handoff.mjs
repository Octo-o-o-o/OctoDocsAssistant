import { fail, ok } from '../agent/output.mjs';
import { packageHandoff } from '../handoff/package.mjs';

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function zipOption(args, outDir) {
  if (!args.includes('--zip')) return null;
  return argValue(args, '--zip') || `${outDir.replace(/\/+$/, '')}.zip`;
}

export async function packageHandoffCommand({ root, args = [] }) {
  const outDir = argValue(args, '--out') || 'octodocs-handoff';
  const zipPath = zipOption(args, outDir);
  try {
    const result = await packageHandoff(root, {
      outDir,
      zipPath,
      force: hasFlag(args, '--force'),
      projectName: argValue(args, '--project-name') || undefined
    });
    if (!result.verification.ready) {
      return fail(
        'HANDOFF_PACKAGE_NOT_STANDALONE',
        `Handoff package was created but verification did not pass. An INCOMPLETE package remains on disk at ${result.out_dir}${result.zip_path ? ` (and ${result.zip_path})` : ''} — do not send it.`,
        'Inspect `_HANDOFF_AUDIT.json`, fix outside or missing local links, then rerun `octodocs package-handoff --force`.',
        result
      );
    }
    return ok(result, [
      'Send the generated handoff directory or zip as a complete package; do not send individual files only.',
      'Ask the recipient to start from `HANDOFF_GUIDE.md`.',
      'Use the real source repository for code changes, deployment, tests, and secrets.'
    ]);
  } catch (error) {
    return fail(
      error.code || 'HANDOFF_PACKAGE_FAILED',
      error.message,
      'Run `octodocs render` first, then rerun `octodocs package-handoff --out <dir> --force`.',
      { outDir, zipPath }
    );
  }
}

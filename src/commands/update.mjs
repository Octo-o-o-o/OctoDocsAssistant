import { ok } from '../agent/output.mjs';
import { evaluateCompleteness } from '../completeness/evaluate.mjs';
import { renderProjectViews } from '../render/project.mjs';
import { markJournalSettled, pendingJournal } from '../settle/journal.mjs';
import { scanRepository } from '../scan/repository.mjs';
import { languageOption, progressOption } from './options.mjs';

function summarizeCompleteness(completeness) {
  const coverage = Array.isArray(completeness?.coverage) ? completeness.coverage : [];
  const coverageByPercent = new Map();
  for (const item of coverage) {
    const key = String(item.percent ?? 'unknown');
    coverageByPercent.set(key, (coverageByPercent.get(key) || 0) + 1);
  }

  return {
    coverage_claims: coverage.length,
    coverage_by_percent: Object.fromEntries(coverageByPercent),
    review_items_created: completeness?.review_items_created ?? 0,
    claim_updates_created: completeness?.claim_updates_created ?? 0,
    skipped_claim_updates: completeness?.skipped_claim_updates ?? 0
  };
}

function summarizeRender(render) {
  const files = Array.isArray(render?.files) ? render.files : [];
  return {
    files: files.length,
    written: files.filter((file) => file.written).length,
    unchanged: files.filter((file) => !file.written).length,
    warnings: Array.isArray(render?.warnings) ? render.warnings.length : 0
  };
}

export async function updateCommand({ root, args }) {
  const changedOnly = args.includes('--changed');
  const summaryOnly = args.includes('--summary');
  const noWrite = args.includes('--dry-run') || args.includes('--no-write');
  const pending = await pendingJournal(root);
  // `--changed` scans only the pending journal paths (md/html) instead of the whole repo.
  // With no pending doc paths, fall back to a full scan so the command is still useful.
  const changedDocPaths = pending.map((event) => event.path).filter((p) => p && /\.(md|html)$/i.test(p));
  const scanOptions = changedOnly && changedDocPaths.length
    ? { writeLedger: !noWrite, changedFiles: Array.from(new Set(changedDocPaths)) }
    : { writeLedger: !noWrite };
  Object.assign(scanOptions, progressOption(args));
  const scan = await scanRepository(root, scanOptions);
  const completeness = noWrite
    ? { dry_run: true, skipped: 'completeness evaluation writes review/claim state and is disabled in dry-run' }
    : await evaluateCompleteness(root);
  if (changedOnly && pending.length && !noWrite) {
    await markJournalSettled(root, pending.map((event) => event.id));
  }
  const render = noWrite
    ? { dry_run: true, files: [], warnings: [], skipped: 'render writes managed views and is disabled in dry-run' }
    : await renderProjectViews(root, languageOption(args));
  const data = {
    dry_run: noWrite,
    scanned_files: scan.files.length,
    scan_scope: scanOptions.changedFiles ? 'changed' : 'full',
    accepted_records: scan.accepted.length,
    skipped_records: scan.skipped.length,
    completeness,
    settled_journal_events: changedOnly && !noWrite ? pending.length : 0,
    render
  };

  if (summaryOnly) {
    return ok(
      {
        scanned_files: data.scanned_files,
        dry_run: data.dry_run,
        scan_scope: data.scan_scope,
        accepted_records: data.accepted_records,
        skipped_records: data.skipped_records,
        settled_journal_events: data.settled_journal_events,
        completeness: summarizeCompleteness(completeness),
        render: summarizeRender(render),
        full_report_available: 'Rerun without `--summary` for full coverage and render details.'
      },
      [
        noWrite ? 'Rerun without `--dry-run` to write ledger, review items, and managed views.' : 'Run `octodocs review` for any prefilled review items.',
        'Rerun `octodocs update` without `--summary` when detailed coverage evidence is needed.',
        'No background LLM was called; semantic gray areas remain host-agent tasks.'
      ]
    );
  }

  return ok(
    data,
    [
      noWrite ? 'Rerun without `--dry-run` to write ledger, review items, and managed views.' : 'Run `octodocs review` for any prefilled review items.',
      'Run `octodocs rebuild --from-ledger` to verify generated views are reconstructible.',
      'No background LLM was called; semantic gray areas remain host-agent tasks.'
    ]
  );
}

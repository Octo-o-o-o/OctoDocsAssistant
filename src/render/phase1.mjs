import { loadConfig } from '../config/config.mjs';
import { readLedger, splitLedger } from '../ledger/store.mjs';
import { gitInfo } from '../utils/git.mjs';
import { pendingJournal } from '../settle/journal.mjs';
import { renderManagedFile } from './managed.mjs';
import { renderCurrentMarkdown } from './current.mjs';
import { renderTimelineMarkdown } from './timeline.mjs';
import { renderHandoffMarkdown } from './handoff.mjs';

const AGENT_COMMENT = '<!-- AGENT: This is an OctoDocs ledger view. Evidence and confidence are inline. Do not edit managed blocks; rerun octodocs render or rebuild. -->';

export async function renderPhase1(root, options = {}) {
  const config = await loadConfig(root);
  const language = options.language || config.output.language;
  const ledger = splitLedger(await readLedger(root));
  // baseline_branch/commit annotates the checkout the views were rendered against (spec §9).
  // All substantive content is reproduced from the ledger; baseline is render-time metadata.
  const baseline = await gitInfo(root);
  // Pending semantic work = unsettled journal events awaiting a host-agent session, NOT
  // the count of unknown-relation evidences.
  const pendingSemanticCount = (await pendingJournal(root)).length;
  const currentBody = renderCurrentMarkdown({ claims: ledger.claims, evidences: ledger.evidences, documents: ledger.documents, baseline, language });
  const timelineBody = renderTimelineMarkdown({ events: ledger.events, evidences: ledger.evidences, baseline, language });
  const handoffBody = renderHandoffMarkdown({ claims: ledger.claims, documents: ledger.documents, events: ledger.events, pendingSemanticCount, baseline, verificationAllowlist: config.verification.allowlist, language });
  const current = await renderManagedFile(root, config.outputs.current, {
    id: 'project-current',
    view: 'PROJECT_CURRENT',
    body: currentBody,
    agentComment: AGENT_COMMENT
  });
  const timeline = await renderManagedFile(root, config.outputs.timeline, {
    id: 'project-timeline',
    view: 'PROJECT_TIMELINE',
    body: timelineBody,
    agentComment: AGENT_COMMENT
  });
  const handoff = await renderManagedFile(root, config.outputs.handoff, {
    id: 'agent-handoff',
    view: 'AGENT_HANDOFF',
    body: handoffBody,
    agentComment: AGENT_COMMENT
  });
  return {
    files: [current, timeline, handoff],
    warnings: [current, timeline, handoff].filter((item) => item.warning)
  };
}

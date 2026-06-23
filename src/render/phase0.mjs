import { loadConfig } from '../config/config.mjs';
import { readLedger, splitLedger } from '../ledger/store.mjs';
import { renderManagedFile } from './managed.mjs';
import { renderInventoryMarkdown } from './inventory.mjs';
import { renderDriftMarkdown } from './drift.mjs';
import { renderDocumentationGapsMarkdown } from './gaps.mjs';

const AGENT_COMMENT = '<!-- AGENT: This is an OctoDocs ledger view. Read AGENT_HANDOFF first when present. Do not edit managed blocks; rerun octodocs render or rebuild. -->';

export async function renderPhase0(root, options = {}) {
  const config = await loadConfig(root);
  const language = options.language || config.output.language;
  const ledger = splitLedger(await readLedger(root));
  const inventoryBody = renderInventoryMarkdown({ documents: ledger.documents, evidences: ledger.evidences, language });
  const driftBody = renderDriftMarkdown({ documents: ledger.documents, evidences: ledger.evidences, language });
  const gapsBody = renderDocumentationGapsMarkdown({ documents: ledger.documents, language });
  const inventory = await renderManagedFile(root, config.outputs.inventory, {
    id: 'docs-inventory',
    view: 'DOCS_INVENTORY',
    body: inventoryBody,
    agentComment: AGENT_COMMENT
  });
  const drift = await renderManagedFile(root, config.outputs.drift, {
    id: 'drift-report',
    view: 'DRIFT_REPORT',
    body: driftBody,
    agentComment: AGENT_COMMENT
  });
  const gaps = await renderManagedFile(root, config.outputs.gaps, {
    id: 'documentation-gaps',
    view: 'DOCUMENTATION_GAPS',
    body: gapsBody,
    agentComment: AGENT_COMMENT
  });
  return {
    files: [inventory, drift, gaps],
    warnings: [inventory, drift, gaps].filter((item) => item.warning)
  };
}

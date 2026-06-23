import { eventSummary, eventTypeLabel, stateLabel, text, none } from './i18n.mjs';

export function renderHandoffMarkdown({ claims, documents, events, pendingSemanticCount, baseline, verificationAllowlist = [], language = 'zh' }) {
  const latestClaims = new Map();
  for (const claim of claims) latestClaims.set(claim.id, claim);
  const staleDocs = documents
    .filter((doc) => doc.tombstone || ['stale', 'superseded', 'archived', 'conflict'].includes(doc.doc_status))
    .slice(0, 8)
    .map((doc) => doc.path);
  const recentEvents = [...events].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 5);
  const activeClaims = Array.from(latestClaims.values()).slice(0, 8);
  const lines = [
    `# ${text(language, 'handoff')}`,
    '',
    `Baseline: ${baseline.branch}@${baseline.commit}`,
    `${text(language, 'pendingTasks')}: ${pendingSemanticCount}`,
    '',
    `## ${text(language, 'startHere')}`,
    '',
    `- ${text(language, 'startRead')}`,
    `- ${text(language, 'startStatus')}`,
    `- ${text(language, 'startUntrusted')}`,
    '',
    `## ${text(language, 'currentClaims')}`,
    ''
  ];
  lines.push(...(activeClaims.length ? activeClaims.map((claim) => `- ${claim.subject}: ${stateLabel(claim, language)} (verification=${claim.verification})`) : [none(language)]));
  lines.push('', `## ${text(language, 'avoidHistorical')}`, '');
  lines.push(...(staleDocs.length ? staleDocs.map((path) => `- ${path}`) : [none(language)]));
  lines.push('', `## ${text(language, 'recentEvents')}`, '');
  lines.push(...(recentEvents.length ? recentEvents.map((event) => `- ${event.ts} ${eventTypeLabel(event, language)}: ${eventSummary(event, language)}`) : [none(language)]));
  lines.push('', `## ${text(language, 'verificationCommands')}`, '');
  lines.push(...(verificationAllowlist.length
    ? verificationAllowlist.map((cmd) => `- ${cmd}`)
    : [`- ${text(language, 'noVerificationCommands')}`]));
  lines.push('');
  const rendered = `${lines.join('\n')}\n`;
  return rendered.length <= 2000 ? rendered : `${rendered.slice(0, 1950)}\n\n${text(language, 'truncated')}\n`;
}

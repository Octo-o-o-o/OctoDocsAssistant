import { stateLabel, text, none } from './i18n.mjs';

function evidenceSummary(claim, evidences) {
  const linked = evidences.filter((ev) => claim.evidence_ids.includes(ev.id)).slice(0, 3);
  if (!linked.length) return 'unknown';
  return linked.map((ev) => `${ev.relation}:${ev.path || ev.kind}`).join('; ');
}

function coverageSummary(claim, evidences) {
  const linked = evidences.filter((ev) => claim.evidence_ids.includes(ev.id));
  const implementsCount = linked.filter((ev) => ev.relation === 'implements').length;
  const testsCount = linked.filter((ev) => ev.relation === 'tests').length;
  const covered = (implementsCount ? 1 : 0) + (testsCount ? 1 : 0);
  return `${covered}/2 (${Math.round((covered / 2) * 100)}%)`;
}

export function renderCurrentMarkdown({ claims, evidences, documents, baseline, language = 'zh' }) {
  const latestClaims = new Map();
  for (const claim of claims) latestClaims.set(claim.id, claim);
  const sortedClaims = Array.from(latestClaims.values()).sort((a, b) => a.subject.localeCompare(b.subject));
  const activeDocs = documents.filter((doc) => !doc.tombstone);
  const staleDocs = documents.filter((doc) => doc.tombstone || ['stale', 'superseded', 'archived', 'conflict'].includes(doc.doc_status));
  const lines = [
    `# ${text(language, 'current')}`,
    '',
    `${text(language, 'baselineBranch')}: ${baseline.branch}`,
    `${text(language, 'baselineCommit')}: ${baseline.commit}`,
    text(language, 'statusBasis'),
    '',
    `## ${text(language, 'positioning')}`,
    '',
    text(language, 'positioningText', { active: activeDocs.length, stale: staleDocs.length }),
    '',
    `## ${text(language, 'featureMap')}`,
    '',
    `| ${text(language, 'feature')} | ${text(language, 'state')} | ${text(language, 'coverage')} | ${text(language, 'evidence')} | ${text(language, 'lastVerified')} | ${text(language, 'baseline')} |`,
    '|---|---|---:|---|---|---|'
  ];
  if (!sortedClaims.length) {
    lines.push(`| _${text(language, 'none')}_ | ${text(language, 'unknown')} | 0/2 (0%) | ${text(language, 'unknown')} |  | ${baseline.branch}@${baseline.commit} |`);
  }
  for (const claim of sortedClaims) {
    lines.push(`| ${claim.subject.replaceAll('|', '/')} | ${stateLabel(claim, language)} | ${coverageSummary(claim, evidences)} | ${evidenceSummary(claim, evidences).replaceAll('|', '/')} | ${claim.last_verified_at || ''} | ${baseline.branch}@${baseline.commit} |`);
  }
  lines.push(
    '',
    `## ${text(language, 'routesApis')}`,
    '',
    `- ${text(language, 'routesUnknown')}`,
    '',
    `## ${text(language, 'unfinished')}`,
    ''
  );
  const unfinished = sortedClaims.filter((claim) => claim.verification !== 'verified');
  lines.push(...(unfinished.length ? unfinished.map((claim) => `- ${claim.subject}: ${stateLabel(claim, language)}; ${text(language, 'evidence')}=${evidenceSummary(claim, evidences)}`) : [none(language)]));
  lines.push(
    '',
    `## ${text(language, 'deprecated')}`,
    ''
  );
  const deprecated = sortedClaims.filter((claim) => ['deprecated', 'superseded'].includes(claim.lifecycle) || claim.implementation === 'removed');
  lines.push(...(deprecated.length ? deprecated.map((claim) => `- ${claim.subject}: ${stateLabel(claim, language)}`) : [none(language)]));
  lines.push(
    '',
    `## ${text(language, 'risks')}`,
    '',
    `- ${text(language, 'riskVerified')}`,
    `- ${text(language, 'riskHtml')}`,
    `- ${text(language, 'riskTasks')}`
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

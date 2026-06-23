import { eventSummary, eventTypeLabel, text } from './i18n.mjs';
import { commitDocumentationGaps, commitDocumentationItems, commitGapTableLines, commitHistoryTableLines } from './commit-docs.mjs';

function timelineIntro(language) {
  return language === 'en'
    ? 'Use this view to answer when something changed, what the commit appears to affect, and whether that change has nearby documentation. The commit tables are derived from git commit evidence; the accepted-event table remains available for ledger-level audit.'
    : '本视图用于回答“什么时间做了什么”、该变更大致影响哪个模块，以及这次变更是否同时更新了文档。commit 表来自 git commit evidence；底部仍保留 accepted events，便于工程审计。';
}

export function renderTimelineMarkdown({ events, evidences = [], baseline, language = 'zh' }) {
  const sorted = [...events].sort((a, b) => (new Date(a.ts).getTime() - new Date(b.ts).getTime()) || a.id.localeCompare(b.id));
  const commitItems = commitDocumentationItems({ evidences, events, language });
  const gaps = commitDocumentationGaps({ evidences, events, language });
  const lines = [
    `# ${language === 'en' ? 'Project Timeline / History Trace' : '项目时间线 / 历史追溯'}`,
    '',
    timelineIntro(language),
    '',
    `- ${text(language, 'baselineBranch')}: ${baseline.branch}`,
    `- ${text(language, 'baselineCommit')}: ${baseline.commit}`,
    '',
    `## ${language === 'en' ? 'Recent Commit Trace' : '近期 commit 追溯'}`,
    '',
    ...commitHistoryTableLines(commitItems, language, 30),
    '',
    `## ${language === 'en' ? 'Commits That May Need Documentation' : '可能缺少文档的 commit'}`,
    '',
    language === 'en'
      ? 'A commit is listed here when recent git evidence changed source/config/migration files but did not include a Markdown/HTML documentation update in the same commit.'
      : '如果近期 git evidence 显示某个 commit 修改了源码、配置或迁移文件，但同一 commit 没有 Markdown/HTML 文档变更，就会列在这里。',
    '',
    ...commitGapTableLines(gaps, language, 20),
    '',
    `## ${language === 'en' ? 'Accepted Ledger Events' : '账本接受事件'}`,
    '',
    `| ${text(language, 'time')} | ${text(language, 'type')} | ${text(language, 'status')} | ${text(language, 'sourceBranch')} | ${text(language, 'summary')} | ${text(language, 'evidence')} |`,
    '|---|---|---|---|---|---|'
  ];
  if (!sorted.length) {
    lines.push(`| _${text(language, 'none')}_ | ${eventTypeLabel({ type: 'doc_updated' }, language)} | ${text(language, 'unknown')} |  | ${text(language, 'noAcceptedEvents')} | |`);
  }
  for (const event of sorted) {
    lines.push(`| ${event.ts} | ${eventTypeLabel(event, language)} | accepted | ${event.source_branch || baseline.branch} | ${eventSummary(event, language).replaceAll('|', '/')} | ${event.evidence_ids.join(', ')} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

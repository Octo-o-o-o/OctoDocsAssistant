const DOC_RE = /\.(md|mdx|markdown|html|rst|adoc)$/i;
const SOURCE_RE = /\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|rb|php|sql|prisma|sh|bash|zsh|fish|css|scss|less|json|ya?ml|toml|ini|env|lock)$/i;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cell(value) {
  const text = clean(value);
  return text ? text.replaceAll('|', '/') : '-';
}

function shortCommit(commit) {
  return String(commit || '').slice(0, 10) || '-';
}

function commitFromEvent(event) {
  const match = String(event?.change_fingerprint || '').match(/^git\/([a-f0-9]{7,40}):/i);
  return match?.[1] || '';
}

function eventTimeByCommit(events) {
  const map = new Map();
  for (const event of events || []) {
    const commit = commitFromEvent(event);
    if (commit && event.ts) map.set(commit, event.ts);
  }
  return map;
}

function stripSummaryPrefix(summary) {
  return clean(summary).replace(/^Git commit summary:\s*/i, '') || '(no commit summary)';
}

function isDocPath(path) {
  return DOC_RE.test(String(path || ''));
}

function isLowSignalPath(path) {
  const value = String(path || '');
  return [
    /(^|\/)(dist|build|coverage|node_modules|vendor|fixtures?|__fixtures__|snapshots?)\//i,
    /(^|\/)(playwright-report|test-results|storybook-static)\//i,
    /(^|\/)(package-lock|pnpm-lock|yarn\.lock|bun\.lockb)$/i,
    /\.(png|jpe?g|gif|webp|svg|ico|pdf|mov|mp4|zip|gz|tgz|wasm|map)$/i
  ].some((pattern) => pattern.test(value));
}

function isSourcePath(path) {
  const value = String(path || '');
  if (!value || isDocPath(value) || isLowSignalPath(value)) return false;
  if (/Dockerfile$/i.test(value)) return true;
  if (/^\.github\/workflows\//i.test(value)) return true;
  if (/(^|\/)(package|tsconfig|vite|next|turbo|eslint|prettier|docker-compose)\.(json|ya?ml|toml|js|mjs|cjs|ts)$/i.test(value)) return true;
  return SOURCE_RE.test(value);
}

function moduleForPath(path, language) {
  const zh = language !== 'en';
  const value = String(path || '');
  if (/^octvex-console\//.test(value)) return zh ? 'Console / 操作台' : 'Console';
  if (/^octvex-core\//.test(value)) return zh ? 'Core / 控制平面' : 'Core';
  if (/^octvex-edge\//.test(value)) return zh ? 'Edge / 执行边界' : 'Edge';
  if (/^octvex-desk\//.test(value)) return zh ? 'Desk / 本地审批' : 'Desk';
  if (/^packages\//.test(value)) return zh ? '共享 packages' : 'Shared Packages';
  if (/^\.github\/|(^|\/)workflow|ci/i.test(value)) return zh ? 'CI / 自动化' : 'CI / Automation';
  if (/prisma|migration|schema|database|db/i.test(value)) return zh ? '数据 / Schema' : 'Data / Schema';
  if (/security|auth|policy|credential|permission|rbac|audit/i.test(value)) return zh ? '安全 / 权限' : 'Security / Permission';
  if (/api|route|mcp|connector|webhook/i.test(value)) return zh ? 'API / 集成' : 'API / Integration';
  if (/scripts?|bin|cli|config|env|docker/i.test(value)) return zh ? '工具 / 运维' : 'Tooling / Operations';
  return zh ? '核心代码' : 'Core Code';
}

function suggestedDocsForPaths(paths, language) {
  const zh = language !== 'en';
  const suggestions = new Set();
  const add = (zhText, enText) => suggestions.add(zh ? zhText : enText);
  const joined = paths.join(' ');
  if (/^octvex-console\//m.test(joined)) add('octvex-console/README.md 或 octvex-console/docs/', 'octvex-console/README.md or octvex-console/docs/');
  if (/^octvex-core\//m.test(joined)) add('octvex-core/docs/architecture.md 或相关 API 文档', 'octvex-core/docs/architecture.md or relevant API docs');
  if (/^octvex-edge\//m.test(joined)) add('octvex-edge/README.md 或 Edge 运行说明', 'octvex-edge/README.md or Edge runtime notes');
  if (/^octvex-desk\//m.test(joined)) add('octvex-desk/README.md 或本地审批/恢复说明', 'octvex-desk/README.md or local approval/recovery notes');
  if (/prisma|migration|schema|database|db/i.test(joined)) add('docs/schema-guide.md 或迁移说明', 'docs/schema-guide.md or migration notes');
  if (/security|auth|policy|credential|permission|rbac|audit/i.test(joined)) add('SECURITY.md 或 docs/security/', 'SECURITY.md or docs/security/');
  if (/api|route|mcp|connector|webhook/i.test(joined)) add('API/协议文档或集成契约', 'API/protocol docs or integration contract');
  if (/scripts?|bin|cli|config|env|docker|deploy/i.test(joined)) add('docs/development-setup.md / self-host / runbook', 'development setup, self-host, or runbook docs');
  if (!suggestions.size) add('README、架构说明、变更记录或对应模块 README', 'README, architecture notes, changelog, or module README');
  return Array.from(suggestions).slice(0, 3);
}

function severityForPaths(paths, language) {
  const joined = paths.join(' ');
  const zh = language !== 'en';
  if (/security|auth|policy|credential|permission|rbac|audit|migration|schema|database|prisma|api|route/i.test(joined)) {
    return zh ? '高：涉及接口、数据、安全或迁移边界' : 'High: API, data, security, or migration boundary';
  }
  if (/console|edge|desk|core|workflow|agent|automation/i.test(joined)) {
    return zh ? '中：涉及主要产品模块' : 'Medium: primary product module';
  }
  return zh ? '中低：建议补充说明' : 'Medium-low: documentation recommended';
}

export function commitDocumentationItems({ evidences = [], events = [], language = 'zh' } = {}) {
  const times = eventTimeByCommit(events);
  const items = [];
  const seen = new Set();
  for (const evidence of evidences || []) {
    if (evidence.kind !== 'commit_diff' || !evidence.commit || seen.has(evidence.commit)) continue;
    seen.add(evidence.commit);
    const links = (evidence.links || []).map(clean).filter(Boolean);
    const docPaths = links.filter(isDocPath);
    const sourcePaths = links.filter(isSourcePath);
    const modules = Array.from(new Set(sourcePaths.map((path) => moduleForPath(path, language)))).slice(0, 4);
    const missingDocs = sourcePaths.length > 0 && docPaths.length === 0;
    items.push({
      commit: evidence.commit,
      shortCommit: shortCommit(evidence.commit),
      ts: times.get(evidence.commit) || '',
      summary: stripSummaryPrefix(evidence.summary),
      sourcePaths,
      docPaths,
      modules,
      docsStatus: missingDocs
        ? (language === 'en' ? 'Missing docs' : '缺少文档')
        : docPaths.length
          ? (language === 'en' ? 'Docs included' : '已包含文档')
          : (language === 'en' ? 'No source-code signal' : '无源码变更信号'),
      severity: missingDocs ? severityForPaths(sourcePaths, language) : '',
      suggestedDocs: missingDocs ? suggestedDocsForPaths(sourcePaths, language) : []
    });
  }
  return items.sort((a, b) => (b.ts || '').localeCompare(a.ts || '') || a.commit.localeCompare(b.commit));
}

export function commitDocumentationGaps(input = {}) {
  return commitDocumentationItems(input).filter((item) => item.sourcePaths.length > 0 && item.docPaths.length === 0);
}

export function commitHistoryTableLines(items, language = 'zh', max = 30) {
  const zh = language !== 'en';
  const visible = items.slice(0, max);
  const lines = [
    `| ${zh ? '时间' : 'Time'} | commit | ${zh ? '文档状态' : 'Docs Status'} | ${zh ? '模块' : 'Module'} | ${zh ? '做了什么' : 'What Changed'} | ${zh ? '代表路径' : 'Representative Paths'} |`,
    '|---|---|---|---|---|---|'
  ];
  if (!visible.length) {
    lines.push(`| - | - | - | - | ${zh ? '暂未发现 commit_diff 证据。' : 'No commit_diff evidence found.'} | - |`);
    return lines;
  }
  lines.push(...visible.map((item) => {
    const paths = [...item.sourcePaths, ...item.docPaths].slice(0, 4).join('<br>');
    return `| ${cell(item.ts || '-')} | ${cell(item.shortCommit)} | ${cell(item.docsStatus)} | ${cell(item.modules.join(zh ? '、' : ', '))} | ${cell(item.summary)} | ${cell(paths)} |`;
  }));
  if (items.length > visible.length) {
    lines.push(`| ... | ... | ... | ... | ${zh ? `还有 ${items.length - visible.length} 条 commit 未展开。` : `${items.length - visible.length} more commits not shown.`} | ... |`);
  }
  return lines;
}

export function commitGapTableLines(gaps, language = 'zh', max = 20) {
  const zh = language !== 'en';
  const visible = gaps.slice(0, max);
  const lines = [
    `| ${zh ? '时间' : 'Time'} | commit | ${zh ? '模块' : 'Module'} | ${zh ? '做了什么' : 'What Changed'} | ${zh ? '缺少的说明' : 'Missing Documentation'} | ${zh ? '涉及路径' : 'Touched Paths'} |`,
    '|---|---|---|---|---|---|'
  ];
  if (!visible.length) {
    lines.push(`| - | - | - | ${zh ? '近期代码 commit 都已伴随文档，或未发现需要文档化的源码变更。' : 'Recent code commits include docs, or no documentation-worthy source changes were found.'} | - | - |`);
    return lines;
  }
  lines.push(...visible.map((item) => {
    const paths = item.sourcePaths.slice(0, 5).join('<br>');
    const missing = zh
      ? `${item.severity}; 建议补充：${item.suggestedDocs.join(' / ')}`
      : `${item.severity}; Suggested docs: ${item.suggestedDocs.join(' / ')}`;
    return `| ${cell(item.ts || '-')} | ${cell(item.shortCommit)} | ${cell(item.modules.join(zh ? '、' : ', '))} | ${cell(item.summary)} | ${cell(missing)} | ${cell(paths)} |`;
  }));
  if (gaps.length > visible.length) {
    lines.push(`| ... | ... | ... | ${zh ? `还有 ${gaps.length - visible.length} 个缺文档 commit 未展开。` : `${gaps.length - visible.length} more documentation gaps not shown.`} | ... | ... |`);
  }
  return lines;
}

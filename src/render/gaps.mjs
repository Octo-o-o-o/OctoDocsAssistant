import { classifyDocument } from '../classify/doc.mjs';

const REQUIRED_DOCS = [
  {
    key: 'overview',
    zh: '项目总览',
    en: 'Project Overview',
    purposeZh: '说明项目定位、主要用户、核心能力和当前状态。',
    purposeEn: 'Explain positioning, users, core capabilities, and current state.',
    match: (doc, classification) => classification.type === 'readme' && /^README\.md$/i.test(doc.path)
  },
  {
    key: 'architecture',
    zh: '架构 / 能力设计',
    en: 'Architecture / Capability Design',
    purposeZh: '说明系统边界、模块关系、关键流程和设计决策。',
    purposeEn: 'Explain boundaries, module relationships, key flows, and design decisions.',
    match: (_doc, classification) => ['design', 'adr'].includes(classification.type)
  },
  {
    key: 'setup',
    zh: '开发与本地运行',
    en: 'Development And Local Setup',
    purposeZh: '说明安装、依赖、本地启动、配置和常见开发动作。',
    purposeEn: 'Explain install, dependencies, local startup, configuration, and common development actions.',
    match: (doc, classification) => classification.type === 'guide' && /setup|install|development|contributing|quickstart|本地|开发|安装/i.test(`${doc.path} ${doc.title}`)
  },
  {
    key: 'deployment',
    zh: '部署、升级与回滚',
    en: 'Deployment, Upgrade, And Rollback',
    purposeZh: '说明部署方式、升级路径、回滚策略和环境要求。',
    purposeEn: 'Explain deployment, upgrade path, rollback strategy, and environment requirements.',
    match: (doc, classification) => ['guide', 'runbook'].includes(classification.type) && /deploy|deployment|docker|self-host|upgrade|rollback|发布|部署|升级|回滚/i.test(`${doc.path} ${doc.title}`)
  },
  {
    key: 'api',
    zh: 'API / 协议 / Schema',
    en: 'API / Protocol / Schema',
    purposeZh: '说明外部接口、协议对象、事件类型、数据结构和兼容性。',
    purposeEn: 'Explain external APIs, protocol objects, event kinds, data shapes, and compatibility.',
    match: (_doc, classification) => ['api', 'schema'].includes(classification.type)
  },
  {
    key: 'security',
    zh: '安全、权限与审计',
    en: 'Security, Permission, And Audit',
    purposeZh: '说明权限模型、凭证处理、安全边界、审计和隐私风险。',
    purposeEn: 'Explain permission models, credential handling, security boundaries, audit, and privacy risks.',
    match: (_doc, classification) => classification.type === 'security'
  },
  {
    key: 'operations',
    zh: '运维 Runbook',
    en: 'Operations Runbooks',
    purposeZh: '说明故障处理、备份恢复、监控、事故响应和人工操作流程。',
    purposeEn: 'Explain incident handling, backup and restore, monitoring, response, and manual operations.',
    match: (_doc, classification) => classification.type === 'runbook'
  },
  {
    key: 'validation',
    zh: '测试、验收与冒烟检查',
    en: 'Testing, Acceptance, And Smoke Checks',
    purposeZh: '说明如何验证核心能力、回归路径和发布前检查。',
    purposeEn: 'Explain how to validate core capabilities, regression paths, and pre-release checks.',
    match: (_doc, classification) => classification.type === 'checklist'
  },
  {
    key: 'roadmap',
    zh: '路线图与变更记录',
    en: 'Roadmap And Change History',
    purposeZh: '说明近期方向、历史变化、发布影响和迁移提醒。',
    purposeEn: 'Explain near-term direction, historical changes, release impact, and migration notes.',
    match: (_doc, classification) => ['roadmap', 'changelog'].includes(classification.type)
  }
];

function normalizeLanguage(language) {
  return language === 'en' ? 'en' : 'zh';
}

function sourceDocLink(path) {
  return `[${path}](<../../${path}>)`;
}

function generatedDocLink(path) {
  return `[${path}](<./${path.split('/').pop()}>)`;
}

function latestDocuments(documents) {
  const byPath = new Map();
  for (const doc of documents) byPath.set(doc.path, doc);
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function isCurrentSource(doc) {
  return !doc.tombstone && ['current', 'proposal', 'draft'].includes(doc.doc_status);
}

function classifyDocs(documents) {
  return latestDocuments(documents).map((doc) => ({ doc, classification: classifyDocument(doc) }));
}

function evaluateRequirements(documents, language) {
  const classified = classifyDocs(documents).filter(({ doc }) => isCurrentSource(doc));
  return REQUIRED_DOCS.map((requirement) => {
    const matches = classified.filter(({ doc, classification }) => requirement.match(doc, classification));
    const currentMatches = matches.filter(({ doc }) => doc.doc_status === 'current');
    const status = currentMatches.length ? 'present' : matches.length ? 'partial' : 'missing';
    return {
      ...requirement,
      label: normalizeLanguage(language) === 'zh' ? requirement.zh : requirement.en,
      purpose: normalizeLanguage(language) === 'zh' ? requirement.purposeZh : requirement.purposeEn,
      status,
      matches: matches.map(({ doc }) => doc)
    };
  });
}

function statusLabel(status, language) {
  const zh = { present: '已覆盖', partial: '部分覆盖', missing: '缺失' };
  const en = { present: 'present', partial: 'partial', missing: 'missing' };
  return normalizeLanguage(language) === 'zh' ? zh[status] : en[status];
}

function recommendation(requirement, language) {
  const zh = normalizeLanguage(language) === 'zh';
  if (requirement.status === 'present') {
    return zh ? '保持当前文档为主入口；后续通过 ledger 更新状态。' : 'Keep the current document as the primary entry; update state through the ledger.';
  }
  if (requirement.status === 'partial') {
    return zh
      ? '已有草案或方案资料，建议确认是否代表当前状态，并补齐验证/适用范围。'
      : 'Draft or proposal material exists; confirm whether it represents current state and add validation/scope.';
  }
  return zh
    ? `建议补充一份标准文档，覆盖：${requirement.purpose}`
    : `Add a standard document covering: ${requirement.purpose}`;
}

function representativeDocs(requirement, language) {
  if (!requirement.matches.length) return normalizeLanguage(language) === 'zh' ? '无' : 'none';
  return requirement.matches.slice(0, 4).map((doc) => sourceDocLink(doc.path)).join('<br>');
}

export function renderDocumentationGapsMarkdown({ documents, language = 'zh' }) {
  const requirements = evaluateRequirements(documents, language);
  const missing = requirements.filter((item) => item.status === 'missing');
  const partial = requirements.filter((item) => item.status === 'partial');
  const zh = normalizeLanguage(language) === 'zh';
  const lines = [
    `# ${zh ? '文档规范化缺口' : 'Documentation Standardization Gaps'}`,
    '',
    zh
      ? '本报告从当前 ledger 的文档状态生成，用来回答“哪些文档可作为标准入口、哪些过时资料应降级、哪些标准文档仍缺失”。它不会自动删除源文档。'
      : 'This report is rendered from the ledger to show which docs are standard entry points, which stale sources should be downgraded, and which standard docs are missing. It never deletes source documents automatically.',
    '',
    `## ${zh ? '总览' : 'Summary'}`,
    '',
    `| ${zh ? '项目' : 'Item'} | ${zh ? '数量' : 'Count'} |`,
    '|---|---:|',
    `| ${zh ? '标准项' : 'Standard areas'} | ${requirements.length} |`,
    `| ${zh ? '已覆盖' : 'Present'} | ${requirements.filter((item) => item.status === 'present').length} |`,
    `| ${zh ? '部分覆盖' : 'Partial'} | ${partial.length} |`,
    `| ${zh ? '缺失' : 'Missing'} | ${missing.length} |`,
    '',
    `## ${zh ? '标准文档矩阵' : 'Standard Docs Matrix'}`,
    '',
    `| ${zh ? '标准项' : 'Standard Area'} | ${zh ? '状态' : 'Status'} | ${zh ? '用途' : 'Purpose'} | ${zh ? '当前资料' : 'Current Material'} | ${zh ? '建议' : 'Recommendation'} |`,
    '|---|---|---|---|---|',
    ...requirements.map((item) => `| ${item.label} | ${statusLabel(item.status, language)} | ${item.purpose} | ${representativeDocs(item, language)} | ${recommendation(item, language)} |`),
    '',
    `## ${zh ? '缺失项优先级' : 'Missing Priorities'}`,
    '',
    ...(missing.length
      ? missing.map((item, index) => `${index + 1}. **${item.label}**: ${recommendation(item, language)}`)
      : [zh ? '无明确缺失项。' : 'No explicit missing standard area.']),
    '',
    `## ${zh ? '处理原则' : 'Handling Rules'}`,
    '',
    zh
      ? '- 不自动删除源文档；过时、删除和冲突资料只在 generated views 中降级展示。'
      : '- Do not auto-delete source documents; stale, deleted, and conflicting material is downgraded in generated views.',
    zh
      ? '- 当前主入口以 PRODUCT_DOCS_INDEX、PRODUCT_OVERVIEW、PRODUCT_ARCHITECTURE、PRODUCT_RECENT_CHANGES 和 TECHNICAL_APPENDIX 为准。'
      : '- Treat PRODUCT_DOCS_INDEX, PRODUCT_OVERVIEW, PRODUCT_ARCHITECTURE, PRODUCT_RECENT_CHANGES, and TECHNICAL_APPENDIX as the current generated entry points.',
    zh
      ? '- 缺失项应补原始资料或确认现有资料后再提升为 current。'
      : '- Fill gaps by adding source material or confirming existing material before promoting it to current.',
    '',
    `## ${zh ? '相关视图' : 'Related Views'}`,
    '',
    `- ${generatedDocLink('docs/octodocs/PRODUCT_DOCS_INDEX.md')}`,
    `- ${generatedDocLink('docs/octodocs/DOCS_INVENTORY.md')}`,
    `- ${generatedDocLink('docs/octodocs/DRIFT_REPORT.md')}`,
    `- ${generatedDocLink('docs/octodocs/TECHNICAL_APPENDIX.md')}`,
    ''
  ];
  return `${lines.join('\n')}\n`;
}

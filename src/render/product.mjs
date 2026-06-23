import { basename, join } from 'node:path';
import { classifyDocument } from '../classify/doc.mjs';
import { loadConfig } from '../config/config.mjs';
import { readLedger, splitLedger } from '../ledger/store.mjs';
import { readTextIfExists } from '../utils/fs.mjs';
import { gitInfo } from '../utils/git.mjs';
import { commitDocumentationGaps, commitGapTableLines } from './commit-docs.mjs';
import { eventSummary, eventTypeLabel, normalizeLanguage } from './i18n.mjs';
import { renderManagedFile } from './managed.mjs';

const AGENT_COMMENT = '<!-- AGENT: This is an OctoDocs product-facing view. Product docs summarize ledger data; use TECHNICAL_APPENDIX for evidence details. Do not edit managed blocks. -->';
const SOURCE_DOC_PREFIX = '../../';
const MAX_MAIN_ITEMS = 12;
const MAX_OVERVIEW_ITEMS = 8;
const MAX_INDEX_DOCS = 10;
const MAX_INDEX_DOMAIN_DOCS = 5;
const MAX_APPENDIX_EVIDENCE = 250;
const MAX_TOMBSTONE_APPENDIX = 80;

const PRODUCT_SOURCE_TYPES = new Set([
  'readme',
  'prd',
  'solution',
  'design',
  'adr',
  'api',
  'guide',
  'runbook',
  'security',
  'roadmap',
  'checklist',
  'schema',
  'changelog'
]);

const CAPABILITY_SOURCE_TYPES = new Set([
  'readme',
  'prd',
  'solution',
  'design',
  'adr',
  'api',
  'guide',
  'runbook',
  'security',
  'roadmap',
  'checklist',
  'schema',
  'changelog'
]);

const DOMAIN_RULES = [
  {
    key: 'entry',
    zh: '用户入口 / 操作界面',
    en: 'User Entry / Interface',
    keywords: ['dashboard', 'console', 'admin', 'web', 'ui', 'route', 'page', 'frontend', 'desktop', 'client', 'local', 'browser', 'brand', 'color', 'design system', 'visual', '控制台', '入口', '页面', '界面', '桌面', '客户端', '本地', '品牌', '视觉']
  },
  {
    key: 'workflow',
    zh: '核心业务流程',
    en: 'Core Workflow',
    keywords: ['workflow', 'flow', 'process', 'task', 'job', 'queue', 'pipeline', 'architecture', 'requirements', 'requirement', 'prd', 'spec', 'capability', 'model', 'decision', '业务', '流程', '任务', '工单', '管线', '架构', '需求', '能力', '模型', '决策']
  },
  {
    key: 'documents',
    zh: '文档解析与生成',
    en: 'Document Parsing And Generation',
    keywords: ['markdown', 'html', 'parser', 'parse', 'render', 'template', 'octodocs', '解析', '生成', '模板']
  },
  {
    key: 'automation',
    zh: '自动化执行',
    en: 'Automation',
    keywords: ['agent', 'automation', 'auto', 'hook', 'watch', 'scan', 'trigger', 'scheduler', 'cron', '自动化', '自动', '扫描', '触发', '钩子']
  },
  {
    key: 'verification',
    zh: '状态判断与验证',
    en: 'State And Verification',
    keywords: ['claim', 'evidence', 'ledger', 'verification', 'verify', 'coverage', 'review', 'status', 'drift', 'proof', '证据', '验证', '状态', '审查', '漂移', '账本']
  },
  {
    key: 'data',
    zh: '数据与存储',
    en: 'Data And Storage',
    keywords: ['storage', 'database', 'db', 'sqlite', 'index', 'cache', 'schema', 'migration', 'data', '数据', '存储', '缓存', '索引', '迁移']
  },
  {
    key: 'security',
    zh: '权限、安全与审计',
    en: 'Permission, Security And Audit',
    keywords: ['auth', 'permission', 'policy', 'role', 'access', 'login', 'security', 'audit', 'token', 'credential', 'secret', 'privacy', '权限', '安全', '审计', '登录', '角色', '访问', '凭证']
  },
  {
    key: 'integration',
    zh: '外部集成',
    en: 'External Integrations',
    keywords: ['api', 'integration', 'webhook', 'mcp', 'connector', 'plugin', 'third-party', 'external', '集成', '接口', '插件', '连接器', '第三方']
  },
  {
    key: 'operations',
    zh: '部署、配置与运维',
    en: 'Deployment, Configuration And Operations',
    keywords: ['deploy', 'deployment', 'docker', 'ci', 'config', 'env', 'release', 'build', 'install', 'setup', 'upgrade', 'rollback', 'backup', 'restore', 'self-host', 'operations', '部署', '配置', '环境', '发布', '安装', '构建', '升级', '回滚', '备份', '恢复', '运维']
  },
  {
    key: 'reporting',
    zh: '报告、导出与协作',
    en: 'Reporting, Export And Collaboration',
    keywords: ['report', 'export', 'summary', 'handoff', 'timeline', 'inventory', 'collaboration', 'usage', 'statistics', 'analytics', 'logs', 'dashboard stats', '报告', '导出', '摘要', '交接', '时间线', '清单', '协作', '用量', '统计', '分析', '日志']
  }
];

const COPY = {
  zh: {
    audienceOverview: '产品经理 / 业务负责人 / 设计负责人 / 运营与增长团队',
    audienceArchitecture: '产品经理 / 设计负责人 / 业务负责人 / 交付负责人',
    audienceChanges: '产品 / 研发 / 设计 / 运营 / 测试 / 增长团队',
    sourceMode: '自动生成',
    generatedAt: '生成依据时间',
    analysisPeriod: '分析范围',
    project: '项目名称',
    confidence: '当前可信度',
    confidenceHigh: '高：已发现较多当前资料和证据线索，但仍建议结合团队确认。',
    confidenceMedium: '中：已发现部分资料和证据线索，仍有待验证事项。',
    confidenceLow: '低：当前仓库资料不足以稳定判断，需要补充需求、变更或验收资料。',
    unknown: '待验证',
    noEvidence: '未发现确定性证据',
    noClearRisk: '暂未发现确定性高风险，但资料完整性仍需继续验证。',
    productIndexTitle: '产品文档导航',
    productOverviewTitle: '产品总览',
    productArchitectureTitle: '产品能力架构',
    recentChangesTitle: '最近变化',
    technicalAppendixTitle: '工程证据附录',
    positioningTitle: '一句话定位：这个项目是什么',
    positioningFallback: '暂未发现明确的一句话定位。根据现有资料，当前可暂时理解为一个围绕仓库资料、项目状态和团队协作信息构建的产品或系统，具体定位仍需结合需求文档进一步确认。',
    statusSummary: '当前状态摘要',
    statusNarrativeTitle: '状态解读',
    statusNarrative: '本文档从当前仓库中的文档、历史删除记录、部分源码线索和变更事件自动生成。凡是标记为“待验证”或“未发现确定性证据”的内容，都表示资料不足以稳定判断，并不代表该能力一定不存在。',
    usersTitle: '谁在使用 / 为谁服务',
    usersFallback: '暂未从现有资料中识别到明确用户角色。建议后续通过需求文档、用户流程或业务说明补充。',
    capabilityMapTitle: '当前产品能力地图',
    architectureOverviewTitle: '产品/系统架构概览',
    recentTitle: '最近做了什么',
    openItemsTitle: '当前未完成或待验证事项',
    risksTitle: '关键风险和开放问题',
    nextStepsTitle: '下一步建议',
    sourcesTitle: '资料入口',
    autoNoteTitle: '自动生成说明',
    autoNote: '本文档由自动化工具生成。主文档只展示产品含义，工程证据、文件路径、commit、coverage、evidence id 请查看工程证据附录。',
    currentRecommended: '推荐优先阅读',
    historicalDocs: '历史资料与可能过时内容',
    productMainDocs: '产品主线文档',
    engineeringDocs: '工程证据与技术视图',
    currentDocs: '当前推荐阅读',
    readPath: '推荐阅读路径',
    currentState: '当前判断',
    maturity: '整体成熟度',
    domains: '主要能力域',
    users: '主要用户/业务对象',
    latestUpdate: '最近更新时间',
    obviousRisk: '是否存在明显风险',
    nextFocus: '推荐下一步关注',
    role: '用户角色',
    roleDescription: '角色说明',
    supportStatus: '当前支持程度',
    domain: '能力域',
    capability: '当前能力',
    value: '用户/业务价值',
    status: '当前状态',
    relatedDocs: '相关资料',
    module: '模块',
    meaning: '产品含义',
    effect: '主要作用',
    item: '事项',
    impact: '影响范围',
    validation: '建议验证方式',
    risk: '风险',
    signal: '当前信号',
    recommendation: '建议处理',
    doc: '文档',
    type: '类型',
    reason: '推荐原因',
    note: '阅读提醒',
    overviewIntro: '用于快速理解项目当前状态、能力地图、风险和下一步关注点。',
    architectureIntro: '本文件不是底层技术架构说明，而是产品能力架构说明。它解释用户入口、核心能力、自动化执行、数据权限、外部集成之间的关系。',
    changesIntro: '本文件借鉴 release notes 结构，但面向内部产品团队。它关注最近变化对用户、业务、模块和团队协作的影响，不是研发日报。',
    appendixIntro: '本附录保留工程证据和追溯入口，供开发者、AI agent、审计或排错时使用。',
    architectureSummary: '架构摘要',
    architectureGraph: '产品能力架构图',
    entryLayer: '用户入口 / 操作界面',
    coreLayer: '核心能力层',
    automationLayer: '执行 / 自动化层',
    dataLayer: '数据、审计、权限、集成',
    dependencyLayer: '外部依赖',
    moduleDetails: '模块说明',
    architectureOpenItems: '架构风险与待验证事项',
    cycleSummary: '本周期摘要',
    topChanges: '本周期最重要的变化',
    importantChanges: '重要变化',
    affectedModules: '影响的产品模块',
    visibleChanges: '用户可感知变化',
    migrationItems: '需要团队关注的行为变化或迁移事项',
    fixedIssues: '已修复问题',
    unresolvedIssues: '未解决问题',
    nextCycle: '下一周期关注点',
    generatedFiles: '本次生成的文件',
    ledgerScale: '账本规模',
    claimAppendix: 'Claims 摘要',
    evidenceAppendix: 'Evidence 样本',
    fullLedger: '完整原始账本',
    fullLedgerNote: '如需完整逐条证据，请查看 `.octodocs/ledger.accepted.jsonl`。本附录只展示可读摘要和代表性样本，避免主文档膨胀。',
    notReleaseNote: '当前变化主要来自仓库扫描、文档记录、提交摘要或历史删除线索；除非资料中已有发布说明，否则不应直接视为正式版本说明。',
    pmStatusNote: '状态说明',
    statusConfirmed: '已实现并验证',
    statusImplementedNeedsValidation: '已实现待验证',
    statusDesignedNotImplemented: '已设计未实现',
    statusExploring: '方案探索中',
    statusRisk: '风险待澄清',
    statusStale: '可能过时',
    statusHistorical: '历史线索',
    statusUnknown: '未发现确定性证据',
    statusSourceCurrent: '当前资料入口',
    currentDocsByDomain: '按能力域的当前资料',
    tombstoneAppendixTitle: '历史痕迹（已删除文档 tombstone）'
  },
  en: {
    audienceOverview: 'Product / Business / Design / Operations',
    audienceArchitecture: 'Product / Design / Business / Delivery',
    audienceChanges: 'Product / Engineering / Design / Operations / QA / Growth',
    sourceMode: 'Generated',
    generatedAt: 'Generated From Ledger Time',
    analysisPeriod: 'Analysis Period',
    project: 'Project',
    confidence: 'Confidence',
    confidenceHigh: 'High: several current documents and evidence signals were found; team confirmation is still recommended.',
    confidenceMedium: 'Medium: partial documents and evidence signals were found; some items still need validation.',
    confidenceLow: 'Low: repository material is not enough for stable conclusions; add requirements, change notes, or acceptance material.',
    unknown: 'Needs validation',
    noEvidence: 'No deterministic evidence found',
    noClearRisk: 'No deterministic high risk was found, but source completeness still needs monitoring.',
    productIndexTitle: 'Product Docs Index',
    productOverviewTitle: 'Product Overview',
    productArchitectureTitle: 'Product Capability Architecture',
    recentChangesTitle: 'Recent Changes',
    technicalAppendixTitle: 'Technical Appendix',
    positioningTitle: 'One-Sentence Positioning',
    positioningFallback: 'No explicit one-sentence positioning was found. Based on current repository material, treat this as a product or system around project knowledge, current state, and team collaboration until requirements confirm otherwise.',
    statusSummary: 'Current Status Summary',
    statusNarrativeTitle: 'Status Interpretation',
    statusNarrative: 'This document is generated from repository documents, historical deleted files, partial source-code signals, and change events. Items marked as needs validation or no deterministic evidence mean the repository material is insufficient for a stable conclusion, not that the capability does not exist.',
    usersTitle: 'Users And Served Roles',
    usersFallback: 'No explicit user roles were found in the current material. Add requirements, user flows, or business descriptions to improve this section.',
    capabilityMapTitle: 'Current Product Capability Map',
    architectureOverviewTitle: 'Product/System Architecture Overview',
    recentTitle: 'What Changed Recently',
    openItemsTitle: 'Unfinished Or Needs-Validation Items',
    risksTitle: 'Key Risks And Open Questions',
    nextStepsTitle: 'Recommended Next Steps',
    sourcesTitle: 'Source Entry Points',
    autoNoteTitle: 'Generated Note',
    autoNote: 'This document is generated automatically. Product-facing docs describe product meaning; file paths, commits, coverage, and evidence IDs are kept in the technical appendix.',
    currentRecommended: 'Recommended Reading',
    historicalDocs: 'Historical Or Possibly Stale Material',
    productMainDocs: 'Product-Facing Docs',
    engineeringDocs: 'Engineering Evidence And Technical Views',
    currentDocs: 'Current Recommended Material',
    readPath: 'Suggested Reading Path',
    currentState: 'Current Judgment',
    maturity: 'Overall Maturity',
    domains: 'Main Capability Domains',
    users: 'Main Users / Business Objects',
    latestUpdate: 'Latest Update',
    obviousRisk: 'Obvious Risk',
    nextFocus: 'Recommended Focus',
    role: 'Role',
    roleDescription: 'Role Description',
    supportStatus: 'Support Status',
    domain: 'Capability Domain',
    capability: 'Current Capability',
    value: 'User / Business Value',
    status: 'Status',
    relatedDocs: 'Related Material',
    module: 'Module',
    meaning: 'Product Meaning',
    effect: 'Main Effect',
    item: 'Item',
    impact: 'Impact Scope',
    validation: 'Suggested Validation',
    risk: 'Risk',
    signal: 'Current Signal',
    recommendation: 'Recommendation',
    doc: 'Document',
    type: 'Type',
    reason: 'Reason',
    note: 'Reading Note',
    overviewIntro: 'Use this to quickly understand current state, capability map, risks, and next focus.',
    architectureIntro: 'This is not low-level technical architecture. It explains user entry, core capabilities, automation, data/permission boundaries, and external integrations.',
    changesIntro: 'This borrows from release-note structure but targets internal product teams. It focuses on impact to users, business, modules, and collaboration instead of engineering daily logs.',
    appendixIntro: 'This appendix keeps evidence and traceability for developers, AI agents, audit, and debugging.',
    architectureSummary: 'Architecture Summary',
    architectureGraph: 'Product Capability Architecture Diagram',
    entryLayer: 'User Entry / Interface',
    coreLayer: 'Core Capability Layer',
    automationLayer: 'Execution / Automation Layer',
    dataLayer: 'Data, Audit, Permission, Integration',
    dependencyLayer: 'External Dependencies',
    moduleDetails: 'Module Details',
    architectureOpenItems: 'Architecture Risks And Needs-Validation Items',
    cycleSummary: 'Cycle Summary',
    topChanges: 'Most Important Changes',
    importantChanges: 'Important Changes',
    affectedModules: 'Affected Product Modules',
    visibleChanges: 'User-Visible Changes',
    migrationItems: 'Behavior Changes Or Migration Items',
    fixedIssues: 'Fixed Issues',
    unresolvedIssues: 'Unresolved Issues',
    nextCycle: 'Next-Cycle Focus',
    generatedFiles: 'Generated Files',
    ledgerScale: 'Ledger Scale',
    claimAppendix: 'Claims Summary',
    evidenceAppendix: 'Evidence Samples',
    fullLedger: 'Full Raw Ledger',
    fullLedgerNote: 'For full evidence records, inspect `.octodocs/ledger.accepted.jsonl`. This appendix shows readable summaries and representative samples to avoid bloated product docs.',
    notReleaseNote: 'Current changes mainly come from repository scans, document records, commit summaries, or historical deletion signals. Do not treat them as official release notes unless release material exists.',
    pmStatusNote: 'Status Legend',
    statusConfirmed: 'Implemented And Verified',
    statusImplementedNeedsValidation: 'Implemented, Needs Validation',
    statusDesignedNotImplemented: 'Designed, Not Implemented',
    statusExploring: 'Exploring',
    statusRisk: 'Risk Needs Clarification',
    statusStale: 'Possibly Stale',
    statusHistorical: 'Historical Signal',
    statusUnknown: 'No Deterministic Evidence',
    statusSourceCurrent: 'Current Source Entry',
    currentDocsByDomain: 'Current Material By Capability Domain',
    tombstoneAppendixTitle: 'Historical Traces (Deleted Document Tombstones)'
  }
};

function p(language, key) {
  const lang = normalizeLanguage(language);
  return COPY[lang][key] || COPY.en[key] || key;
}

function cleanInline(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableCell(value) {
  const text = cleanInline(value);
  return text ? text.replaceAll('|', '/') : '-';
}

function mdLink(label, target) {
  const safeLabel = cleanInline(label).replaceAll('[', '(').replaceAll(']', ')').replaceAll('|', '/') || cleanInline(target);
  const safeTarget = cleanInline(target).replaceAll('>', '%3E');
  return `[${safeLabel}](<${safeTarget}>)`;
}

function generatedDocLink(fileName) {
  return mdLink(fileName, `./${fileName}`);
}

function sourceDocLink(doc) {
  return mdLink(displayDocTitle(doc), `${SOURCE_DOC_PREFIX}${doc.path}`);
}

function latestBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return Array.from(map.values());
}

function latestDocuments(documents) {
  return latestBy(documents, (doc) => doc.path).sort((a, b) => a.path.localeCompare(b.path));
}

function latestClaims(claims) {
  return latestBy(claims, (claim) => claim.id).sort((a, b) => a.subject.localeCompare(b.subject));
}

function isHistoricalDoc(doc) {
  return ['stale', 'superseded', 'archived', 'conflict'].includes(doc.doc_status);
}

function isStaleDoc(doc) {
  return !doc.tombstone && isHistoricalDoc(doc);
}

function isTombstoneDoc(doc) {
  return Boolean(doc.tombstone);
}

function isLowPrioritySourceDoc(doc) {
  const path = String(doc.path || '');
  return [
    /^\.github\//,
    /^\.design-sync\//,
    /^\.omo\//,
    /^\.sisyphus\//,
    /^\.staging\//,
    /^\.workflow\//,
    /^tests?\//,
    /(^|\/)__fixtures__\//,
    /(^|\/)fixtures\//,
    /(^|\/)templates?\//,
    /(^|\/)vendor\//,
    /(^|\/)oh_modules\//,
    /(^|\/)dist-mobile\//,
    /(^|\/)docs\/archive\//,
    /^artifacts\//,
    /(^|\/)browser-walkthrough-reports\//,
    /(^|\/)github-issue-drafts[^/]*\//,
    /^tmp\//,
    /^temp\//,
    /^release(-asar|-local)?\//
  ].some((pattern) => pattern.test(path));
}

function docSourcePriority(doc, classification = classifyDocument(doc)) {
  const path = String(doc.path || '');
  if (/^README\.md$/i.test(path)) return 0;
  if (/^CHANGELOG\.md$/i.test(path) || /^ROADMAP\.md$/i.test(path) || /^SECURITY\.md$/i.test(path)) return 5;
  if (/^docs\/(self-host-guide|development-setup|schema-guide|public-release-checklist|rollback-playbook|upgrade-guide)\.md$/i.test(path)) return 8;
  if (/^docs\/(architecture|operations|security|smoke-checklists)\//i.test(path)) return 12;
  if (/^octvex-(core|console|desk|edge)\/README\.md$/i.test(path)) return 14;
  if (/^docs\/blueprints\/[^/]+\/README\.md$/i.test(path)) return 18;
  if (/^docs\//i.test(path)) return 22;
  if (/^octvex-(core|console|desk|edge)\/docs\//i.test(path)) return 28;
  if (/^octvex-edge\/src\/README\.md$/i.test(path)) return 30;
  if (/^octvex-console\/app\/\(dashboard\)\//i.test(path)) return 50;
  if (/^octvex-console\/app\/api\//i.test(path)) return 52;
  if (/^octvex-core\/src\/recipe\/blueprints\//i.test(path)) return 75;
  if (classification.type === 'recipe') return 80;
  if (classification.type === 'template' || classification.type === 'agent-rules') return 90;
  return 40;
}

function stripTitleNoise(title) {
  return cleanInline(title)
    .replace(/\.(md|markdown|html)$/i, '')
    .replace(/^\d{4}[-_./]?\d{2}[-_./]?\d{2}[-_\s]*/, '')
    .replace(/^\d{8}[-_\s]*/, '')
    .replace(/\b(v\d+|final-final|final)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayDocTitle(doc) {
  const title = stripTitleNoise(doc.title || basename(doc.path));
  if (/^readme(_cn)?$/i.test(title)) return 'README';
  return title || basename(doc.path);
}

function docTypeLabel(doc, language) {
  const type = classifyDocument(doc).type;
  const labels = {
    zh: {
      prd: '需求文档',
      solution: '方案/规格',
      design: '设计/架构',
      adr: '决策记录',
      readme: '项目说明',
      api: 'API/协议',
      guide: '指南',
      runbook: '运维 Runbook',
      security: '安全/权限',
      roadmap: '路线图',
      checklist: '验收/检查清单',
      schema: 'Schema/数据模型',
      recipe: 'Recipe/蓝图',
      'agent-rules': 'Agent 规则',
      template: '模板',
      todo: '待办/计划',
      changelog: '更新说明',
      'demo-html': 'HTML 原型/产物',
      generated: '生成文档',
      unknown: '未归类资料'
    },
    en: {
      prd: 'Requirements',
      solution: 'Solution / Spec',
      design: 'Design / Architecture',
      adr: 'Decision Record',
      readme: 'README',
      api: 'API / Protocol',
      guide: 'Guide',
      runbook: 'Runbook',
      security: 'Security / Permission',
      roadmap: 'Roadmap',
      checklist: 'Validation / Checklist',
      schema: 'Schema / Data Model',
      recipe: 'Recipe / Blueprint',
      'agent-rules': 'Agent Rules',
      template: 'Template',
      todo: 'Todo / Plan',
      changelog: 'Changelog',
      'demo-html': 'HTML Prototype / Artifact',
      generated: 'Generated Doc',
      unknown: 'Unclassified'
    }
  };
  const lang = normalizeLanguage(language);
  return labels[lang][type] || type;
}

function docSortScore(doc) {
  const type = classifyDocument(doc).type;
  const typeScore = {
    readme: 0,
    prd: 1,
    solution: 2,
    design: 3,
    adr: 4,
    api: 5,
    security: 6,
    schema: 7,
    guide: 8,
    runbook: 9,
    checklist: 10,
    roadmap: 11,
    changelog: 12,
    recipe: 13,
    todo: 14,
    'demo-html': 15,
    'agent-rules': 16,
    template: 17,
    unknown: 18,
    generated: 19
  }[type] ?? 8;
  const statusScore = { current: 0, proposal: 1, draft: 2, conflict: 4, stale: 5, superseded: 6, archived: 7 }[doc.doc_status] ?? 3;
  return docSourcePriority(doc, { type }) * 100 + typeScore * 10 + statusScore;
}

function recommendedDocs(documents) {
  return documents
    .filter((doc) => !doc.tombstone && !isHistoricalDoc(doc) && !isLowPrioritySourceDoc(doc) && PRODUCT_SOURCE_TYPES.has(classifyDocument(doc).type))
    .sort((a, b) => docSortScore(a) - docSortScore(b) || displayDocTitle(a).localeCompare(displayDocTitle(b)));
}

function isProductRelevantDocPath(path) {
  const doc = { path: String(path || ''), doc_status: 'current', tombstone: false };
  const classification = classifyDocument(doc);
  return doc.path
    && !isLowPrioritySourceDoc(doc)
    && PRODUCT_SOURCE_TYPES.has(classification.type)
    && docSourcePriority(doc, classification) < 60;
}

function historicalDocs(documents) {
  return documents
    .filter((doc) => isStaleDoc(doc) && !isLowPrioritySourceDoc(doc) && PRODUCT_SOURCE_TYPES.has(classifyDocument(doc).type))
    .sort((a, b) => docSortScore(a) - docSortScore(b) || displayDocTitle(a).localeCompare(displayDocTitle(b)));
}

function tombstoneDocs(documents) {
  return documents
    .filter(isTombstoneDoc)
    .sort((a, b) => (b.last_seen_commit || '').localeCompare(a.last_seen_commit || '') || a.path.localeCompare(b.path));
}

function domainLabel(domainKey, language) {
  const domain = DOMAIN_RULES.find((item) => item.key === domainKey) || DOMAIN_RULES[1];
  return normalizeLanguage(language) === 'zh' ? domain.zh : domain.en;
}

function classifyDomain(...parts) {
  const text = parts.map((part) => cleanInline(part).toLowerCase()).join(' ');
  let best = { key: 'workflow', score: 0 };
  for (const domain of DOMAIN_RULES) {
    const score = domain.keywords.reduce((sum, keyword) => sum + (matchesDomainKeyword(text, keyword) ? 1 : 0), 0);
    if (score > best.score) best = { key: domain.key, score };
  }
  return best.score > 0 ? best.key : 'workflow';
}

function domainForDocument(doc, classification = classifyDocument(doc)) {
  const typeDomain = {
    api: 'integration',
    schema: 'data',
    security: 'security',
    runbook: 'operations',
    checklist: 'verification',
    changelog: 'operations',
    roadmap: 'workflow'
  }[classification.type];
  return typeDomain || classifyDomain(doc.path, doc.title, doc.render_summary);
}

function matchesDomainKeyword(text, keyword) {
  const value = String(keyword || '').toLowerCase();
  if (!value) return false;
  if (/^[a-z0-9][a-z0-9 -]*[a-z0-9]$/.test(value)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(value).replace(/\s+/g, '[ -]+')}($|[^a-z0-9])`, 'i').test(text);
  }
  return text.includes(value);
}

function valueForDomain(domainKey, language) {
  const zh = {
    entry: '帮助用户进入、配置和查看系统结果。',
    workflow: '承载用户或业务团队完成核心任务的主流程。',
    documents: '帮助团队从项目资料中形成可阅读、可追溯的说明。',
    automation: '减少人工重复操作，让扫描、触发、生成或同步流程自动完成。',
    verification: '帮助团队判断资料是否可信、是否过时、是否仍需确认。',
    data: '承载数据、缓存、索引或结构变更，影响稳定性和可追溯性。',
    security: '影响访问边界、敏感信息、审计和团队协作安全。',
    integration: '连接外部系统、API、插件或工具，扩展产品使用场景。',
    operations: '影响安装、部署、配置、构建和运行稳定性。',
    reporting: '帮助团队查看结果、交接状态、导出信息或协同决策。'
  };
  const en = {
    entry: 'Helps users enter, configure, and inspect system results.',
    workflow: 'Carries the main flow for users or business teams to complete core tasks.',
    documents: 'Turns project material into readable and traceable documentation.',
    automation: 'Reduces repeated manual work by automating scan, trigger, generation, or sync flows.',
    verification: 'Helps teams judge whether material is trustworthy, stale, or needs confirmation.',
    data: 'Carries data, cache, index, or schema changes that affect stability and traceability.',
    security: 'Affects access boundaries, sensitive information, audit, and collaboration safety.',
    integration: 'Connects external systems, APIs, plugins, or tools.',
    operations: 'Affects installation, deployment, configuration, build, and runtime stability.',
    reporting: 'Helps teams inspect outputs, hand off state, export information, or collaborate.'
  };
  return normalizeLanguage(language) === 'zh' ? zh[domainKey] : en[domainKey];
}

function pmStatusForClaim(claim, language) {
  const lang = normalizeLanguage(language);
  const label = (key) => p(lang, key);
  if (claim.verification === 'failed') return label('statusRisk');
  if (claim.lifecycle === 'deprecated' || claim.lifecycle === 'superseded') return label('statusRisk');
  if (claim.implementation === 'removed') return label('statusRisk');
  if (claim.verification === 'verified') return label('statusConfirmed');
  if (claim.implementation === 'implemented') return label('statusImplementedNeedsValidation');
  if (claim.implementation === 'in_progress') return label('statusImplementedNeedsValidation');
  if (claim.intent === 'planned') return label('statusDesignedNotImplemented');
  if (claim.intent === 'proposal' || claim.intent === 'idea') return label('statusExploring');
  return label('statusUnknown');
}

function evidenceIndex(evidences) {
  const byId = new Map();
  const byPath = new Map();
  for (const ev of evidences) {
    byId.set(ev.id, ev);
    if (ev.path) {
      const list = byPath.get(ev.path) || [];
      list.push(ev);
      byPath.set(ev.path, list);
    }
  }
  return { byId, byPath };
}

function linkedEvidences(claim, index) {
  return (claim.evidence_ids || []).map((id) => index.byId.get(id)).filter(Boolean);
}

function relatedDocForClaim(claim, index, documents) {
  const docsByPath = new Map(documents.map((doc) => [doc.path, doc]));
  for (const ev of linkedEvidences(claim, index)) {
    if (ev.path && docsByPath.has(ev.path)) return docsByPath.get(ev.path);
  }
  const subject = cleanInline(claim.subject).toLowerCase();
  return recommendedDocs(documents).find((doc) => subject.includes(displayDocTitle(doc).toLowerCase()));
}

function domainOrder(domainKey) {
  const index = DOMAIN_RULES.findIndex((item) => item.key === domainKey);
  return index === -1 ? 999 : index;
}

function capabilityItemSort(a, b) {
  return (a.priority ?? 50) - (b.priority ?? 50)
    || domainOrder(a.domainKey) - domainOrder(b.domainKey)
    || b.confidence - a.confidence
    || a.title.localeCompare(b.title);
}

function dedupeCapabilityItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items.sort(capabilityItemSort)) {
    const key = `${item.domainKey}:${cleanInline(item.title).toLowerCase()}`;
    const relatedKey = item.related ? `${item.domainKey}:${cleanInline(item.related).toLowerCase()}` : null;
    if (seen.has(key) || (relatedKey && seen.has(relatedKey))) continue;
    seen.add(key);
    if (relatedKey) seen.add(relatedKey);
    deduped.push(item);
  }
  return deduped;
}

function limitCapabilityDocsByDomain(items, maxPerDomain = 5) {
  const counts = new Map();
  const kept = [];
  for (const item of items.sort(capabilityItemSort)) {
    const count = counts.get(item.domainKey) || 0;
    if (count >= maxPerDomain) continue;
    counts.set(item.domainKey, count + 1);
    kept.push(item);
  }
  return kept;
}

function claimCapabilityItems({ claims, documents, evidences, language }) {
  const index = evidenceIndex(evidences);
  return claims.map((claim) => {
    const relatedDoc = relatedDocForClaim(claim, index, documents);
    const evs = linkedEvidences(claim, index);
    const domainKey = classifyDomain(claim.subject, claim.aliases?.join(' '), relatedDoc?.path, relatedDoc?.title, relatedDoc?.render_summary);
    return {
      title: cleanInline(claim.subject),
      sourceType: 'claim',
      domainKey,
      domain: domainLabel(domainKey, language),
      value: valueForDomain(domainKey, language),
      status: pmStatusForClaim(claim, language),
      related: relatedDoc ? sourceDocLink(relatedDoc) : generatedDocLink('TECHNICAL_APPENDIX.md'),
      confidence: claim.confidence ?? 0,
      evidenceCount: evs.length,
      risk: claim.verification === 'failed' ? p(language, 'statusRisk') : (claim.verification === 'verified' ? p(language, 'noClearRisk') : p(language, 'unknown')),
      open: claim.verification !== 'verified',
      priority: 35 + (claim.verification === 'verified' ? 0 : 8) + (relatedDoc ? Math.min(20, docSourcePriority(relatedDoc) / 3) : 15)
    };
  });
}

function docCapabilityItems({ documents, language }) {
  const candidates = recommendedDocs(documents)
    .filter((doc) => CAPABILITY_SOURCE_TYPES.has(classifyDocument(doc).type))
    .filter((doc) => docSourcePriority(doc) < 60)
    .map((doc) => {
      const domainKey = domainForDocument(doc);
      return {
        title: displayDocTitle(doc),
        sourceType: 'document',
        domainKey,
        domain: domainLabel(domainKey, language),
        value: valueForDomain(domainKey, language),
        status: p(language, 'statusSourceCurrent'),
        related: sourceDocLink(doc),
        confidence: classifyDocument(doc).confidence,
        evidenceCount: 0,
        risk: p(language, 'unknown'),
        open: false,
        priority: docSourcePriority(doc)
      };
    });
  return limitCapabilityDocsByDomain(candidates, 5);
}

function capabilityItems({ claims, documents, evidences, language }) {
  const items = dedupeCapabilityItems([
    ...docCapabilityItems({ documents, language }),
    ...claimCapabilityItems({ claims, documents, evidences, language })
  ]);
  if (items.length) return items;

  return recommendedDocs(documents).slice(0, MAX_MAIN_ITEMS).map((doc) => {
    const domainKey = domainForDocument(doc);
    return {
      title: displayDocTitle(doc),
      sourceType: 'document',
      domainKey,
      domain: domainLabel(domainKey, language),
      value: valueForDomain(domainKey, language),
      status: p(language, 'statusSourceCurrent'),
      related: sourceDocLink(doc),
      confidence: classifyDocument(doc).confidence,
      evidenceCount: 0,
      risk: p(language, 'unknown'),
      open: false,
      priority: docSourcePriority(doc)
    };
  });
}

function domainSummary(items, language) {
  const counts = new Map();
  for (const item of items) counts.set(item.domainKey, (counts.get(item.domainKey) || 0) + 1);
  const labels = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `${domainLabel(key, language)}(${count})`);
  return labels.length ? labels.join('、') : p(language, 'unknown');
}

function groupDocsByDomain(docs, language) {
  const groups = new Map();
  for (const doc of docs) {
    const domainKey = domainForDocument(doc);
    const group = groups.get(domainKey) || { key: domainKey, label: domainLabel(domainKey, language), docs: [] };
    group.docs.push(doc);
    groups.set(domainKey, group);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      docs: group.docs.sort((a, b) => docSortScore(a) - docSortScore(b) || displayDocTitle(a).localeCompare(displayDocTitle(b)))
    }))
    .sort((a, b) => DOMAIN_RULES.findIndex((item) => item.key === a.key) - DOMAIN_RULES.findIndex((item) => item.key === b.key));
}

function groupedDocLines(docs, language, options = {}) {
  const maxDomains = options.maxDomains ?? 8;
  const maxPerDomain = options.maxPerDomain ?? MAX_INDEX_DOMAIN_DOCS;
  const groups = groupDocsByDomain(docs, language).slice(0, maxDomains);
  if (!groups.length) {
    return [
      `| ${p(language, 'doc')} | ${p(language, 'type')} | ${p(language, 'reason')} |`,
      '|---|---|---|',
      `| ${p(language, 'noEvidence')} | - | ${normalizeLanguage(language) === 'zh' ? '建议先补充 README、需求或产品说明。' : 'Add README, requirements, or product notes first.'} |`
    ];
  }

  const lines = [];
  let shown = 0;
  for (const group of groups) {
    const visibleDocs = group.docs.slice(0, maxPerDomain);
    shown += visibleDocs.length;
    lines.push(
      `### ${group.label}`,
      '',
      `| ${p(language, 'doc')} | ${p(language, 'type')} | ${p(language, 'reason')} |`,
      '|---|---|---|',
      ...visibleDocs.map((doc) => `| ${sourceDocLink(doc)} | ${docTypeLabel(doc, language)} | ${normalizeLanguage(language) === 'zh' ? '当前资料，适合作为理解该能力域的入口。' : 'Current material suitable as an entry point for this domain.'} |`)
    );
    if (group.docs.length > visibleDocs.length) {
      lines.push(`| ${normalizeLanguage(language) === 'zh' ? `另有 ${group.docs.length - visibleDocs.length} 份同域资料` : `${group.docs.length - visibleDocs.length} more in this domain`} | - | ${normalizeLanguage(language) === 'zh' ? '为保持导航可读，本页只展示代表性入口。' : 'Only representative entry points are shown to keep the index readable.'} |`);
    }
    lines.push('');
  }
  if (docs.length > shown) {
    lines.push(normalizeLanguage(language) === 'zh'
      ? `> 当前资料较多，本节按能力域展示代表性入口；完整清单请查看 ${generatedDocLink('DOCS_INVENTORY.md')}。`
      : `> This section shows representative entry points by capability domain. See ${generatedDocLink('DOCS_INVENTORY.md')} for the full inventory.`);
  }
  return lines;
}

function confidenceLabel({ documents, claims, evidences }, language) {
  const currentDocs = recommendedDocs(documents).length;
  if (currentDocs >= 5 && claims.length >= 3 && evidences.length >= 20) return p(language, 'confidenceHigh');
  if (currentDocs >= 1 || evidences.length >= 1) return p(language, 'confidenceMedium');
  return p(language, 'confidenceLow');
}

function maturityLabel(claims, language) {
  if (!claims.length) return p(language, 'statusUnknown');
  const verified = claims.filter((claim) => claim.verification === 'verified').length;
  const implemented = claims.filter((claim) => ['implemented', 'in_progress'].includes(claim.implementation)).length;
  const lang = normalizeLanguage(language);
  if (verified / claims.length >= 0.6) return lang === 'zh' ? '较稳定：多数结论已有验证线索。' : 'Relatively stable: most claims have validation signals.';
  if (implemented > 0) return lang === 'zh' ? '已有实现线索，仍需产品或验收验证。' : 'Implementation signals exist, but product or acceptance validation is still needed.';
  return lang === 'zh' ? '资料/方案阶段，当前不宜视为已完整交付。' : 'Document/proposal stage; do not treat as fully delivered yet.';
}

function latestLedgerTime(events) {
  const sorted = [...events].map((event) => event.ts).filter(Boolean).sort();
  return sorted.at(-1) || 'unknown';
}

function analysisPeriod(events, language) {
  const sorted = [...events].map((event) => event.ts).filter(Boolean).sort();
  if (!sorted.length) return normalizeLanguage(language) === 'zh' ? '暂未识别统计周期' : 'No stable analysis period found';
  const first = sorted[0].slice(0, 10);
  const last = sorted.at(-1).slice(0, 10);
  return first === last ? first : `${first} - ${last}`;
}

async function inferProjectName(root) {
  const pkgText = await readTextIfExists(join(root, 'package.json'));
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      if (pkg.name) return pkg.name;
    } catch {
      // Fall back to the directory name below.
    }
  }
  return basename(root);
}

function eventCategory(event, language) {
  const raw = `${event.type} ${event.summary || ''}`.toLowerCase();
  const zh = normalizeLanguage(language) === 'zh';
  if (event.type === 'doc_deleted' || /remove|delete|deprecat|删除|下线|废弃/.test(raw)) return zh ? '行为变化 / 历史资料' : 'Behavior Change / Historical Material';
  if (/fix|bug|resolve|修复|问题/.test(raw)) return zh ? '问题修复' : 'Fix';
  if (/\b(feat|feature)\b|add|create|new|introduce|新增|创建/.test(raw)) return zh ? '新增能力' : 'Added Capability';
  if (/improve|enhance|optimi[sz]e|refactor|优化|改进/.test(raw)) return zh ? '能力改进' : 'Improvement';
  if (/deploy|ci|config|env|build|release|部署|配置|环境|发布|构建/.test(raw)) return zh ? '运维变化' : 'Operations';
  if (/docs?|readme|guide|markdown|html|scanned|文档|说明/.test(raw)) return zh ? '文档变化' : 'Documentation';
  if (event.type === 'code_changed' || event.type === 'commit') return zh ? '能力改进' : 'Improvement';
  return zh ? '待验证' : 'Needs Validation';
}

function eventImpact(event, language) {
  const category = eventCategory(event, language);
  const zh = normalizeLanguage(language) === 'zh';
  if (/文档|Documentation/.test(category)) return zh ? '帮助团队更新对项目资料和当前说明的理解。' : 'Helps the team refresh project material and current explanations.';
  if (/修复|Fix/.test(category)) return zh ? '可能改善相关问题的稳定性或一致性，仍需结合验收确认。' : 'May improve stability or consistency; validate with acceptance evidence.';
  if (/运维|Operations/.test(category)) return zh ? '可能影响部署、配置、构建或自动化流程。' : 'May affect deployment, configuration, build, or automation flows.';
  if (/历史|Behavior/.test(category)) return zh ? '可能表示资料、入口或行为已调整，当前状态需要确认。' : 'May indicate material, entry points, or behavior changed; confirm current state.';
  return zh ? '可能影响相关能力或模块，当前仍需产品或研发确认。' : 'May affect related capabilities or modules; product or engineering confirmation is needed.';
}

function importantEvents(events, language) {
  const commitEvents = events.filter((event) => event.type === 'commit');
  const nonCommitEvents = events.filter((event) => event.type !== 'commit');
  const commitTimes = commitEvents.map((event) => new Date(event.ts).getTime()).filter(Number.isFinite);
  const commitSpanMs = commitTimes.length ? Math.max(...commitTimes) - Math.min(...commitTimes) : 0;
  const commitSort = commitSpanMs > 5 * 60 * 1000
    ? (a, b) => b.ts.localeCompare(a.ts)
    : (a, b) => a.ts.localeCompare(b.ts);
  const orderedEvents = [
    ...commitEvents.sort(commitSort),
    ...nonCommitEvents.filter((event) => !/\bscanned as (markdown|html)\b/i.test(event.summary || '')).sort((a, b) => b.ts.localeCompare(a.ts)),
    ...nonCommitEvents.filter((event) => /\bscanned as (markdown|html)\b/i.test(event.summary || '')).sort((a, b) => b.ts.localeCompare(a.ts))
  ];
  const changes = orderedEvents.map((event) => ({
      title: eventSummary(event, language),
      type: eventCategory(event, language),
      impact: eventImpact(event, language),
      status: normalizeLanguage(language) === 'zh' ? '已记录，待产品确认影响' : 'Recorded; product impact needs confirmation',
      source: event.source,
      path: event.path,
      ts: event.ts,
      eventType: event.type,
      scanEvent: /\bscanned as (markdown|html)\b/i.test(event.summary || '')
    }));
  const seen = new Set();
  const deduped = [];
  for (const change of changes) {
    const key = `${change.type}:${change.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(change);
    if (deduped.length >= 50) break;
  }
  return deduped;
}

function productFacingChanges(events, language, max = 24) {
  const changes = importantEvents(events, language);
  const meaningful = changes.filter((change) => !change.scanEvent);
  if (meaningful.length) return meaningful.slice(0, max);
  const productDocScans = changes.filter((change) => change.scanEvent && isProductRelevantDocPath(change.path));
  return (productDocScans.length ? productDocScans : changes.filter((change) => !change.scanEvent || isProductRelevantDocPath(change.path))).slice(0, max);
}

function changeBucket(change) {
  if (/新增|Added/.test(change.type)) return 'added';
  if (/修复|Fix/.test(change.type)) return 'fixed';
  if (/文档|Documentation|运维|Operations|历史|Behavior/.test(change.type)) return 'docsOps';
  return 'improved';
}

function changeBucketTitle(bucket, language) {
  const zh = {
    added: '新增能力',
    improved: '改进',
    fixed: '修复',
    docsOps: '文档 / 运维变化'
  };
  const en = {
    added: 'Added Capability',
    improved: 'Improvements',
    fixed: 'Fixes',
    docsOps: 'Documentation / Operations'
  };
  return normalizeLanguage(language) === 'zh' ? zh[bucket] : en[bucket];
}

function groupedChangeLines(changes, language, maxPerBucket = 4) {
  const zh = normalizeLanguage(language) === 'zh';
  const separator = zh ? '：' : ': ';
  const wrapStatus = (status) => zh ? `（${status}）` : ` (${status})`;
  const buckets = ['added', 'improved', 'fixed', 'docsOps'];
  const lines = [];
  for (const bucket of buckets) {
    const bucketChanges = changes.filter((change) => changeBucket(change) === bucket).slice(0, maxPerBucket);
    lines.push(`### ${changeBucketTitle(bucket, language)}`, '');
    if (bucketChanges.length) {
      lines.push(...bucketChanges.map((change) => `- **${cleanInline(change.title)}**${separator}${cleanInline(change.impact)}${wrapStatus(cleanInline(change.status))}`));
    } else {
      lines.push(zh
        ? '- 暂未发现足够清晰的本类变化。'
        : '- No clear change in this category was found.');
    }
    lines.push('');
  }
  return lines;
}

function riskItems({ claims, documents, evidences, language }) {
  const items = [];
  for (const claim of claims) {
    if (claim.verification === 'failed') {
      items.push({
        title: claim.subject,
        impact: normalizeLanguage(language) === 'zh' ? '可能影响能力状态判断和团队决策。' : 'May affect capability-state judgment and team decisions.',
        signal: p(language, 'statusRisk'),
        recommendation: normalizeLanguage(language) === 'zh' ? '对比相关需求、实现和验收资料后再确认。' : 'Compare requirements, implementation, and acceptance material before confirming.'
      });
    } else if (claim.verification !== 'verified') {
      items.push({
        title: claim.subject,
        impact: normalizeLanguage(language) === 'zh' ? '当前状态不应直接作为已完成结论使用。' : 'Do not use this as a completed-state conclusion yet.',
        signal: pmStatusForClaim(claim, language),
        recommendation: normalizeLanguage(language) === 'zh' ? '补充验收、测试、使用说明或团队确认。' : 'Add acceptance, tests, usage notes, or team confirmation.'
      });
    }
  }
  const conflictDocs = documents.filter((doc) => doc.doc_status === 'conflict');
  for (const doc of conflictDocs) {
    items.push({
      title: displayDocTitle(doc),
      impact: normalizeLanguage(language) === 'zh' ? '资料之间可能存在不一致。' : 'Source material may be inconsistent.',
      signal: p(language, 'statusRisk'),
      recommendation: normalizeLanguage(language) === 'zh' ? '确认该文档是否仍代表当前状态。' : 'Confirm whether this document still represents current state.'
    });
  }
  if (historicalDocs(documents).length && !items.length) {
    items.push({
      title: normalizeLanguage(language) === 'zh' ? '历史资料可能影响当前判断' : 'Historical material may affect current judgment',
      impact: normalizeLanguage(language) === 'zh' ? '旧方案或删除文档不应直接作为当前状态依据。' : 'Old plans or deleted documents should not be used as current-state evidence directly.',
      signal: normalizeLanguage(language) === 'zh' ? `发现 ${historicalDocs(documents).length} 份历史/可能过时资料。` : `${historicalDocs(documents).length} historical or possibly stale documents found.`,
      recommendation: normalizeLanguage(language) === 'zh' ? '主文档只引用当前资料，历史资料放入附录和导航提醒。' : 'Use current material in main docs; keep historical material in navigation and appendix.'
    });
  }
  if (!evidences.some((ev) => ev.relation === 'tests')) {
    items.push({
      title: normalizeLanguage(language) === 'zh' ? '验收或测试线索不足' : 'Acceptance or test signals are limited',
      impact: normalizeLanguage(language) === 'zh' ? '能力状态更适合标记为待验证。' : 'Capability states should remain needs-validation.',
      signal: normalizeLanguage(language) === 'zh' ? '未发现 tests 类 evidence。' : 'No tests relation evidence found.',
      recommendation: normalizeLanguage(language) === 'zh' ? '补充测试、验收记录或人工确认。' : 'Add tests, acceptance records, or human confirmation.'
    });
  }
  return items.slice(0, MAX_MAIN_ITEMS);
}

function openItems(items, language) {
  const open = items.filter((item) => item.open !== false && item.status !== p(language, 'statusConfirmed'));
  if (open.length) return open.slice(0, MAX_MAIN_ITEMS).map((item) => ({
    title: item.title,
    status: item.status,
    impact: item.domain,
    validation: normalizeLanguage(language) === 'zh' ? '结合当前需求文档、产品走查、测试或研发确认验证。' : 'Validate with current requirements, product walkthrough, tests, or engineering confirmation.',
    related: item.related
  }));
  return [];
}

function architectureMermaid(items, language) {
  const domains = Array.from(new Set(items.map((item) => item.domainKey))).slice(0, 8);
  const lang = normalizeLanguage(language);
  const entry = lang === 'zh' ? '用户入口 / 操作界面' : 'User Entry / Interface';
  const core = lang === 'zh' ? '核心能力层' : 'Core Capability Layer';
  const automation = lang === 'zh' ? '执行 / 自动化层' : 'Execution / Automation Layer';
  const data = lang === 'zh' ? '数据、权限与审计' : 'Data, Permission And Audit';
  const integration = lang === 'zh' ? '外部集成与依赖' : 'External Integrations And Dependencies';
  const lines = [
    'flowchart TB',
    `    A["${entry}"] --> B["${core}"]`,
    `    B --> C["${automation}"]`,
    `    B --> D["${data}"]`,
    `    C --> D`,
    `    B --> E["${integration}"]`
  ];
  domains.forEach((domainKey, index) => {
    const target = domainKey === 'entry' ? 'A'
      : ['automation', 'operations'].includes(domainKey) ? 'C'
        : ['data', 'security', 'verification'].includes(domainKey) ? 'D'
          : domainKey === 'integration' ? 'E'
            : 'B';
    lines.push(`    M${index + 1}["${domainLabel(domainKey, language)}"] --> ${target}`);
  });
  return lines.join('\n');
}

function labelSeparator(language) {
  return normalizeLanguage(language) === 'zh' ? '：' : ': ';
}

function metadataLine(language, label, value) {
  return `- **${label}**${labelSeparator(language)}${value}`;
}

function emphasizedLead(language, lead, value) {
  return `- **${lead}**${labelSeparator(language)}${value}`;
}

function productDocIntro(language, kind) {
  const intro = kind === 'architecture'
    ? p(language, 'architectureIntro')
    : kind === 'changes'
      ? p(language, 'changesIntro')
      : kind === 'appendix'
        ? p(language, 'appendixIntro')
        : p(language, 'overviewIntro');
  return [
    `> ${intro}`,
    `> ${p(language, 'autoNote')}`
  ];
}

function titleWithPeriod(title, period, language) {
  return normalizeLanguage(language) === 'zh' ? `${title}（${period}）` : `${title} (${period})`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function docSummaryText(doc) {
  return cleanInline(doc?.render_summary || '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^#\s+/, '');
}

function extractProjectSentence(projectName, documents) {
  const candidates = [
    documents.find((doc) => doc.path === 'README.md'),
    documents.find((doc) => /(^|\/)CLAUDE\.md$/i.test(doc.path)),
    documents.find((doc) => /(^|\/)AGENTS\.md$/i.test(doc.path)),
    ...documents.filter((doc) => /README\.md$/i.test(doc.path))
  ].filter(Boolean);
  const name = escapeRegExp(projectName);
  const sentenceRe = new RegExp(`\\b${name}\\b\\s+(is|是)\\s+([^.!?。]+[.!?。]?)`, 'i');
  for (const doc of candidates) {
    const text = docSummaryText(doc);
    const match = text.match(sentenceRe);
    if (match) return `${projectName} ${match[1]} ${match[2]}`.trim();
  }
  return '';
}

function projectPositioning(model) {
  const { projectName, documents, language } = model;
  const zh = normalizeLanguage(language) === 'zh';
  const joined = documents
    .filter((doc) => /(^|\/)(README|CLAUDE|AGENTS)\.md$/i.test(doc.path) || /architecture/i.test(doc.path))
    .slice(0, 40)
    .map((doc) => `${doc.path} ${doc.title || ''} ${docSummaryText(doc)}`)
    .join(' ');

  if (/self-hostable control plane for AI agents|governed agent control plane/i.test(joined)) {
    return zh
      ? `${projectName} 是一个面向 AI agent 的自托管治理执行控制平面，用于集中管理策略受控的执行、即时凭证、人工审批、边缘执行和可审计记录。`
      : `${projectName} is a self-hostable governed execution control plane for AI agents, centralizing policy-controlled execution, just-in-time credentials, human approvals, edge execution, and auditable records.`;
  }
  if (/control-plane runtime for Octvex|orchestration runtime/i.test(joined)) {
    return zh
      ? `${projectName} 是 Octvex 的控制平面与编排运行时，负责身份、工作区、任务/运行、策略、审批、凭证、调度、MCP/GEP 接入和审计。`
      : `${projectName} is the Octvex control-plane and orchestration runtime for identity, workspaces, tasks/runs, policy, approvals, credentials, schedules, MCP/GEP ingress, and audit.`;
  }

  const sentence = extractProjectSentence(projectName, documents);
  if (sentence) return sentence;
  return p(language, 'positioningFallback');
}

function userRows(model) {
  const { documents, language } = model;
  const zh = normalizeLanguage(language) === 'zh';
  const joined = documents.map((doc) => `${doc.path} ${doc.title || ''} ${docSummaryText(doc)}`).join(' ');
  if (/operator dashboard|workspaces|policies|credentials|approvals|runs|audit|AI agents|MCP|Edge/i.test(joined)) {
    return zh
      ? [
          ['平台/业务管理员', '管理 workspace、policy、credential、approval、run、audit、usage 等运营对象。', p(language, 'statusImplementedNeedsValidation')],
          ['AI agent 调用方和自动化平台', '通过 CLI、MCP、GEP、Channel 或外部控制平面提交、监控和治理执行任务。', p(language, 'statusImplementedNeedsValidation')],
          ['开发、交付和运维团队', '部署和维护 Core、Edge、Console、Desk、CLI 以及共享 packages，并处理集成、审计和故障排查。', p(language, 'statusImplementedNeedsValidation')]
        ]
      : [
          ['Platform / business operators', 'Manage workspaces, policies, credentials, approvals, runs, audit, usage, and operations objects.', p(language, 'statusImplementedNeedsValidation')],
          ['AI-agent callers and automation platforms', 'Submit, monitor, and govern execution through CLI, MCP, GEP, channels, or external control planes.', p(language, 'statusImplementedNeedsValidation')],
          ['Development, delivery, and operations teams', 'Deploy and maintain Core, Edge, Console, Desk, CLI, shared packages, integrations, audit, and troubleshooting.', p(language, 'statusImplementedNeedsValidation')]
        ];
  }
  return [[
    zh ? '产品、业务、设计、运营团队' : 'Product, business, design, and operations teams',
    zh ? '默认读者，用于理解项目状态、最近变化、风险和资料入口。' : 'Default readers who need current state, recent changes, risks, and source entry points.',
    p(language, 'statusImplementedNeedsValidation')
  ]];
}

function userSummary(model) {
  return userRows(model).slice(0, 3).map((row) => row[0]).join(normalizeLanguage(model.language) === 'zh' ? '、' : ', ');
}

function renderOverview(model) {
  const { language, projectName, generatedAt, period, documents, claims, evidences, events, items } = model;
  const currentDocs = recommendedDocs(documents);
  const risks = riskItems(model);
  const opens = openItems(items, language);
  const recent = productFacingChanges(events, language, 16);
  const users = userRows(model);
  const lines = [
    `# ${projectName} · ${p(language, 'productOverviewTitle')}`,
    '',
    ...productDocIntro(language, 'overview'),
    '',
    metadataLine(language, p(language, 'generatedAt'), generatedAt),
    metadataLine(language, p(language, 'analysisPeriod'), period),
    metadataLine(language, p(language, 'project'), projectName),
    metadataLine(language, p(language, 'confidence'), confidenceLabel(model, language)),
    '',
    `## 1. ${p(language, 'positioningTitle')}`,
    '',
    projectPositioning(model),
    '',
    `## 2. ${p(language, 'statusSummary')}`,
    '',
    `| ${p(language, 'item')} | ${p(language, 'currentState')} |`,
    '|---|---|',
    `| ${p(language, 'maturity')} | ${tableCell(maturityLabel(claims, language))} |`,
    `| ${p(language, 'domains')} | ${tableCell(domainSummary(items, language))} |`,
    `| ${p(language, 'users')} | ${tableCell(userSummary(model))} |`,
    `| ${p(language, 'latestUpdate')} | ${events.length ? events.slice().sort((a, b) => b.ts.localeCompare(a.ts))[0].ts : p(language, 'noEvidence')} |`,
    `| ${p(language, 'obviousRisk')} | ${risks.length ? tableCell(risks[0].title) : p(language, 'noClearRisk')} |`,
    `| ${p(language, 'nextFocus')} | ${opens.length ? tableCell(opens[0].title) : (normalizeLanguage(language) === 'zh' ? '确认项目定位、核心能力范围和当前可用状态。' : 'Confirm project positioning, core capability scope, and current usability.')} |`,
    '',
    `### ${p(language, 'statusNarrativeTitle')}`,
    '',
    p(language, 'statusNarrative'),
    '',
    `## 3. ${p(language, 'usersTitle')}`,
    '',
    `| ${p(language, 'role')} | ${p(language, 'roleDescription')} | ${p(language, 'supportStatus')} |`,
    '|---|---|---|',
    ...users.map((row) => `| ${tableCell(row[0])} | ${tableCell(row[1])} | ${tableCell(row[2])} |`),
    '',
    ...(users.length === 1 ? [`> ${p(language, 'usersFallback')}`] : []),
    '',
    `## 4. ${p(language, 'capabilityMapTitle')}`,
    '',
    `| ${p(language, 'domain')} | ${p(language, 'capability')} | ${p(language, 'value')} | ${p(language, 'status')} | ${p(language, 'relatedDocs')} |`,
    '|---|---|---|---|---|',
    ...(items.slice(0, MAX_OVERVIEW_ITEMS).length ? items.slice(0, MAX_OVERVIEW_ITEMS).map((item) => `| ${tableCell(item.domain)} | ${tableCell(item.title)} | ${tableCell(item.value)} | ${tableCell(item.status)} | ${item.related} |`) : [`| ${p(language, 'unknown')} | ${p(language, 'noEvidence')} | ${p(language, 'unknown')} | ${p(language, 'statusUnknown')} | ${generatedDocLink('PRODUCT_DOCS_INDEX.md')} |`]),
    '',
    `## 5. ${p(language, 'architectureOverviewTitle')}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? `当前可先按「${domainSummary(items, language)}」理解产品能力边界。更详细的模块关系见 ${generatedDocLink('PRODUCT_ARCHITECTURE.md')}。`
      : `For now, understand the product boundary through ${domainSummary(items, language)}. See ${generatedDocLink('PRODUCT_ARCHITECTURE.md')} for module relationships.`,
    '',
    `## 6. ${p(language, 'recentTitle')}`,
    '',
    metadataLine(language, p(language, 'analysisPeriod'), period),
    metadataLine(language, p(language, 'confidence'), confidenceLabel(model, language)),
    '',
    `> ${p(language, 'notReleaseNote')}`,
    '',
    ...groupedChangeLines(recent, language, 3),
    '',
    normalizeLanguage(language) === 'zh'
      ? `更多变化说明请查看 ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')}。`
      : `See ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')} for more change notes.`,
    '',
    `## 7. ${p(language, 'openItemsTitle')}`,
    '',
    `| ${p(language, 'item')} | PM ${p(language, 'status')} | ${p(language, 'impact')} | ${p(language, 'validation')} | ${p(language, 'relatedDocs')} |`,
    '|---|---|---|---|---|',
    ...(opens.length ? opens.map((item) => `| ${tableCell(item.title)} | ${tableCell(item.status)} | ${tableCell(item.impact)} | ${tableCell(item.validation)} | ${item.related} |`) : [`| ${normalizeLanguage(language) === 'zh' ? '暂未发现明确未完成事项' : 'No explicit unfinished item found'} | ${p(language, 'statusUnknown')} | ${p(language, 'unknown')} | ${normalizeLanguage(language) === 'zh' ? '继续跟踪最近变化和开放事项。' : 'Keep tracking recent changes and open items.'} | ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')} |`]),
    '',
    `### PM ${p(language, 'pmStatusNote')}`,
    '',
    `| ${p(language, 'status')} | ${normalizeLanguage(language) === 'zh' ? '含义' : 'Meaning'} |`,
    '|---|---|',
    `| ${p(language, 'statusConfirmed')} | ${normalizeLanguage(language) === 'zh' ? '现有资料支持该能力已实现或可用。' : 'Current material supports that this capability is implemented or usable.'} |`,
    `| ${p(language, 'statusImplementedNeedsValidation')} | ${normalizeLanguage(language) === 'zh' ? '已发现实现线索，但仍缺少完整验收或产品说明。' : 'Implementation signals exist, but full acceptance or product notes are missing.'} |`,
    `| ${p(language, 'statusDesignedNotImplemented')} | ${normalizeLanguage(language) === 'zh' ? '已发现设计或需求描述，但未发现确定性实现证据。' : 'Design or requirement material exists, but deterministic implementation evidence is missing.'} |`,
    `| ${p(language, 'statusExploring')} | ${normalizeLanguage(language) === 'zh' ? '资料表现为方案、草案或建议，当前不应视为已完成能力。' : 'Material appears to be a plan, draft, or suggestion; do not treat it as complete.'} |`,
    `| ${p(language, 'statusRisk')} | ${normalizeLanguage(language) === 'zh' ? '不同资料或状态信号之间存在不一致，需要进一步确认。' : 'Signals are inconsistent and need clarification.'} |`,
    `| ${p(language, 'statusUnknown')} | ${normalizeLanguage(language) === 'zh' ? '没有足够证据支持确定性判断，不写“没做”或“已完成”。' : 'There is not enough evidence for a deterministic judgment; do not label it as missing or complete.'} |`,
    '',
    `## 8. ${p(language, 'risksTitle')}`,
    '',
    `| ${p(language, 'risk')} | ${p(language, 'impact')} | ${p(language, 'signal')} | ${p(language, 'recommendation')} |`,
    '|---|---|---|---|',
    ...(risks.length ? risks.slice(0, MAX_MAIN_ITEMS).map((risk) => `| ${tableCell(risk.title)} | ${tableCell(risk.impact)} | ${tableCell(risk.signal)} | ${tableCell(risk.recommendation)} |`) : [`| ${p(language, 'noClearRisk')} | ${p(language, 'unknown')} | ${p(language, 'noEvidence')} | ${normalizeLanguage(language) === 'zh' ? '在下一轮生成中继续跟踪。' : 'Keep tracking in the next generation.'} |`]),
    '',
    `## 9. ${p(language, 'nextStepsTitle')}`,
    '',
    ...(opens.length ? opens.slice(0, 5).map((item) => emphasizedLead(language, item.title, item.validation)) : [normalizeLanguage(language) === 'zh' ? '- **确认项目当前状态**：建议优先确认项目定位、主要用户、核心能力范围和当前可用程度。' : '- **Confirm current project state**: validate positioning, main users, core capability scope, and usability.']),
    '',
    `## 10. ${p(language, 'sourcesTitle')}`,
    '',
    `### ${p(language, 'currentRecommended')}`,
    '',
    `| ${p(language, 'doc')} | ${p(language, 'type')} | ${p(language, 'reason')} |`,
    '|---|---|---|',
    ...(currentDocs.slice(0, MAX_INDEX_DOCS).length ? currentDocs.slice(0, MAX_INDEX_DOCS).map((doc) => `| ${sourceDocLink(doc)} | ${docTypeLabel(doc, language)} | ${normalizeLanguage(language) === 'zh' ? '与当前项目状态相关，建议优先阅读。' : 'Relevant to current project state; read first.'} |`) : [`| ${p(language, 'noEvidence')} | - | ${normalizeLanguage(language) === 'zh' ? '建议先补充 README、需求文档或产品说明。' : 'Add README, requirements, or product notes first.'} |`]),
    '',
    `### ${p(language, 'historicalDocs')}`,
    '',
    `| ${p(language, 'doc')} | ${p(language, 'status')} | ${p(language, 'note')} |`,
    '|---|---|---|',
    ...(historicalDocs(documents).slice(0, 6).length ? historicalDocs(documents).slice(0, 6).map((doc) => `| ${sourceDocLink(doc)} | ${doc.doc_status} | ${normalizeLanguage(language) === 'zh' ? '仅作为历史线索，不应直接当作当前状态；已删除文档只在工程附录保留。' : 'Historical signal only; do not use as current state directly. Deleted documents are kept only in the appendix.'} |`) : [`| ${p(language, 'noEvidence')} | - | - |`]),
    '',
    normalizeLanguage(language) === 'zh'
      ? `工程证据、文件路径、commit、coverage、evidence id 请查看 ${generatedDocLink('TECHNICAL_APPENDIX.md')}。`
      : `For engineering evidence, file paths, commits, coverage, and evidence IDs, see ${generatedDocLink('TECHNICAL_APPENDIX.md')}.`,
    '',
    `## 11. ${p(language, 'autoNoteTitle')}`,
    '',
    p(language, 'autoNote')
  ];
  return `${lines.join('\n')}\n`;
}

function renderArchitecture(model) {
  const { language, projectName, generatedAt, documents, items } = model;
  const risks = riskItems(model);
  const domains = Array.from(new Set(items.map((item) => item.domainKey)));
  const domainRows = (domainKey) => items.filter((item) => item.domainKey === domainKey).slice(0, 4);
  const lines = [
    `# ${projectName} · ${p(language, 'productArchitectureTitle')}`,
    '',
    ...productDocIntro(language, 'architecture'),
    '',
    metadataLine(language, p(language, 'generatedAt'), generatedAt),
    metadataLine(language, p(language, 'confidence'), confidenceLabel(model, language)),
    '',
    `## 1. ${p(language, 'architectureSummary')}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? `当前可按 ${domains.length || 1} 个产品能力域理解：${domainSummary(items, language)}。这些能力域来自文档标题、路径、claim、evidence 和最近变化的确定性归类。`
      : `The current product can be understood through ${domains.length || 1} capability domains: ${domainSummary(items, language)}. These domains are deterministically grouped from titles, paths, claims, evidence, and recent changes.`,
    '',
    `| ${p(language, 'item')} | ${p(language, 'currentState')} |`,
    '|---|---|',
    `| ${p(language, 'entryLayer')} | ${domains.includes('entry') ? p(language, 'statusImplementedNeedsValidation') : p(language, 'statusUnknown')} |`,
    `| ${p(language, 'coreLayer')} | ${items.length ? p(language, 'statusImplementedNeedsValidation') : p(language, 'statusUnknown')} |`,
    `| ${p(language, 'automationLayer')} | ${domains.includes('automation') ? p(language, 'statusImplementedNeedsValidation') : p(language, 'statusUnknown')} |`,
    `| ${p(language, 'dataLayer')} | ${domains.some((key) => ['data', 'security', 'verification'].includes(key)) ? p(language, 'statusImplementedNeedsValidation') : p(language, 'statusUnknown')} |`,
    `| ${p(language, 'dependencyLayer')} | ${domains.includes('integration') ? p(language, 'statusImplementedNeedsValidation') : p(language, 'statusUnknown')} |`,
    '',
    `## 2. ${p(language, 'architectureGraph')}`,
    '',
    '```mermaid',
    architectureMermaid(items, language),
    '```',
    '',
    `## 3. ${p(language, 'entryLayer')}`,
    '',
    `| ${p(language, 'module')} | ${p(language, 'meaning')} | ${p(language, 'status')} | ${p(language, 'risk')} |`,
    '|---|---|---|---|',
    ...(domainRows('entry').length ? domainRows('entry').map((item) => `| ${tableCell(item.title)} | ${tableCell(item.value)} | ${tableCell(item.status)} | ${tableCell(item.risk)} |`) : [`| ${p(language, 'noEvidence')} | ${normalizeLanguage(language) === 'zh' ? '暂未识别明确入口，建议从 README、路由、页面、CLI 或使用手册中提取。' : 'No explicit entry point found. Check README, routes, pages, CLI, or user guides.'} | ${p(language, 'statusUnknown')} | ${p(language, 'unknown')} |`]),
    '',
    `## 4. ${p(language, 'coreLayer')}`,
    '',
    `| ${p(language, 'capability')} | ${p(language, 'value')} | ${p(language, 'status')} | ${p(language, 'relatedDocs')} | ${p(language, 'risk')} |`,
    '|---|---|---|---|---|',
    ...(items.filter((item) => !['entry', 'automation', 'data', 'security', 'verification', 'integration', 'operations'].includes(item.domainKey)).slice(0, MAX_MAIN_ITEMS).map((item) => `| ${tableCell(item.title)} | ${tableCell(item.value)} | ${tableCell(item.status)} | ${item.related} | ${tableCell(item.risk)} |`)),
    ...(items.filter((item) => !['entry', 'automation', 'data', 'security', 'verification', 'integration', 'operations'].includes(item.domainKey)).length ? [] : [`| ${p(language, 'noEvidence')} | ${p(language, 'unknown')} | ${p(language, 'statusUnknown')} | ${generatedDocLink('PRODUCT_OVERVIEW.md')} | ${p(language, 'unknown')} |`]),
    '',
    `## 5. ${p(language, 'automationLayer')}`,
    '',
    `| ${p(language, 'capability')} | ${normalizeLanguage(language) === 'zh' ? '触发/输出' : 'Trigger / Output'} | ${p(language, 'status')} | ${p(language, 'risk')} |`,
    '|---|---|---|---|',
    ...(domainRows('automation').length ? domainRows('automation').map((item) => `| ${tableCell(item.title)} | ${tableCell(item.value)} | ${tableCell(item.status)} | ${tableCell(item.risk)} |`) : [`| ${p(language, 'noEvidence')} | ${normalizeLanguage(language) === 'zh' ? '建议从任务脚本、Hook、CI、命令说明或生成流程文档中提取。' : 'Check scripts, hooks, CI, command docs, or generation flow docs.'} | ${p(language, 'statusUnknown')} | ${p(language, 'unknown')} |`]),
    '',
    `## 6. ${p(language, 'dataLayer')}`,
    '',
    `| ${p(language, 'module')} | ${p(language, 'value')} | ${p(language, 'status')} | ${p(language, 'risk')} |`,
    '|---|---|---|---|',
    ...items.filter((item) => ['data', 'security', 'verification', 'integration'].includes(item.domainKey)).slice(0, MAX_MAIN_ITEMS).map((item) => `| ${tableCell(item.title)} | ${tableCell(item.value)} | ${tableCell(item.status)} | ${tableCell(item.risk)} |`),
    ...(items.some((item) => ['data', 'security', 'verification', 'integration'].includes(item.domainKey)) ? [] : [`| ${p(language, 'noEvidence')} | ${p(language, 'unknown')} | ${p(language, 'statusUnknown')} | ${p(language, 'unknown')} |`]),
    '',
    `## 7. ${p(language, 'dependencyLayer')}`,
    '',
    `| ${p(language, 'doc')} | ${p(language, 'type')} | ${p(language, 'note')} |`,
    '|---|---|---|',
    ...recommendedDocs(documents).filter((doc) => domainForDocument(doc) === 'integration').slice(0, 8).map((doc) => `| ${sourceDocLink(doc)} | ${docTypeLabel(doc, language)} | ${normalizeLanguage(language) === 'zh' ? '可能涉及外部系统、API、插件或工具。' : 'May involve external systems, APIs, plugins, or tools.'} |`),
    ...(recommendedDocs(documents).some((doc) => domainForDocument(doc) === 'integration') ? [] : [`| ${p(language, 'noEvidence')} | - | ${normalizeLanguage(language) === 'zh' ? '暂未识别明确外部依赖。' : 'No explicit external dependency found.'} |`]),
    '',
    `## 8. ${p(language, 'moduleDetails')}`,
    '',
    `| ${p(language, 'domain')} | ${p(language, 'module')} | ${p(language, 'value')} | ${p(language, 'status')} | ${p(language, 'relatedDocs')} |`,
    '|---|---|---|---|---|',
    ...items.slice(0, MAX_MAIN_ITEMS).map((item) => `| ${tableCell(item.domain)} | ${tableCell(item.title)} | ${tableCell(item.value)} | ${tableCell(item.status)} | ${item.related} |`),
    '',
    `## 9. ${p(language, 'architectureOpenItems')}`,
    '',
    `| ${p(language, 'item')} | ${p(language, 'type')} | ${p(language, 'impact')} | ${p(language, 'validation')} |`,
    '|---|---|---|---|',
    ...(risks.length ? risks.slice(0, 8).map((risk) => `| ${tableCell(risk.title)} | ${tableCell(risk.signal)} | ${tableCell(risk.impact)} | ${tableCell(risk.recommendation)} |`) : [`| ${p(language, 'noClearRisk')} | ${p(language, 'statusUnknown')} | ${p(language, 'unknown')} | ${normalizeLanguage(language) === 'zh' ? '继续跟踪最近变化和工程附录。' : 'Keep tracking recent changes and the technical appendix.'} |`]),
    '',
    `## 10. ${p(language, 'relatedDocs')}`,
    '',
    `| ${p(language, 'doc')} | ${normalizeLanguage(language) === 'zh' ? '说明' : 'Description'} |`,
    '|---|---|',
    `| ${generatedDocLink('PRODUCT_OVERVIEW.md')} | ${normalizeLanguage(language) === 'zh' ? '查看项目当前状态。' : 'View current project state.'} |`,
    `| ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')} | ${normalizeLanguage(language) === 'zh' ? '查看最近变化。' : 'View recent changes.'} |`,
    `| ${generatedDocLink('TECHNICAL_APPENDIX.md')} | ${normalizeLanguage(language) === 'zh' ? '查看工程证据与来源。' : 'View engineering evidence and sources.'} |`,
    '',
    `## 11. ${p(language, 'autoNoteTitle')}`,
    '',
    p(language, 'autoNote')
  ];
  return `${lines.join('\n')}\n`;
}

function renderRecentChanges(model) {
  const { language, projectName, generatedAt, period, events, items } = model;
  const changes = productFacingChanges(events, language, 50);
  const docGaps = commitDocumentationGaps(model);
  const top = changes.slice(0, 3);
  const risks = riskItems(model);
  const fixed = changes.filter((change) => /修复|Fix/.test(change.type)).slice(0, 8);
  const docsOps = changes.filter((change) => /文档|Documentation|运维|Operations/.test(change.type)).slice(0, 12);
  const visible = changes.filter((change) => !/文档|Documentation/.test(change.type)).slice(0, 8);
  const title = titleWithPeriod(`${projectName} · ${p(language, 'recentChangesTitle')}`, period, language);
  const lines = [
    `# ${title}`,
    '',
    ...productDocIntro(language, 'changes'),
    '',
    metadataLine(language, p(language, 'generatedAt'), generatedAt),
    metadataLine(language, p(language, 'analysisPeriod'), period),
    metadataLine(language, p(language, 'confidence'), confidenceLabel(model, language)),
    '',
    `> ${p(language, 'notReleaseNote')}`,
    '',
    `## 1. ${p(language, 'cycleSummary')}`,
    '',
    changes.length
      ? (normalizeLanguage(language) === 'zh'
        ? `本周期共识别到 ${changes.length} 条变化线索，主要集中在 ${Array.from(new Set(changes.slice(0, 20).map((change) => change.type))).join('、')}。这些线索仍需结合正式需求、发布记录或团队确认判断用户影响。`
        : `${changes.length} change signals were identified. Main categories: ${Array.from(new Set(changes.slice(0, 20).map((change) => change.type))).join(', ')}. Validate user impact with formal requirements, release notes, or team confirmation.`)
      : (normalizeLanguage(language) === 'zh' ? '本周期暂未发现足够清晰的变化摘要。' : 'No stable recent-change summary was found.'),
    '',
    `### 1.1 ${p(language, 'topChanges')}`,
    '',
    ...(top.length ? top.map((change, index) => `${index + 1}. **${change.title}**\n   ${metadataLine(language, p(language, 'type'), change.type)}\n   ${metadataLine(language, p(language, 'impact'), change.impact)}\n   ${metadataLine(language, p(language, 'status'), change.status)}`) : [p(language, 'noEvidence')]),
    '',
    `## 2. ${normalizeLanguage(language) === 'zh' ? '变更文档化缺口' : 'Documentation Gaps In Recent Commits'}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? `这里筛出“改了源码/配置/迁移，但同一 commit 没有更新 Markdown/HTML 文档”的提交。完整时间追溯见 ${generatedDocLink('PROJECT_TIMELINE.md')}。`
      : `This section lists commits that changed source/config/migration files without a Markdown/HTML documentation update in the same commit. See ${generatedDocLink('PROJECT_TIMELINE.md')} for the full timeline.`,
    '',
    ...commitGapTableLines(docGaps, language, 8),
    '',
    `## 3. ${p(language, 'importantChanges')}`,
    '',
    `| ${p(language, 'type')} | ${p(language, 'item')} | ${p(language, 'impact')} | ${p(language, 'status')} |`,
    '|---|---|---|---|',
    ...(changes.slice(0, MAX_MAIN_ITEMS).length ? changes.slice(0, MAX_MAIN_ITEMS).map((change) => `| ${tableCell(change.type)} | ${tableCell(change.title)} | ${tableCell(change.impact)} | ${tableCell(change.status)} |`) : [`| ${p(language, 'unknown')} | ${p(language, 'noEvidence')} | ${p(language, 'unknown')} | ${p(language, 'statusUnknown')} |`]),
    '',
    `## 4. ${p(language, 'affectedModules')}`,
    '',
    `| ${p(language, 'module')} | ${normalizeLanguage(language) === 'zh' ? '变化说明' : 'Change Summary'} | ${p(language, 'impact')} |`,
    '|---|---|---|',
    ...items.slice(0, 10).map((item) => `| ${tableCell(item.domain)} | ${tableCell(item.title)} | ${tableCell(item.value)} |`),
    ...(items.length ? [] : [`| ${p(language, 'noEvidence')} | ${p(language, 'unknown')} | ${p(language, 'unknown')} |`]),
    '',
    `## 5. ${p(language, 'visibleChanges')}`,
    '',
    `| ${normalizeLanguage(language) === 'zh' ? '用户可感知变化' : 'User-Visible Change'} | ${normalizeLanguage(language) === 'zh' ? '发生场景' : 'Scenario'} | ${p(language, 'impact')} | ${normalizeLanguage(language) === 'zh' ? '是否需要说明' : 'Needs Communication'} |`,
    '|---|---|---|---|',
    ...(visible.length ? visible.map((change) => `| ${tableCell(change.title)} | ${tableCell(change.type)} | ${tableCell(change.impact)} | ${p(language, 'unknown')} |`) : [`| ${normalizeLanguage(language) === 'zh' ? '暂未发现明确用户可感知变化' : 'No explicit user-visible change found'} | - | ${normalizeLanguage(language) === 'zh' ? '本周期变化可能偏内部，或资料不足以判断用户影响。' : 'Changes may be internal, or source material is insufficient to judge user impact.'} | ${p(language, 'unknown')} |`]),
    '',
    `## 6. ${p(language, 'migrationItems')}`,
    '',
    `| ${p(language, 'item')} | ${p(language, 'impact')} | ${normalizeLanguage(language) === 'zh' ? '团队需要做什么' : 'Team Action'} | ${normalizeLanguage(language) === 'zh' ? '优先级' : 'Priority'} |`,
    '|---|---|---|---|',
    ...(risks.slice(0, 8).length ? risks.slice(0, 8).map((risk) => `| ${tableCell(risk.title)} | ${tableCell(risk.impact)} | ${tableCell(risk.recommendation)} | ${p(language, 'unknown')} |`) : [`| ${normalizeLanguage(language) === 'zh' ? '暂未发现明确行为变化或迁移事项' : 'No explicit behavior or migration item found'} | - | ${normalizeLanguage(language) === 'zh' ? '暂无确定性团队动作。' : 'No deterministic team action.'} | ${p(language, 'unknown')} |`]),
    '',
    `## 7. ${p(language, 'fixedIssues')}`,
    '',
    `| ${normalizeLanguage(language) === 'zh' ? '问题' : 'Issue'} | ${normalizeLanguage(language) === 'zh' ? '修复说明' : 'Fix Summary'} | ${p(language, 'impact')} | ${p(language, 'status')} |`,
    '|---|---|---|---|',
    ...(fixed.length ? fixed.map((change) => `| ${tableCell(change.title)} | ${tableCell(change.impact)} | ${tableCell(change.type)} | ${tableCell(change.status)} |`) : [`| ${normalizeLanguage(language) === 'zh' ? '暂未发现明确修复记录' : 'No explicit fix record found'} | - | - | ${p(language, 'statusUnknown')} |`]),
    '',
    `## 8. ${p(language, 'unresolvedIssues')}`,
    '',
    `| ${normalizeLanguage(language) === 'zh' ? '问题' : 'Issue'} | ${p(language, 'status')} | ${p(language, 'impact')} | ${normalizeLanguage(language) === 'zh' ? '建议下一步' : 'Suggested Next Step'} |`,
    '|---|---|---|---|',
    ...(risks.length ? risks.slice(0, 8).map((risk) => `| ${tableCell(risk.title)} | ${tableCell(risk.signal)} | ${tableCell(risk.impact)} | ${tableCell(risk.recommendation)} |`) : [`| ${normalizeLanguage(language) === 'zh' ? '暂未发现明确未解决问题' : 'No explicit unresolved issue found'} | ${p(language, 'statusUnknown')} | ${p(language, 'unknown')} | ${normalizeLanguage(language) === 'zh' ? '继续跟踪最近变更和开放事项。' : 'Keep tracking recent changes and open items.'} |`]),
    '',
    `## 9. ${p(language, 'nextCycle')}`,
    '',
    ...(risks.length ? risks.slice(0, 5).map((risk) => emphasizedLead(language, risk.title, risk.recommendation)) : [normalizeLanguage(language) === 'zh' ? '- **确认本周期变化是否完整**：建议补充最近需求、提交记录、测试结果或版本说明。' : '- **Confirm whether this cycle is complete**: add recent requirements, commit records, test results, or release notes.']),
    '',
    `## 10. ${p(language, 'relatedDocs')}`,
    '',
    `| ${p(language, 'doc')} | ${normalizeLanguage(language) === 'zh' ? '说明' : 'Description'} |`,
    '|---|---|',
    `| ${generatedDocLink('PRODUCT_OVERVIEW.md')} | ${normalizeLanguage(language) === 'zh' ? '查看项目当前状态总览。' : 'View current project state.'} |`,
    `| ${generatedDocLink('PRODUCT_ARCHITECTURE.md')} | ${normalizeLanguage(language) === 'zh' ? '查看产品能力架构。' : 'View product capability architecture.'} |`,
    `| ${generatedDocLink('PROJECT_TIMELINE.md')} | ${normalizeLanguage(language) === 'zh' ? '按时间追溯 commit 和缺文档风险。' : 'Trace commits over time and documentation gaps.'} |`,
    `| ${generatedDocLink('TECHNICAL_APPENDIX.md')} | ${normalizeLanguage(language) === 'zh' ? '查看工程证据与来源。' : 'View engineering evidence and sources.'} |`,
    '',
    `## 11. ${p(language, 'autoNoteTitle')}`,
    '',
    p(language, 'autoNote')
  ];
  return `${lines.join('\n')}\n`;
}

function renderIndex(model) {
  const { language, projectName, generatedAt, period, documents, claims, evidences, events } = model;
  const currentDocs = recommendedDocs(documents);
  const oldDocs = historicalDocs(documents).slice(0, 6);
  const lines = [
    `# ${projectName} · ${p(language, 'productIndexTitle')}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? '本导航页用于回答“我应该先看哪份文档”。产品经理默认阅读产品主线文档；需要追溯证据时再进入工程附录。'
      : 'Use this index to decide what to read first. Product readers start with product-facing docs; use the appendix when evidence traceability is needed.',
    '',
    `## ${p(language, 'readPath')}`,
    '',
    `${generatedDocLink('PRODUCT_OVERVIEW.md')} -> ${generatedDocLink('PRODUCT_ARCHITECTURE.md')} -> ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? `需要精确追溯证据、commit、路径或已删除文档时，再查看 ${generatedDocLink('TECHNICAL_APPENDIX.md')}。`
      : `When precise evidence, commits, paths, or deleted documents are needed, use ${generatedDocLink('TECHNICAL_APPENDIX.md')}.`,
    normalizeLanguage(language) === 'zh'
      ? `需要按时间看“什么时候做了什么”或排查缺文档 commit 时，查看 ${generatedDocLink('PROJECT_TIMELINE.md')}。`
      : `To see what happened when, or to check commits missing documentation, use ${generatedDocLink('PROJECT_TIMELINE.md')}.`,
    '',
    `## ${p(language, 'productMainDocs')}`,
    '',
    `| ${p(language, 'doc')} | ${normalizeLanguage(language) === 'zh' ? '主要读者' : 'Main Reader'} | ${normalizeLanguage(language) === 'zh' ? '解决的问题' : 'Question Answered'} |`,
    '|---|---|---|',
    `| ${generatedDocLink('PRODUCT_OVERVIEW.md')} | ${p(language, 'audienceOverview')} | ${normalizeLanguage(language) === 'zh' ? '项目现在是什么状态、能做什么、风险和下一步是什么。' : 'Current state, capabilities, risks, and next focus.'} |`,
    `| ${generatedDocLink('PRODUCT_ARCHITECTURE.md')} | ${p(language, 'audienceArchitecture')} | ${normalizeLanguage(language) === 'zh' ? '产品能力如何分层，各模块之间是什么关系。' : 'How product capabilities are layered and related.'} |`,
    `| ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')} | ${p(language, 'audienceChanges')} | ${normalizeLanguage(language) === 'zh' ? '最近一个周期做了什么，对用户和团队有什么影响。' : 'What changed recently and how it affects users and teams.'} |`,
    '',
    `## ${p(language, 'engineeringDocs')}`,
    '',
    `| ${p(language, 'doc')} | ${normalizeLanguage(language) === 'zh' ? '用途' : 'Purpose'} |`,
    '|---|---|',
    `| ${generatedDocLink('TECHNICAL_APPENDIX.md')} | ${normalizeLanguage(language) === 'zh' ? '证据、路径、commit、claim 和 evidence 摘要。' : 'Evidence, paths, commits, claims, and evidence summaries.'} |`,
    `| ${generatedDocLink('PROJECT_CURRENT.md')} | ${normalizeLanguage(language) === 'zh' ? '工程视角的 claim、coverage 和 evidence 状态。' : 'Engineering view of claims, coverage, and evidence.'} |`,
    `| ${generatedDocLink('PROJECT_TIMELINE.md')} | ${normalizeLanguage(language) === 'zh' ? '历史追溯：按时间查看做了什么，并标注可能缺少文档的 commit。' : 'History trace: what changed when, with commits that may be missing docs.'} |`,
    `| ${generatedDocLink('DOCS_INVENTORY.md')} | ${normalizeLanguage(language) === 'zh' ? '完整文档清单和状态机结果。' : 'Full document inventory and status-machine output.'} |`,
    `| ${generatedDocLink('DOCUMENTATION_GAPS.md')} | ${normalizeLanguage(language) === 'zh' ? '标准文档覆盖、缺失项和补齐建议。' : 'Standard-doc coverage, missing areas, and fill recommendations.'} |`,
    `| ${generatedDocLink('DRIFT_REPORT.md')} | ${normalizeLanguage(language) === 'zh' ? '漂移、过时、冲突或灰区风险。' : 'Drift, stale, conflict, or gray-area risks.'} |`,
    '',
    `## ${p(language, 'currentDocsByDomain')}`,
    '',
    ...groupedDocLines(currentDocs, language, { maxDomains: 8, maxPerDomain: MAX_INDEX_DOMAIN_DOCS }),
    '',
    `## ${p(language, 'historicalDocs')}`,
    '',
    `| ${p(language, 'doc')} | ${p(language, 'status')} | ${p(language, 'note')} |`,
    '|---|---|---|',
    ...(oldDocs.length ? oldDocs.map((doc) => `| ${sourceDocLink(doc)} | ${doc.doc_status} | ${normalizeLanguage(language) === 'zh' ? '仅作为历史线索，不应直接当作当前状态；已删除文档只在工程附录保留。' : 'Historical signal only; do not use as current state directly. Deleted documents are kept only in the appendix.'} |`) : [`| ${p(language, 'noEvidence')} | - | - |`]),
    '',
    `## ${p(language, 'ledgerScale')}`,
    '',
    `| ${p(language, 'item')} | ${normalizeLanguage(language) === 'zh' ? '数量' : 'Count'} |`,
    '|---|---:|',
    `| documents | ${documents.length} |`,
    `| claims | ${claims.length} |`,
    `| evidences | ${evidences.length} |`,
    `| events | ${events.length} |`,
    '',
    metadataLine(language, p(language, 'generatedAt'), generatedAt),
    metadataLine(language, p(language, 'analysisPeriod'), period),
    '',
    `## ${p(language, 'autoNoteTitle')}`,
    '',
    p(language, 'autoNote')
  ];
  return `${lines.join('\n')}\n`;
}

function renderAppendix(model, baseline) {
  const { language, projectName, generatedAt, period, documents, claims, evidences, events } = model;
  const evidenceRows = evidences
    .slice()
    .sort((a, b) => (a.path || '').localeCompare(b.path || '') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .slice(0, MAX_APPENDIX_EVIDENCE);
  const tombstones = tombstoneDocs(documents);
  const tombstoneRows = tombstones.slice(0, MAX_TOMBSTONE_APPENDIX);
  const lines = [
    `# ${projectName} · ${p(language, 'technicalAppendixTitle')}`,
    '',
    ...productDocIntro(language, 'appendix'),
    '',
    metadataLine(language, p(language, 'generatedAt'), generatedAt),
    metadataLine(language, p(language, 'analysisPeriod'), period),
    metadataLine(language, 'baseline', `${baseline.branch}@${baseline.commit}`),
    '',
    `## 1. ${p(language, 'ledgerScale')}`,
    '',
    `| ${p(language, 'item')} | ${normalizeLanguage(language) === 'zh' ? '数量' : 'Count'} |`,
    '|---|---:|',
    `| documents | ${documents.length} |`,
    `| claims | ${claims.length} |`,
    `| evidences | ${evidences.length} |`,
    `| events | ${events.length} |`,
    '',
    `## 2. ${p(language, 'claimAppendix')}`,
    '',
    `| claim_id | ${normalizeLanguage(language) === 'zh' ? '主题' : 'Subject'} | PM ${p(language, 'status')} | verification | evidence_ids |`,
    '|---|---|---|---|---|',
    ...(claims.length ? claims.map((claim) => {
      const ids = (claim.evidence_ids || []).slice(0, 12).join(', ');
      const more = claim.evidence_ids.length > 12 ? ` +${claim.evidence_ids.length - 12}` : '';
      return `| ${claim.id} | ${tableCell(claim.subject)} | ${pmStatusForClaim(claim, language)} | ${claim.verification} | ${tableCell(`${ids}${more}`)} |`;
    }) : [`| - | ${p(language, 'noEvidence')} | ${p(language, 'statusUnknown')} | - | - |`]),
    '',
    `## 3. ${p(language, 'evidenceAppendix')}`,
    '',
    `| evidence_id | kind | relation | path | commit | summary |`,
    '|---|---|---|---|---|---|',
    ...(evidenceRows.length ? evidenceRows.map((ev) => `| ${ev.id} | ${ev.kind} | ${ev.relation} | ${tableCell(ev.path || '-')} | ${tableCell(ev.commit || '-')} | ${tableCell(ev.summary)} |`) : [`| - | - | - | - | - | ${p(language, 'noEvidence')} |`]),
    '',
    evidences.length > evidenceRows.length
      ? (normalizeLanguage(language) === 'zh' ? `> 已展示前 ${evidenceRows.length} 条 evidence 样本，完整记录请查看原始账本。` : `> Showing ${evidenceRows.length} evidence samples. Inspect the raw ledger for full records.`)
      : '',
    '',
    `## 4. ${p(language, 'tombstoneAppendixTitle')}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? `已删除文档不会出现在产品主文档或文档导航主列表中。本节只为工程追溯保留，共发现 ${tombstones.length} 条。`
      : `Deleted documents do not appear in product-facing main docs or the primary index. This section keeps them for engineering traceability only. Found ${tombstones.length} records.`,
    '',
    '<details>',
    `<summary>${normalizeLanguage(language) === 'zh' ? '展开查看已删除文档样本' : 'Show deleted document samples'}</summary>`,
    '',
    `| ${p(language, 'doc')} | ${p(language, 'status')} | last_seen_commit |`,
    '|---|---|---|',
    ...(tombstoneRows.length ? tombstoneRows.map((doc) => `| ${tableCell(doc.path)} | ${doc.doc_status} / tombstone | ${tableCell(doc.last_seen_commit || '-')} |`) : [`| ${p(language, 'noEvidence')} | - | - |`]),
    '',
    tombstones.length > tombstoneRows.length
      ? (normalizeLanguage(language) === 'zh' ? `> 已展示前 ${tombstoneRows.length} 条 tombstone 样本，完整记录请查看原始账本。` : `> Showing ${tombstoneRows.length} tombstone samples. Inspect the raw ledger for full records.`)
      : '',
    '',
    '</details>',
    '',
    `## 5. ${p(language, 'generatedFiles')}`,
    '',
    `| ${p(language, 'doc')} | ${normalizeLanguage(language) === 'zh' ? '说明' : 'Description'} |`,
    '|---|---|',
    `| ${generatedDocLink('PRODUCT_DOCS_INDEX.md')} | ${normalizeLanguage(language) === 'zh' ? '产品阅读导航。' : 'Product reading index.'} |`,
    `| ${generatedDocLink('PRODUCT_OVERVIEW.md')} | ${normalizeLanguage(language) === 'zh' ? '产品视角总览。' : 'Product-facing overview.'} |`,
    `| ${generatedDocLink('PRODUCT_ARCHITECTURE.md')} | ${normalizeLanguage(language) === 'zh' ? '产品能力架构。' : 'Product capability architecture.'} |`,
    `| ${generatedDocLink('PRODUCT_RECENT_CHANGES.md')} | ${normalizeLanguage(language) === 'zh' ? '最近变化说明。' : 'Recent changes.'} |`,
    `| ${generatedDocLink('PROJECT_CURRENT.md')} | ${normalizeLanguage(language) === 'zh' ? '工程视角当前状态。' : 'Engineering current-state view.'} |`,
    `| ${generatedDocLink('PROJECT_TIMELINE.md')} | ${normalizeLanguage(language) === 'zh' ? '工程事件时间线。' : 'Engineering event timeline.'} |`,
    `| ${generatedDocLink('DOCS_INVENTORY.md')} | ${normalizeLanguage(language) === 'zh' ? '完整文档清单。' : 'Full docs inventory.'} |`,
    `| ${generatedDocLink('DOCUMENTATION_GAPS.md')} | ${normalizeLanguage(language) === 'zh' ? '标准文档缺口和补齐建议。' : 'Standard documentation gaps and recommendations.'} |`,
    `| ${generatedDocLink('DRIFT_REPORT.md')} | ${normalizeLanguage(language) === 'zh' ? '漂移和灰区报告。' : 'Drift and gray-area report.'} |`,
    '',
    `## 6. ${p(language, 'fullLedger')}`,
    '',
    p(language, 'fullLedgerNote'),
    '',
    `## 7. ${p(language, 'autoNoteTitle')}`,
    '',
    normalizeLanguage(language) === 'zh'
      ? `主文档不会展示 ${evidences.length} 条 evidence 的完整细节，避免产品阅读体验被工程记录打断。需要精确追溯时，以本附录、工程视图和原始 ledger 为准。`
      : `Product-facing docs do not show all ${evidences.length} evidence records. Use this appendix, engineering views, and the raw ledger for precise traceability.`
  ];

  return `${lines.join('\n')}\n`;
}

async function buildModel(root, ledger, options) {
  const language = normalizeLanguage(options.language);
  const documents = latestDocuments(ledger.documents);
  const claims = latestClaims(ledger.claims);
  const evidences = ledger.evidences;
  const events = latestBy(ledger.events, (event) => event.id).sort((a, b) => a.ts.localeCompare(b.ts));
  const projectName = await inferProjectName(root);
  const model = {
    root,
    language,
    projectName,
    documents,
    claims,
    evidences,
    events,
    generatedAt: latestLedgerTime(events),
    period: analysisPeriod(events, language)
  };
  model.items = capabilityItems({ claims, documents, evidences, language });
  return model;
}

export async function renderProductViews(root, options = {}) {
  const config = await loadConfig(root);
  const language = options.language || config.output.language;
  const ledger = splitLedger(await readLedger(root));
  const baseline = await gitInfo(root);
  const model = await buildModel(root, ledger, { language });
  const indexBody = renderIndex(model);
  const overviewBody = renderOverview(model);
  const architectureBody = renderArchitecture(model);
  const changesBody = renderRecentChanges(model);
  const appendixBody = renderAppendix(model, baseline);

  const index = await renderManagedFile(root, config.outputs.product_index, {
    id: 'product-docs-index',
    view: 'PRODUCT_DOCS_INDEX',
    body: indexBody,
    agentComment: AGENT_COMMENT
  });
  const overview = await renderManagedFile(root, config.outputs.product_overview, {
    id: 'product-overview',
    view: 'PRODUCT_OVERVIEW',
    body: overviewBody,
    agentComment: AGENT_COMMENT
  });
  const architecture = await renderManagedFile(root, config.outputs.product_architecture, {
    id: 'product-architecture',
    view: 'PRODUCT_ARCHITECTURE',
    body: architectureBody,
    agentComment: AGENT_COMMENT
  });
  const changes = await renderManagedFile(root, config.outputs.product_recent_changes, {
    id: 'product-recent-changes',
    view: 'PRODUCT_RECENT_CHANGES',
    body: changesBody,
    agentComment: AGENT_COMMENT
  });
  const appendix = await renderManagedFile(root, config.outputs.technical_appendix, {
    id: 'technical-appendix',
    view: 'TECHNICAL_APPENDIX',
    body: appendixBody,
    agentComment: AGENT_COMMENT
  });

  const files = [index, overview, architecture, changes, appendix];
  return {
    files,
    warnings: files.filter((item) => item.warning)
  };
}

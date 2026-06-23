import { z } from 'zod';

export const DocClassSchema = z.object({
  type: z.enum([
    'prd',
    'solution',
    'design',
    'adr',
    'readme',
    'api',
    'guide',
    'runbook',
    'security',
    'roadmap',
    'checklist',
    'schema',
    'recipe',
    'agent-rules',
    'template',
    'todo',
    'changelog',
    'demo-html',
    'generated',
    'unknown'
  ]),
  confidence: z.number().min(0).max(1),
  gray: z.boolean(),
  reason: z.string()
});

function has(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyDocument(parsedOrPath) {
  const path = typeof parsedOrPath === 'string' ? parsedOrPath : parsedOrPath.path;
  const title = typeof parsedOrPath === 'string' ? '' : parsedOrPath.title || '';
  const frontmatter = typeof parsedOrPath === 'string' ? {} : parsedOrPath.frontmatter || {};
  const htmlKind = typeof parsedOrPath === 'string' ? null : parsedOrPath.html_kind;
  const text = `${path} ${title} ${frontmatter.type || ''} ${frontmatter.kind || ''}`.toLowerCase();

  if (/docs\/octodocs\//.test(path)) {
    return DocClassSchema.parse({ type: 'generated', confidence: 1, gray: false, reason: 'Generated octodocs view path' });
  }
  if (htmlKind || /\.html$/i.test(path)) {
    return DocClassSchema.parse({ type: 'demo-html', confidence: htmlKind === 'prototype' ? 0.85 : 0.7, gray: false, reason: 'Static HTML artifact/prototype' });
  }
  if (has(text, [/(^|\/)(agents|claude)\.md\b/, /agent rules|repository guidelines|coding agent|ai agent instructions|仓库指引|agent 指引/])) {
    return DocClassSchema.parse({ type: 'agent-rules', confidence: 0.88, gray: false, reason: 'Agent instruction or repository rules document' });
  }
  if (has(text, [/issue_template|pull_request_template|(^|\/)templates?\//, /template|模板/])) {
    return DocClassSchema.parse({ type: 'template', confidence: 0.78, gray: false, reason: 'Template or issue/PR form document' });
  }
  if (has(text, [/readme/, /getting[- ]started/, /quickstart/, /使用说明/])) {
    return DocClassSchema.parse({ type: 'readme', confidence: 0.9, gray: false, reason: 'README or quickstart naming' });
  }
  if (has(text, [/change[-_ ]?log/, /release notes?/, /更新日志/])) {
    return DocClassSchema.parse({ type: 'changelog', confidence: 0.88, gray: false, reason: 'Changelog naming' });
  }
  if (has(text, [/roadmap/, /milestone/, /路线图/])) {
    return DocClassSchema.parse({ type: 'roadmap', confidence: 0.84, gray: false, reason: 'Roadmap or milestone naming' });
  }
  if (has(text, [/adr/, /architecture decision/, /决策记录/])) {
    return DocClassSchema.parse({ type: 'adr', confidence: 0.86, gray: false, reason: 'ADR naming or title' });
  }
  if (has(text, [/prd/, /product requirement/, /requirements?/, /需求/])) {
    return DocClassSchema.parse({ type: 'prd', confidence: 0.84, gray: false, reason: 'Requirement naming or title' });
  }
  if (has(text, [/方案/, /proposal/, /solution/, /spec/, /规格/])) {
    return DocClassSchema.parse({ type: 'solution', confidence: 0.82, gray: false, reason: 'Solution/spec/proposal naming or title' });
  }
  if (has(text, [/design/, /设计/, /architecture/, /架构/])) {
    return DocClassSchema.parse({ type: 'design', confidence: 0.82, gray: false, reason: 'Design or architecture naming' });
  }
  if (has(text, [/security|rbac|auth|oauth|permission|credential|secret[-_ ]?(management|handling|rotation)|pii|privacy|gdpr|安全|权限|凭证|审计|隐私/])) {
    return DocClassSchema.parse({ type: 'security', confidence: 0.82, gray: false, reason: 'Security, auth, permission, or audit naming' });
  }
  if (has(text, [/runbook|incident|backup|restore|recovery|disaster|rollback|operations?\//, /故障|回滚|备份|恢复|运维/])) {
    return DocClassSchema.parse({ type: 'runbook', confidence: 0.82, gray: false, reason: 'Runbook, incident, backup, restore, or rollback naming' });
  }
  if (has(text, [/api|protocol|endpoint|rest|graphql|mcp|gep|接口|协议/])) {
    return DocClassSchema.parse({ type: 'api', confidence: 0.8, gray: false, reason: 'API, endpoint, or protocol naming' });
  }
  if (has(text, [/schema|event kind|data model|migration|prisma|ddl|数据模型|迁移/])) {
    return DocClassSchema.parse({ type: 'schema', confidence: 0.8, gray: false, reason: 'Schema, event catalog, data model, or migration naming' });
  }
  if (has(text, [/checklist|smoke|test plan|validation|certification|acceptance|验收|认证|走查|检查清单|测试/])) {
    return DocClassSchema.parse({ type: 'checklist', confidence: 0.82, gray: false, reason: 'Checklist, smoke, validation, or test-plan naming' });
  }
  if (has(text, [/blueprints?\//, /recipe|skill\.md|工作流|配方/])) {
    return DocClassSchema.parse({ type: 'recipe', confidence: 0.78, gray: false, reason: 'Blueprint, recipe, or skill document' });
  }
  if (has(text, [/install|setup|deployment|deploy|docker|upgrade|contributing|guide|指南|部署|安装|配置|贡献/])) {
    return DocClassSchema.parse({ type: 'guide', confidence: 0.78, gray: false, reason: 'Setup, deployment, upgrade, contributing, or guide naming' });
  }
  if (has(text, [/todo/, /backlog/, /任务/])) {
    return DocClassSchema.parse({ type: 'todo', confidence: 0.86, gray: false, reason: 'TODO/backlog naming' });
  }
  return DocClassSchema.parse({ type: 'unknown', confidence: 0.25, gray: true, reason: 'No deterministic path, title, or frontmatter rule matched' });
}

export function classifyDocuments(parsedDocuments) {
  return parsedDocuments.map((doc) => ({ path: doc.path, ...classifyDocument(doc) }));
}

import { basename, join } from 'node:path';
import { rm } from 'node:fs/promises';
import { loadConfig } from '../config/config.mjs';
import { readLedger, splitLedger } from '../ledger/store.mjs';
import { gitInfo } from '../utils/git.mjs';
import { readTextIfExists, writeText } from '../utils/fs.mjs';
import { commitDocumentationGaps, commitGapTableLines } from './commit-docs.mjs';
import { text, normalizeLanguage } from './i18n.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function latestById(items) {
  const map = new Map();
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
}

function generatedHtmlName(markdownPath) {
  return `${basename(markdownPath).replace(/\.md$/i, '')}.html`;
}

function scenarioViewDocs(language) {
  const zh = normalizeLanguage(language) === 'zh';
  return [
    {
      key: 'PROJECT_COMPLETE_VIEW',
      html: 'project.html',
      title: zh ? '完整项目' : 'Complete Project',
      navTitle: zh ? '项目全景' : 'Project View',
      group: 'scenario',
      tier: zh ? '场景视图' : 'Scenario',
      code: zh ? '项目全景' : 'Project',
      description: zh ? '从产品状态、能力架构、文档覆盖和工程视图看完整项目。' : 'Full project view across product state, architecture, documentation coverage, and engineering views.',
      primary: true
    },
    {
      key: 'RECENT_CHANGE_VIEW',
      html: 'changes.html',
      title: zh ? '最近变化' : 'Recent Changes',
      navTitle: zh ? '变化总览' : 'Change Review',
      group: 'scenario',
      tier: zh ? '场景视图' : 'Scenario',
      code: zh ? '变化追踪' : 'Changes',
      description: zh ? '按时间看近期 commit、用户影响和可能缺文档的变更。' : 'Trace recent commits, user impact, and possible documentation gaps.'
    },
    {
      key: 'ANGLE_VIEW',
      html: 'angles.html',
      title: zh ? '多角度浏览' : 'Explore By Angle',
      navTitle: zh ? '视角导航' : 'Angles',
      group: 'scenario',
      tier: zh ? '场景视图' : 'Scenario',
      code: zh ? '视角导航' : 'Angles',
      description: zh ? '按产品、架构、风险、证据、交接、文档覆盖等角度进入。' : 'Enter through product, architecture, risk, evidence, handoff, or coverage angles.'
    }
  ];
}

function markdownOutputDocs(config, language) {
  const zh = normalizeLanguage(language) === 'zh';
  const desc = {
    PRODUCT_OVERVIEW: zh ? '一页看懂项目是什么、现状、能力范围、风险和下一步。' : 'Current state, capability scope, risks, and next focus.',
    PRODUCT_ARCHITECTURE: zh ? '用产品语言理解入口、核心能力、自动化、数据权限和外部依赖。' : 'Product-language capability architecture.',
    PRODUCT_RECENT_CHANGES: zh ? '查看最近做了什么、影响谁、哪些事项需要迁移或确认，以及哪些 commit 可能缺文档。' : 'Recent changes, impact, migration items, and commits that may be missing docs.',
    PRODUCT_DOCS_INDEX: zh ? '按读者和能力域找到当前资料，历史资料降级展示。' : 'Reading index by reader and capability domain.',
    TECHNICAL_APPENDIX: zh ? '工程证据、commit、路径、claim 和 tombstone 历史痕迹。' : 'Evidence, commits, paths, claims, and tombstone traces.',
    PROJECT_CURRENT: zh ? '工程视角的当前结论、状态和 coverage。' : 'Engineering current-state view.',
    PROJECT_TIMELINE: zh ? '历史追溯：按时间看做了什么，并标注可能缺少文档的 commit。' : 'History trace with commit timing and possible documentation gaps.',
    DOCS_INVENTORY: zh ? '完整文档清单和状态机结果。' : 'Full document inventory.',
    DOCUMENTATION_GAPS: zh ? '标准文档覆盖、缺失项和规范化建议。' : 'Standard-doc coverage, missing areas, and normalization recommendations.',
    DRIFT_REPORT: zh ? '过时、冲突、漂移和灰区风险。' : 'Drift, stale, conflict, and gray-area risks.',
    AGENT_HANDOFF: zh ? '给下一位 Agent 的接手摘要。' : 'Agent handoff summary.'
  };
  const tier = {
    product: zh ? '产品文档' : 'Product',
    appendix: zh ? '附录' : 'Appendix',
    engineering: zh ? '工程视图' : 'Engineering'
  };
  return [
    { key: 'PRODUCT_OVERVIEW', path: config.outputs.product_overview, title: zh ? '产品总览' : 'Product Overview', group: 'product', tier: tier.product, primary: true },
    { key: 'PRODUCT_ARCHITECTURE', path: config.outputs.product_architecture, title: zh ? '产品能力架构' : 'Product Capability Architecture', group: 'product', tier: tier.product },
    { key: 'PRODUCT_RECENT_CHANGES', path: config.outputs.product_recent_changes, title: zh ? '最近变化' : 'Recent Changes', navTitle: zh ? '产品最近变化' : 'Product Changes', group: 'product', tier: tier.product },
    { key: 'PRODUCT_DOCS_INDEX', path: config.outputs.product_index, title: zh ? '文档导航' : 'Docs Index', group: 'product', tier: zh ? '导航' : 'Index' },
    { key: 'TECHNICAL_APPENDIX', path: config.outputs.technical_appendix, title: zh ? '工程证据附录' : 'Technical Appendix', group: 'appendix', tier: tier.appendix },
    { key: 'PROJECT_CURRENT', path: config.outputs.current, title: text(language, 'current'), group: 'engineering', tier: tier.engineering },
    { key: 'PROJECT_TIMELINE', path: config.outputs.timeline, title: text(language, 'timeline'), group: 'engineering', tier: tier.engineering },
    { key: 'DOCS_INVENTORY', path: config.outputs.inventory, title: text(language, 'docsInventory'), group: 'engineering', tier: tier.engineering },
    { key: 'DOCUMENTATION_GAPS', path: config.outputs.gaps, title: zh ? '文档规范化缺口' : 'Documentation Gaps', group: 'engineering', tier: tier.engineering },
    { key: 'DRIFT_REPORT', path: config.outputs.drift, title: text(language, 'drift'), group: 'engineering', tier: tier.engineering },
    { key: 'AGENT_HANDOFF', path: config.outputs.handoff, title: text(language, 'handoff'), group: 'engineering', tier: tier.engineering }
  ].map((doc) => ({
    ...doc,
    description: desc[doc.key],
    html: generatedHtmlName(doc.path)
  }));
}

function stripOuterGeneratedMatter(markdown) {
  let textValue = String(markdown || '').replace(/^<!-- AGENT:[\s\S]*?-->\n?/, '').trimStart();
  textValue = textValue.replace(/^---\n[\s\S]*?\n---\n?/, '').trimStart();
  const match = textValue.match(/<!-- octodocs:managed start [\s\S]*?-->\n([\s\S]*?)<!-- octodocs:managed end/);
  if (match) textValue = match[1].trimStart();
  textValue = textValue.replace(/\n?<!-- octodocs:managed file id="[^"]+" hash="[a-f0-9]+" -->\s*$/i, '');
  textValue = textValue.replace(/^---\n[\s\S]*?\n---\n?/, '').trimStart();
  return textValue.trim();
}

// Single-file portal: every generated view is an in-page section with id `view-<name>`.
// Links target those anchors so the portal never navigates across files (works in IDE
// preview panes, opened straight from disk, or shared as one file).
function viewAnchor(html) {
  return `#view-${String(html || '').replace(/\.(html|md)$/i, '')}`;
}

function rewriteHref(target) {
  const raw = String(target || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^&lt;/i, '')
    .replace(/&gt;$/i, '');
  if (!raw) return '#';
  if (/^(https?:|mailto:|#)/i.test(raw)) return raw;
  // Same-directory generated views (./PRODUCT_OVERVIEW.md or DRIFT_REPORT.html) become
  // in-page anchors; source documents one or more levels up keep their relative path
  // (HTML lives one directory deeper than the Markdown views).
  if (/^\.?\/?[^/]+\.(md|html)(#.*)?$/i.test(raw)) {
    const file = raw.replace(/^\.\//, '').split('#')[0].replace(/\.(md|html)$/i, '');
    return `#view-${file}`;
  }
  if (/^\.\.\//.test(raw)) return `../${raw}`;
  return raw;
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => `<a href="${escapeHtml(rewriteHref(target))}">${label}</a>`);
  return html;
}

function simpleHash(value) {
  let hash = 0;
  const input = String(value || '');
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16);
}

function parseMermaidNode(expr, nodes) {
  const cleaned = String(expr || '').trim().replace(/;$/, '');
  const match = cleaned.match(/^([A-Za-z0-9_]+)(?:\["([^"]+)"\])?$/);
  if (!match) return null;
  const id = match[1];
  const label = match[2] || nodes.get(id)?.label || id;
  nodes.set(id, { id, label });
  return id;
}

function wrapSvgLabel(label) {
  const textValue = String(label || '').trim();
  if (!textValue) return [''];
  if (textValue.includes(' / ')) return textValue.split(/\s+\/\s+/).slice(0, 3);
  if (textValue.length <= 13) return [textValue];
  if (/\s/.test(textValue)) {
    const lines = [];
    let current = '';
    for (const word of textValue.split(/\s+/)) {
      if (`${current} ${word}`.trim().length > 18 && current) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`.trim();
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 3);
  }
  return textValue.match(/.{1,9}/g).slice(0, 3);
}

function mermaidFlowchartToSvg(code) {
  const source = String(code || '').trim();
  if (!/^flowchart\s+/i.test(source)) return null;
  const nodes = new Map();
  const edges = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^flowchart\s+/i.test(line) || line.startsWith('%%')) continue;
    const edge = line.match(/^(.+?)\s*-->\s*(.+)$/);
    if (edge) {
      const from = parseMermaidNode(edge[1], nodes);
      const to = parseMermaidNode(edge[2], nodes);
      if (from && to) edges.push({ from, to });
      continue;
    }
    parseMermaidNode(line, nodes);
  }
  if (!nodes.size || !edges.length) return null;

  const ids = Array.from(nodes.keys());
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const nextRank = (rank.get(edge.from) || 0) + 1;
      if (nextRank > (rank.get(edge.to) || 0)) {
        rank.set(edge.to, nextRank);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const groups = new Map();
  for (const id of ids) {
    const value = rank.get(id) || 0;
    const group = groups.get(value) || [];
    group.push(id);
    groups.set(value, group);
  }
  const ranks = Array.from(groups.keys()).sort((a, b) => a - b);
  const nodeWidth = 186;
  const nodeHeight = 58;
  const xGap = 84;
  const yGap = 34;
  const margin = 36;
  const maxRows = Math.max(...Array.from(groups.values()).map((group) => group.length));
  const width = margin * 2 + ranks.length * nodeWidth + Math.max(0, ranks.length - 1) * xGap;
  const height = margin * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * yGap;
  const positions = new Map();

  for (const rankValue of ranks) {
    const group = groups.get(rankValue).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const x = margin + ranks.indexOf(rankValue) * (nodeWidth + xGap);
    const groupHeight = group.length * nodeHeight + Math.max(0, group.length - 1) * yGap;
    const startY = margin + Math.max(0, (height - margin * 2 - groupHeight) / 2);
    group.forEach((id, index) => positions.set(id, { x, y: startY + index * (nodeHeight + yGap) }));
  }

  const markerId = `arrow-${simpleHash(source)}`;
  const edgePaths = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const sx = from.x + nodeWidth;
    const sy = from.y + nodeHeight / 2;
    const tx = to.x;
    const ty = to.y + nodeHeight / 2;
    const curve = Math.max(42, Math.abs(tx - sx) / 2);
    return `<path d="M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}" fill="none" stroke="var(--flow-edge)" stroke-width="1.6" marker-end="url(#${markerId})"/>`;
  }).join('');

  const nodeGroups = ids.map((id) => {
    const node = nodes.get(id);
    const pos = positions.get(id);
    const lines = wrapSvgLabel(node.label);
    const textY = nodeHeight / 2 - (lines.length - 1) * 8;
    const tspans = lines.map((line, index) => `<tspan x="${nodeWidth / 2}" y="${textY + index * 16}">${escapeHtml(line)}</tspan>`).join('');
    return `<g class="flow-node" transform="translate(${pos.x},${pos.y})"><rect width="${nodeWidth}" height="${nodeHeight}" rx="8"/><text text-anchor="middle">${tspans}</text></g>`;
  }).join('');

  return `<div class="flow-svg-wrap"><svg class="flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Flowchart" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="var(--flow-edge)"/></marker></defs>${edgePaths}${nodeGroups}</svg></div>`;
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function tableHtml(lines) {
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return `<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function flushParagraph(out, paragraph) {
  if (!paragraph.length) return;
  out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  paragraph.length = 0;
}

function flushList(out, listItems) {
  if (!listItems.length) return;
  out.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
  listItems.length = 0;
}

function markdownToHtml(markdown) {
  const lines = stripOuterGeneratedMatter(markdown).split(/\r?\n/);
  const out = [];
  const paragraph = [];
  const listItems = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(out, paragraph);
      flushList(out, listItems);
      continue;
    }

    const fence = trimmed.match(/^```(\w+)?/);
    if (fence) {
      flushParagraph(out, paragraph);
      flushList(out, listItems);
      const lang = fence[1] || '';
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      if (lang.toLowerCase() === 'mermaid') {
        out.push(mermaidFlowchartToSvg(code.join('\n')) || `<pre class="raw"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      } else {
        out.push(`<pre class="raw"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      }
      continue;
    }

    if (/^<\/?(details|summary)/i.test(trimmed)) {
      flushParagraph(out, paragraph);
      flushList(out, listItems);
      out.push(trimmed);
      continue;
    }

    if (/^\|.+\|$/.test(trimmed) && i + 1 < lines.length && /^\|?[\s:-]+\|[\s|:-]+$/.test(lines[i + 1].trim())) {
      flushParagraph(out, paragraph);
      flushList(out, listItems);
      const tableLines = [trimmed, lines[i + 1].trim()];
      i += 2;
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      out.push(tableHtml(tableLines));
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(out, paragraph);
      flushList(out, listItems);
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph(out, paragraph);
      flushList(out, listItems);
      const quotes = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quotes.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      i -= 1;
      out.push(`<blockquote>${quotes.map((item) => `<p>${inlineMarkdown(item)}</p>`).join('')}</blockquote>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
    if (bullet) {
      flushParagraph(out, paragraph);
      listItems.push(bullet[1]);
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph(out, paragraph);
  flushList(out, listItems);
  return out.join('\n');
}

function docNav(docs, language) {
  const zh = normalizeLanguage(language) === 'zh';
  const scenario = docs.filter((doc) => doc.group === 'scenario');
  const product = docs.filter((doc) => doc.group === 'product');
  const appendix = docs.filter((doc) => doc.group === 'appendix');
  const engineering = docs.filter((doc) => doc.group === 'engineering');
  const links = (items) => items.map((doc) => `<a href="${escapeHtml(viewAnchor(doc.html))}"><span class="dot"></span>${escapeHtml(doc.navTitle || doc.title)}</a>`).join('\n');
  return `<nav>
    <div class="nav-group">${escapeHtml(zh ? '场景视图' : 'Scenarios')}</div>
    ${links(scenario)}
    <div class="nav-group">${escapeHtml(zh ? '产品主线' : 'Product')}</div>
    ${links(product)}
    <div class="nav-group">${escapeHtml(zh ? '附录' : 'Appendix')}</div>
    ${links(appendix)}
    <div class="nav-group">${escapeHtml(zh ? '工程视图' : 'Engineering')}</div>
    ${links(engineering)}
  </nav>`;
}

function layout({ title, body, language, navDocs }) {
  const lang = normalizeLanguage(language);
  const zh = lang === 'zh';
  const contentBody = String(body || '').trimStart();
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{
      --background:#ffffff;--foreground:#0e1b2d;--card:#ffffff;--popover:#ffffff;
      --muted:#f2f5fa;--muted-foreground:#64748b;--border:#e2e8f0;--input:#e2e8f0;
      --primary:#1c3357;--primary-foreground:#ffffff;--ring:#3e78c9;--info:#3e78c9;
      --success:#2f7d57;--warning:#c68a2e;--destructive:#c0443b;
      --sidebar:#0e1b2d;--sidebar-soft:#15273f;--sidebar-line:#1e293b;
      --flow-edge:#3e78c9;--shadow:0 1px 2px rgba(14,27,45,.05),0 12px 32px rgba(14,27,45,.08);
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;background:var(--muted);color:var(--foreground);font-family:Inter,"Noto Sans SC",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}
    a{color:var(--info);text-decoration:none}
    a:hover{text-decoration:underline}
    .app{display:grid;grid-template-columns:304px minmax(0,1fr)}
    .sidebar{position:sticky;top:0;height:100vh;overflow:auto;background:var(--sidebar);color:var(--primary-foreground);border-right:1px solid var(--sidebar-line);padding:28px 22px;display:flex;flex-direction:column;gap:24px}
    .brand{display:flex;align-items:center;gap:12px}
    .mark{width:40px;height:40px;border-radius:8px;background:var(--primary);display:grid;place-items:center;border:1px solid rgba(255,255,255,.18)}
    .mark svg{width:25px;height:25px}
    .brand b{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:15px;font-weight:600;display:block;line-height:1.2}
    .brand small{font-size:11.5px;color:#94a3b8}
    .nav-group{font-size:11px;text-transform:uppercase;color:#94a3b8;margin:16px 0 6px;padding-left:12px}
    nav a{display:flex;align-items:center;gap:9px;padding:8px 12px;border-radius:8px;color:#cbd5e1;font-size:13.5px}
    nav a:hover{background:rgba(255,255,255,.08);color:#f2f5fa;text-decoration:none}
    nav a.active{background:#f2f5fa;color:var(--foreground);font-weight:600;box-shadow:0 1px 2px rgba(14,27,45,.18)}
    .dot{width:5px;height:5px;border-radius:50%;background:#64748b;flex:none}.active .dot{background:var(--ring);transform:scale(1.5)}
    .side-foot{margin-top:auto;font-size:11.5px;color:#94a3b8;border-top:1px solid var(--sidebar-line);padding-top:16px}
    .content{min-width:0}
    .wrap{max-width:1120px;margin:0 auto;padding:44px 48px 72px}
    .kicker{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;text-transform:uppercase;color:var(--primary);display:flex;align-items:center;gap:10px;margin-bottom:16px}
    .kicker:before{content:"";width:22px;height:1px;background:var(--ring)}
    .page-title{font-size:40px;line-height:1.16;margin:0;font-weight:750}
    .lede{font-size:16px;color:#334155;max-width:78ch;margin:14px 0 28px}
    .doc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:24px 0 34px}
    .doc-card{display:flex;flex-direction:column;gap:9px;min-height:158px;padding:18px;border:1px solid var(--border);border-radius:8px;background:var(--card);box-shadow:var(--shadow);color:var(--foreground)}
    .doc-card:hover{border-color:var(--ring);text-decoration:none}.doc-card.primary{border-left:3px solid var(--primary)}
    .doc-card code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11.5px;color:var(--primary);background:var(--muted);border-radius:5px;padding:1px 6px;width:max-content;max-width:100%;overflow-wrap:anywhere}
    .doc-card strong{font-size:17px}.doc-card span{font-size:13px;color:#334155}
    .chip,.state{display:inline-flex;width:max-content;max-width:100%;padding:2px 9px;border-radius:999px;background:var(--muted);border:1px solid var(--border);color:var(--muted-foreground);font-size:12px;font-weight:600}
    .state{background:rgba(47,125,87,.12);color:var(--success);border:0}.warn{background:rgba(198,138,46,.14);color:var(--warning)}.bad{background:rgba(192,68,59,.12);color:var(--destructive)}
    .metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0 28px}
    .metric{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;box-shadow:var(--shadow)}
    .metric b{display:block;font-size:24px;color:var(--primary);line-height:1.1}.metric span{font-size:12px;color:var(--muted-foreground)}
    .view-stack{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin:16px 0 30px}
    .view-panel{background:var(--background);border:1px solid var(--border);border-radius:8px;padding:18px;box-shadow:var(--shadow)}
    .view-panel h2,.view-panel h3{margin-top:0}
    article.doc{background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow);padding:34px 38px}
    .doc h1{font-size:30px;line-height:1.22;margin:0 0 16px}
    .doc h2{font-size:22px;margin:34px 0 12px;padding-top:18px;border-top:1px solid var(--border)}
    .doc h3{font-size:17px;margin:24px 0 8px}.doc h4{font-size:15px;margin:18px 0 6px}
    .doc p,.doc li{font-size:14.5px;color:#334155}.doc strong{color:var(--foreground)}
    .doc ul,.doc ol{padding-left:22px;margin:10px 0}.doc li{margin:5px 0}.doc li::marker{color:var(--ring)}
    .doc code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;background:var(--muted);color:var(--primary);padding:1px 6px;border-radius:5px}
    .doc blockquote{margin:14px 0;padding:12px 16px;background:var(--muted);border-left:3px solid var(--ring);border-radius:0 8px 8px 0}
    .doc blockquote p{font-size:13px;color:var(--muted-foreground);margin:4px 0}
    .table-wrap{overflow-x:auto;margin:16px 0;border:1px solid var(--border);border-radius:8px;background:var(--card)}
    .doc table{width:100%;border-collapse:collapse;background:var(--card);font-size:13.5px}
    .doc th{text-align:left;color:var(--foreground);background:var(--muted);padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
    .doc td{padding:9px 12px;border-bottom:1px solid var(--border);color:#334155;vertical-align:top}.doc tr:last-child td{border-bottom:0}
    pre.raw{margin:16px 0;padding:18px 20px;border-radius:8px;background:#0e1b2d;overflow:auto}
    pre.raw code{background:transparent;color:#f2f5fa;padding:0}
    .flow-svg-wrap{padding:18px;background:var(--muted);border:1px solid var(--border);border-radius:8px;margin:16px 0;overflow:auto}
    .flow-svg{display:block;min-width:760px;max-width:100%;height:auto;margin:0 auto}
    .flow-node rect{fill:var(--background);stroke:var(--border);stroke-width:1.2}
    .flow-node text{font-family:Inter,"Noto Sans SC",ui-sans-serif,system-ui,sans-serif;font-size:12px;font-weight:650;fill:var(--foreground)}
    details{border:1px solid var(--border);border-radius:8px;padding:12px 14px;background:var(--muted);margin:16px 0}
    summary{cursor:pointer;font-weight:600;color:var(--foreground)}
    .view{display:none}
    .view:target{display:block}
    #view-index{display:block}
    body:has(.view:not(#view-index):target) #view-index{display:none}
    @media(max-width:920px){.app{grid-template-columns:1fr}.sidebar{position:static;height:auto}.sidebar nav,.side-foot{display:none}.wrap{padding:28px 20px 48px}.page-title{font-size:32px}article.doc{padding:24px 20px}.doc-grid{grid-template-columns:1fr}.metric-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<!-- AGENT: HTML is an OctoDocs generated view from Markdown and ledger data. Do not edit; rebuild from .octodocs/ledger.accepted.jsonl. -->
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 3h10l8 8v10l-8 8H11l-8-8V11z" fill="none" stroke="white" stroke-width="3" stroke-linejoin="round"/></svg></div><div><b>OctoDocs</b><small>${escapeHtml(zh ? '产品文档视图' : 'Product Docs View')}</small></div></div>
    ${docNav(navDocs, language)}
    <div class="side-foot">${escapeHtml(zh ? '同一份自动生成数据，两种读者。产品主线优先，工程证据后置。' : 'One generated data set, two reader modes. Product docs first; engineering evidence behind it.')}</div>
  </aside>
  <main class="content">
    ${contentBody}
  </main>
</div>
</body>
</html>
`;
}

async function writeHtml(root, relativePath, html) {
  const existing = await readTextIfExists(join(root, relativePath));
  if (existing === html) return { path: relativePath, written: false };
  await writeText(join(root, relativePath), html);
  return { path: relativePath, written: true };
}

async function removeHtmlIfExists(root, relativePath) {
  try {
    await rm(join(root, relativePath), { force: false });
    return { path: relativePath, written: true, deleted: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: relativePath, written: false, deleted: true };
    throw error;
  }
}

function productCards(docs) {
  return docs.filter((doc) => ['product', 'appendix'].includes(doc.group)).map((doc) => `
<a class="doc-card${doc.primary ? ' primary' : ''}" href="${escapeHtml(viewAnchor(doc.html))}">
  <code>${escapeHtml(doc.code || basename(doc.path || doc.html))}</code>
  <strong>${escapeHtml(doc.title)}</strong>
  <span>${escapeHtml(doc.description)}</span>
  <span class="chip">${escapeHtml(doc.tier)}</span>
</a>`).join('\n');
}

function viewCards(docs) {
  return docs.map((doc) => `
<a class="doc-card${doc.primary ? ' primary' : ''}" href="${escapeHtml(viewAnchor(doc.html))}">
  <code>${escapeHtml(doc.code || doc.html)}</code>
  <strong>${escapeHtml(doc.title)}</strong>
  <span>${escapeHtml(doc.description)}</span>
  <span class="chip">${escapeHtml(doc.tier)}</span>
</a>`).join('\n');
}

function engineeringRows({ claims, docs, events, evidences, language }) {
  return `<div class="table-wrap"><table><thead><tr><th>${escapeHtml(text(language, 'view'))}</th><th>${escapeHtml(text(language, 'count'))}</th><th>${escapeHtml(text(language, 'notes'))}</th></tr></thead><tbody>
<tr><td><a href="#view-PROJECT_CURRENT">${escapeHtml(text(language, 'currentView'))}</a></td><td>${claims.length}</td><td>${escapeHtml(text(language, 'currentNotes'))}</td></tr>
<tr><td><a href="#view-PROJECT_TIMELINE">${escapeHtml(text(language, 'timeline'))}</a></td><td>${events.length}</td><td>${escapeHtml(text(language, 'timelineNotes'))}</td></tr>
<tr><td><a href="#view-TECHNICAL_APPENDIX">${escapeHtml(text(language, 'evidenceView'))}</a></td><td>${evidences.length}</td><td>${escapeHtml(text(language, 'evidenceNotes'))}</td></tr>
<tr><td><a href="#view-DOCS_INVENTORY">${escapeHtml(text(language, 'documents'))}</a></td><td>${docs.length}</td><td>${escapeHtml(text(language, 'documentsNotes'))}</td></tr>
</tbody></table></div>`;
}

function metricGrid(metrics) {
  return `<div class="metric-grid">${metrics.map((metric) => `<div class="metric"><b>${escapeHtml(metric.value)}</b><span>${escapeHtml(metric.label)}</span></div>`).join('')}</div>`;
}

function docByKey(docs, key) {
  return docs.find((doc) => doc.key === key);
}

function linkedDocPanel(doc, description) {
  return `<div class="view-panel"><h3><a href="${escapeHtml(viewAnchor(doc.html))}">${escapeHtml(doc.title)}</a></h3><p>${escapeHtml(description || doc.description)}</p><p><span class="chip">${escapeHtml(doc.tier)}</span></p></div>`;
}

function indexBody({ language, baseline, scenarioDocs, docs, claims, documentRecords, events, evidences }) {
  const zh = normalizeLanguage(language) === 'zh';
  return `
<h1 class="page-title">${escapeHtml(text(language, 'htmlIndex'))}</h1>
<p class="lede">${escapeHtml(zh ? '产品读者优先从产品总览、能力架构和最近变化开始；需要追溯工程证据时，再进入附录或账本视图。' : 'Product readers should start with the overview, capability architecture, and recent changes. Use the appendix or ledger views only when traceability is needed.')}</p>
<p><span class="chip">${escapeHtml(text(language, 'baseline'))}: ${escapeHtml(baseline.branch)}@${escapeHtml(baseline.commit)}</span></p>
<section>
  <h2>${escapeHtml(zh ? '按场景进入' : 'Start By Scenario')}</h2>
  <div class="doc-grid">${viewCards(scenarioDocs)}</div>
</section>
<section>
  <h2>${escapeHtml(zh ? '产品文档' : 'Product Documents')}</h2>
  <div class="doc-grid">${productCards(docs)}</div>
</section>
<section>
  <h2>${escapeHtml(zh ? '工程账本视图' : 'Engineering Ledger Views')}</h2>
  ${engineeringRows({ claims, docs: documentRecords, events, evidences, language })}
</section>`;
}

function projectViewBody({ language, baseline, docs, claims, documentRecords, events, evidences }) {
  const zh = normalizeLanguage(language) === 'zh';
  const overview = docByKey(docs, 'PRODUCT_OVERVIEW');
  const architecture = docByKey(docs, 'PRODUCT_ARCHITECTURE');
  const index = docByKey(docs, 'PRODUCT_DOCS_INDEX');
  const inventory = docByKey(docs, 'DOCS_INVENTORY');
  const gaps = docByKey(docs, 'DOCUMENTATION_GAPS');
  return `
<h1 class="page-title">${escapeHtml(zh ? '完整项目视图' : 'Complete Project View')}</h1>
<p class="lede">${escapeHtml(zh ? '这个页面把产品主线、架构、文档覆盖和工程账本放在一个入口里，用于快速建立完整项目上下文。' : 'This page combines product storyline, architecture, documentation coverage, and ledger views into one project-level entry point.')}</p>
<p><span class="chip">${escapeHtml(text(language, 'baseline'))}: ${escapeHtml(baseline.branch)}@${escapeHtml(baseline.commit)}</span></p>
${metricGrid([
    { label: zh ? '当前文档记录' : 'Document Records', value: String(documentRecords.length) },
    { label: zh ? '当前结论' : 'Claims', value: String(claims.length) },
    { label: zh ? '证据记录' : 'Evidence Records', value: String(evidences.length) },
    { label: zh ? '事件记录' : 'Events', value: String(events.length) }
  ])}
<div class="view-stack">
  ${linkedDocPanel(overview, zh ? '先看项目现在是什么、面向谁、能做什么、风险在哪里。' : 'Start with current state, audience, capabilities, and risks.')}
  ${linkedDocPanel(architecture, zh ? '再看产品能力如何分层，以及入口、执行、数据、集成之间的关系。' : 'Then inspect capability layers and relationships between entry, execution, data, and integrations.')}
  ${linkedDocPanel(index, zh ? '需要回到全部文档入口时，从这里按能力域继续展开。' : 'Use this index to expand into all documentation by capability domain.')}
</div>
<section>
  <h2>${escapeHtml(zh ? '文档覆盖和工程视图' : 'Coverage And Engineering Views')}</h2>
  <div class="view-stack">
    ${linkedDocPanel(inventory, zh ? '查看完整文档清单、当前状态和推荐阅读标记。' : 'Inspect the full document inventory, status, and recommended reading flags.')}
    ${linkedDocPanel(gaps, zh ? '查看标准文档覆盖和仍需补齐的区域。' : 'Inspect standard documentation coverage and remaining gaps.')}
  </div>
  ${engineeringRows({ claims, docs: documentRecords, events, evidences, language })}
</section>`;
}

function changesViewBody({ language, docs, events, evidences }) {
  const zh = normalizeLanguage(language) === 'zh';
  const changes = docByKey(docs, 'PRODUCT_RECENT_CHANGES');
  const timeline = docByKey(docs, 'PROJECT_TIMELINE');
  const appendix = docByKey(docs, 'TECHNICAL_APPENDIX');
  const gaps = commitDocumentationGaps({ evidences, events, language });
  return `
<h1 class="page-title">${escapeHtml(zh ? '最近变化视图' : 'Recent Changes View')}</h1>
<p class="lede">${escapeHtml(zh ? '这个页面把最近变化、时间线和缺文档 commit 放在一起，适合产品、研发、测试和运营同步项目进展。' : 'This page combines recent changes, timeline, and commits that may be missing documentation for product, engineering, QA, and operations review.')}</p>
${metricGrid([
    { label: zh ? '最近事件' : 'Recent Events', value: String(events.length) },
    { label: zh ? '可能缺文档 commit' : 'Possible Missing-Doc Commits', value: String(gaps.length) },
    { label: zh ? '证据记录' : 'Evidence Records', value: String(evidences.length) }
  ])}
<div class="view-stack">
  ${linkedDocPanel(changes, zh ? '查看本周期变化、用户可感知影响和需要团队关注的事项。' : 'Review cycle changes, user-visible impact, and team follow-up items.')}
  ${linkedDocPanel(timeline, zh ? '按时间追溯 commit，并查看同一 commit 是否带了文档。' : 'Trace commits by time and see whether each commit included documentation.')}
  ${linkedDocPanel(appendix, zh ? '需要精确 evidence id、路径、commit 时再进入工程附录。' : 'Use the appendix when exact evidence IDs, paths, or commits are needed.')}
</div>
<section>
  <h2>${escapeHtml(zh ? '可能缺少文档的 commit' : 'Commits That May Need Documentation')}</h2>
  ${markdownToHtml(commitGapTableLines(gaps, language, 10).join('\n'))}
</section>`;
}

function anglesViewBody({ language, docs }) {
  const zh = normalizeLanguage(language) === 'zh';
  const angles = [
    ['PRODUCT_OVERVIEW', zh ? '产品视角' : 'Product Angle', zh ? '项目状态、用户、能力、风险和下一步。' : 'State, users, capabilities, risks, and next focus.'],
    ['PRODUCT_ARCHITECTURE', zh ? '架构视角' : 'Architecture Angle', zh ? '入口、核心能力、自动化、数据、安全和外部依赖。' : 'Entry, core capability, automation, data, security, and external dependencies.'],
    ['PRODUCT_RECENT_CHANGES', zh ? '变化视角' : 'Change Angle', zh ? '最近做了什么，影响谁，哪些事项需要说明。' : 'What changed recently, who is affected, and what needs communication.'],
    ['PROJECT_TIMELINE', zh ? '历史追溯' : 'History Trace', zh ? '什么时间做了什么，哪些 commit 可能缺文档。' : 'What happened when, and which commits may be missing docs.'],
    ['DOCUMENTATION_GAPS', zh ? '规范覆盖' : 'Standard Coverage', zh ? '标准文档覆盖、缺失项和补齐建议。' : 'Standard documentation coverage and fill recommendations.'],
    ['DRIFT_REPORT', zh ? '风险/漂移' : 'Risk / Drift', zh ? '过时、冲突、漂移和灰区风险。' : 'Stale, conflict, drift, and gray-area risk.'],
    ['TECHNICAL_APPENDIX', zh ? '工程证据' : 'Engineering Evidence', zh ? 'claim、evidence、路径、commit 和 tombstone。' : 'Claims, evidence, paths, commits, and tombstones.'],
    ['AGENT_HANDOFF', zh ? 'Agent 接手' : 'Agent Handoff', zh ? '给下一位 Agent 的上下文、风险和起点。' : 'Context, risk, and starting point for the next agent.']
  ];
  return `
<h1 class="page-title">${escapeHtml(zh ? '多角度浏览' : 'Explore By Angle')}</h1>
<p class="lede">${escapeHtml(zh ? '不同读者需要不同入口：产品看状态和变化，研发看证据和时间线，交接看 handoff，文档治理看覆盖和漂移。' : 'Different readers need different entry points: product reads state and changes, engineering reads evidence and timeline, handoff reads agent context, and documentation governance reads coverage and drift.')}</p>
<div class="view-stack">
${angles.map(([key, title, desc]) => {
    const doc = docByKey(docs, key);
    return `<div class="view-panel"><h3><a href="${escapeHtml(viewAnchor(doc.html))}">${escapeHtml(title)}</a></h3><p>${escapeHtml(desc)}</p><p><span class="chip">${escapeHtml(doc.title)}</span></p></div>`;
  }).join('\n')}
</div>`;
}

function wrapSection(id, subtitle, body, language) {
  const zh = normalizeLanguage(language) === 'zh';
  return `<section class="view" id="view-${escapeHtml(id)}"><div class="wrap"><div class="kicker">${escapeHtml(subtitle || (zh ? '自动生成' : 'Generated'))}</div>
${String(body || '').trimStart()}</div></section>`;
}

async function markdownDocBody(root, doc, language) {
  const markdown = await readTextIfExists(join(root, doc.path));
  return markdown
    ? `<article class="doc">${markdownToHtml(markdown)}</article>`
    : `<article class="doc"><h1>${escapeHtml(doc.title)}</h1><p>${escapeHtml(text(language, 'noEvidence'))}</p></article>`;
}

export async function renderHtmlViews(root, options = {}) {
  const config = await loadConfig(root);
  const language = options.language || config.output.language;
  const ledger = splitLedger(await readLedger(root));
  const baseline = await gitInfo(root);
  const htmlDir = config.outputs.html_dir;
  const claims = latestById(ledger.claims).sort((a, b) => a.subject.localeCompare(b.subject));
  const documentRecords = latestById(ledger.documents).sort((a, b) => a.path.localeCompare(b.path));
  const allEvents = [...ledger.events].sort((a, b) => b.ts.localeCompare(a.ts));
  const events = allEvents.slice(0, 100);
  const evidences = [...ledger.evidences].sort((a, b) => a.id.localeCompare(b.id));
  const docs = markdownOutputDocs(config, language);
  const scenarioDocs = scenarioViewDocs(language);
  const navDocs = [...scenarioDocs, ...docs];
  const zh = normalizeLanguage(language) === 'zh';

  // Single-file portal: every view is an in-page <section id="view-…">. All navigation is
  // #anchor + CSS :target, so the portal opens and switches views with zero cross-file
  // navigation (IDE preview panes, file:// double-click, or a single shared HTML).
  const sections = [
    wrapSection('index', zh ? '把工程审计翻译成产品简报' : 'Product-facing documentation',
      indexBody({ language, baseline, scenarioDocs, docs, claims, documentRecords, events: allEvents, evidences }), language),
    wrapSection('project', zh ? '完整项目' : 'Complete Project',
      projectViewBody({ language, baseline, docs, claims, documentRecords, events: allEvents, evidences }), language),
    wrapSection('changes', zh ? '最近变化' : 'Recent Changes',
      changesViewBody({ language, docs, events: allEvents, evidences }), language),
    wrapSection('angles', zh ? '多角度浏览' : 'Explore By Angle',
      anglesViewBody({ language, docs }), language)
  ];
  for (const doc of docs) {
    sections.push(wrapSection(doc.html.replace(/\.html$/i, ''), doc.tier, await markdownDocBody(root, doc, language), language));
  }

  const files = [];
  files.push(await writeHtml(root, `${htmlDir}/index.html`, layout({
    title: text(language, 'htmlIndex'),
    body: sections.join('\n'),
    language,
    navDocs
  })));

  // Remove the previous per-view files so stale pages cannot 404 from in-page anchors.
  const obsolete = ['project.html', 'changes.html', 'angles.html', 'current.html', 'timeline.html', 'evidence.html', ...docs.map((doc) => doc.html)];
  for (const name of obsolete) files.push(await removeHtmlIfExists(root, `${htmlDir}/${name}`));
  return { files };
}

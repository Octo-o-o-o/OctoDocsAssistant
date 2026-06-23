import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

function nodeText(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(nodeText).join('');
  return '';
}

function walk(node, visitor) {
  visitor(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visitor);
  }
}

const FILE_LIKE_EXTENSIONS = new Set([
  'md', 'markdown', 'html', 'json', 'yml', 'yaml', 'toml', 'env',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'cs',
  'cpp', 'c', 'h', 'sql', 'sh', 'bash', 'zsh', 'png', 'jpg',
  'jpeg', 'gif', 'svg', 'webp', 'pdf', 'zip', 'gz'
]);

function splitInvalidFrontmatter(content) {
  const text = String(content || '');
  if (!text.startsWith('---')) return { data: {}, body: text, error: null };
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { data: {}, body: text, error: null };
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIndex === -1) return { data: {}, body: text, error: null };
  return {
    data: {},
    body: lines.slice(endIndex + 1).join('\n'),
    error: null
  };
}

function parseMatterSafely(content) {
  try {
    const parsed = matter(content);
    return { data: parsed.data || {}, body: parsed.content, error: null };
  } catch (error) {
    const fallback = splitInvalidFrontmatter(content);
    return {
      data: fallback.data,
      body: fallback.body,
      error: String(error?.message || 'Invalid frontmatter').replace(/\s+/g, ' ').trim()
    };
  }
}

export function shouldTreatInlineCodeAsSymbol(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z_$][\w$.:#/-]{1,120}$/.test(token)) return false;
  if (token.includes('/')) return false;
  if (token.startsWith('--')) return false;
  const extension = token.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (extension && FILE_LIKE_EXTENSIONS.has(extension)) return false;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(token)) return false;
  if (/^[a-z]+$/.test(token)) return false;
  if (/^[A-Z0-9_]+$/.test(token)) return false;
  return /[A-Z]/.test(token) || /[.:#]/.test(token);
}

export function parseMarkdownContent(content, path) {
  const parsed = parseMatterSafely(content);
  const tree = unified().use(remarkParse).parse(parsed.body);
  const headings = [];
  const links = [];
  const code_blocks = [];
  const code_symbols = new Set();

  walk(tree, (node) => {
    if (node.type === 'heading') {
      headings.push({ depth: node.depth, text: nodeText(node) });
    }
    if (node.type === 'link') {
      links.push({ url: node.url, text: nodeText(node) });
    }
    if (node.type === 'code') {
      code_blocks.push({ lang: node.lang || '', value: node.value || '' });
    }
    if (node.type === 'inlineCode') {
      const value = String(node.value || '').trim();
      if (shouldTreatInlineCodeAsSymbol(value)) code_symbols.add(value);
    }
  });

  const title = headings[0]?.text || parsed.data?.title || path.split('/').pop();
  const excerpt = parsed.body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

  return {
    path,
    kind: 'markdown',
    frontmatter: parsed.data || {},
    frontmatter_error: parsed.error || undefined,
    title,
    headings,
    links,
    code_blocks,
    code_symbols: Array.from(code_symbols).sort(),
    excerpt,
    content
  };
}

export async function scanMarkdownFile(root, path) {
  const content = await readFile(join(root, path), 'utf8');
  return parseMarkdownContent(content, path);
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

export function parseHtmlContent(content, path) {
  const $ = cheerio.load(content, { scriptingEnabled: false });
  $('script, style, noscript').remove();
  const title = ($('title').first().text() || $('h1').first().text() || path.split('/').pop()).trim();
  const headings = [];
  $('h1,h2,h3,h4,h5,h6').each((_, element) => {
    headings.push({
      depth: Number(element.tagName.slice(1)),
      text: $(element).text().replace(/\s+/g, ' ').trim()
    });
  });
  const links = [];
  $('a[href]').each((_, element) => {
    links.push({
      url: $(element).attr('href'),
      text: $(element).text().replace(/\s+/g, ' ').trim()
    });
  });
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const html_kind = path.includes('/prototype') || path.includes('/demo') || /prototype|demo|mock/i.test(title)
    ? 'prototype'
    : 'artifact';
  return {
    path,
    kind: 'html',
    html_kind,
    title,
    headings,
    links,
    excerpt: bodyText.slice(0, 240),
    content
  };
}

export async function scanHtmlFile(root, path) {
  const content = await readFile(join(root, path), 'utf8');
  return parseHtmlContent(content, path);
}

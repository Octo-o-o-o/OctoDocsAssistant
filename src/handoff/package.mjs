import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from '../config/config.mjs';
import { normalizePath } from '../ledger/model.mjs';
import { ensureParent, readTextIfExists, toPosixPath, writeText } from '../utils/fs.mjs';

const execFileAsync = promisify(execFile);

const DOC_EXTENSIONS = ['.md', '.html'];
const SOURCE_SNAPSHOT_DIR = '_source_docs';
const EXCLUDED_NAMES = new Set(['.DS_Store']);
const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules', '.pytest_cache']);
const MANAGED_HASH_RE = /<!-- octodocs:managed file id="([^"]+)" hash="([a-f0-9]+)" -->\s*$/;

function isInsideOrSame(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveOutputPath(root, value) {
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function entryStat(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function hasExcludedSegment(path) {
  return normalizePath(path).split('/').some((part) => EXCLUDED_SEGMENTS.has(part));
}

function shouldCopyPath(path) {
  const normalized = normalizePath(path);
  if (EXCLUDED_NAMES.has(basename(normalized))) return false;
  return !hasExcludedSegment(normalized);
}

async function assertOutputReady(outDir, { force }) {
  if (!(await pathExists(outDir))) return;
  if (force) {
    await rm(outDir, { recursive: true, force: true });
    return;
  }
  const entries = await readdir(outDir);
  if (entries.length) {
    const error = new Error(`Handoff output already exists and is not empty: ${outDir}`);
    error.code = 'HANDOFF_OUTPUT_EXISTS';
    throw error;
  }
}

async function walkFiles(root, { extensions = null, includeAllFiles = false } = {}) {
  const files = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const rel = normalizePath(relative(root, absolute));
      if (!shouldCopyPath(rel)) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (includeAllFiles || !extensions || extensions.some((ext) => rel.toLowerCase().endsWith(ext))) files.push(absolute);
    }
  }
  if (await pathExists(root)) await visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

async function copyTree(sourceDir, targetDir) {
  const files = await walkFiles(sourceDir, { includeAllFiles: true });
  for (const sourceFile of files) {
    const rel = normalizePath(relative(sourceDir, sourceFile));
    const targetFile = join(targetDir, rel);
    await ensureParent(targetFile);
    await copyFile(sourceFile, targetFile);
  }
  return files.length;
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function splitTarget(rawTarget) {
  let raw = htmlDecode(String(rawTarget || '').trim());
  if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);
  const hashIndex = raw.indexOf('#');
  return {
    raw,
    path: hashIndex >= 0 ? raw.slice(0, hashIndex) : raw,
    hash: hashIndex >= 0 ? raw.slice(hashIndex) : ''
  };
}

function isSkippableLink(rawTarget) {
  const raw = htmlDecode(String(rawTarget || '').trim());
  return !raw || /^(https?:|mailto:|tel:|data:|javascript:|#|app:\/\/)/i.test(raw);
}

function markdownLinkRegex() {
  return /\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g;
}

function htmlLinkRegex() {
  return /\b(href|src)=(['"])(.*?)\2/g;
}

function relativePackageTarget(fromFile, targetAbs, hash = '') {
  let rel = toPosixPath(relative(dirname(fromFile), targetAbs));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return `${rel}${hash}`;
}

async function rewritePackageLinks({ packageFile, originalFile, root, docsDir, outDir, sourceTargets }) {
  const text = await readTextIfExists(packageFile);
  if (text == null) return false;
  const replaceTarget = (rawTarget) => {
    if (isSkippableLink(rawTarget)) return null;
    const parsed = splitTarget(rawTarget);
    if (!parsed.path) return null;
    const originalTarget = resolve(dirname(originalFile), parsed.path);
    if (isInsideOrSame(docsDir, originalTarget)) {
      const relInDocs = normalizePath(relative(docsDir, originalTarget));
      return relativePackageTarget(packageFile, join(outDir, relInDocs), parsed.hash);
    }
    if (isInsideOrSame(root, originalTarget)) {
      const relInRepo = normalizePath(relative(root, originalTarget));
      if (!shouldCopyPath(relInRepo)) return null;
      sourceTargets.set(originalTarget, relInRepo);
      return relativePackageTarget(packageFile, join(outDir, SOURCE_SNAPSHOT_DIR, relInRepo), parsed.hash);
    }
    return null;
  };
  let changed = false;
  let next = text;
  if (packageFile.toLowerCase().endsWith('.md')) {
    next = next.replace(markdownLinkRegex(), (match, label, rawTarget) => {
      const replacement = replaceTarget(rawTarget);
      if (!replacement) return match;
      changed = true;
      return `[${label}](<${replacement}>)`;
    });
  } else if (packageFile.toLowerCase().endsWith('.html')) {
    next = next.replace(htmlLinkRegex(), (match, attr, quote, rawTarget) => {
      const replacement = replaceTarget(rawTarget);
      if (!replacement) return match;
      changed = true;
      return `${attr}=${quote}${replacement}${quote}`;
    });
  }
  if (changed) await writeFile(packageFile, next, 'utf8');
  return changed;
}

async function copySourceSnapshot(root, outDir, sourceTargets) {
  let copied = 0;
  for (const [sourceAbs, relInRepo] of sourceTargets.entries()) {
    const sourceStat = await entryStat(sourceAbs);
    if (!sourceStat) continue;
    const target = join(outDir, SOURCE_SNAPSHOT_DIR, relInRepo);
    if (sourceStat.isDirectory()) {
      const sourceFiles = await walkFiles(sourceAbs, { extensions: DOC_EXTENSIONS });
      for (const sourceFile of sourceFiles) {
        const rel = normalizePath(relative(root, sourceFile));
        if (!shouldCopyPath(rel)) continue;
        const targetFile = join(outDir, SOURCE_SNAPSHOT_DIR, rel);
        await ensureParent(targetFile);
        await copyFile(sourceFile, targetFile);
        copied += 1;
      }
      continue;
    }
    if (!sourceStat.isFile()) continue;
    await ensureParent(target);
    await copyFile(sourceAbs, target);
    copied += 1;
  }
  return copied;
}

async function sanitizeSourceMarkdown(outDir) {
  const sourceRoot = join(outDir, SOURCE_SNAPSHOT_DIR);
  const files = await walkFiles(sourceRoot, { extensions: ['.md'] });
  let changedFiles = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    let changed = false;
    const next = text.replace(markdownLinkRegex(), (match, label, rawTarget) => {
      if (isSkippableLink(rawTarget)) return match;
      const parsed = splitTarget(rawTarget);
      if (!parsed.path) return match;
      const target = resolve(dirname(file), parsed.path);
      if (isInsideOrSame(outDir, target) && shouldCopyPath(relative(outDir, target)) && existsSync(target)) {
        return match;
      }
      changed = true;
      const cleanLabel = String(label || parsed.raw).replaceAll('|', '/').trim() || parsed.raw;
      return `${cleanLabel} (not included in handoff package: \`${parsed.raw}\`)`;
    });
    if (changed) {
      await writeFile(file, next, 'utf8');
      changedFiles += 1;
    }
  }
  return changedFiles;
}

async function refreshManagedHashes(outDir) {
  const { createHash } = await import('node:crypto');
  const files = await walkFiles(outDir, { extensions: ['.md'] });
  let checked = 0;
  let refreshed = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const match = text.match(MANAGED_HASH_RE);
    if (!match) continue;
    checked += 1;
    const content = text.slice(0, match.index);
    const hash = createHash('sha256').update(content).digest('hex');
    if (hash === match[2]) continue;
    await writeFile(file, `${content}<!-- octodocs:managed file id="${match[1]}" hash="${hash}" -->\n`, 'utf8');
    refreshed += 1;
  }
  return { checked, refreshed };
}

async function renderHandoffGuide(outDir, { projectName }) {
  const candidates = [
    ['PROJECT_BRIEF.md', '一页项目简介，适合快速判断项目是什么。'],
    ['PRODUCT_OVERVIEW.md', '产品定位、用户、能力、状态、风险和下一步。'],
    ['PRODUCT_ARCHITECTURE.md', '入口、核心模块、执行、数据、安全和外部集成关系。'],
    ['PROJECT_CURRENT.md', '当前可确认状态、能力地图和不确定项。'],
    ['AGENT_HANDOFF.md', '给后续 agent 或工程接手人的行动入口。'],
    ['TECHNICAL_APPENDIX.md', '证据、路径、commit、claim 和 ledger 摘要。'],
    ['DOCS_INVENTORY.md', '完整文档清单和推荐阅读标记。']
  ];
  const existing = [];
  for (const [file, desc] of candidates) {
    if (await pathExists(join(outDir, file))) existing.push([file, desc]);
  }
  const lines = [
    `# ${projectName} 交接阅读指南`,
    '',
    '这个目录是 OctoDocs 生成的独立交接包。主文档中的源仓库引用已经改写到包内 `_source_docs/` 快照，因此接手人不需要保留原始仓库路径也可以打开主要引用。',
    '',
    '## 怎么读',
    '',
    '1. 先读本文件，确认交接范围和阅读顺序。',
    '2. 再按下面的项目文档顺序阅读。',
    '3. 如果只想浏览汇总视图，可以打开 `html/index.html`。',
    '',
    '## 推荐顺序',
    '',
    ...existing.map(([file, desc]) => `- [${file}](./${file})：${desc}`),
    '',
    '## 独立使用边界',
    '',
    '- `_source_docs/` 只收录主文档直接引用的源 Markdown/HTML 快照，不是完整源码仓库。',
    '- 交接阅读、背景理解、任务分流和后续排期可以依赖本目录。',
    '- 真正继续开发、部署、运行测试或修改代码时，仍应回到对应原始仓库确认最新代码、环境变量、密钥和运行状态。',
    '- 源文档内部若引用未收录文件，会被转成路径提示，避免离线交接包出现误导性断链。',
    ''
  ];
  await writeText(join(outDir, 'HANDOFF_GUIDE.md'), lines.join('\n'));
}

async function renderPackageReadme(outDir, { projectName }) {
  const htmlExists = await pathExists(join(outDir, 'html', 'index.html'));
  const lines = [
    `# ${projectName} OctoDocs Handoff Package`,
    '',
    '这是可以独立发送给工作交接人的 OctoDocs 文档包。',
    '',
    '## 入口',
    '',
    '- [HANDOFF_GUIDE.md](./HANDOFF_GUIDE.md)：交接阅读顺序和独立使用边界。',
    ...(htmlExists ? ['- [html/index.html](./html/index.html)：浏览器汇总视图。'] : []),
    '- [_source_docs/README.md](./_source_docs/README.md)：源文档快照范围说明。',
    '',
    '## 注意',
    '',
    '`_source_docs/` 是被主文档引用到的源文档快照，不是完整源码仓库；开发、部署和测试仍需回到真实仓库确认。',
    ''
  ];
  await writeText(join(outDir, 'README.md'), lines.join('\n'));
}

async function renderSourceDocsReadme(outDir) {
  const lines = [
    '# Source Document Snapshots',
    '',
    'These files are source-document snapshots directly referenced by the handoff package.',
    '',
    '- This directory is not a full source repository.',
    '- It exists so package-local links remain readable after the handoff package is moved or zipped.',
    '- Missing nested source links are converted to inline path notes instead of broken links.',
    ''
  ];
  await writeText(join(outDir, SOURCE_SNAPSHOT_DIR, 'README.md'), lines.join('\n'));
}

function localLinkRecords(file, text, packageRoot) {
  const records = [];
  const collect = (rawTarget) => {
    if (isSkippableLink(rawTarget)) return;
    const parsed = splitTarget(rawTarget);
    if (!parsed.path) return;
    const target = resolve(dirname(file), parsed.path);
    records.push({
      file: normalizePath(relative(packageRoot, file)),
      raw: parsed.raw,
      target
    });
  };
  if (file.toLowerCase().endsWith('.md')) {
    let match;
    const regex = markdownLinkRegex();
    while ((match = regex.exec(text))) collect(match[2]);
  } else if (file.toLowerCase().endsWith('.html')) {
    let match;
    const regex = htmlLinkRegex();
    while ((match = regex.exec(text))) collect(match[3]);
  }
  return records;
}

async function managedHashStats(files) {
  const { createHash } = await import('node:crypto');
  let checked = 0;
  const bad = [];
  for (const file of files.filter((item) => item.endsWith('.md'))) {
    const text = await readFile(file, 'utf8');
    const match = text.match(MANAGED_HASH_RE);
    if (!match) continue;
    checked += 1;
    const hash = createHash('sha256').update(text.slice(0, match.index)).digest('hex');
    if (hash !== match[2]) bad.push(file);
  }
  return { checked, bad };
}

export async function verifyHandoffPackage(packageRoot) {
  const files = await walkFiles(packageRoot, { extensions: DOC_EXTENSIONS });
  const mainFiles = files.filter((file) => !normalizePath(relative(packageRoot, file)).startsWith(`${SOURCE_SNAPSHOT_DIR}/`));
  async function check(scopeFiles) {
    const outside = [];
    const missing = [];
    for (const file of scopeFiles) {
      const text = await readFile(file, 'utf8');
      for (const record of localLinkRecords(file, text, packageRoot)) {
        if (!isInsideOrSame(packageRoot, record.target)) {
          outside.push({ ...record, target: record.target });
          continue;
        }
        if (!(await pathExists(record.target))) missing.push({ ...record, target: normalizePath(relative(packageRoot, record.target)) });
      }
    }
    return {
      files: scopeFiles.length,
      markdown_files: scopeFiles.filter((file) => file.endsWith('.md')).length,
      html_files: scopeFiles.filter((file) => file.endsWith('.html')).length,
      outside_local_paths: outside.length,
      broken_local_links: missing.length,
      outside_sample: outside.slice(0, 10).map((item) => ({ file: item.file, raw: item.raw })),
      missing_sample: missing.slice(0, 10).map((item) => ({ file: item.file, raw: item.raw, target: item.target }))
    };
  }
  const allEntries = await walkFiles(packageRoot, { includeAllFiles: true });
  const unwanted = allEntries
    .map((file) => normalizePath(relative(packageRoot, file)))
    .filter((file) => EXCLUDED_NAMES.has(basename(file)) || hasExcludedSegment(file));
  const hashes = await managedHashStats(files);
  const main = await check(mainFiles);
  const all = await check(files);
  return {
    ready: main.outside_local_paths === 0
      && main.broken_local_links === 0
      && all.outside_local_paths === 0
      && all.broken_local_links === 0
      && hashes.bad.length === 0
      && unwanted.length === 0,
    main,
    all,
    managed_hashes: {
      checked: hashes.checked,
      bad_hashes: hashes.bad.length,
      bad_sample: hashes.bad.slice(0, 10).map((file) => normalizePath(relative(packageRoot, file)))
    },
    unwanted_entries: {
      count: unwanted.length,
      sample: unwanted.slice(0, 10)
    }
  };
}

async function zipPackage(root, outDir, zipPath) {
  const zipAbs = resolveOutputPath(root, zipPath);
  await rm(zipAbs, { force: true });
  try {
    await execFileAsync('zip', ['-qr', zipAbs, basename(outDir)], { cwd: dirname(outDir) });
  } catch (error) {
    if (error.code === 'ENOENT') {
      const wrapped = new Error(
        `The \`zip\` executable was not found; the handoff directory was still created at ${outDir}. Install zip or send the directory instead.`
      );
      wrapped.code = 'HANDOFF_ZIP_UNAVAILABLE';
      throw wrapped;
    }
    throw error;
  }
  return zipAbs;
}

export async function packageHandoff(root, {
  outDir = 'octodocs-handoff',
  zipPath = null,
  force = false,
  projectName = basename(root)
} = {}) {
  const config = await loadConfig(root);
  const docsDir = resolve(root, config.output.docs_dir || 'docs/octodocs');
  if (!(await pathExists(docsDir))) {
    const error = new Error(`OctoDocs output directory does not exist: ${docsDir}`);
    error.code = 'HANDOFF_DOCS_DIR_MISSING';
    throw error;
  }
  const outAbs = resolveOutputPath(root, outDir);
  if (isInsideOrSame(docsDir, outAbs)) {
    const error = new Error('Handoff output must not be inside the generated docs directory.');
    error.code = 'HANDOFF_OUTPUT_INSIDE_DOCS';
    throw error;
  }
  await assertOutputReady(outAbs, { force });
  await mkdir(outAbs, { recursive: true });
  const copiedPackageFiles = await copyTree(docsDir, outAbs);
  const sourceTargets = new Map();
  const packageDocs = await walkFiles(outAbs, { extensions: DOC_EXTENSIONS });
  let rewrittenFiles = 0;
  for (const packageFile of packageDocs) {
    const rel = normalizePath(relative(outAbs, packageFile));
    if (rel.startsWith(`${SOURCE_SNAPSHOT_DIR}/`)) continue;
    const originalFile = join(docsDir, rel);
    if (await rewritePackageLinks({ packageFile, originalFile, root, docsDir, outDir: outAbs, sourceTargets })) rewrittenFiles += 1;
  }
  const copiedSourceFiles = await copySourceSnapshot(root, outAbs, sourceTargets);
  await renderSourceDocsReadme(outAbs);
  const sanitizedSourceFiles = await sanitizeSourceMarkdown(outAbs);
  await renderHandoffGuide(outAbs, { projectName });
  await renderPackageReadme(outAbs, { projectName });
  const refreshedHashes = await refreshManagedHashes(outAbs);
  const verification = await verifyHandoffPackage(outAbs);
  const audit = {
    generated_at: new Date().toISOString(),
    project: projectName,
    package_root: outAbs,
    source_docs_dir: SOURCE_SNAPSHOT_DIR,
    copied_package_files: copiedPackageFiles,
    rewritten_main_files: rewrittenFiles,
    source_targets: sourceTargets.size,
    copied_source_files: copiedSourceFiles,
    sanitized_source_files: sanitizedSourceFiles,
    managed_hashes_refreshed: refreshedHashes,
    verification
  };
  await writeText(join(outAbs, '_HANDOFF_AUDIT.json'), `${JSON.stringify(audit, null, 2)}\n`);
  const finalVerification = await verifyHandoffPackage(outAbs);
  audit.verification = finalVerification;
  await writeText(join(outAbs, '_HANDOFF_AUDIT.json'), `${JSON.stringify(audit, null, 2)}\n`);
  const zipAbs = zipPath ? await zipPackage(root, outAbs, zipPath) : null;
  return {
    out_dir: outAbs,
    zip_path: zipAbs,
    copied_package_files: copiedPackageFiles,
    rewritten_main_files: rewrittenFiles,
    source_targets: sourceTargets.size,
    copied_source_files: copiedSourceFiles,
    sanitized_source_files: sanitizedSourceFiles,
    verification: finalVerification
  };
}

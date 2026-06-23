import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ensureLedger } from '../ledger/store.mjs';
import { readTextIfExists, writeText } from '../utils/fs.mjs';
import { parseSimpleYaml, stringifySimpleYaml } from './simple-yaml.mjs';

const execFileAsync = promisify(execFile);

export const ConfigSchema = z.object({
  schema_version: z.literal(1),
  watch: z.object({
    include: z.array(z.string()).default(['**/*.md', '**/*.html']),
    exclude: z.array(z.string()).default([])
  }),
  output: z.object({
    language: z.enum(['zh', 'en', 'bi']).default('zh'),
    docs_dir: z.string().default('docs/octodocs')
  }),
  llm: z.object({
    mode: z.literal('host-agent').default('host-agent'),
    background: z.enum(['enqueue-only', 'host-cli', 'local', 'api']).default('enqueue-only'),
    host_cli: z.object({
      enabled: z.boolean().default(false),
      command: z.string().default('claude -p'),
      timeout_s: z.number().int().positive().default(60),
      max_tokens: z.number().int().positive().default(4000),
      dry_run: z.boolean().default(false)
    }).default({})
  }),
  update_policy: z.object({
    auto_update_timeline: z.boolean().default(true),
    auto_update_current_when_confidence_above: z.number().min(0).max(1).default(0.85),
    require_review_for_status_changes: z.array(z.enum(['verified', 'released', 'superseded', 'removed', 'deprecated'])).default(['verified', 'released', 'superseded', 'removed']),
    never_auto_delete_docs: z.boolean().default(true),
    max_auto_patch_lines: z.number().int().positive().default(120)
  }),
  verification: z.object({
    allowlist: z.array(z.string()).default([])
  }),
  outputs: z.object({
    current: z.string().default('docs/octodocs/PROJECT_CURRENT.md'),
    timeline: z.string().default('docs/octodocs/PROJECT_TIMELINE.md'),
    inventory: z.string().default('docs/octodocs/DOCS_INVENTORY.md'),
    gaps: z.string().default('docs/octodocs/DOCUMENTATION_GAPS.md'),
    handoff: z.string().default('docs/octodocs/AGENT_HANDOFF.md'),
    drift: z.string().default('docs/octodocs/DRIFT_REPORT.md'),
    product_index: z.string().default('docs/octodocs/PRODUCT_DOCS_INDEX.md'),
    product_overview: z.string().default('docs/octodocs/PRODUCT_OVERVIEW.md'),
    product_architecture: z.string().default('docs/octodocs/PRODUCT_ARCHITECTURE.md'),
    product_recent_changes: z.string().default('docs/octodocs/PRODUCT_RECENT_CHANGES.md'),
    technical_appendix: z.string().default('docs/octodocs/TECHNICAL_APPENDIX.md'),
    html_dir: z.string().default('docs/octodocs/html')
  })
});

export function defaultConfig() {
  return {
    schema_version: 1,
    watch: {
      include: ['**/*.md', '**/*.html'],
      exclude: [
        'node_modules/**',
        '**/node_modules/**',
        'dist/**',
        '**/dist/**',
        'build/**',
        '**/build/**',
        '.next/**',
        '**/.next/**',
        '**/.next-e2e/**',
        '**/.test-dist/**',
        '**/.turbo/**',
        '**/.cache/**',
        '**/.vite/**',
        '.design-sync/**',
        '**/.design-sync/**',
        '.staging/**',
        '**/.staging/**',
        '.workflow/**',
        '**/.workflow/**',
        'vendor/**',
        '**/vendor/**',
        'oh_modules/**',
        '**/oh_modules/**',
        'dist-mobile/**',
        '**/dist-mobile/**',
        '.gradle/**',
        '**/.gradle/**',
        'Pods/**',
        '**/Pods/**',
        '.yarn/**',
        '**/.yarn/**',
        '.pnpm-store/**',
        '**/.pnpm-store/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/storybook-static/**',
        'coverage/**',
        '**/coverage/**',
        'out/**',
        '**/out/**',
        'release/**',
        'release-asar/**',
        'release-local/**',
        'artifacts/**',
        '**/browser-walkthrough-reports/**',
        '**/github-issue-drafts*/**',
        'tmp/**',
        'temp/**',
        '.git/**',
        '.claude/**',
        '.codex/**',
        '.sisyphus/**',
        '**/.sisyphus/**',
        '.omo/**',
        '**/.omo/**',
        'docs/octodocs/**'
      ]
    },
    output: {
      language: 'zh',
      docs_dir: 'docs/octodocs'
    },
    llm: {
      mode: 'host-agent',
      background: 'enqueue-only',
      host_cli: {
        enabled: false,
        command: 'claude -p',
        timeout_s: 60,
        max_tokens: 4000,
        dry_run: false
      }
    },
    update_policy: {
      auto_update_timeline: true,
      auto_update_current_when_confidence_above: 0.85,
      require_review_for_status_changes: ['verified', 'released', 'superseded', 'removed'],
      never_auto_delete_docs: true,
      max_auto_patch_lines: 120
    },
    verification: {
      allowlist: []
    },
    outputs: {
      current: 'docs/octodocs/PROJECT_CURRENT.md',
      timeline: 'docs/octodocs/PROJECT_TIMELINE.md',
      inventory: 'docs/octodocs/DOCS_INVENTORY.md',
      gaps: 'docs/octodocs/DOCUMENTATION_GAPS.md',
      handoff: 'docs/octodocs/AGENT_HANDOFF.md',
      drift: 'docs/octodocs/DRIFT_REPORT.md',
      product_index: 'docs/octodocs/PRODUCT_DOCS_INDEX.md',
      product_overview: 'docs/octodocs/PRODUCT_OVERVIEW.md',
      product_architecture: 'docs/octodocs/PRODUCT_ARCHITECTURE.md',
      product_recent_changes: 'docs/octodocs/PRODUCT_RECENT_CHANGES.md',
      technical_appendix: 'docs/octodocs/TECHNICAL_APPENDIX.md',
      html_dir: 'docs/octodocs/html'
    }
  };
}

export function configPath(root) {
  return join(root, '.octodocs', 'config.yml');
}

export async function loadConfig(root) {
  const text = await readTextIfExists(configPath(root));
  if (text == null) return ConfigSchema.parse(defaultConfig());
  try {
    return ConfigSchema.parse(parseSimpleYaml(text));
  } catch (error) {
    const message = error?.issues
      ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      : error.message;
    const wrapped = new Error(`Invalid .octodocs/config.yml. ${message}. Run \`octodocs init\` to restore missing defaults, then reapply intentional edits.`);
    wrapped.code = 'INVALID_CONFIG';
    throw wrapped;
  }
}

export async function isGitRepo(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function mergeGitignore(root) {
  const filePath = join(root, '.gitignore');
  const required = [
    'node_modules/',
    '.octodocs/cache.sqlite',
    '.octodocs/journal/',
    '.octodocs/review/',
    '.octodocs/corrections.yml'
  ];
  const header = '# OctoDocsAssistant (managed)';
  const existing = (await readTextIfExists(filePath)) || '';
  const present = new Set(existing.split('\n').map((line) => line.trim()).filter(Boolean));
  const missing = required.filter((entry) => !present.has(entry));
  if (!missing.length && existing) {
    return { changed: false, entries: required };
  }
  // Append only the missing rules under a managed header at the end of the
  // file. We never re-sort or rewrite existing lines, so the user's comments,
  // grouping, and ordering are preserved.
  const block = present.has(header) ? missing : [header, ...missing];
  const trimmed = existing.replace(/\n+$/, '');
  const parts = trimmed ? [trimmed, '', ...block] : block;
  await writeText(filePath, `${parts.join('\n')}\n`);
  return { changed: true, entries: required };
}

export async function initProject(root) {
  await mkdir(join(root, '.octodocs'), { recursive: true });
  await mkdir(join(root, 'docs', 'octodocs'), { recursive: true });
  const cfgPath = configPath(root);
  const existingConfig = await readTextIfExists(cfgPath);
  let configWritten = false;
  if (existingConfig == null) {
    await writeFile(cfgPath, `${stringifySimpleYaml(defaultConfig())}\n`, 'utf8');
    configWritten = true;
  } else {
    await loadConfig(root);
  }
  await ensureLedger(root);
  const gitignore = await mergeGitignore(root);
  const git = await isGitRepo(root);
  return {
    config_path: '.octodocs/config.yml',
    ledger_path: '.octodocs/ledger.accepted.jsonl',
    config_written: configWritten,
    gitignore,
    git_repo: git,
    warning: git ? null : 'This target is not a git repository; commit hooks are unavailable, but file scanning still works.'
  };
}

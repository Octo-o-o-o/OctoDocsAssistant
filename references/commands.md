# OctoDocsAssistant Commands

All command outputs use `{ ok, data, next_actions }`. Errors use `{ ok:false, error:{ code, message, instruction } }`.

## Setup

- `octodocs init`
- `octodocs install`
- `octodocs install --uninstall`

## Reconciliation

- `octodocs scan`
- `octodocs scan --dry-run`
- `octodocs scan --progress`
- `octodocs update --changed`
- `octodocs update --changed --dry-run`
- `octodocs update --changed --summary` (compact output for large reconciliations)
- `octodocs update --changed --progress`
- `octodocs rebuild --from-ledger`
- `octodocs render --language zh|en`
- `octodocs rebuild --from-ledger --language zh|en`
- `octodocs package-handoff --out octodocs-handoff`
- `octodocs package-handoff --out octodocs-handoff --zip --force`

`--progress` writes scan phase and file progress to stderr while keeping stdout as JSON.
`--language zh|en` controls product-facing and engineering-view labels; code names, file names, API names, and evidence ids are not translated.
`scan --dry-run` reports records that would be appended after ledger dedupe. Large accepted counts are usually code-symbol coverage; symbol evidence is capped per source document and aggregated by relation to avoid one record per matching file.

Generated product-facing docs:

- `docs/octodocs/PRODUCT_DOCS_INDEX.md`
- `docs/octodocs/PRODUCT_OVERVIEW.md`
- `docs/octodocs/PRODUCT_ARCHITECTURE.md`
- `docs/octodocs/PRODUCT_RECENT_CHANGES.md` including a concise table of recent commits that may be missing documentation
- `docs/octodocs/TECHNICAL_APPENDIX.md`

Engineering views are still generated as `PROJECT_CURRENT.md`, `PROJECT_TIMELINE.md`, `DOCS_INVENTORY.md`, `DRIFT_REPORT.md`, and `AGENT_HANDOFF.md`.
`PROJECT_TIMELINE.md` is the human-readable history trace: it groups recent commits by time, shows whether docs were included, and flags source/config/migration commits that did not update Markdown/HTML documentation in the same commit.
`DOCUMENTATION_GAPS.md` is generated as the standardization gap report for missing or partial source documentation.
Generated Markdown should start with the reader-facing title; machine metadata stays in hidden managed comments and technical appendices.

## Handoff Packaging

`octodocs package-handoff` builds a standalone handoff directory from generated `docs/octodocs` views. It copies the generated docs, rewrites local source-document links into package-local `_source_docs/` snapshots, sanitizes missing nested snapshot links into inline path notes, refreshes managed hashes after relocation, writes `HANDOFF_GUIDE.md`, and records verification in `_HANDOFF_AUDIT.json`.

Use this when generated docs need to be sent to another person without assuming they have the original repository path. The package is for reading and handoff; implementation verification still belongs in the real repository.

Options:

- `--out <dir>`: output directory, default `octodocs-handoff`.
- `--zip [path]`: also create a zip; if no path is supplied, uses `<out>.zip`.
- `--force`: remove an existing output directory before rebuilding it.
- `--project-name <name>`: override the display name in the generated handoff guide.

Generated HTML docs:

- `docs/octodocs/html/index.html` — Steel-themed browser entry point.
- `docs/octodocs/html/project.html` — full-project scenario view.
- `docs/octodocs/html/changes.html` — recent-change and missing-doc commit scenario view.
- `docs/octodocs/html/angles.html` — angle-based navigation across product, architecture, history, coverage, drift, evidence, and handoff views.
- One HTML page per generated Markdown view.

Supported Mermaid `flowchart` blocks are rendered as inline SVG in HTML. If a diagram cannot be parsed deterministically, the code block is preserved instead of rendering an empty diagram.

## Host-Agent Tasks

- `octodocs emit-tasks --out .octodocs/settlement.task.json`
- `octodocs apply --answers .octodocs/answers.json`

## Review

- `octodocs review`
- `octodocs review explain <id>`
- `octodocs review confirm <id>`
- `octodocs review reject <id> --reason <category>`
- `octodocs review ignore <id>`
- `octodocs review pin <id>`
- `octodocs review unpin <id>`

## Triggers

- `octodocs watch`
- `octodocs watch --once`
- `octodocs hook --source file_change --path <path>`
- `octodocs hook --source git_commit --commit <sha>`

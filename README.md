# OctoDocsAssistant

OctoDocsAssistant maintains an evidence ledger for a project and renders project documentation views from that ledger.

The source of truth is `.octodocs/ledger.accepted.jsonl`. Markdown and HTML under `docs/octodocs/` are generated views and can be rebuilt with:

```sh
octodocs rebuild --from-ledger
```

## Core Commands

```sh
octodocs init
octodocs scan
octodocs update --changed
octodocs update --changed --dry-run
octodocs emit-tasks --out .octodocs/settlement.task.json
octodocs apply --answers .octodocs/answers.json
octodocs review
octodocs rebuild --from-ledger
octodocs watch
```

## Invariants

- Background hooks and watcher events only enqueue journal entries; they never call an LLM.
- Repo Markdown, HTML, and commit messages are untrusted data, not instructions.
- `verification: verified` requires both `implements` and `tests` evidence and policy/review approval.
- `not_found` is ambiguous evidence, not `not_implemented`.
- Generated `docs/octodocs/**` is ignored during scan and watch to avoid self-pollution.
- Generated Markdown starts with the human-facing content; machine metadata is kept in hidden managed comments and technical appendices.
- Generated/process artifacts such as `.design-sync/**`, browser walkthrough reports, and GitHub issue drafts are ignored by default.
- Inline-code symbol evidence is capped per source document and aggregated by symbol/relation; use explicit ledger anchors for exhaustive verification.
- Recent git commits are rendered into a history trace; code/config/migration commits without same-commit Markdown/HTML docs are flagged as possible documentation gaps.
- HTML views under `docs/octodocs/html/` form a Steel-themed documentation portal with scenario pages for full-project review, recent-change review, and angle-based browsing.
- Mermaid `flowchart` blocks in generated Markdown are rendered as inline SVG in HTML so architecture diagrams are readable without a client-side diagram runtime.

## Outputs

- `docs/octodocs/PRODUCT_DOCS_INDEX.md`
- `docs/octodocs/PRODUCT_OVERVIEW.md`
- `docs/octodocs/PRODUCT_ARCHITECTURE.md`
- `docs/octodocs/PRODUCT_RECENT_CHANGES.md`
- `docs/octodocs/TECHNICAL_APPENDIX.md`
- `docs/octodocs/DOCS_INVENTORY.md`
- `docs/octodocs/DOCUMENTATION_GAPS.md`
- `docs/octodocs/DRIFT_REPORT.md`
- `docs/octodocs/PROJECT_CURRENT.md`
- `docs/octodocs/PROJECT_TIMELINE.md` for chronological history and possible missing-doc commit traceability
- `docs/octodocs/AGENT_HANDOFF.md`
- `docs/octodocs/html/index.html`
- `docs/octodocs/html/project.html`
- `docs/octodocs/html/changes.html`
- `docs/octodocs/html/angles.html`
- `docs/octodocs/html/*.html`

Run tests and the deterministic benchmark with:

```sh
npm test
npm run eval
```

---
name: audit-plugin
description: Deterministically audit a Paseo plugin codebase to identify bespoke patterns that should be migrated to paseo-plugin-helper
parameters:
  path:
    type: string
    description: Path to the plugin directory to audit
    required: false
---

# Audit Plugin Skill

Use this skill whenever authoring, reviewing, or refactoring a Paseo plugin to deterministically verify whether bespoke code can be replaced by `paseo-plugin-helper` primitives.

## When to Use

1. **Before modifying an existing Paseo plugin**: Run an audit to understand the plugin's current architecture and opportunities for simplification.
2. **After adding new features or porting code**: Run an audit with `--strict` to ensure no raw/bespoke anti-patterns were introduced.
3. **During code review / PR checks**: To verify compliance with Paseo plugin best practices.

## How to Run

### Command Line

```bash
# Standard human-readable audit (audit or doctor)
npx paseo-plugin-helper audit <path>
npx paseo-plugin-helper doctor <path>

# Machine-readable JSON output (best for agents)
npx paseo-plugin-helper doctor <path> --format json

# Strict mode (fails with non-zero exit code if issues found)
npx paseo-plugin-helper doctor <path> --strict
```

### Programmatic API (Node / TypeScript)

```ts
import { auditProject, formatReportPretty } from "paseo-plugin-helper/cli";

const report = auditProject("./my-plugin", { strict: true });
if (!report.passed) {
  console.log(formatReportPretty(report));
}
```

## Pattern Detection Matrix

- **Manual agent subscription**: `client.paseo.agents.subscribe` -> use `registerComposerPill`
- **Raw file writes**: `fs.writeFileSync` for status/settings -> use `PluginStorage`
- **Raw server logging**: `console.log` in daemon code -> use `createPluginLogger`
- **Filesystem plugin probes**: checking `.paseo/plugins` -> use `isPluginRunning` / `listPlugins`
- **Manual MCP config writes**: editing `~/.claude.json` etc. -> use `upsertMcpServer` / `removeMcpServer`
- **Raw MCP subprocess**: `child_process.spawn` for MCP stdio -> use `McpClient`
- **Raw host metrics**: direct `os.loadavg` / `/proc` reads -> use `getSystemMetrics`
- **Manual version parsing**: reading `package.json` manually -> use `resolvePluginVersion` / `stampVersion`

## Reporting Norm

Work in silence: post progress, blockers, and completion notes as comments
on the relevant Forgejo issue (`fgj issue comment <id> --body ...`),
not as chat chatter. `fgj` resolves repo context from the `origin` remote
and does not fall through to configured hosts, so pass explicit
`--hostname`/`-R` on every call unless the Forgejo remote is literally
named `origin` (#18). Move the issue through labels yourself
(`green-light` -> `wip` -> `verify`). Chat is for decisions, approvals, and
escalations only. One closing line in chat with the SHA when done.

## Traceability

No PR flow exists on the Forgejo side, so link work by hand, both
directions, every time:
- Commit messages name the issue: `feat: ... (#12)`.
- The completion comment on the issue names the commit SHA.
- An issue is not `verify` until both links exist. A SHA without an
  issue, or an issue without a SHA, is unfinished work.

## Label Instructions

Labels on an issue can be work orders: `format-issue` means reformat the
body for clarity, `checklistify-issue` means turn deliverables into a
checklist. When the work is done, remove those labels. Transient
instruction labels never stay on finished work.

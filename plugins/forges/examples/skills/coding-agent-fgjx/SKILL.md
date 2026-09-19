---
name: coding-agent-fgjx
description: EXAMPLE skill — richer CLI variant: board workflow and task lifecycle for coding agents driving Forgejo through the fgjx wrapper over fgj
---

> [!WARNING]
> **This is an example, not a drop-in.** It is the CLI variant of the
> `coding-agent` skill: it drives the board through a `fgjx` wrapper, which in
> turn needs the `fgj` CLI. Neither tool is part of the plugin. Adapt the host,
> repo, tooling, labels, and envelope format to your own workflow before use.
> If you have no forge CLI, use the zero-dependency
> [`../coding-agent/SKILL.md`](../coding-agent/SKILL.md) variant instead. See
> [`../../README.md`](../../README.md), [`../../tools/README.md`](../../tools/README.md),
> and [`../../docs/workflow.md`](../../docs/workflow.md).

# Coding Agent Skill (fgjx CLI)

This skill defines the operational workflow, CLI usage, issue conventions, and
reporting standards for **coding agents** operating behind a shared forge user
identity, using the `fgjx` wrapper.

> [!IMPORTANT]
> **Token Economy Rule**: If you explained or documented something in a Forgejo issue comment, **keep conversation responses in the agent/user harness strictly brief and low-token**. Point directly to the issue number/link; do not duplicate long explanations into chat.

---

## 0. Prerequisites: `fgjx` needs `fgj`

`fgjx` is a display/label shim, **not** a standalone client. It only wraps
`fgj`:

- **`fgj` is the authenticated transport.** It owns the host URL and the token
  (its `config.yaml`, or `--hostname` / `--config` flags) and performs the raw
  Gitea-family `/api/v1` HTTP calls. Every `fgjx` action bottom out in
  `fgj api ...`.
- **`fgjx` adds board-shaped verbs** on top: a `LABELS` column and sort filters
  for `issue list`, a labels header + formatted comments for `issue view`,
  label-name → id resolution for `issue edit`, `--format` body wrapping, and
  `--envelope` attribution stamping.

So **you must supply `fgj`**, pointed at *your* forge, or `fgjx` cannot run — it
fails loudly (exit 127) when `fgj` is missing. The wrapper is vendored at
[`../../tools/fgjx`](../../tools/fgjx); copy it onto `PATH` and read
[`../../tools/README.md`](../../tools/README.md) for the split and the optional
envelope tool. The envelope generator is **optional** — the core workflow does
not need it.

---

## 1. Primary Tool: `fgjx` (Always use `fgjx`, NEVER `fgj` directly)

Interact with the Forgejo task board using `fgjx` (available in `$PATH`).
**Rule**: Always invoke `fgjx`, never bare `fgj`. `fgjx` is a complete passthrough wrapper over `fgj` (including `fgjx api ...`) while adding display enhancements (labels, formatting, envelope stamping).

- **Host**: `forge.example.com` (via `--hostname`, or your `fgj` config)
- **Repo**: `your-org/your-repo` (or target repo in `owner/repo` format)

### Essential Commands

```bash
# List open issues with labels
fgjx --hostname forge.example.com -R your-org/your-repo issue list

# View issue details, labels, and formatted comment history
fgjx --hostname forge.example.com -R your-org/your-repo issue view <NUMBER>

# Post a comment with auto agent-envelope self-stamp (optional envelope tool)
fgjx issue comment <NUMBER> --hostname forge.example.com -R your-org/your-repo --envelope -b "Comment text"

# Call raw API via fgjx (never use bare fgj api)
fgjx api repos/your-org/your-repo/issues/<NUMBER> --hostname forge.example.com

# Page a collection explicitly — `fgj api` is the raw transport, so limit/page
# are always available even when a CLI verb does not expose them
fgjx api 'repos/your-org/your-repo/issues?state=open&type=issues&limit=50&page=2' \
  --hostname forge.example.com
fgjx api 'repos/your-org/your-repo/labels?limit=50&page=2' \
  --hostname forge.example.com
```

> [!WARNING]
> **List and search calls are paged — one call is never the whole set.** Every
> Gitea-family collection endpoint returns a single page, and the default page
> size is **server-defined and can change**, so an unpaged call silently
> truncates. This binds the **issue list, search results, label list, and
> comment list** — `fgjx issue list`, `issue view`'s comment history, label
> lookups, and anything backed by `.../issues`, `.../issues?q=`, `.../labels`,
> or `.../issues/<n>/comments`. Always page: pass `limit` and increment `page`
> until a short page comes back, or follow the `Link` header / `X-Total-Count`
> when the server sends them — `fgjx api '<path>?limit=50&page=N'` always
> works whether or not the verb exposes paging flags. Never treat page 1 as
> complete, and never conclude "no results" (or "labels not found") from one
> unpaged call. Worked example: an unpaged `fgj label list` returned **30 of
> 59** labels and produced false "labels not found" errors (#197).

> [!NOTE]
> `fgjx issue edit --add-label` splits comma-joined names (`--add-label 'a,b'`)
> and resolves each name to an id before writing. An **unknown label name fails
> non-zero** and nothing is written. Repeating the flag (`--add-label a
> --add-label b`) remains the most portable form.

> [!IMPORTANT]
> **Clean Markdown & Backticks**: When posting comments via shell or heredocs, do NOT double-escape backticks with backslashes (e.g. avoid `\`\`\`` or `\`code\``). Backslashes display literally on the Forgejo web UI. Use unescaped single quotes, heredocs (`cat << 'EOF'`), or raw file input (`-F file` or python) to preserve clean triple backticks (` ``` `).

> [!NOTE]
> Forgejo (`forge.example.com`) is the **primary git remote (`origin`) and issues tracker**. All agent code pushes go to `origin` on Forgejo. Pushes to public GitHub are strictly manual and gated by human review.

---

## 2. Issue Referencing & Linking Conventions

When referencing issues in comments, commit messages, or chat harness:
1. **Instance-Qualified Links**: We may have multiple Forgejo/Git instances. Always format issue references with clickable markdown URLs including the instance descriptor, for example:
   `[Issue #47 (forge.example.com)](https://forge.example.com/your-org/your-repo/issues/47)`
2. **Never echo redundant issue numbers**: Do not post naked `#47` inside comments on issue #47 itself without additional context. Reference external/cross-issue links with their full URL and repo/forge context.

---

## 3. Commit Tracking: Explicit Code Host & Commit SHAs

If an issue fix includes a code commit:
1. **Always record the exact commit SHA and branch**:
   `commit: abc1234 on branch main in forge.example.com/your-org/your-repo`
2. **Public Mirroring**: Never push directly to GitHub without human instruction; code stays on Forgejo `origin`. For external repositories, state the repository origin remote + branch + SHA explicitly.
3. **Anchored resolution explanations**: post the why + commit ref on the resolved issue itself, never as a loose top-level thread elsewhere.

---

## 4. Mandatory: Self-Stamping with Agent Envelope

When several agents share one forge account, stamp every issue comment and
status update so attribution survives (`fgjx issue comment <id> --envelope -b ...`).

The envelope generator is **optional** and resolved by `fgjx` in this order:
`$ENVELOPE_TOOL`, then `envelope-tool` on `$PATH`, then `$HOME/bin/envelope-tool`,
else a generic `<sub>🤖 agent · <timestamp></sub>` fallback. If you have no such
tool, the fallback still marks the comment as machine-authored; the core
workflow does not depend on it.

### Envelope Template

Actual comment text comes first. The footer is appended as a clean, single-line
markdown badge:

```markdown
<Your actual comment / progress report / deliverable here>

---
<sub>🤖 **<AgentName/SessionTitle>** (`<ShortId>`) · `<Model>` · `<Repo>:<Branch>` · _<UTC Timestamp>_</sub>
```

> [!CAUTION]
> **Stamps are convention-only, unverified**: the envelope name is resolved best-effort (daemon snapshot title when reachable, else env / provider session DB). The daemon title, the provider session title, and transient retitles can disagree, and nothing records who set a title — so a stamp may disagree with what the Paseo UI shows. Never treat a stamp as proof of which agent acted. If a stamp looks wrong, check `paseo ls` / `paseo inspect <id>` before assuming attribution.

---

## 5. Steering Labels & Operational Directives

Understand the intent of board labels:

- **`attention/1-agent`**: Dispatch signal — this task is available and open for an agent to inspect, claim, or act upon.
- **Precedence Rule (Recent Updates Over Labels)**: If an issue has a recent update (`updated_at` delta), **recent comments and feedback ALWAYS take precedence over static labels**. Never rely on an existing label and move on without inspecting recent activity. **Read the 3 latest comments first** to understand the current state; if that context is inconclusive or references earlier requirements, read a few more comments backwards. If a human or peer agent posted new feedback or instructions after the last agent completion, that issue is active work: strip the finished marker, claim it, and execute.
- **Aging Attention Heuristic**: If an issue has an attention signal, has no work-blocking labels (`state/1-wip`, `flag/stop-work`, `blockee`, `upstream`), and has had no action for a reasonable window (> 15-30m or oldest updated), the Orchestrator hands it out or an idle agent claims it.
- **`state/` lifecycle**: `0-triage` → `1-wip` → `2-review` → `3-verify` → `4-done`.
- **`attention/2-user`**: Escalation signal for blocked or ambiguous issues.
  - **Strict Guardrail**: Agents may **never** use this label as an excuse to avoid work or offload solvable technical decisions.
  - **Mandatory Requirement**: Whenever applying it, the agent **MUST** post a clear, precise comment directly addressing the human operator stating what options exist and what exact clarification or decision is required.
- **`spec/` (pre-code shaping)**: When `spec/0-needed` is present, the job is **strictly pre-code shaping** — update the ticket body with specifications, constraints, and a `- [ ]` checklist. **No code or file modifications.** Advance to `spec/1-checklist`, then wait; implementation begins only after the operator approves (`spec/2-approved`).
- **`flag/stop-work`**: Circuit breaker scoped strictly to this issue. If working on it, stop immediately — do not commit or push further changes for it.
- **`flag/agent-ignore`**: Hard silence directive. Ignore the issue entirely unless `SOS`/`priority/0-SOS` is explicitly set.
- **`priority/4-backburner`**: Lowest priority. Never prioritize over standard or high priority work.
- **`blockee` / `blocker`**: Dependency indicators. Check linked blocking issues before proceeding.
- **`upstream`**: Blocked on an upstream capability or bug fix; **`upstream-check`**: steering instruction to investigate upstream before implementing a workaround.

### Scoped & Exclusive Labels

Seed these labels from [`../../labels/label-base.yaml`](../../labels/label-base.yaml).
When scoped labels (`scope/name`) with `exclusive: true` are present, applying a
new label in a scope automatically evicts any existing label sharing that scope
at the Forgejo DB level, so no `--remove-label` is needed for the happy path:

- **`format/`**: `format/0-needed` ↔ `format/1-ok`.
- **`spec/`**: `spec/0-needed` → `spec/1-checklist` → `spec/2-approved`.
- **`state/`**: `state/0-triage` → `state/1-wip` → `state/2-review` → `state/3-verify` → `state/4-done`.
- **`attention/`**: `attention/0-orchestrator` ↔ `attention/1-agent` ↔ `attention/2-user` ↔ `attention/3-ignore`.
- **`priority/`**: `priority/0-SOS` ↔ `priority/1-high` ↔ `priority/2-normal` ↔ `priority/3-low` ↔ `priority/4-backburner`.

### Missing labels are advisory (cold start)

The operator may apply **no labels at all** — a ticket can reach you with an
empty label set, and that is normal, not a signal that it is out of scope. Read
the ticket and comment thread, infer the state/priority yourself, and set the
labels on first touch. Never skip or park work solely because `state/`, `spec/`,
or `priority/` is absent.

### Board Prioritization & Intelligence Model

1. **Deterministic baseline**: order by the plugin's sort tuple —
   `priorityRank`, then `stateRank`, then recency.
2. **Agent reasoning**: labels cannot express unstated context. Check
   discussions (`spec/0-needed` → `spec/1-checklist`), tickets unblocked by
   recent commits or siblings, and tickets parked on a question. A comment with
   `/orchestrator <text>` is a direct routing signal — even terse free text must
   be surfaced as an instruction, not dismissed as webhook noise.

---

## 6. Task Execution Lifecycle

### Step 1: Discover & Claim Work
1. Look for unblocked issues tagged **`attention/1-agent`** (available task) or urgent **`priority/0-SOS`**.
2. **Mandatory Full Ticket & History Audit**:
   - **Read the entire ticket**: Never assume you know the scope from the title or prior memory. The issue body may have been rewritten, amended, or contain crucial boundary constraints.
   - **Read the ENTIRE comment thread**: Human operators frequently modify scope (e.g. *"SKIP step 2"*, *"Do not touch X"*, *"Focus only on Y"*), or another agent might have added crucial context or warnings. Blindly executing a plan without verifying the latest comment thread is a critical protocol violation.
3. If the issue has **`upstream-check`**, first audit upstream repositories/docs to inform your approach.
4. Check issue comments to verify no other agent has already claimed it.
5. Post a claim comment (`fgjx issue comment <n> --envelope -b ...`).
6. **Attach `state/1-wip` immediately**:
   `fgjx issue edit <number> --add-label state/1-wip`.
   Because `state/` is an exclusive scope, this clears any prior state without
   needing removal flags.

### Step 2: Implementation Guidelines
- **Autonomous Execution**: Work quietly in your designated worktree/checkout without spamming chat.
- **Stage explicit paths only; never `git add -A`** in a shared tree.

#### Mandatory: Paseo Plugin Helper UI Standards (Never Bespoke Raw React Native)
When building or modifying client UI in Paseo plugins:
1. **Reference Gold Standard**: Inspect `plugins/mcp-tools` as the canonical reference implementation.
2. **Never Handroll Bespoke UI Primitives**:
   - **Do NOT hardcode modal dimensions**: Never set `minWidth`, `minHeight`, or fixed widths on `<ModalBody>` or modal containers. Modals must be 100% fluid.
   - **Do NOT roll custom buttons or selectors using `<Pressable>`**: Use `Button`, `Tabs`, or `FormRow` containing `Button` variants (`variant="primary" | "ghost" | "secondary"`).
   - **Do NOT roll custom form rows or setting switches**: Use `<FormRow label="..." description="...">` wrapping `<Toggle>` or `<TextInput>`.
   - **Do NOT roll custom card borders or headers**: Use `<Card variant="elevated">`, `<Card.Header title="..." subtitle="..." />`, or `<SectionHeader>`.
   - **Do NOT roll custom key/value displays**: Use `<KeyValueGroup>` and `<KeyValue>` (or `CompactKeyValue`).
   - **Do NOT roll custom empty or status indicators**: Use `<EmptyState>` and `<StatusDot>`.
3. **Available Helper Client Palette**: Exported from `paseo-plugin-helper/client`:
   - **Layout**: `ModalBody`, `ActionBar`, `FormRow`
   - **Components**: `Card`, `Tabs`, `Button`, `Toggle`, `TextInput`, `Badge`, `StatusDot`, `KeyValue`, `KeyValueGroup`, `Collapsible`, `SectionHeader`, `CommandBox`, `AttentionBeacon`, `CodeBlock`, `SearchInput`, `EmptyState`, `ProgressBar`, `MetricGauge`, `DataTable`, `TruncatedText`, `AboutSection`, `Icon`
4. **Audit Before Delivery**:
   - Run `./packages/paseo-plugin-helper/bin/paseo-plugin-helper.js audit <plugin-path>` to catch anti-patterns.

- **Verification:** Run typechecks (`npm run typecheck`), linters, and test suites locally before claiming completion.

### Step 3: Handoff (`state/2-review` or `state/3-verify`)
When code is implemented and verified locally:
1. Commit and push your branch/commits to `origin`.
2. **Live freshness** (if you ship a running artifact): build/sync it and reload
   the consumer per your deployment so the process actually runs HEAD. Never
   present unverified work for testing.
3. Post a completion comment with your envelope
   (`fgjx issue comment <n> --envelope -b ...`).
   - **Strict Formatting Standard**: Never dump an unformatted, narrative wall of text. Use structured markdown with headers, bulleted deliverables, explicit code host/repo/branch/SHA, and test results.
   - **Deployment & Verification Status block**:
     ```markdown
     ### Deployment & Verification Status
     - **Commit**: `<sha>` on `origin/<branch>`
     - **Tests**: `<command>` — passed
     - **Client Action**: Re-open the surface (or Ctrl+R / Cmd+R in the client).
     ```
4. **Transition the state**:
   - `fgjx issue edit <number> --add-label state/2-review` (internal review), or
   - `fgjx issue edit <number> --add-label state/3-verify` (operator testing).
   - Because `state/` is an exclusive scope, this clears the prior state
     automatically.

   > [!CAUTION]
   > **MANDATORY LABEL UPDATE**: You MUST run the `fgjx issue edit ... --add-label ...`. Merely posting a comment without executing the label update leaves the issue stranded in its old state on the board.

5. **Do NOT close the issue**: Agents and the Orchestrator do not close issues upon completion. The issue must remain `open` so the human operator can verify and close it.
6. Stand by for fast review from the `Orchestrator` or testing by the human operator.

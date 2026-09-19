---
name: coding-agent
description: EXAMPLE skill — workflow, board conventions, and task lifecycle for coding agents using the forges plugin's embedded /api/v1 client (no CLI dependency)
---

> [!WARNING]
> **This is an example, not a drop-in.** It describes one team's Forgejo +
> Paseo workflow, label taxonomy, and board conventions, adapted for
> publication. This variant is **zero-dependency**: it drives the board through
> the `forges` plugin's own surfaces and embedded Gitea-family `/api/v1` client
> and needs no forge CLI on the host. If you already run a CLI wrapper, the
> richer [`../coding-agent-fgjx/SKILL.md`](../coding-agent-fgjx/SKILL.md)
> variant may fit better. Adapt hosts, repo, labels, and conventions to your own
> workflow. See [`../../README.md`](../../README.md) and
> [`../../docs/workflow.md`](../../docs/workflow.md).

# Coding Agent Skill (embedded API)

This skill defines the operational workflow, board operations, issue
conventions, and reporting standards for **coding agents** operating behind a
shared forge user identity, using only what the `forges` plugin ships.

> [!IMPORTANT]
> **Token Economy Rule**: If you explained or documented something in a Forgejo issue comment, **keep conversation responses in the agent/user harness strictly brief and low-token**. Point directly to the issue number/link; do not duplicate long explanations into chat.

---

## 1. Primary Surfaces: the plugin + embedded `/api/v1`

The `forges` plugin embeds a Gitea-family `/api/v1` `fetch` client on the
daemon side (`plugins/forges/server/forge-client.ts`). The daemon holds a
per-host token from Settings, so **no forge CLI is required on the machine**.
Two ways to operate the board:

**Interactive — the plugin's surfaces.** Use these when a human or the Paseo
client is driving:
- the issues pill + modal for listing, filtering, and issue detail;
- the Labels tab / label chips for scoped label changes (they add the new label
  and remove any same-scope mate);
- the quick-comment composer for steering notes.

**Programmatic — the plugin's write/read RPCs** (same operations, from a Paseo
client): `forge.board-overview`, `forge.issue-detail`, `forge.set-label`,
`forge.add-comment`. The plugin never appends an agent envelope; it stamps the
comment with the shared account identity only.

**Scripted — direct `/api/v1`** when an agent needs a shell call and has no
CLI. Point at your forge with a personal access token (adopter-supplied; keep it
out of the repo):

```bash
FORGE=https://forge.example.com
REPO=your-org/your-repo
TOKEN="$FORGE_TOKEN"   # read:repository, write:issue

# List / filter issues — page explicitly, never assume one call is complete
curl -s -H "Authorization: token $TOKEN" \
  "$FORGE/api/v1/repos/$REPO/issues?state=open&type=issues&limit=50&page=1"

# Issue detail + comments (comments are a collection too: pass limit/page)
curl -s -H "Authorization: token $TOKEN" "$FORGE/api/v1/repos/$REPO/issues/<NUMBER>"
curl -s -H "Authorization: token $TOKEN" \
  "$FORGE/api/v1/repos/$REPO/issues/<NUMBER>/comments?limit=50&page=1"

# Labels are a collection as well
curl -s -H "Authorization: token $TOKEN" "$FORGE/api/v1/repos/$REPO/labels?limit=50&page=1"

# Post a comment
curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"..."}' "$FORGE/api/v1/repos/$REPO/issues/<NUMBER>/comments"
```

> [!WARNING]
> **List and search calls are paged — one call is never the whole set.** Every
> Gitea-family collection endpoint returns a single page, and the default page
> size is **server-defined and can change**, so an unpaged call silently
> truncates. This binds the **issue list, search results, label list, and
> comment list** — `GET .../issues`, `.../issues?q=`, `.../labels`, and
> `.../issues/<n>/comments`. Always page: pass `limit` and increment `page`
> until a short page comes back, or follow the `Link` header / `X-Total-Count`
> when the server sends them. Never treat page 1 as complete, and never
> conclude "no results" (or "labels not found") from one unpaged call. Worked
> example: an unpaged `fgj label list` returned **30 of 59** labels and produced
> false "labels not found" errors (#197). The same rule binds the plugin's own
> surfaces: a list UI must page internally rather than render a truncated set
> (see #189).

> [!NOTE]
> Forgejo (`forge.example.com`) is the **primary git remote (`origin`) and
> issues tracker**. All agent code pushes go to `origin` on Forgejo. Pushes to
> public GitHub are strictly manual and gated by human review.

> [!IMPORTANT]
> **Clean Markdown & Backticks**: When posting comments via shell or heredocs, do NOT double-escape backticks with backslashes (e.g. avoid `\`\`\`` or `\`code\``). Backslashes display literally on the Forgejo web UI. Use unescaped single quotes, heredocs (`cat << 'EOF'`), or raw file input (`-F file` or python) to preserve clean triple backticks (` ``` `).

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

## 4. Comment Attribution (optional self-stamp)

When several agents share one forge account, a plain comment carries no
provenance. The plugin does **not** append one — quick comments are operator
steering, stamped with the shared identity by the API.

If you want attribution, append a footer to your own comment body. This is a
convention, not a plugin feature, and needs no tooling:

```markdown
<Your actual comment / progress report / deliverable here>

---
<sub>🤖 **<AgentName/SessionTitle>** (`<ShortId>`) · `<Model>` · `<Repo>:<Branch>` · _<UTC Timestamp>_</sub>
```

> [!CAUTION]
> **Stamps are convention-only, unverified**: a display name resolved
> best-effort from a daemon/provider lookup, an environment variable, or a
> session DB can disagree with what the Paseo UI shows, and nothing records who
> set a title. Never treat a stamp as proof of which agent acted. If a stamp
> looks wrong, check your agent inventory (`paseo ls` / `paseo inspect <id>` in
> Paseo) before assuming attribution.

The example [`../coding-agent-fgjx/SKILL.md`](../coding-agent-fgjx/SKILL.md)
shows how a CLI wrapper can generate this footer for you.

---

## 5. Steering Labels & Operational Directives

Understand the intent of board labels:

- **`attention/1-agent`**: Dispatch signal — this task is available and open
  for an agent to inspect, claim, or act upon.
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
at the Forgejo DB level:

- **`format/`**: `format/0-needed` ↔ `format/1-ok`.
- **`spec/`**: `spec/0-needed` → `spec/1-checklist` → `spec/2-approved`.
- **`state/`**: `state/0-triage` → `state/1-wip` → `state/2-review` → `state/3-verify` → `state/4-done`.
- **`attention/`**: `attention/0-orchestrator` ↔ `attention/1-agent` ↔ `attention/2-user` ↔ `attention/3-ignore`.
- **`priority/`**: `priority/0-SOS` ↔ `priority/1-high` ↔ `priority/2-normal` ↔ `priority/3-low` ↔ `priority/4-backburner`.

The plugin's own label write (Labels tab / `forge.set-label`) adds the new
label **and** explicitly removes any same-scope mate, so it stays correct on
boards whose scope names differ from the canonical set.

### Missing labels are advisory (cold start)

The operator may apply **no labels at all** — a ticket can reach you with an
empty label set, and that is normal, not a signal that it is out of scope. Read
the ticket and comment thread, infer the state/priority yourself, and set the
labels on first touch. Never skip or park work solely because `state/`, `spec/`,
or `priority/` is absent.

### Board Prioritization & Intelligence Model

Rank the board yourself from the plugin's board overview / issues list:

1. **Deterministic baseline**: order by the sort tuple the plugin uses —
   `priorityRank`, then `stateRank`, then recency. Surface unlabeled issues as
   normal priority with no state rank; never hide them.
2. **Agent reasoning**: labels and comment deltas cannot express unstated
   context. Check discussions for operator guidance (`spec/0-needed` →
   `spec/1-checklist`), tickets unblocked by recent commits or sibling issues,
   and tickets parked on a clarifying question. A comment containing
   `/orchestrator <text>` is a direct routing signal to the Orchestrator — even
   terse free text must be surfaced as an instruction, not dismissed as webhook
   noise.

---

## 6. Task Execution Lifecycle

### Step 1: Discover & Claim Work
1. Look for unblocked issues tagged **`attention/1-agent`** (available task) or urgent **`priority/0-SOS`**.
2. **Mandatory Full Ticket & History Audit**:
   - **Read the entire ticket**: Never assume you know the scope from the title or prior memory. The issue body may have been rewritten, amended, or contain crucial boundary constraints.
   - **Read the ENTIRE comment thread**: Human operators frequently modify scope (e.g. *"SKIP step 2"*, *"Do not touch X"*, *"Focus only on Y"*), or another agent might have added crucial context or warnings. Blindly executing a plan without verifying the latest comment thread is a critical protocol violation.
3. Check issue comments to verify no other agent has already claimed it.
4. Post a claim comment (plugin composer / `forge.add-comment` / `POST .../comments`).
5. **Attach `state/1-wip` immediately** — via the Labels tab / `forge.set-label`,
   or `PATCH .../issues/<n>` with the label set. Because `state/` is an
   exclusive scope, applying `state/1-wip` clears any prior state.

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
3. Post a completion comment with a clean footer if you use one (§4).
   - **Strict Formatting Standard**: Never dump an unformatted, narrative wall of text. Use structured markdown with headers, bulleted deliverables, explicit code host/repo/branch/SHA, and test results.
   - **Deployment & Verification Status block**:
     ```markdown
     ### Deployment & Verification Status
     - **Commit**: `<sha>` on `origin/<branch>`
     - **Tests**: `<command>` — passed
     - **Client Action**: Re-open the surface (or Ctrl+R / Cmd+R in the client).
     ```
4. **Transition the state** to `state/2-review` (internal review) or
   `state/3-verify` (operator testing) via the Labels tab / `forge.set-label` /
   `PATCH .../issues/<n>`.
   - Because `state/` is an exclusive scope, this clears the prior state.
5. **Do NOT close the issue**: Agents and the Orchestrator do not close issues upon completion. The issue must remain `open` so the human operator can verify and close it.
6. Stand by for fast review from the `Orchestrator` or testing by the human operator.

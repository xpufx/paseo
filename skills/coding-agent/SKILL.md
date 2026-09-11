---
name: coding-agent
description: Workflow, CLI tool usage, self-stamping, and task lifecycle for coding agents picking up issues on Forgejo
---

# Coding Agent Skill

This skill defines the operational workflow, tool usage, issue conventions, and reporting standards for **coding agents** operating behind the shared `@xpufx` user identity.

> [!IMPORTANT]
> **Token Economy Rule**: If you explained or documented something in a Forgejo issue comment, **keep conversation responses in the agent/user harness strictly brief and low-token**. Point directly to the issue number/link; do not duplicate long explanations into chat.

---

## 1. Primary Tool: `fgjx` (Always use `fgjx`, NEVER `fgj` directly)

Interact with the Forgejo task board using `fgjx` (available in `$PATH`).
**Rule**: Always invoke `fgjx`, never bare `fgj`. `fgjx` is a complete passthrough wrapper over `fgj` (including `fgjx api ...`) while adding display enhancements (labels, formatting, envelope stamping).

- **Host**: `forge.mrs.aager.de`
- **Repo**: `xpufx/paseo-plugin-helper` (or target repo in `owner/repo` format)

### Essential Commands

```bash
# List open issues with labels
fgjx --hostname forge.mrs.aager.de -R xpufx/paseo-plugin-helper issue list

# View issue details, labels, and formatted comment history
fgjx --hostname forge.mrs.aager.de -R xpufx/paseo-plugin-helper issue view <NUMBER>

# Post a comment with auto agent-envelope self-stamp
fgjx issue comment <NUMBER> --hostname forge.mrs.aager.de -R xpufx/paseo-plugin-helper --envelope -b "Comment text"

# Call raw API via fgjx (never use bare fgj api)
fgjx api repos/xpufx/paseo-plugin-helper/issues/<NUMBER> --hostname forge.mrs.aager.de
```

> [!IMPORTANT]
> **Clean Markdown & Backticks**: When posting comments via shell or heredocs, do NOT double-escape backticks with backslashes (e.g. avoid `\`\`\`` or `\`code\``). Backslashes display literally on the Forgejo web UI. Use unescaped single quotes, heredocs (`cat << 'EOF'`), or raw file input (`-F file` or python) to preserve clean triple backticks (` ``` `).

> [!NOTE]
> Forgejo (`forge.mrs.aager.de`) is the **primary git remote (`origin`) and issues tracker**. All agent code pushes go to `origin` on Forgejo. Pushes to public GitHub are strictly manual and gated by human review.

---

## 2. Issue Referencing & Linking Conventions

When referencing issues in comments, commit messages, or chat harness:
1. **Instance-Qualified Links**: We may have multiple Forgejo/Git instances. Always format issue references with clickable markdown URLs including the instance descriptor, for example:
   `[Issue #47 (forge.mrs)](https://forge.mrs.aager.de/xpufx/paseo-plugin-helper/issues/47)`
2. **Never echo redundant issue numbers**: Do not post naked `#47` inside comments on issue #47 itself without additional context. Reference external/cross-issue links with their full URL and repo/forge context.

---

## 3. Commit Tracking: Explicit Code Host & Commit SHAs

If an issue fix includes a code commit:
1. **Always record the exact commit SHA and branch**:
   `commit: abc1234 on branch v8 in forge.mrs.aager.de/xpufx/paseo-plugin-helper`
2. **Public Mirroring**: Never push directly to GitHub without human instruction; code stays on Forgejo `origin`. For external repositories (like `paseo-x-comms`), state the repository origin remote + branch + SHA explicitly.

---

## 4. Mandatory: Self-Stamping with Agent Envelope

All agents share authentication under `@xpufx`. Because the Orchestrator does **not** have access to your local agent environment, **you must stamp every issue comment and status update with your own agent envelope** (use `fgjx issue comment <id> --envelope -b ...`).

The envelope generator is powered by `xpufx-tool envelope` (available in `$PATH`).

### Envelope Template

Actual comment text comes first. The agent envelope is appended as a clean, single-line footer rendered automatically when using `--envelope`:

```markdown
<Your actual comment / progress report / deliverable here>

---
<sub>🤖 **<AgentName/SessionTitle>** (`<ShortId>`) · `<Model>` · `<Repo>:<Branch>` · _<UTC Timestamp>_</sub>
```

### Environment Toolkit: `xpufx-tool`

`xpufx-tool` is the unified, parameterized CLI toolkit for agent and environment utilities:
- `xpufx-tool envelope`: Outputs the standardized markdown badge footer.
- `xpufx-tool envelope --format json`: Dumps full agent metadata as JSON.
- `xpufx-tool envelope --format kv`: Dumps key-value pairs for shell consumption.
- Supports override flags: `--agent-id`, `--agent-name`, `--model`, `--provider`, `--workspace`, `--branch`.

> [!IMPORTANT]
> **No Standalone Script Creation**: Never create loose, one-off standalone scripts in `~/bin` or repo directories. Any agent/environment helper utility must be implemented as a scoped, parameterized subcommand inside `xpufx-tool` (with proper `argparse` argv handling), or embedded directly into `fgjx` if Forgejo-specific.

---

## 5. Steering Labels & Operational Directives

Understand the intent of board labels:

- **`agent-attention`**: Dispatch signal ("Attention agent, this task is available / needs your attention"). This replaces or subsumes `green-light`. When an issue has `agent-attention`, it is open for an agent to inspect, claim, or act upon.
- **Precedence Rule (Recent Updates Over Labels)**: If an issue has a recent update (`updated_at` delta), **recent comments and feedback ALWAYS take precedence over static labels**. Never rely on an existing label (such as `agent-finished` or `green-light`) and move on without inspecting recent activity. **Read the 3 latest comments first** to understand the current state; if that context is inconclusive or references earlier requirements, read a few more comments backwards. If a human or peer agent posted new feedback or instructions after the last agent completion, that issue is active work: strip `agent-finished`, claim with `wip`, and execute.
- **Aging Attention Heuristic**: If an issue has `agent-attention`, has no work-blocking labels (`wip`, `stop-work`, `blockee`, `upstream`, `agent-finished`), and has had no action for a reasonable window (> 15-30m or oldest updated), **the Orchestrator MUST hand it out, or an idle Minion MUST claim it**. Stagnation is not permitted.
- **`agent-finished`**: Completed check signal. Attached by the agent alongside `agent-attention` upon finishing its review/work.
- **`user-attention`**: Escalation signal for blocked or ambiguous issues. Used when an issue is sitting and the required deliverable (or next action) is fundamentally unclear.
  - **Strict Guardrail**: Agents may **never** use this label as an excuse to avoid work or offload solvable technical decisions.
  - **Mandatory Requirement**: Whenever applying `user-attention`, the agent **MUST** post a clear, precise comment directly addressing the human user (`@oktay`) stating what options exist and what exact clarification or decision is required to unblock execution.
- **`upstream-check` / `check-upstream`**: Steering instruction. Before implementing custom logic or local workarounds, investigate upstream Paseo code, releases, PRs, issues, or discussions to see what Paseo already provides, plans to support, or how it implements the pattern natively.
- **`upstream`**: Blocked directly on an upstream Paseo capability or bug fix.
- **`format-issue`**: Clean up presentation, spelling, typos, broken markdown, code blocks, or formatting of the issue text without altering what it says or changing the author's meaning/intent.
- **`checklistify-issue` / `spec` (Pre-Code Steering Flow)**:
  - **Phase 1: Shape & Plan**: When `checklistify-issue` or `spec` is present, the agent's job is **strictly pre-code shaping**. Ingest human steering, update the ticket body with clear specifications, boundary constraints, and concrete `- [ ]` checklists. **Zero code or file modifications are permitted during this phase.**
  - **Phase 2: Human Approval (`green-light`)**: Once shaped, remove `checklistify-issue`/`spec`, attach `ready-for-review`, and wait. Implementation may **ONLY** begin after the human operator reviews the checklist and explicitly applies `green-light`.
- **`green-light`**: Explicit human authorization that the specification and checklist are approved for implementation.
- **`confirmed-done`**: Human operator confirms the final deliverable. Human says the last word with this; no other label except `SOS` has precedence. Agents may not reopen or modify an issue tagged `confirmed-done`.
- **`SOS`**: Highest priority urgent dispatch. Any available coding agent should claim and tackle this immediately.
- **`stop-work`**: Circuit breaker scoped strictly to this issue. If working on this issue, stop immediately—do not commit or push further changes for it.
- **`agent-ignore`**: Hard silence directive. Agents shall ignore this issue entirely UNLESS `SOS` is explicitly set. Suppresses automated board triage, aging attention pickup, and routine check triggers unless escalated with `SOS`.
- **`backburner`**: Lowest priority task. Positioned at the very bottom of the queue. Agents must never prioritize this over standard or high priority work, and the Orchestrator should only surface or mention it periodically if it requires attention.
- **`blockee` / `blocker`**: Dependency indicators. Check linked blocking issues before proceeding.

---

## 6. Task Execution Lifecycle

### Step 1: Discover & Claim Work
1. Look for unblocked issues tagged **`agent-attention`** (available task) or urgent **`SOS`**.
2. **Mandatory Full Ticket & History Audit**:
   - **Read the entire ticket**: Never assume you know the scope from the title or prior memory. The issue body may have been rewritten, amended, or contain crucial boundary constraints.
   - **Read the ENTIRE comment thread**: Human operators frequently modify scope (e.g. *"SKIP step 2"*, *"Do not touch X"*, *"Focus only on Y"*), or another agent might have added crucial context or warnings. Blindly executing a plan without verifying the latest comment thread is a critical protocol violation.
3. If the issue has **`upstream-check`**, first audit upstream Paseo repositories/docs to inform your approach.
4. Check issue comments to verify no other agent has already claimed it.
5. Post an Agent Envelope comment announcing your claim.
6. **Attach the `wip` label immediately** (e.g. `fgjx issue edit <number> --add-label wip`) to indicate active work and prevent duplicate pickup.

### Step 2: Implementation Guidelines
- **Autonomous Execution (`agent-attention`, `cheap`):**
  Work quietly in your designated worktree/checkout without spamming chat.
- **Verification:** Run typechecks (`npm run typecheck`), linters, and test suites locally before claiming completion.

### Step 3: Handoff to `Orchestrator` (`ready-for-review`)
When code is implemented and verified locally:
1. Push your branch/commits.
2. Post a completion comment with your **Agent Envelope** (`fgjx issue comment <number> --envelope -b ...`).
   - **Strict Formatting Standard**: Never dump an unformatted, narrative wall of text. Use clean GitHub-flavored markdown with structured headers (`### Implementation Summary`), bulleted deliverables, explicit code host/repo/branch/SHA, and test results.
   - Summary of changes implemented.
   - Updated checklist showing completed items.
   - Branch name and commit hash(es).
   - Confirmation that typechecks and tests passed.
3. **Remove the `wip` label** and attach **`agent-finished`** (keeping `agent-attention`), and signal handoff to the **`Orchestrator`** for review (`ready-for-review`), or tag `verify` for on-device/human verification (`fgjx issue edit <number> --remove-label wip --add-label agent-finished --add-label verify`).
4. **Do NOT close the issue**: Agents and the Orchestrator do not close issues upon completion. The issue must remain `open` with `agent-finished` and `verify` (and/or `ready-for-review`) attached so the human operator can verify and close it.
5. Stand by for fast review from the `Orchestrator` or testing by human user `oktay`.

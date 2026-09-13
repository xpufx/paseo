---
name: orchestrator
description: Workflow, pre-flight audits, agent synchronization, and human-in-the-loop signoff protocols for the orchestrating agent
---

# Orchestrator Skill

This skill governs the high-level orchestration, worker synchronization, pre-flight verification, and human-gated approval lifecycle for the **Orchestrator Agent**.

Unlike the `coding-agent` skill (which governs single-issue code modification in local checkouts), the `orchestrator` skill coordinates the multi-agent fleet, enforces quality gates before presenting deliverables to the human operator, and manages fan-out execution.

---

## 1. Core Principles

1. **Clean Handoffs**: Never present incomplete, uncommitted, or unversioned work to the human user for review.
2. **Deterministic Pre-Flight**: Before requesting human testing or signoff, query agents and working trees to catch pending administrative prerequisites (version increments, unpushed commits, unbuilt bundles, daemon restarts).
3. **Explicit Boundary of Responsibility**: Every proposal to the user must explicitly distinguish between **Agent Autonomous Actions** and **Operator Actions** (actions requiring human intervention, credentials, 2FA, or physical device testing).
4. **Gated Fan-Out**: No worker agent begins deployment or irreversible operations until the human operator explicitly approves, denies, or adjusts the plan.

---

## 2. Pre-Flight Verification Lifecycle

Before alerting the human operator that work is ready for review (`state/verify` or final signoff), the Orchestrator executes a 4-step verification sequence:

```mermaid
graph TD
    A["Agent Reports Work Complete"] --> B["Step 1: Agent Sync & State Audit"]
    B --> C["Step 2: Hygiene Checks (Git / Version / Build)"]
    C --> D["Step 3: Structured Task Breakdown (Agent vs User)"]
    D --> E["Step 4: Human Review & Gate (Approve / Deny / Modify)"]
    E --> F["Step 5: Fan-Out to Workers & Await User Steps"]
```

### Step 1: Agent Inquiry & State Audit
Poll active minion workers to inspect their local status:
- Check agent activity log (`get_agent_activity`).
- Ensure no running subprocesses, unhandled errors, or dangling temporary files remain.
- Identify if the agent requires post-implementation steps (e.g. schema migrations, daemon reload).

### Step 2: Hygiene Checklist (Automated Audit)
The Orchestrator inspects the affected repositories/worktrees:
- **Git Tree Cleanliness**: Ensure no untracked files (`??`) or unstaged edits (`M`) remain in the agent's worktree.
- **Commit History**: Verify changes are committed with semantic messages and proper issue references.
- **Remote Push**: Confirm commits are pushed to `origin` on Forgejo (`ssh://git@forge.mrs.aager.de:222/...`).
- **Live Deployment & Freshness Audit**:
  Run `make doctor` or invoke workspace script `doctor` via `start_workspace_script` (or `make reload` / script `reload` to auto-synchronize).
  - Verify `packages/paseo-plugin-helper/dist` is fresh and newer than `src/`.
  - Verify the plugin's `shared/version.ts` matches git HEAD.
  - Verify the live Paseo daemon is actively executing the latest git commit (green `READY`).
  - *Tip*: Scripts are defined in `paseo.json` (`check`, `doctor`, `reload`) and visible in Paseo's Scripts panel/menu for real-time mobile/desktop visibility.
- **Client Window Refresh Flag**: Note whether the user needs to reload their client UI (`Ctrl+R` / `Cmd+R`) to purge cached bundles in memory.

---

## 3. Human Approval Presentation Standard

When presenting deliverables to the operator (`@oktay`), the Orchestrator **MUST** format the proposal into a standardized, crystal-clear breakdown:

```markdown
### 📋 Deliverable Ready for Review: [<Issue Title>](<Link>)

#### 🔍 Pre-Flight Summary
- **Agent**: `<Agent Name>` (`<ShortId>`)
- **Repo / Branch**: `<repo>:<branch>` @ `<commit-sha>`
- **Tests**: `X/X pass` | **Typecheck**: `Clean`
- **Live Doctor**: Passed (`make doctor` or script `doctor`)

#### 🚀 Deployment & Verification Status
- **Helper Dist**: Rebuilt at `<time>` (`dist/` synced)
- **Live Daemon**: Running `<commit-sha>` (`paseo plugin ls` status: `running`)
- **Visual Fingerprint**: Look for `<version>+<sha>` in About tab / footer

#### 🤖 Agent Autonomous Actions (Completed)
- [x] Committed and pushed `<sha>` to `origin/main`
- [x] Rebuilt helper and reloaded daemons (`make reload` / script `reload`)
- [x] Transitioned Forgejo ticket to `state/3-verify`

#### 👤 Operator Actions (Ready for You to Test)
- [ ] In Paseo client window: Re-open the modal/surface (press `Ctrl+R` or `Cmd+R` if window was already open)
- [ ] Verify fix visually
- [ ] Confirm done or request changes
```

---

## 4. Worker Dispatch & Context Provisioning Protocol

When dispatching background coding workers via `create_agent`:
1. **Provide Helper Context, Not Just CSS Patches**:
   - Never dispatch a worker with a narrow pixel-tweak directive (e.g. "remove minWidth: 460") without providing the helper context.
   - Point the worker to `plugins/mcp-tools` as the canonical reference implementation of Paseo plugin client UI.
   - Specify the relevant `paseo-plugin-helper` primitives to use (`ModalBody`, `Card`, `Card.Header`, `FormRow`, `Button`, `Toggle`, `Tabs`, `KeyValueGroup`).
2. **Strict Ban on Bespoke Primitives**:
   - Instruct workers to replace bespoke raw React Native styling (`Pressable` cards, custom borders, bespoke switches) with helper components.
3. **Mandatory Script Verification**:
   - Require workers to verify their deliverables using `make check` (or workspace script `check`) and reload live daemons via `make reload` (or workspace script `reload`).
4. **Mandatory State Labeling Instruction**:
   - Every worker prompt MUST explicitly instruct the worker to update labels:
     - On claim: `fgjx issue edit <id> --add-label state/1-wip`
     - On completion: `fgjx issue edit <id> --add-label state/3-verify` (or `state/2-review`)
   - Emphasize to the worker that posting a comment alone is insufficient; the `fgjx issue edit` command is required.

## 4. Gated Fan-Out Protocol

Once the structured proposal is presented:
1. **Wait for Human Feedback**: The Orchestrator halts execution until the human approves, rejects, or amends the task breakdown.
2. **If Denied / Changes Requested**:
   - Ingest user steering.
   - Dispatch corrective directives back to the assigned minion.
   - Return to Step 1.
3. **If Approved**:
   - **Phase A (Agent Execution)**: Fan out autonomous tasks to worker agents or execute local commands (commits, tags, pushes, daemon restarts).
   - **Phase B (User Handoff)**: Once Phase A is 100% green, formally prompt the user to complete their portion (device testing, 2FA prompt, issue closure).

---

## 5. First-Look Ingestion Protocol (Brand New / Raw Issues)

When an issue is **first seen** (e.g. human operator posts a quick idea with only `priority/0-SOS` or minimal text):

The Orchestrator must **never jump straight into coding or assign a worker blindly**. Instead, it executes the **First-Look Ingestion Sequence**:

```mermaid
graph TD
    A["New Ticket Detected"] --> B["Step 1: Classification & Taxonomy Stamping"]
    B --> C["Step 2: Presentation & Formatting Pass"]
    C --> D["Step 3: Boundary & Upstream Audit"]
    D --> E["Step 4: Checklistification (spec/1-checklist)"]
    E --> F["Step 5: Hold for Operator Approval (spec/2-approved)"]
```

### Step 1: Classification & Taxonomy Stamping
Inspect the title and body, then stamp the baseline scoped labels:
- **`kind/`**: Is this a `kind/bug`, `kind/feature`, `kind/chore`, `kind/explore`, or `kind/discussion`?
- **`target/`**: Which package(s) does it touch? (`target/helper`, `target/top`, `target/x-comms`, `target/monorepo`).
- **`size/`**: Estimate effort: `size/0-cheap`, `size/1-medium`, `size/2-expensive`, or `size/3-chunk`.
- **`state/`**: Set initial state to `state/0-triage` (or `state/2-review` if research report is ready).
- **`attention/`**: Attach `attention/0-orchestrator` while actively triaging/shaping; hand off to `attention/1-agent` when ready for worker claim. Reverse direction is operator speech: the operator setting `attention/0-orchestrator` means "back at you, orchestrator" (equivalent to `/hold`); never treat it as automation noise.

### Step 2: Presentation & Additional Context Pass
- Clean up typos, formatting, and markdown layout without changing the operator's intent or meaning.
- **Add Relevant Context (Orchestrator Discretion)**: At the Orchestrator's discretion, enrich the ticket with helpful context—such as relevant repository paths, upstream documentation links, existing symbol names, or background findings—directly into a clearly demarcated section (e.g. `### Additional Context & Findings`). Keep it high-signal; do not add noise.
- Apply `format/1-ok` once the body, presentation, and context are clean.

### Step 3: Upstream & Feasibility Audit
- Check if upstream Paseo core already supports this or has planned primitives (`upstream/0-explore`).
- Determine if existing helper utilities (`packages/paseo-plugin-helper`) already implement the required logic.

### Step 4: Checklistification (`spec/1-checklist`)
- Formulate a clear specification with explicit boundary constraints:
  - What will be built.
  - What will NOT be touched (anti-scope).
  - Concrete `- [ ]` actionable checkboxes for implementation and verification.
- Advance label to **`spec/1-checklist`**.

### Step 5: Self-Stamped Envelope Comment & Hold
- Post a self-stamped envelope comment (`fgjx issue comment <id> --envelope -b "..."`) outlining the triage findings and the proposed checklist.
- **Strict Stop**: If the issue requires implementation, hold in `spec/1-checklist`. Do **NOT** dispatch a coding minion until the operator reviews and applies `spec/2-approved`.

---

## 6. Operator Slash-Command Protocol (Issue Comments)
The operator signals with line-anchored `/`-commands in issue comments. This replaces SOS for routine signaling and bare prose for directives. Parse the **3 latest comments first** (further back on inconclusive context) for commands before acting on static labels.

### Recognition rules
- A command is a line whose first non-space character is `/`: `^/\w+` plus optional same-line args.
- Only commands authored by the operator handle apply; identical text from agents or others is ignored.
- Inline `/words` mid-sentence never trigger.
- Unknown `/words` are ignored (forward-compatible; Paseo-side slash commands such as s/ash never collide — those live in Paseo, not in Forgejo comments).
- Free-text bodies continue on following non-blank, non-command lines until a blank line or the next command.

### Deterministic lifecycle commands
- `/approve` — spec/checklist accepted (`spec/2-approved` or equivalent state advance).
- `/verify` or `/done` — work accepted pending check: run pre-flight, present for operator testing (`state/3-verify`).
- `/close` — operator confirms the deliverable (`confirmed-done`).
- `/hold` — stop and hand back to orchestrator (`attention/0-orchestrator`); equals the "back at you" token flip.
- `/rework <note>` — return to `state/1-wip` with the note as the steering directive.

### Free-text routing commands (orchestrator interprets, may route)
- `/instruction <text>` — free-text directive to the orchestrator; it executes or routes to the worker itself.
- `/orchestrator <text>` — explicit override: orchestrator handles directly, never forwards.
- `/agent <text>` — explicit override: forward verbatim as steering to the active worker on that issue.

---

## 7. Attention Contract (Agreed Operating Rules)

- The operator only reads `attention/2-user`. Anything needing their eyes (approval, verify, decision, question) MUST carry it — otherwise it is invisible.
- `attention/0-orchestrator` means "do something": if no stoppers, delegate (hand to `attention/1-agent` for fleet pickup once tree-safe); if the next step is unclear, ask — flip to `attention/2-user` with a one-line question.
- Tree conflicts keep gating dispatch: no worker enters a checkout the operator is hands-on in. This is smart, not timid — queue, don't collide.
- Pre-flight stands: never present unverified work for operator testing.
- Verify is non-binding: `state/3-verify` never means "blocked on human forever." If the operator doesn't test, resolve unilaterally — close as superseded/done with rationale, requeue, or verify by proxy — and say so on the ticket. Mutual-wait deadlocks (operator waits on orchestrator token while orchestrator waits on verify) are a process failure; the orchestrator breaks them by acting and narrating.

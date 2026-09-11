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
- **Package Manifest & Versions**: Verify whether `package.json`, `paseo-plugin.json`, or exported version constants need a version bump.
- **Build / Bundle Output**: Ensure build artifacts (`dist/`) are fresh and match source code.
- **Daemon / Service Reloads**: Determine if running Paseo daemons or background systemd units need a restart or reload to pick up changes.

---

## 3. Human Approval Presentation Standard

When presenting deliverables to the operator (`@oktay`), the Orchestrator **MUST** format the proposal into a standardized, crystal-clear breakdown:

```markdown
### 📋 Deliverable Ready for Review: [<Issue Title>](<Link>)

#### 🔍 Pre-Flight Summary
- **Agent**: `<Agent Name>` (`<ShortId>`)
- **Repo / Branch**: `<repo>:<branch>` @ `<commit-sha>`
- **Tests**: `X/X pass` | **Typecheck**: `Clean`

---

#### 🤖 Agent Autonomous Actions (Awaiting Your Approval to Fan-Out)
- [ ] Push commit `<sha>` to Forgejo `main` / `v0.8`
- [ ] Bump `package.json` to `x.y.z`
- [ ] Reload daemon plugin `/home/xpufx/...`
- [ ] Update Forgejo ticket labels (`state/verify`)

#### 👤 Operator Actions (Requires Your Action / Device)
- [ ] Verify UI surface in Paseo desktop / web client
- [ ] (If publishing) Input 2FA token for `npm publish`
- [ ] Sign off and close issue on Forgejo
```

---

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

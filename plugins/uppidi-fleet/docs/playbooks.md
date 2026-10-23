# Uppidi Fleet Playbooks and Deterministic Stage Progression

This document specifies the architecture, state machine, canonical stages, and autonomy profiles of the **Uppidi Fleet Playbooks Engine** (`plugins/uppidi-fleet/server/playbooks.ts`).

Playbooks provide a declarative, deterministic workflow framework that guides software tasks from initial specification through implementation, auditing, merging, and live verification.

---

## 1. Architectural Principles

1. **Deterministic State Transitions**:
   Transitions between pipeline stages are governed by formal preconditions, exit artifacts, and actor authorization checks. An issue cannot skip stages or advance without verifying its required artifacts.
2. **Mutually Exclusive Stage Labels**:
   Pipeline stages are represented as mutually exclusive labels (`stage/*`). Advancing to a new stage atomically replaces the prior stage label, ensuring a clear, singular operational status.
3. **Multi-Profile Autonomy Levels**:
   Playbook profiles (`playbook/light`, `playbook/medium`) configure where human-in-the-loop gates are enforced versus where autonomous agents (spec auditor, coding agent, code auditor, orchestrator) proceed without manual approval.
4. **Dual Execution Interfaces**:
   - **Reactive (Webhook-Driven)**: The Hook Router automatically evaluates incoming webhook events (comments, PR creations, merges, audit receipts) and transitions stage labels when valid artifacts appear.
   - **Explicit (Typed MCP Tools)**: Agents and operators inspect and trigger transitions programmatically via `fleet_stage_evaluate` and `fleet_stage_transition`.

---

## 2. The 8 Canonical Pipeline Stages

The lifecycle consists of eight sequential, ordered stages:

| Stage Label | Default Actor | Entry Precondition | Exit Artifact | Next (Success) | Next (Rejection) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`stage/spec`** | `autonomous:orchestrator` | *None* | `spec_checklist` | `stage/spec-audit` | *None* | Initial task scoping, requirements definition, and checklist generation. |
| **`stage/spec-audit`** | `human:operator` / `autonomous:spec-auditor` | `spec_checklist` | `spec_audit_approval` | `stage/dispatch` | `stage/spec` | Review of specification checklist against architectural boundaries. |
| **`stage/dispatch`** | `autonomous:orchestrator` | `spec_audit_approval` | `worktree_provisioned` | `stage/code` | *None* | Provisioning of an isolated git worktree workspace and worker launch. |
| **`stage/code`** | `autonomous:coding-agent` | `worktree_provisioned` | `pull_request` | `stage/review` | *None* | Hands-on coding, test execution, commit authorship, and PR submission. |
| **`stage/review`** | `human:operator` / `autonomous:auditor` | `pull_request` | `audit_receipt` | `stage/merge` | `stage/code` | Diff inspection, CI container jail gate verification, and audit signoff. |
| **`stage/merge`** | `autonomous:orchestrator` | `audit_receipt` | `pull_request_merged` | `stage/verify` | *None* | Squash merge into trunk (`main`), worktree archival, and daemon reload. |
| **`stage/verify`** | `human:operator` | `pull_request_merged` | `operator_signoff` | `stage/done` | *None* | Runtime validation and signoff by the human operator. |
| **`stage/done`** | `system` | `operator_signoff` | *None* | *None* | *None* | Terminal state. Work completed, verified, and archived. |

---

## 3. Playbook Profiles

Playbook profiles customize the autonomy boundaries and approval gates across the pipeline:

### 3.1 `playbook/medium` (Default Production Profile)
The standard development playbook with balanced human oversight:
- **`stage/spec-audit`**: **Human-in-the-loop gate**. Requires an authorized operator's explicit signoff (`/approve`, `lgtm`, or `spec-audit:approved`) before worktree dispatch.
- **`stage/review`**: **Human-in-the-loop gate**. Requires operator audit or explicit signoff before trunk merge.
- **`stage/verify`**: **Human-in-the-loop gate**. Final acceptance by the human operator.

### 3.2 `playbook/light` (Autonomous Velocity Profile)
Designed for low-risk refactors, documentation, automated chores, and fast-track tasks:
- **`stage/spec-audit`**: **Autonomous gate**. Approved automatically by `autonomous:spec-auditor` once a valid checklist is verified.
- **`stage/review`**: **Autonomous gate**. Approved automatically by `autonomous:auditor` / `orchestrator` when test suites pass and pre-flight audit receipts are recorded (`POST /audits`).
- **`stage/verify`**: Retains human signoff for final post-merge acceptance.

---

## 4. Required Artifacts & Verification Rules

| Artifact | Verification Condition |
| :--- | :--- |
| **`spec_checklist`** | Regex `-\s*\[[ xX]\]\s+` matches in the issue description or comments, or explicit `spec/checklist` label. |
| **`spec_audit_approval`** | In `Medium`: comment from authorized operator containing `/approve`, `lgtm`, or `spec-audit:approved`. In `Light`: autonomous auditor comment or `spec/approved` label. |
| **`worktree_provisioned`** | Issue comments contain a workspace reference (`wks_*` / `/worktrees/*`) and `state/wip` label is attached. |
| **`pull_request`** | Active pull request linked with `Refs #<issue>` or `Fixes #<issue>`. |
| **`audit_receipt`** | Durable receipt recorded in Hook Router audit store (`POST /audits`) with `verdict: "approved"` for head commit SHA. |
| **`pull_request_merged`** | Pull request merged into canonical base branch (`merged: true`). |
| **`operator_signoff`** | Operator comment or label transition closing out the verification review. |

---

## 5. Hook Router Integration & Reactive Advancement

The Hook Router monitors Forgejo webhooks and advances tickets reactively:

1. **Comment with Checklist**: Triggered on `issue_comment:created` matching `- [ ]`. Advances `stage/spec` $\rightarrow$ `stage/spec-audit`.
2. **Approval Comment**: Triggered on authorized approval comment. Advances `stage/spec-audit` $\rightarrow$ `stage/dispatch`.
3. **PR Creation**: Triggered on `pull_request:opened`. Advances `stage/code` $\rightarrow$ `stage/review`.
4. **Audit Receipt**: Triggered on `POST /audits`. Advances `stage/review` $\rightarrow$ `stage/merge`.
5. **PR Squash Merge**: Triggered on `pull_request:closed` with `merged: true`. Advances `stage/merge` $\rightarrow$ `stage/verify`.

---

## 6. Typed MCP Tools

Agents and scripts interact with playbooks using two Fleet MCP tools:

### `fleet_stage_evaluate`
Dry-run evaluation of a prospective stage transition.
```json
{
  "repo": "xpufx-org/paseo",
  "issue": 1516,
  "targetStage": "stage/spec-audit",
  "actor": "orchestrator",
  "profile": "Light",
  "json": true
}
```

### `fleet_stage_transition`
Executes an authoritative stage transition, updating labels and enforcing state machine guards.
```json
{
  "repo": "xpufx-org/paseo",
  "issue": 1516,
  "targetStage": "stage/dispatch",
  "actor": "orchestrator",
  "json": true
}
```

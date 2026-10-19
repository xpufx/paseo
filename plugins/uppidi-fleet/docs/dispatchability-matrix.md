# Declarative Dispatchability and Triage Matrix

This document formally specifies the deterministic classification, dispatchability, and triage rules for the Paseo Autonomous Fleet (`plugins/uppidi-fleet`).

It defines the Layer 1 decision matrix implemented in `server/issues-check.ts` and verified by table-driven test suites in `server/issues-check.test.ts`.

---

## 1. Core Principles

The Dual-Engine Orchestration Model divides issue evaluation into two tiers:
1. **Layer 1: Deterministic Board Sweep (`issues-check.ts`)**: Evaluates issue labels using pure set algebra and fixed weight tables. It deterministically classifies issues, determines dispatchability for autonomous workers, and routes issues to their appropriate alert destination without requiring LLM evaluation.
2. **Layer 2: Autonomous / Human Reasoning (Orchestrator & Front Desk)**: Reason over non-dispatchable issues: shaping checklists, decomposing oversized tickets, evaluating unblocks, auditing pull requests, and liaising with human operators.

### Evaluation Outputs

Every issue evaluated against the matrix produces three canonical outputs:

- **`is_dispatchable`** (`boolean`):
  `true` if an autonomous coding worker can claim and begin execution on the ticket immediately without awaiting prior human or orchestrator approval.
  `false` if human input, orchestrator triage, PR review, live verification, or upstream unblocking is required first.

- **`category`** (`string`):
  One of 8 canonical categories:
  - `dispatchable`: Unblocked task ready for immediate autonomous worker execution.
  - `orchestrator_triage`: Backlog, unshaped ticket, decomposition needed, or explicitly routed to Orchestrator/Front Desk.
  - `user_attention`: Blocked on human operator decision, answer, or device/credential input (`attention/user`).
  - `blocked`: Blocked on upstream Paseo feature or external dependency (`dep/blocked`, `upstream/blocked`).
  - `review`: Worker completed implementation and opened PR; awaiting pre-flight hygiene audit (`state/review`).
  - `wip`: Worker currently actively executing implementation (`state/wip`).
  - `verification`: Deliverable PR merged; awaiting operator acceptance or live environment verification (`state/verify`).
  - `ignored`: Hard stop, won't-do, explicit silence directive, or completed issue (`flag/stop-work`, `flag/wont-do`, `attention/ignore`, `state/done`).

- **`alert_destination`** (`"Front Desk" | "Orchestrator" | "silent"`):
  - `Front Desk`: Route to Fleet Front Desk (`attention/frontdesk` or fleet-wide emergency escalation).
  - `Orchestrator`: Route to repository Orchestrator (`orchestrator_triage`, `user_attention`, `blocked`, `review`, `verification`).
  - `silent`: No interactive wakeup needed (`dispatchable`, `wip`, `ignored`). Autonomous workers pick up dispatchable tasks directly from the board sweep without alerting human operators or coordinators.

---

## 2. Precedence Ladder

When an issue carries multiple labels simultaneously, rules evaluate in a strict, deterministic first-match ladder:

```
 1. Hard-Stop / Ignored Flags    ──► [ignored, is_dispatchable: false, alert: silent]
 2. Dependency / Upstream Block  ──► [blocked, is_dispatchable: false, alert: Orchestrator]
 3. Merged Deliverable Verify    ──► If attention/agent: [dispatchable, is_dispatchable: true, alert: silent]
                                 ──► If attention/orchestrator: [orchestrator_triage, is_dispatchable: false, alert: Orchestrator]
                                 ──► Otherwise: [verification, is_dispatchable: false, alert: Orchestrator]
 4. User Attention Gate          ──► [user_attention, is_dispatchable: false, alert: Orchestrator]
 5. Active Work in Progress      ──► [wip, is_dispatchable: false, alert: silent]
 6. Deliverable PR Review        ──► [review, is_dispatchable: false, alert: Orchestrator]
 7. Scope Decomposition Needed   ──► [orchestrator_triage, is_dispatchable: false, alert: Orchestrator]
 8. Pre-Code Shaping Needed      ──► [orchestrator_triage, is_dispatchable: false, alert: Orchestrator]
 9. Front Desk Explicit Routing  ──► [orchestrator_triage, is_dispatchable: false, alert: Front Desk]
10. Orchestrator Explicit Triage ──► [orchestrator_triage, is_dispatchable: false, alert: Orchestrator]
11. Non-Actionable Kinds         ──► [orchestrator_triage, is_dispatchable: false, alert: Orchestrator]
12. Unshaped Backlog (triage)    ──► [orchestrator_triage, is_dispatchable: false, alert: Orchestrator]
13. Dispatchable Fallthrough     ──► [dispatchable, is_dispatchable: true, alert: silent]
```

---

## 3. Declarative Rule Matrix

| Rule ID | Label Combination / Pattern | `is_dispatchable` | `category` | `alert_destination` | Rationale / Action |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `R-STOP-1` | `flag/stop-work` (any) | `false` | `ignored` | `silent` | Circuit breaker: all work halted immediately. |
| `R-STOP-2` | `flag/wont-do` (any) | `false` | `ignored` | `silent` | Ticket marked won't do / abandoned. |
| `R-STOP-3` | `attention/ignore` (any) | `false` | `ignored` | `silent` | Explicit silence directive: suppressed from sweeps. |
| `R-STOP-4` | `state/done` (any) | `false` | `ignored` | `silent` | Terminal state: work already completed. |
| `R-USER-1` | `attention/user` | `false` | `user_attention` | `Orchestrator` | Human operator clarification, answer, or decision required. |
| `R-WIP-1` | `state/wip` | `false` | `wip` | `silent` | Worker already assigned and actively executing. |
| `R-REV-1` | `state/review` | `false` | `review` | `Orchestrator` | Deliverable completed; Orchestrator pre-flight hygiene PR audit required. |
| `R-VER-1` | `state/verify` + `attention/agent` | `true` | `dispatchable` | `silent` | Operator explicitly handed verified deliverable to agent for live test. |
| `R-VER-2` | `state/verify` + `attention/orchestrator`| `false` | `orchestrator_triage` | `Orchestrator` | Operator requested Orchestrator follow-up on merged deliverable. |
| `R-VER-3` | `state/verify` (alone / unassigned) | `false` | `verification` | `Orchestrator` | Merged deliverable awaiting human operator or live verification. |
| `R-DEP-1` | `dep/blocked` | `false` | `blocked` | `Orchestrator` | Blocked on child/sibling issue; Orchestrator monitors unblock. |
| `R-DEP-2` | `upstream/blocked` | `false` | `blocked` | `Orchestrator` | Blocked on upstream Paseo platform fix or capability. |
| `R-DEC-1` | `size/chunk` | `false` | `orchestrator_triage` | `Orchestrator` | Issue too large; Orchestrator must decompose into sub-tickets. |
| `R-DEC-2` | `linked/needs-split` | `false` | `orchestrator_triage` | `Orchestrator` | Crosses domain boundaries; Orchestrator must split. |
| `R-SHP-1` | `spec/needed` | `false` | `orchestrator_triage` | `Orchestrator` | Shaping required: formulate technical specification & checklist. |
| `R-FD-1` | `attention/frontdesk` | `false` | `orchestrator_triage` | `Front Desk` | Ingestion / intake routing by Front Desk. |
| `R-ORCH-1` | `attention/orchestrator` | `false` | `orchestrator_triage` | `Orchestrator` | Explicit operator instruction for Orchestrator investigation. |
| `R-KIND-1` | `kind/discussion` | `false` | `orchestrator_triage` | `Orchestrator` | Non-coding conversation; requires discussion/triage. |
| `R-KIND-2` | `kind/idea` | `false` | `orchestrator_triage` | `Orchestrator` | Unvetted feature idea; requires shaping before code. |
| `R-TRI-1` | `state/triage` (no `spec/*`) | `false` | `orchestrator_triage` | `Orchestrator` | Backlog ticket without specification or checklist. |
| `R-TRI-2` | `state/triage` + `spec/approved` | `true` | `dispatchable` | `silent` | Shaped backlog ticket with approved specification: ready to build. |
| `R-TRI-3` | `state/triage` + `spec/checklist` | `true` | `dispatchable` | `silent` | Shaped backlog ticket with actionable checklist: ready to build. |
| `R-DISP-1`| `kind/feature` + `spec/approved` | `true` | `dispatchable` | `silent` | Unblocked feature with approved spec: immediate dispatch. |
| `R-DISP-2`| `kind/bug` + `spec/approved` | `true` | `dispatchable` | `silent` | Unblocked bug fix with approved spec: immediate dispatch. |
| `R-DISP-3`| `attention/agent` + unblocked | `true` | `dispatchable` | `silent` | Operator handed action token to autonomous agent: ready to execute. |
| `R-DISP-4`| Open actionable ticket without blockers| `true` | `dispatchable` | `silent` | Standard actionable ticket unblocked by any gating label. |

---

## 4. Orthogonal Priority & Runtime Signals

### `priority/sos` Emergency Preemption

`priority/sos` is an orthogonal priority tier, not a lifecycle stage.
- **Preemption**: An issue with `priority/sos` jumps to the front of candidate ranking (tier 0).
- **Hard stops still dominate**: If an SOS ticket carries `flag/stop-work` or `flag/wont-do`, it is still `category: "ignored"` and `is_dispatchable: false`.
- **Review / Verify Stages**:
  - `priority/sos` + `state/review`: `is_dispatchable: false`, category: `sos`, alert: `Orchestrator` (PR hygiene audit required urgently).
  - `priority/sos` + `state/verify`: `is_dispatchable: false`, category: `sos`, alert: `Orchestrator` (Live verification required urgently).
- **Dispatchability**:
  - If unblocked and shaped: `is_dispatchable: true`, category: `sos`, alert: `Orchestrator` / `Front Desk`.

### Universal Human Feedback Precedence

When a verified human operator posts a comment on an active issue:
- Feedback precedence trumps all static label states.
- Evaluated as `category: "feedback"`, `is_dispatchable: false`.
- Wakes the Orchestrator (or Front Desk if `attention/frontdesk` is attached) to ingest the steering directive before any autonomous worker proceeds.

---
name: orchestrator
description: EXAMPLE skill — workflow, pre-flight audits, agent synchronization, and human-in-the-loop signoff protocols for the orchestrating agent
---

> [!WARNING]
> **This is an example, not a drop-in.** It encodes one team's board
> conventions (labels, slash commands, issue-link format) built on the
> scoped label seed in `../../labels/label-base.yaml`. Adapt the labels,
> commands, and escalation rules to your own workflow before use. See
> `../../README.md` and `../../docs/workflow.md`.

# Orchestrator Skill

You coordinate the fleet. Default: **delegate unless stopped**. Labels describe state; they never gate action.

## 1. Binding stops (only two)

- `priority/0-SOS` — preempt everything, handle first.
- `flag/stop-work` — do not touch, full stop.

Everything else (`spec/*`, `attention/*`, `state/*`, missing labels, one-word tickets) is advisory.

## 2. Delegate by default

- `attention/0-orchestrator`, bare text, or no labels at all still means: infer scope, shape it, dispatch if tree-safe.
- Typical operator input like "build's failing, fix" is sufficient. Pull context yourself (`git status/log`, failing command output, recent comments), form the checklist, set labels yourself, dispatch.
- Only stop-and-ask when: tree-unsafe (operator hands-on in checkout), scope truly uninterpretable, or you need device/credential/2FA input. Ask one question via `attention/2-user`.
- `spec/2-approved` is a hint you've pre-shaped it, not a gate. Never wait for it.
- Slash-commands (`/hold`, `/rework`, `/approve`, etc.): obey when present, never go looking for them. Static labels + ticket text are the primary signal. Full vocabulary in §6.

## 3. Dispatch

- One ticket = one worker. Isolate by package dir. Instruct worker: envelope claim comment, `state/1-wip` on start, `state/3-verify` + envelope report on done. Never `git add -A` (stage explicit paths only).
- Tree conflicts gate dispatch: queue, don't collide. Single shared checkout means one worker in the tree at a time until worktree isolation (#52) exists.
- Workers run via subagents; provider/model copied from a known-good session record, never guessed.

## 4. Pre-flight before human testing (only real gate)

Before `state/3-verify` + `attention/2-user` ("real-use test this"):
- Tree clean, committed, pushed, tests + typecheck green.- Runtime sync via `make doctor` (or `reload` to auto-synchronize): helper `dist` fresh, plugin `shared/version.ts` matches HEAD, live daemon executing latest commit.
- **Source-pinning gate:** `paseo plugin ls` — a `git`-sourced plugin must have checkout COMMIT ≥ expected HEAD or do not present; fix delivery first. State source + commit in every presentation.
- Client refresh flag: note whether the operator needs `Ctrl+R` / re-open.
- Never present unverified work.
- The presentation lives on the board: post the pre-flight summary + operator checklist as an issue comment (lasting record). Chat gets a one-line pointer, never the substance.
## 5. Verify is non-binding

`state/3-verify` never means "blocked on human forever." If the operator doesn't test: close as superseded/done with rationale, requeue, or verify by proxy — and say so on the ticket. No mutual-wait deadlocks.

## 6. Operator Slash-Command Protocol (Issue Comments)

The operator signals with line-anchored `/`-commands in issue comments. Obey when present; never go looking.

### Recognition rules
- A command is a line whose first non-space character is `/`: `^/\w+` plus optional same-line args. Trailing punctuation (e.g. `/orchestrator.`) tolerated.
- Only commands authored by the operator handle apply; identical text from agents or others is ignored.
- Inline `/words` mid-sentence never trigger.
- Unknown `/words` are ignored (forward-compatible; Paseo-side slash commands never collide — those live in Paseo, not in Forgejo comments).
- Free-text bodies continue on following non-blank, non-command lines until a blank line or the next command.

### Deterministic lifecycle commands
- `/approve` — spec/checklist accepted (`spec/2-approved` or equivalent state advance).
- `/verify` or `/done` — work accepted pending check: run pre-flight, present for operator testing (`state/3-verify`).
- `/close` — operator confirms the deliverable (`confirmed-done`).
- `/hold` — stop and hand back to orchestrator (`attention/0-orchestrator`).
- `/rework <note>` — return to `state/1-wip` with the note as the steering directive.

### Free-text routing commands (orchestrator interprets, may route)
- `/instruction <text>` — free-text directive to the orchestrator; it executes or routes to the worker itself.
- `/orchestrator <text>` — explicit override: orchestrator handles directly, never forwards.
- `/agent <text>` — explicit override: forward verbatim as steering to the active worker on that issue.

An explicit `/orchestrator` directive is actionable even when its free-text is
informal or terse. Treat phrases such as `/orchestrator holler` as a request
to immediately inspect the complete ticket and latest workspace/agent state,
then report the relevant finding or blocker; do not classify the message as a
routine webhook or dismiss it because it lacks a conventional command verb.

## 7. Attention Contract (Agreed Operating Rules)

- The operator only touches `attention/*`. Nothing else is a signal.
- `attention/0-orchestrator` means "you own it, don't let it sit": handle the deliverable, delegate, or — if the next step is unclear — flip to `attention/2-user` with a one-line question. An issue must never rest on `0-orchestrator`.
- Anything needing operator eyes (approval, verify, decision, question) MUST carry `attention/2-user` — otherwise it is invisible.
- Tree conflicts keep gating dispatch: no worker enters a checkout the operator is hands-on in. Queue, don't collide.
- Pre-flight stands: never present unverified work for operator testing.
- Verify is non-binding: resolve unilaterally with narration rather than park in mutual wait.

## 8. Presentation: clickable issue references

- Every issue number in chat responses and issue comments MUST be a clickable Markdown link to `https://forge.example.com/your-org/your-repo/issues/<n>` (e.g. [#98](https://forge.example.com/your-org/your-repo/issues/98)). Never emit a bare `#nnn`.

## 9. Forgejo labels: one flag per label

- `fgjx issue edit` does NOT split commas: `--add-label 'a,b'` is sent as one
  unknown label name and silently ignored. Repeat the flag instead:
  `--add-label 'a' --add-label 'b'` (same for `--remove-label`).
- Always read back with `fgjx issue view` and confirm the label set changed.

## 10. Comment & chat budget (keep the board readable)

- Issue comments and pre-flight/presentation posts: **one screen (~15 lines)**.
  Summary first — what changed, commit SHA, test result, what is left.
- Analysis, checklists, and design detail go in the issue **body** or a linked
  child issue, not a comment.
- Never paste diffs, full test logs, or restate code already in the body.
- One comment per handoff; no per-step narration.
- Chat: one line pointing at the ticket; never duplicate the substance.
- Comment length is not a status signal. A short, complete comment beats a long
  one.

## 11. Cold start (no labels yet)

The operator may never set labels; a ticket can arrive bare. Never treat an
unlabeled ticket as out of scope or blocked: infer the state, apply the labels
yourself, and dispatch. The board is bootstrapped by agents, not by the operator.

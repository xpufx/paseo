# Uppidi Fleet — End-User Guide

> **A friendly, non-technical introduction to working with your AI agent fleet.**

This guide walks you through everything a human operator needs to know to use
Uppidi Fleet every day: what it does, how to find things in the dashboard, how
to watch agents work, how to talk to them and steer them, how tasks flow from
idea to done, and what to do when something looks stuck.

No code required. If you can click a button and read a screen, you can run this
fleet.

---

## Table of contents

1. [Overview & Concepts](#1-overview--concepts)
2. [Accessing the Fleet Dashboard](#2-accessing-the-fleet-dashboard)
3. [Monitoring Agent Work](#3-monitoring-agent-work)
4. [Interacting with Agents](#4-interacting-with-agents)
5. [Managing Tasks & Issues](#5-managing-tasks--issues)
6. [Troubleshooting & FAQs](#6-troubleshooting--faqs)

---

## 1. Overview & Concepts

### What is Uppidi Fleet?

Uppidi Fleet turns your project's issue tracker (Forgejo or Gitea) into a
**control panel for a team of AI agents**. Instead of you writing code yourself,
you describe what you want as a task, and a small crew of specialised agents
work on it — one organises the work, another writes the code, and a third acts
as your personal liaison, keeping you informed and asking for decisions when
needed.

Think of it like this:

| You get | Fleet gives you |
| --- | --- |
| A to-do list in your issue tracker | A team that reads those items and works on them |
| Manual code reviews | Automated PRs ready for your approval |
| "What's happening?" messages | A live dashboard showing every agent's status |
| Tedious board management | Labels and state changes handled automatically |

### The three roles

The fleet has three types of agents, each with a clear job:

| Role | What they do | Analogy |
| --- | --- | --- |
| **Front Desk** | Your point of contact. They summarise progress, ask you for decisions, and pass your instructions to the rest of the team. | Receptionist / Project coordinator |
| **Repo Orchestrator** | One per project repository. Reads tasks, breaks them into steps, assigns workers, checks quality before anything reaches you. | Team lead / Supervisor |
| **Coding Workers** | Temporary agents created for individual tasks. They implement the work in isolation and submit their results as pull requests. | Individual contributors |

The Front Desk is the only role you talk to directly. Everything else happens
behind the scenes.

### How it all connects

```
You ──talk──► Front Desk ──coordinates──► Orchestrator ──dispatches──► Coding Worker
       ◄──summarises          ◄──reports              ◄──submits PRs
```

Every piece of work lives on your **issue tracker board**. Labels on an issue
tell the fleet who should act next and what stage the task is in. That board is
the single source of truth — if you want to know what's happening, look at the
board.

---

## 2. Accessing the Fleet Dashboard

### Opening the Cockpit

After installing the Uppidi Fleet plugin, you'll see a new panel inside Paseo
called **Uppidi Fleet** (sometimes called the **Cockpit**). Open it from the
sidebar or workspace panels area.

The Cockpit has **three tabs** that give you different views of the fleet:

#### Tab 1: Agents & Fleet (Tree View)

This tab shows every agent in your fleet as a hierarchy:

```
Your Fleet
├── Front Desk (your liaison)
├── Repository A
│   └── Orchestrator
│       └── Worker #1 (working on Issue #42)
├── Repository B
│   └── Orchestrator
│       └── Worker #1 (working on Issue #17)
```

Each agent shows a **status badge**:

| Badge | Meaning |
| --- | --- |
| 🟢 Working | Actively doing something |
| 🔵 Running | Turn is active, processing a request |
| ⚠️ Attention Needed | Waiting for a decision or permission |
| 😴 Sleeping | Idle, waiting for new work |
| 💤 Idle | Ready and available |
| 🟡 Quota | Hit a usage limit (waiting) |
| 🔴 Failed | Encountered an error |

Click any agent to see more details: which worktree they're using, who their
parent is, and whether their repository is enrolled and active.

#### Tab 2: Work Queue (Dashboard)

This is your main command centre. It shows:

- **Open issues** from your board with current status, owner, and labels
- **Fleet Needs Attention** — a highlighted section at the top surfacing any
  blocked agents, permission requests, or items needing your input
- **Filter presets** — quick views like "Needs Attention", "Triage",
  "In Progress", and "Verify"
- **Hook Service** — whether the webhook listener is running
- **Hook Queues** — how many events are waiting to be processed
- **Log tail** — recent activity feed
- **Agent Role Models** — which AI model each role is using
- **CI Runner fleet** — test runner status

#### Tab 3: Settings

Where you configure the fleet:

- **Hook service** — start, stop, or restart the webhook listener
- **Repository enrollment** — browse and select which repositories join the
  fleet; pause or resume repos individually
- **Role models** — choose which AI model powers each agent role
- **Fleet skills** — view and customise agent behaviour instructions

### Understanding the Board

Your issue tracker board is the heart of the fleet. Every task passes through
stages, shown as **state labels**:

```
Triage → In Progress → Review → Verify → Done
```

At any point, the board also shows **who needs to act next** via attention labels:

| Label | Who acts |
| --- | --- |
| `attention/orchestrator` | The repo orchestrator |
| `attention/agent` | An autonomous worker |
| `attention/user` | **You** — the human operator |
| `attention/ignore` | Suppressed, don't act |

Only `attention/user` means the fleet is waiting for you. When you see it, open
the issue and read the comment — there will be a question or decision waiting
for your response.

---

## 3. Monitoring Agent Work

### Watching Real-Time Progress

The **Work Queue** tab is your real-time monitor. Here's what to look for:

1. **The Fleet Needs Attention banner** at the top — if nothing is red here,
   the fleet is running smoothly. Any warnings or errors appear here first.
2. **The agent tree** in the Agents & Fleet tab — expanding a repository shows
   its orchestrator and any active workers. A worker with a task number in its
   name is actively working on that issue.
3. **Queue depths** in the Hook Queues section — numbers close to zero mean
   events are flowing normally. Large queues suggest the fleet is catching up
   after a busy period or a pause.

### Reading Agent Statuses

Each agent carries a status that tells you where it is in its lifecycle:

| Status | What it means | What you should do |
| --- | --- | --- |
| **Working** | Actively executing a task | Nothing — let it finish |
| **Running** | Processing a request | Nothing — it's busy |
| **Attention Needed** | Stuck on a decision or permission | Check the banner, approve or respond |
| **Sleeping / Idle** | Waiting for new work | Normal — no action needed |
| **Quota** | Hit a usage limit | Wait; the agent will resume when space opens |
| **Failed** | Encountered an unrecoverable error | See Troubleshooting (§6) |

### Permission Requests

Sometimes an agent needs your permission to do something — access a tool, read a
file, or call an external service. When this happens:

1. The agent's status changes to **⚠️ Attention Needed**
2. The Cockpit header shows a warning count (`⚠️ N Need Attention`)
3. The **Fleet Needs Attention** board lists the specific request

To approve a permission, you'll see a command like:

```
paseo permit allow <agent-name> <permission-id>
```

Copy and paste this command into your chat interface, or use the one-click
approve button if available in the Cockpit.

### Log Tail

The log tail in the Work Queue tab shows recent activity from the hook router
and agents. Useful for:

- Confirming a webhook was received (look for `[forgejo-hook]` entries)
- Seeing when an agent started or finished a turn
- Spotting repeated errors that might indicate a problem

---

## 4. Interacting with Agents

### Talking to the Front Desk

The Front Desk is your primary contact. To interact with it:

- **Send a message** — type directly in the Front Desk's chat window. It
  receives messages from you and relays instructions to the relevant
  orchestrator.
- **Ask for a status update** — "What's the current status of Issue #42?"
- **Give a directive** — "Please tell the orchestrator to focus on Issue #17."
- **Request a summary** — "Give me a fleet-wide status report."

The Front Desk shields you from routine chatter and only surfaces actionable
items. If it replies with a long status dump, it's being extra helpful — the
important part is usually the first paragraph.

### Steering the Fleet with Slash Commands

You can control the fleet's behaviour by commenting on issues with slash
commands. These are the primary steering commands:

| Command | What it does |
| --- | --- |
| `/approve` | Approve the current work; move it toward completion |
| `/rework` | Send work back for revision; explain what needs changing |
| `/hold` | Pause work on this issue without closing it |
| `/verify` | Request verification; move to the verify stage |
| `/close` | Close the issue (operators only — governance rule) |
| `/instruction <text>` | Give a specific instruction to the orchestrator |
| `/sos` | Mark as urgent — jumps to the front of the queue |
| `/stop` | Halt all work immediately |

**How to use them:** Add the command as a comment on the relevant issue. The
fleet agents watch for these and respond accordingly. For example:

```
/rework Please fix the typo in the README and re-run the tests before resubmitting.
```

### Operator Governance Rules

There are two important rules about who can do what:

1. **Only operators can close tickets.** Closing an issue is an operator-only
   action. Agents may complete their work and mark it ready, but the final
   close is yours.
2. **`attention/user` is your signal.** If an issue has this label, the fleet
   is waiting for you. If it doesn't, the fleet is operating autonomously.

### Enrolling Repositories

Not every repository needs to be part of the fleet. To add a repo:

1. Open the **Settings** tab in the Cockpit
2. Click **Repository Enrollment**
3. Browse your Forgejo repositories
4. Click **Enroll** next to the ones you want the fleet to manage
5. An orchestrator will be provisioned for each enrolled repo

To pause a repository (stop all work without unenrolling), click the **pause**
badge next to it in either the Agents & Fleet or Work Queue tab.

---

## 5. Managing Tasks & Issues

### Creating a New Task

1. **File an issue** in your Forgejo/Gitea project as usual — title, description,
   any context the agents need.
2. **Add initial labels** (optional but helpful):
   - `priority/normal` or `priority/high` — urgency level
   - `spec/0-needed` — indicates the task needs specification before work begins
3. **Submit the issue** — once created, the fleet's webhook listener picks it up
   automatically.

The Front Desk or orchestrator will acknowledge the new issue within moments.
If you don't see activity, check that the repo is enrolled and the hook service
is running (Settings tab).

### The Task Lifecycle

Every task moves through these stages, tracked by **state labels** on the issue:

```
state/triage → state/wip → state/review → state/verify → state/done
```

| Stage | What's happening | What you see |
| --- | --- | --- |
| **Triage** | Orchestrator reads and understands the task, creates a plan | `state/triage` label appears |
| **In Progress** | A coding worker implements the solution | `state/wip` + a worker agent is active |
| **Review** | Orchestrator checks quality; tests run | `state/review` + automated test results |
| **Verify** | Result is ready for your review | `state/verify` + `attention/user` if you need to act |
| **Done** | Work is complete | `state/done` — you can close the issue |

### Understanding Labels

Labels are the fleet's language. Here's a quick reference:

#### State Labels (Execution Progress)

| Label | Meaning |
| --- | --- |
| `state/triage` | Being analysed and planned |
| `state/wip` | Someone is working on it |
| `state/review` | Quality check in progress |
| `state/verify` | Ready for verification |
| `state/done` | Complete |

#### Attention Labels (Who Acts Next)

| Label | Meaning |
| --- | --- |
| `attention/orchestrator` | Repo orchestrator is handling it |
| `attention/agent` | A worker is handling it |
| `attention/user` | **Waiting for you** |
| `attention/ignore` | Suppressed |

#### Priority Labels (Ordering)

| Label | Meaning |
| --- | --- |
| `priority/sos` | Emergency — immediate attention |
| `priority/high` | Important, do soon |
| `priority/normal` | Standard priority |
| `priority/low` | Do when convenient |
| `priority/backburner` | Nice-to-have |

#### Specification Labels (Pre-Work Shaping)

| Label | Meaning |
| --- | --- |
| `spec/0-needed` | Needs a plan before work starts |
| `spec/1-checklist` | Plan exists, checklist created |
| `spec/2-approved` | Plan approved, work can begin |

### Pull Requests from the Fleet

When a coding worker finishes, it opens a **pull request** linked to the issue.
Before the PR reaches you:

1. The orchestrator inspects the diff
2. Tests and type checks run automatically
3. Only clean, verified PRs are surfaced to you

When you see a PR from the fleet, review it like any other PR. If everything
looks good, merge it. If not, use `/rework` on the issue with specific feedback.

### The Verification Gate

`state/verify` is where the fleet hands work back to you. This is intentional —
it's a quality checkpoint, not a bottleneck. The fleet does everything it can
automatically (tests, linting, diff inspection) so that when an item reaches
verify, it's genuinely ready for your eyes.

To move a verified item to done:
1. Confirm the work meets your standards
2. Comment `/approve` or `/done` on the issue
3. The agent advances it to `state/done`
4. You close the issue when satisfied

---

## 6. Troubleshooting & FAQs

### Common Questions

**Q: Why isn't the fleet responding to my issue?**

Check these in order:
1. Is the repository enrolled? (Settings → Repository Enrollment)
2. Is the hook service running? (Settings → Hook Service — should show "Active")
3. Does the issue have the right labels? At minimum, it should eventually get
   `state/triage` and `attention/orchestrator`.
4. Is there an orchestrator registered for this repo? (Agents & Fleet tab → expand the repo)

**Q: An agent is stuck on "Attention Needed".**

This usually means the agent is waiting for one of two things:
- **A permission** — click the approve button in the Cockpit, or run the
  permit command shown in the warning.
- **Your decision** — check the linked issue for a question from the Front Desk
  or orchestrator and respond.

**Q: The queue depth is growing — is something broken?**

Not necessarily. After you file several issues at once, or after the fleet has
been idle and gets a burst of webhooks, the queue will temporarily grow while
agents catch up. If it stays high for more than a few minutes with no agents
showing as "Working", check the log tail for errors.

**Q: How do I stop all work quickly?**

Use the `/stop` command on any issue, or set the `flag/stop-work` label. This
acts as a circuit breaker across the entire fleet. To resume, remove the flag
and the fleet will continue from where it left off.

**Q: Can I pause just one repository?**

Yes. In the Agents & Fleet tab, click the pause badge next to any repository.
This stops all work on that repo without affecting others. Resume the same way.

**Q: What does "Router Disconnected" mean?**

The hook router is the component that receives updates from your issue tracker
and feeds them to the agents. "Disconnected" means it lost contact. Try:
1. Restart the hook service (Settings → Hook Service → Restart)
2. Check that your Forgejo/Gitea instance is reachable
3. Verify the webhook URL in your Forgejo repository settings points to the
   correct host and port

**Q: An agent keeps failing on the same task.**

Note the error shown in the agent's status. Common causes:
- **Quota exhausted** — wait for usage to reset
- **Permission denied** — approve the pending permission
- **API error** — retry; transient failures often resolve themselves
- **Persistent failure** — escalate to the Front Desk with the error details

**Q: How do I change which AI model a role uses?**

Go to Settings → Agent Role Models. Select the role (Front Desk, Orchestrator,
or Coding Worker) and pick a different model from the dropdown. Changes take
effect on the next agent spawn.

**Q: The board looks messy with lots of labels.**

That's normal during setup. The label system uses a scoping convention (`scope/value`)
so related labels group together. Over time, as tasks progress through the
lifecycle, older labels are replaced by newer ones (applying a new label in the
same scope removes the old one automatically).

### Emergency Controls

| Situation | Action |
| --- | --- |
| Something is going wrong fast | `/stop` on any issue, or set `flag/stop-work` |
| One repo is causing problems | Pause that repo from the Agents & Fleet tab |
| Queue is wedged (not draining) | Settings → Hook Queues → Drain |
| Need a fresh start on an issue | `/rework` with explanation, or `/hold` then reopen later |
| Agent is stuck in a loop | Archive the agent from the Agents & Fleet tab; the orchestrator will spawn a replacement |

### Getting Help

When you're unsure about something:

1. **Ask the Front Desk** — it's designed to handle questions and route them
   appropriately
2. **Check the log tail** — recent errors and events are logged there
3. **Look at the board** — the issue labels and comments tell you exactly where
   a task stands
4. **Check the Fleet Needs Attention banner** — if nothing is flagged there,
   the fleet is operating normally

---

*This guide covers the core daily operations of Uppidi Fleet. For technical
details about architecture, configuration, and development, see the full
[README](../README.md) and the developer documentation in the `docs/` folder.*

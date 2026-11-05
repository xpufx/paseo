# Uppidi Fleet

Uppidi Fleet is an autonomous engineering fleet orchestrator that turns a Forgejo or Gitea issue board into a full-lifecycle software engineering control plane.

The plugin coordinates a multi-agent hierarchy within Paseo: a Front Desk agent handles operator intake and conversation; repository orchestrators triage, shape, and dispatch tickets; and ephemeral coding agents implement features and fixes in isolated worktrees.

## Features and Capabilities

- **Unified Fleet Control Mode**: Manage fleet execution modes (`RUN`, `DRAIN`, `HALT`, `STOP`) with graceful shutdown and persistent state across daemon restarts.
- **Forgejo / Gitea Board Control Plane**: Uses issue boards as the single source of truth for work items, task states, labels, and agent progress envelopes.
- **Hierarchical Agent Orchestration**:
  - **Front Desk**: Conversational agent liaison for the operator, ingesting requirements and routing tasks.
  - **Orchestrator**: Repository-scoped agent that triages incoming tickets, shapes work plans, and dispatches tasks to coding agents.
  - **Coding Agents**: Ephemeral worker agents operating in dedicated git worktrees, executing tests, and submitting pull requests.
- **Work Queue & Ticket Board**: Kanban and table views of active tasks categorized by workflow stages (`state/triage`, `state/wip`, `state/review`, `state/done`).
- **CI Runner Fleet Telemetry**: Real-time monitoring of Docker-in-Docker CI runners, runner scaling, action workflows, and job logs.
- **Typed Fleet MCP Tools**: Comprehensive suite of MCP tools (`ticket_*`, `pr_*`, `ci_logs`, `fleet_*`) enabling agents to interact programmatically with the board.
- **Webhook Bridge**: Embedded HTTP webhook router (`hook-router`) receiving live event payloads from forge webhooks to trigger agent wakeups.

## Surfaces and UI

- **Cockpit Dashboard**: Master view presenting active agents, fleet mode status, queue throughput, and router health.
- **Agent Tree & Kanban**: Visual hierarchy of running agents alongside the live Forgejo issue board.
- **Work Queue**: Filterable inventory of open tasks, attention tags, and priority queues.
- **Front Desk Chat**: Integrated chat interface with the Front Desk agent.
- **Tooling & Settings**: Fleet configuration for hook endpoints, concurrency limits, and MCP injection policies.

## Setup and Requirements

- Requires Paseo 0.8.0 or later.
- Connects to a Forgejo or Gitea instance with webhook support.
- Requires Node.js runtime for the embedded webhook router and MCP server.

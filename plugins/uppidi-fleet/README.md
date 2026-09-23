# @xpufx/paseo-uppidi-fleet

**Dedicated, opinionated full-lifecycle autonomous engineering fleet surface (Cockpit) for Paseo.**

`uppidi-fleet` brings the complete Forgejo / Uppidi autonomous developer lifecycle into a first-class, dedicated top-level Paseo tab surface (parallel to **Agent**, **Terminal**, and **Explorer**).

Instead of managing issues through small modals or composer pills, `uppidi-fleet` provides an expansive, opinionated workspace (Cockpit) designed for orchestrators and operators to drive issues, pull requests, dispatch pipelines, and review cycles without ever leaving Paseo.

---

## Highlights

- **Dedicated Primary Surface & Workspace Tab Launcher**: Registered as a full sidebar tab (`addSidebarItem` + `addSurface`) and workspace panel (`addWorkspacePanel`), allowing Uppidi Fleet (Cockpit) to appear in the workspace New Tab (`+`) launcher menu and open as a tab.
- **Full Lifecycle Flow**:
  - **Triage & Backlog**: Filter by status, priority, and attention labels (`attention/0-orchestrator`, `attention/1-agent`, `attention/2-user`).
  - **Orchestration & Dispatch**: View orchestrator status, dispatch worktree jobs, and steer coding agents.
  - **In-Flight Queue**: Monitor active worktree runs, agent turns, and pending permissions across repos.
  - **Verification & Signoff**: Inspect diffs, review checklist items (`spec/1-checklist`), run signoff verifications, and drive PR merges.
- **First-Class Theme & Native UI**: The primary dashboard uses `paseo-plugin-helper` theme, layout, table, filter, status, and action components.
- **Static Mockup Tab**: The original visual dashboard mockup remains available from the dedicated **Static mockup** view tab for comparison and demos.
- **Daemon & RPC Native**: Seamlessly interfaces with Paseo workspaces and the local Forgejo hook service.

---

## Architecture

```
plugins/uppidi-fleet/
├── paseo-plugin.json      # Plugin manifest (requirements: paseo >= 0.8.0)
├── index.client.tsx       # Client entrypoint: registers sidebar surface & workspace panel launcher
├── index.server.ts       # Server RPC handlers & Forgejo API bridge
├── client/
│   ├── surface.tsx        # Top-level full-screen surface component (Cockpit)
│   ├── components/        # Kanban, issue list, PR inspector, activity streams
│   └── hooks/             # Reactive queries for issues, agents, and worktrees
├── server/
│   ├── forge-api.ts       # Forgejo REST & webhook synchronization
│   └── rpc.ts             # Plugin RPC contract implementations
└── shared/
    └── types.ts           # Shared data contracts (Issue, PR, Worktree, Orchestrator)
```

---

## Installation

### From the Paseo monorepo

Install directly from this repository's plugin path:
```bash
paseo plugin add xpufx/paseo --path plugins/uppidi-fleet
```

---

## Development

```bash
# Typecheck
npm run typecheck --workspace=plugins/uppidi-fleet

# Test
npm test --workspace=plugins/uppidi-fleet
```

---

## License

MIT © 2026 xpufx

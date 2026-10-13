# @xpufx/backend-tickets

Headless Forgejo issue tracker, label taxonomy, and Kanban state machine for Paseo.

## Subpath Exports & Runtime Boundary

This package is configured with `"sideEffects": false` and strict subpath exports to prevent Node built-ins (`fs`, `child_process`, `os`, `path`) from leaking into React Native, Hermes, and browser client bundles.

- `@xpufx/backend-tickets/client`: Pure types, Zod schemas, label colors, and Kanban card / transition pure logic. **Zero Node built-ins**.
- `@xpufx/backend-tickets/shared`: Canonical label taxonomy, multi-repo group definitions, automation tiers, and bi-directional flight control helpers.
- `@xpufx/backend-tickets/server`: All shared exports plus Forgejo API client, git remote URL parsing, issue synchronization, and server handlers.
- `@xpufx/backend-tickets`: Root entrypoint re-exporting shared.

## Features

- **Canonical Label Taxonomy**: Strict mapping for state (`state/triage`, `state/wip`, `state/review`, `state/done`), priority (`priority/sos`, `priority/high`, etc.), attention, and targets.
- **Kanban State Engine**: Deterministic column mapping, forward and backward transition validation, and automation tier controls (`Full Fleet Active`, `Paused Fleet`, `Kanban-Only`).
- **Multi-Repo Association**: Cross-repository grouping (`All`, `Core`, `Active Sprint`) and project coordinate normalization.
- **Bi-Directional Flight Control**: Automated change-request steering and rollback detection for Review ➔ WIP transitions.

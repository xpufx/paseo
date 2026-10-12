# @xpufx/backend-fleet

Headless agent roster graph, worktree resolution, queue state machine, and watchdog anomaly classifier for Paseo.

## Subpath Exports & Runtime Boundary

This package is configured with `"sideEffects": false` and strict subpath exports to prevent Node built-ins (`fs`, `child_process`, `os`, `path`) from leaking into React Native, Hermes, and browser client bundles.

- `@xpufx/backend-fleet/client`: Pure types, Zod schemas, status light / health gauge calculators, transcript activity parsers, and client filters. **Zero Node built-ins**.
- `@xpufx/backend-fleet/shared`: All client exports plus pure state progression algorithms, worktree/project extractors, hierarchical tree builder, and the pure Watchdog anomaly classifier.
- `@xpufx/backend-fleet/server`: All shared exports plus daemon SDK / CLI roster aggregation, workspace/project file resolution, quota alert reading, and safe Paseo home directory resolution.
- `@xpufx/backend-fleet`: Root entrypoint aliasing server.

## Features

- **Deterministic Agent State Machine**: 12 fine-grained deterministic states mapped to provider-agnostic canonical lifecycle states (`running`, `waiting_for_input`, `idle`, `errored`, `completed`).
- **Headless Watchdog Anomaly Classifier**: Zero-token pure anomaly detector identifying turn concurrency locks, cancellation timeouts, zombie hung turns, provider quota exhaustion, stale error ghosting, idle amnesia, and repetitive tool loops.
- **Ordered Recovery Planner**: Generates conservative 4-step recovery pipelines (`stop` -> `clearError` -> `clearAttention` -> `steer`).
- **Workspace & Worktree Resolution**: Deterministic matcher resolving repository coordinates, canonical keys (`host/owner/repo`), and workspace IDs through daemon descriptors and local worktrees.

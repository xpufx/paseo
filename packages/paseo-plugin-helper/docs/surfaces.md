# Surface visibility contract

Single source of truth for every rendered surface (composer pills, timeline
cards, settings matrix). Pill and card must never disagree: both ask the same
predicates over the same data.

## The table

| | Data present | Data absent, source alive or unknown | Source known-dead |
|---|---|---|---|
| Surface selected | value | placeholder (`--`) | hidden on both surfaces |
| Surface not selected | hidden | hidden | hidden |

## Definitions

- **Selected**: the metric's surface target includes the surface being rendered
  (`pill`, `timeline`, or `both` in user settings).
- **Known-dead**: the producer is observably gone. Today that means one thing:
  a dependency plugin installed but not running (mcp-tools disabled). Dead is
  never placeholder material: placeholders promise future data, and a dead
  source makes no promises.
- **Not-yet-observed**: no data has arrived through any channel yet. Render the
  placeholder so the user's selection is visible and honored.
- **Historical cards are snapshots**: appended timeline rows record what was
  true at turn end, including liveness flags. They never rewrite; only live
  surfaces react to state changes.

## Rules for new metrics

1. Every metric renders through the shared predicates (`isSourceDead`,
   surface enablement), never through per-surface private logic.
2. Adding a metric without wiring both surfaces fails the gap suite.
3. A new dead-state source extends `isSourceDead`; the table does the rest.

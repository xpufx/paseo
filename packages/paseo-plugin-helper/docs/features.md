# Feature Modules (`paseo-plugin-helper/shared`)

Feature modules are the composition primitive for plugins: a `FeatureModule` is
a self-contained, droppable unit of plugin functionality (custom pills, timeline
telemetry, permission auditing, …) that can be mounted into any plugin entry.

Phase 0 of [paseo#852](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/852)
freezes this interface and the lifecycle contract. It adds no behavior to
existing plugins: nothing in the library or the plugins changes until a plugin
entry explicitly chooses to compose with it.

```ts
import type { PluginRpcContract } from "paseo-plugin-helper/shared";

interface FeatureModule<TServerContext = unknown, TClientContext = unknown> {
  id: string;
  contributeServer?(server: TServerContext): (() => void) | void;
  contributeClient?(client: TClientContext): (() => void) | void;
  contracts?: Record<string, PluginRpcContract>;
}
```

`TServerContext` / `TClientContext` are generic because
`paseo-plugin-helper/shared` imports no Paseo SDK modules. Type a module with
the SDK contexts at the definition site:

```ts
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { FeatureModule } from "paseo-plugin-helper/shared";

export const customPills: FeatureModule<PluginServerContext, PluginClientContext> = {
  id: "custom-pills",
  contracts: { list: listCustomPillsRpc, run: runCustomPillModalCommandRpc },
  contributeServer(server) {
    const { unsubscribe } = registerCustomPillsServer(server);
    return unsubscribe;
  },
  contributeClient(client) {
    return registerCustomPills(client);
  },
};
```

## Field contract

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `id` | yes | Stable, plugin-unique module id (`"custom-pills"`). Used for diagnostics and, in later phases, feature dependency resolution. Must be a non-empty string. |
| `contributeServer` | no | Runs once against the plugin's `PluginServerContext`. Returns an idempotent disposer, or `void` when it owns nothing to release. |
| `contributeClient` | no | Runs once against the plugin's `PluginClientContext`. Returns an idempotent disposer, or `void`. |
| `contracts` | no | Declarative RPC contracts keyed by a local name. Not registered automatically — the composing entry still calls `server.handle(contract, handler)`. |

A module may contribute to one side, both, or neither. `contracts` is metadata
so a composing plugin (or, in Phase 3, a depending plugin) can discover what a
feature exposes without importing its implementation.

## Lifecycle contract

1. **Every `contribute*` returns an idempotent disposer.** A disposer may be
   called more than once; the second and later calls are no-ops. A hook that
   owns nothing returns `void` instead of a disposer.
2. **A plugin entry composes feature modules and returns a combined disposer.**
   The entry's own `contribute(server)` / `contribute(client)` passes the host
   context to the composition and returns its combined disposer unchanged.
3. **Teardown is reverse-order (LIFO).** Modules contributed last are disposed
   first, which matches the dependency order of typical plugin setups.
4. **A failed contribution never leaks.** If one module's hook throws while
   composing, the already-contributed modules are disposed before the error is
   re-thrown.
5. **Teardown is best-effort.** If one module's disposer throws, every remaining
   disposer still runs; the first error is re-thrown afterwards. The combined
   disposer remains idempotent and does not re-throw on a second call.
6. **Composition is validated eagerly.** Duplicate module `id`s and duplicate
   RPC contract `name`s across modules throw at `composeFeatureModules` time,
   not at runtime contribution time.

`composeFeatureModules` wraps every disposer it receives, so the *composed*
teardown is idempotent even if an individual module forgot to guard its own.

## Composition

```ts
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { composeFeatureModules } from "paseo-plugin-helper/shared";
import { customPills } from "./features/custom-pills.js";
import { timelineTelemetry } from "./features/timeline-telemetry.js";

const features = composeFeatureModules<PluginServerContext, PluginClientContext>([
  customPills,
  timelineTelemetry,
]);

export function contributeServer(server: PluginServerContext) {
  return features.contributeServer(server);
}

export function contributeClient(client: PluginClientContext) {
  return features.contributeClient(client);
}
```

`composeFeatureModules(modules)` returns:

| Member | Meaning |
| :--- | :--- |
| `ids` | Module ids in composition order. |
| `contracts` | Every declared contract, flattened in module order. Throws on duplicate `name`s. |
| `contributeServer(ctx)` | Runs each `contributeServer` in order; returns one combined, idempotent disposer. |
| `contributeClient(ctx)` | Runs each `contributeClient` in order; returns one combined, idempotent disposer. |

The helper is intentionally small: it owns ordering, teardown, idempotency, and
composition validation — not registration policy. Handlers, subscriptions, and
surfaces are still registered by the feature module; the composition only
guarantees they are mounted and unmounted once, in a predictable order.

## Testing a feature module

Because a module is just an object, test it in isolation with the helper's mock
contexts (`paseo-plugin-helper/testing`) or a plain stub, and assert that its
disposer is idempotent:

```ts
const dispose = customPills.contributeServer!(mockServer);
dispose();
dispose(); // must not throw or double-unsubscribe
```

`composeFeatureModules` is covered by
`src/__tests__/features.test.ts` (ordering, LIFO teardown, idempotency,
partial-failure cleanup, and validation).

## Out of scope for Phase 0

- No plugin is migrated to feature modules yet (Phase 2).
- No scaffolding or shared feature test harness (Phase 5).
- No UI is removed here; #924 owns UI extraction.


## Phase 3 — plugin-to-plugin feature dependencies

A plugin may declare that it depends on feature modules provided by another
plugin in its `paseo-plugin.json`:

```json
{
  "id": "my-plugin",
  "requirements": { "paseo": ">=0.9.0" },
  "dependencies": {
    "top": ["top-custom-pills", "top-timeline-telemetry"],
    "permission-audit": ["permission-audit"]
  }
}
```

`dependencies` is an optional map of **provider plugin id** -> array of
**feature module ids** that the depending plugin needs at runtime. Both keys
and values must be non-empty strings; module id arrays must not contain
duplicates.

### Validation (CLI)

`paseo-plugin-helper audit` validates the shape of `dependencies` and reports
`invalid-feature-dependencies` (error) when:

- `dependencies` is not an object,
- a plugin id is empty/whitespace,
- a value is not an array,
- an entry is not a non-empty string, or
- an array contains duplicate ids.

### Runtime resolution

Use `resolveFeatureDependencies` (available from `paseo-plugin-helper/shared`
and `paseo-plugin-helper/server`) to validate and resolve declared dependencies
against installed/running plugins:

```ts
import { resolveFeatureDependencies } from "paseo-plugin-helper/server";

const resolution = await resolveFeatureDependencies(manifest.dependencies, context);
if (!resolution.satisfied) {
  // resolution.missingPlugins / resolution.missingFeatures describe the gap
}
```

The resolver returns:

| Field | Meaning |
| :--- | :--- |
| `satisfied` / `ok` | True when every declared dependency is available. |
| `valid` | True when the declaration is well-formed. |
| `dependencies` | Per-provider records (`pluginId`, `featureModuleIds`, `available`, `missingFeatureModuleIds`, `satisfied`). |
| `missingPlugins` | Provider plugin ids that are not installed/enabled/running. |
| `missingFeatures` | Providers whose requested module ids are not exposed. |
| `errors` | Shape validation errors. |
| `resolved` / `missing` | Convenience partitions of `dependencies`. |

A pure, synchronous variant is available from `paseo-plugin-helper/shared` that
resolves against an explicit feature registry instead of the daemon:

```ts
import { resolveFeatureDependencies } from "paseo-plugin-helper/shared";

const resolution = resolveFeatureDependencies(manifest.dependencies, {
  availableFeatures: {
    top: ["top-custom-pills", "top-timeline-telemetry"],
  },
});
```

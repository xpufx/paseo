import type { PluginRpcContract } from "./rpc.js";

/**
 * Cleanup handle returned by a feature contribution.
 *
 * A disposer MUST be idempotent: calling it more than once must not throw and
 * must not tear down anything twice. `composeFeatureModules` additionally
 * wraps every disposer it receives so the *composed* teardown is idempotent
 * even if an individual module forgets.
 */
export type FeatureDisposer = () => void;

/**
 * A self-contained, droppable unit of plugin functionality.
 *
 * A feature module owns one concern (custom pills, timeline telemetry,
 * permission auditing, …) and exposes it through up to two contribution hooks:
 * `contributeServer` for the daemon-side `PluginServerContext` and
 * `contributeClient` for the client-side `PluginClientContext`. Both hooks are
 * optional; a module may contribute to one side, both, or neither.
 *
 * Lifecycle contract
 * ------------------
 * - A contribution hook runs at most once per `contribute*` call on the
 *   composing plugin entry.
 * - It may return a {@link FeatureDisposer} for cleanup, or `void` when it owns
 *   nothing to release.
 * - Returned disposers MUST be idempotent (see {@link FeatureDisposer}).
 * - The plugin entry composes modules with {@link composeFeatureModules} and
 *   returns the combined disposer to Paseo.
 * - `contracts` is declarative metadata (name-keyed RPC contracts the module
 *   owns); it is not registered automatically. The composing entry still calls
 *   `server.handle(contract, handler)`.
 *
 * Context types are generic because `paseo-plugin-helper/shared` must not
 * import the Paseo SDK. Type a module with the SDK contexts at the call site:
 *
 * ```ts
 * import type { PluginClientContext } from "@getpaseo/plugin/client";
 * import type { PluginServerContext } from "@getpaseo/plugin/server";
 * import type { FeatureModule } from "paseo-plugin-helper/shared";
 *
 * export const customPills: FeatureModule<PluginServerContext, PluginClientContext> = {
 *   id: "custom-pills",
 *   contracts: { list: listCustomPillsRpc },
 *   contributeServer(server) {
 *     const { unsubscribe } = registerCustomPillsServer(server);
 *     return unsubscribe;
 *   },
 *   contributeClient(client) {
 *     const remove = registerCustomPills(client);
 *     return remove;
 *   },
 * };
 * ```
 */
export interface FeatureModule<
  TServerContext = unknown,
  TClientContext = unknown,
> {
  /** Stable, plugin-unique module id (e.g. `"custom-pills"`). */
  readonly id: string;
  /** Daemon-side contribution. Returns an idempotent disposer, or `void`. */
  readonly contributeServer?: (server: TServerContext) => FeatureDisposer | void;
  /** Client-side contribution. Returns an idempotent disposer, or `void`. */
  readonly contributeClient?: (client: TClientContext) => FeatureDisposer | void;
  /** RPC contracts this module owns, keyed by a local name. */
  readonly contracts?: Record<string, PluginRpcContract>;
}

/**
 * A composed set of feature modules. `contributeServer` / `contributeClient`
 * run every module's hook for that side and return a single combined,
 * idempotent disposer that tears the modules down in reverse order.
 */
export interface FeatureComposition<
  TServerContext = unknown,
  TClientContext = unknown,
> {
  /** Module ids in composition order. */
  readonly ids: readonly string[];
  /** Every declared contract, flattened in module order and de-duplicated. */
  readonly contracts: readonly PluginRpcContract[];
  /** Run all `contributeServer` hooks; returns the combined disposer. */
  contributeServer(server: TServerContext): FeatureDisposer;
  /** Run all `contributeClient` hooks; returns the combined disposer. */
  contributeClient(client: TClientContext): FeatureDisposer;
}

function toIdempotentDisposer(disposer: FeatureDisposer): FeatureDisposer {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    disposer();
  };
}

/**
 * Run a set of disposers in reverse (LIFO) order. Every disposer runs even if
 * an earlier one throws; the first error is re-thrown after teardown finishes.
 */
function disposeAll(disposers: readonly FeatureDisposer[]): void {
  let hasError = false;
  let firstError: unknown;
  for (let i = disposers.length - 1; i >= 0; i -= 1) {
    try {
      disposers[i]!();
    } catch (error) {
      if (!hasError) {
        hasError = true;
        firstError = error;
      }
    }
  }
  if (hasError) throw firstError;
}

/**
 * Collect the disposers produced by a per-side contribution hook. If a module
 * throws mid-composition, already-contributed modules are disposed before the
 * error is re-thrown so a failed composition never leaks partial state.
 */
function runContributions<TServerContext, TClientContext>(
  modules: readonly FeatureModule<TServerContext, TClientContext>[],
  contribute: (
    module: FeatureModule<TServerContext, TClientContext>,
  ) => FeatureDisposer | void,
): FeatureDisposer {
  const disposers: FeatureDisposer[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeAll(disposers);
  };

  try {
    for (const module of modules) {
      const result = contribute(module);
      if (typeof result === "function") {
        disposers.push(toIdempotentDisposer(result));
      }
    }
  } catch (error) {
    // Roll back what already mounted, but never let a failing disposer mask
    // the contribution error that triggered the rollback.
    try {
      dispose();
    } catch {
      // ignored
    }
    throw error;
  }

  return dispose;
}

function assertUniqueModules<TServerContext, TClientContext>(
  modules: readonly FeatureModule<TServerContext, TClientContext>[],
): void {
  const seen = new Set<string>();
  for (const module of modules) {
    const id = typeof module.id === "string" ? module.id.trim() : "";
    if (!id) {
      throw new Error("Feature module id must be a non-empty string");
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate feature module id "${id}"`);
    }
    seen.add(id);
  }
}

function collectContracts<TServerContext, TClientContext>(
  modules: readonly FeatureModule<TServerContext, TClientContext>[],
): readonly PluginRpcContract[] {
  const contracts: PluginRpcContract[] = [];
  const seen = new Set<string>();
  for (const module of modules) {
    for (const contract of Object.values(module.contracts ?? {})) {
      if (seen.has(contract.name)) {
        throw new Error(
          `Duplicate RPC contract "${contract.name}" across feature modules`,
        );
      }
      seen.add(contract.name);
      contracts.push(contract);
    }
  }
  return Object.freeze(contracts);
}

/**
 * Compose {@link FeatureModule}s into one contribution unit for a plugin entry.
 *
 * Modules run in array order on contribution and are disposed in reverse (LIFO)
 * order. The returned combined disposer is idempotent: calling it twice runs
 * teardown once and never throws the first error a second time.
 *
 * ```ts
 * import type { PluginClientContext } from "@getpaseo/plugin/client";
 * import type { PluginServerContext } from "@getpaseo/plugin/server";
 * import { composeFeatureModules } from "paseo-plugin-helper/shared";
 * import { customPills } from "./features/custom-pills.js";
 * import { timelineTelemetry } from "./features/timeline-telemetry.js";
 *
 * const features = composeFeatureModules<PluginServerContext, PluginClientContext>([
 *   customPills,
 *   timelineTelemetry,
 * ]);
 *
 * export function contributeServer(server: PluginServerContext) {
 *   return features.contributeServer(server);
 * }
 *
 * export function contributeClient(client: PluginClientContext) {
 *   return features.contributeClient(client);
 * }
 * ```
 *
 * @throws if two modules share an `id` or declare the same RPC contract `name`.
 */
export function composeFeatureModules<
  TServerContext = unknown,
  TClientContext = unknown,
>(
  modules: readonly FeatureModule<TServerContext, TClientContext>[],
): FeatureComposition<TServerContext, TClientContext> {
  const list = [...modules];
  assertUniqueModules(list);
  const contracts = collectContracts(list);

  return {
    ids: Object.freeze(list.map((module) => module.id)),
    contracts,
    contributeServer(server) {
      return runContributions(list, (module) => module.contributeServer?.(server));
    },
    contributeClient(client) {
      return runContributions(list, (module) => module.contributeClient?.(client));
    },
  };
}

export * from "./feature-dependencies.js";

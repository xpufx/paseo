/**
 * Paseo Plugin Helper — Core Runtime (Headless, CLIENT-SAFE).
 *
 * Import from `paseo-plugin-helper/core` for everything headless that must
 * also load in the plugin CLIENT bundle: RPC contracts, query/mutation
 * hooks, settings sync hooks, and pure formatters.
 *
 * Client/server boundary (#219): this entry MUST NOT re-export `../server/*`
 * or `../mcp/*` — those pull `node:*` built-ins (fs, child_process, …) which
 * the 0.8 client compiler rejects. Server-only primitives stay in
 * `paseo-plugin-helper/server` (and MCP in `paseo-plugin-helper/mcp`).
 *
 * Purity contract (enforced by `src/__tests__/core-purity.test.ts`):
 * - No runtime import of `react-native` or any UI component.
 * - No `node:*` (or bare Node builtin) imports.
 * - No DOM/CSS variable scraper (`theme/host-variables`).
 * - No layout opinions (`layout/`, `components/`, `ModalBody`, `maxContentWidth`).
 *
 * React (not React Native) is the only view-layer dependency here, via
 * `@tanstack/react-query` hooks. Host RPC access flows through the injected
 * `useRpc` seam in `client/host.js`, which itself carries only type-level
 * `react-native` imports (erased at runtime).
 */

export * from "../shared/rpc.js";
export * from "../shared/settings.js";
export * from "../shared/suite-settings.js";
export * from "../shared/formatters.js";
export * from "../shared/async.js";
export * from "../shared/highlight.js";
export * from "../shared/forge.js";
export * from "../shared/custom-pills.js";
export * from "../shared/suppressed.js";
export * from "../shared/types.js";

export {
  initClientHelpers,
  getClientHost,
  getOptionalClientHost,
  isClientHostInitialized,
  selectHostScrollView,
} from "../client/host.js";
export type {
  ClientHostDeps,
  HostTheme,
  HostThemeColors,
  HostLayout,
  HostToast,
  HostUseToast,
  HostUseRpc,
  HostRpcContract,
  HostCopyText,
  HostAgentsApi,
  HostAgentRef,
  HostAgentUpdate,
  PluginCleanup,
} from "../client/host.js";

export * from "../client/query.js";
export * from "../client/query-refresh.js";
export * from "../client/settings.js";
export * from "../client/shared-settings.js";
export * from "../client/snapshot.js";
export * from "../client/command-center.js";

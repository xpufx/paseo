/**
 * Paseo Plugin Helper — Core Runtime (Headless).
 *
 * Import from `paseo-plugin-helper/core` for everything that is NOT UI:
 * RPC contracts & handlers, query/mutation hooks, settings storage & sync,
 * daemon lifecycle, MCP tool registration, and pure formatters.
 *
 * Purity contract (enforced by `src/__tests__/core-purity.test.ts`):
 * - No runtime import of `react-native` or any UI component.
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

export * from "../server/storage.js";
export * from "../server/settings.js";
export * from "../server/shared-settings.js";
export * from "../server/jsonc.js";
export * from "../server/redact.js";
export * from "../server/process.js";
export * from "../server/system.js";
export * from "../server/logger.js";
export * from "../server/version.js";
export * from "../server/network.js";
export * from "../server/task.js";
export * from "../server/mcp-config.js";
export * from "../server/mcp-injection.js";
export * from "../server/plugins.js";
export * from "../server/rpc-guard.js";
export * from "../server/agent.js";
export * from "../server/workspace-beacon.js";

export * from "../mcp/index.js";

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

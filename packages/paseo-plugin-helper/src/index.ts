/**
 * Paseo Plugin Helper - Root Entrypoint
 *
 * For platform-safe imports in your Paseo plugins, import directly from the subpaths:
 * - `paseo-plugin-helper/core`     -> Headless runtime: RPC contracts, query/mutation
 *   hooks, settings storage & sync, daemon lifecycle, MCP tools, pure formatters.
 *   Zero React Native UI, zero CSS scrapers, zero layout opinions (#219).
 * - `paseo-plugin-helper/ui`       -> Host-delegating adapters (HostModalContent,
 *   HostScroll, upstream-shaped settings renderer) conforming to
 *   `@getpaseo/plugin/client/ui` and `@getpaseo/plugin/client/react-native`.
 * - `paseo-plugin-helper/client`  -> Legacy full bundle (frozen bespoke components
 *   + headless hooks; prefer `core` + `ui` for new code)
 * - `paseo-plugin-helper/server`  -> Node-safe server storage, JSONC, and safe process spawning
 * - `paseo-plugin-helper/shared`  -> Shared RPC contracts, types, and formatters
 * - `paseo-plugin-helper/testing` -> Client and server testing harnesses
 */

export * from "./shared/index.js";

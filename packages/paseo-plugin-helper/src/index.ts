/**
 * Paseo Plugin Helper - Root Entrypoint
 *
 * For platform-safe imports in your Paseo plugins, import directly from the subpaths:
 * - `paseo-plugin-helper/client`  -> React Native components, theming, visual flair & query hooks
 * - `paseo-plugin-helper/server`  -> Node-safe server storage, JSONC, and safe process spawning
 * - `paseo-plugin-helper/shared`  -> Shared RPC contracts, types, and formatters
 * - `paseo-plugin-helper/testing` -> Client and server testing harnesses
 */

export * from "./shared/index.js";

/**
 * Paseo Plugin Helper — Lifecycle (headless, client-safe, UI-free).
 *
 * Import from `paseo-plugin-helper/lifecycle` for the host-registration
 * engines — composer pills, sidebar surfaces, workspace/agent panels — plus
 * clipboard and haptics helpers. These are client-bundle safe (React Native,
 * no `node:*`) but intentionally separate from `paseo-plugin-helper/core`,
 * whose purity contract forbids `react-native`.
 *
 * The bespoke `client/` design system was removed (#938); this entry mounts
 * the host theme itself and imports only the headless host seam from `core`.
 */
export * from "./pill.js";
export * from "./surface.js";
export * from "./panel.js";
export * from "./clipboard.js";
export * from "./haptics.js";
export * from "./scroll-owner.js";
export * from "./host-theme.js";
export * from "./host-color.js";
export * from "./flair.js";
export * from "./providers.js";
export * from "./multi-host.js";

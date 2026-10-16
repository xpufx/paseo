/**
 * Paseo Plugin Helper — UI Kit / Adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, composable adapters strictly conforming to upstream native
 * primitives. Rules for everything in this entry:
 *
 * - Scroll ownership stays with the host (`Modal.Content` default
 *   `scrollable`; explicit host `ScrollView` only where the host supplies
 *   no scroller). Never force `scrollable={false}` plus a helper-owned
 *   replacement scroller. No scroll-ownership state machine.
 * - No artificial width caps: no `maxContentWidth`, no `size="large"` with
 *   hardcoded `minWidth`. Fill the host-allocated frame fluidly.
 * - No DOM CSS variable scrapers: colors arrive via the host `theme` prop
 *   through `HostThemeProvider` — never from `getComputedStyle`.
 * - Upstream settings primitives come from the host bundle
 *   (`@getpaseo/plugin/client/ui`), injected by the plugin — never
 *   re-implemented here.
 *
 * This is the only UI the package ships: the legacy bespoke kit was removed
 * in #938, and the CLI audit flags new `maxContentWidth` / `scrollable={false}`
 * uses with pointers here.
 *
 * Module map:
 * - `ui/theme.tsx` — `HostThemeProvider` / `useHostTheme` (host colors only)
 * - `ui/color.ts` — `alpha()` and status color helpers (pure)
 * - `ui/modal.tsx` — `HostModalContent` / `HostScroll` / `HostModalSection`
 * - `ui/layout.tsx` — `HostStack` / `HostRow` / `HostGrid` / `HostActionBar` / `HostFormRow`
 * - `ui/content.tsx` — `HostCard` / `HostTabs` / `HostBadge` / `HostKeyValue` / …
 * - `ui/controls.tsx` — `HostButton` / `HostToggle` / `HostSelect` / `HostTextInput` / …
 * - `ui/text.tsx` — `HostCodeBlock` / `HostCommandBox` / `HostTruncatedText` / …
 * - `ui/data.tsx` — `HostDataTable`
 * - `ui/settings.ts` — settings screen adapters over the host ui bundle
 */

export * from "./theme";
export * from "./color";
export * from "./modal";
export * from "./layout";
export * from "./content";
export * from "./controls";
export * from "./text";
export * from "./data";
export * from "./settings";
export { PluginReloadBanner } from "./plugin-reload-banner";

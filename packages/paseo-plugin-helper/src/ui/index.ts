/**
 * Paseo Plugin Helper — UI Kit / Adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, composable adapters strictly conforming to upstream native
 * primitives. Rules for everything in this entry:
 *
 * - Scroll ownership stays with the host (`Modal.Content` default
 *   `scrollable`; explicit host `ScrollView` only where the host supplies
 *   no scroller). Never force `scrollable={false}` plus a helper-owned
 *   replacement scroller.
 * - No artificial width caps: no `maxContentWidth`, no `size="large"` with
 *   hardcoded `minWidth`. Fill the host-allocated frame fluidly.
 * - No DOM CSS variable scrapers: colors arrive via the host `theme` prop.
 * - Upstream settings primitives come from the host bundle
 *   (`@getpaseo/plugin/client/ui`), injected by the plugin — never
 *   re-implemented here.
 *
 * Legacy bespoke components (`ModalBody`, `ModalContent`, `Card`, `Button`,
 * …) remain available from `paseo-plugin-helper/client` for compatibility
 * but are frozen: no new features, and the CLI audit flags new
 * `maxContentWidth` / `scrollable={false}` uses with pointers here.
 */

export * from "./modal.js";
export * from "./settings.js";

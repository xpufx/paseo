import { createContext } from "react";

/**
 * Scroll-ownership signal emitted by the lifecycle registration engines.
 *
 * - `"helper"` — the default; the content owns its own scrolling.
 * - `"host"` — an ancestor host view already provides the one scroller
 *   (0.8 composer popovers), so the content renders plain.
 * - `"required"` — the ancestor has NO host scroller and the content is
 *   host-sized, so it MUST own the scroll on every surface. Set by
 *   `registerSidebarSurface` (a plugin surface is a full host page whose body
 *   is not wrapped in a host scroller).
 * - `"popover"` — the host anchored-popover already supplies the sole scroller.
 *
 * The context lives in `lifecycle/` so the registration engines can mark the
 * subtrees they render without importing any UI kit. It survived the removal of
 * the bespoke `ModalBody` reader (#938) as a signal plugins and the host can
 * still consume.
 */
export type ModalBodyScrollOwner = "helper" | "host" | "required" | "popover";

const SCROLL_OWNER_CONTEXT_KEY = Symbol.for("paseo.modalBodyScrollOwnerContext");

export const ModalBodyScrollOwnerContext: React.Context<ModalBodyScrollOwner> =
  ((globalThis as any)[SCROLL_OWNER_CONTEXT_KEY] ??= createContext<ModalBodyScrollOwner>("helper"));


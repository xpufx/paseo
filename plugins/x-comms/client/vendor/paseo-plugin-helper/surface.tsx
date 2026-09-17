import React, { type ComponentType } from "react";
import type { HostSurfaceProps as PluginSurfaceProps } from "./host";
import { PluginThemeProvider } from "./theme/provider";
import { ModalBodyScrollOwnerContext } from "./layout/ModalBody";
import type { VisualFlair } from "./theme/flair";

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
export interface SidebarSurfaceRegistrar {
  addSurface(surfaceId: string, Component: ComponentType<PluginSurfaceProps>): any;
  addSidebarItem(contribution: any): any;
}

export interface RegisterSidebarSurfaceOptions {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<PluginSurfaceProps>;
  flair?: VisualFlair;
}

/**
 * Registers a sidebar icon and corresponding full-page surface in a single call,
 * automatically injecting `<PluginThemeProvider>` with custom visual flair.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 *
 * A sidebar surface is a full host page: Paseo routes to it directly and does
 * NOT wrap the surface body in a host scroller (unlike `<Modal.Content>`, which
 * bounds the dialog and supplies the outer scroll). Any `ModalBody` in the
 * subtree would therefore pick the plain, non-scrolling branch on a
 * non-compact desktop and clip overflowing content — the recurring
 * "plugin page does not scroll" bug. Marking the subtree with the
 * `"required"` scroll-owner context makes every `ModalBody` inside own the
 * scroll on every surface, so plugins inherit working scroll with no
 * per-plugin workaround.
 *
 * Returns an idempotent disposer that removes both the surface and the sidebar
 * item, matching every other helper `add*` registration. Existing callers that
 * ignore the return value are unaffected.
 */
export function registerSidebarSurface(
  plugin: SidebarSurfaceRegistrar,
  options: RegisterSidebarSurfaceOptions,
): () => void {
  const { id, title, icon, Component, flair } = options;

  const WrappedComponent: ComponentType<PluginSurfaceProps> = (props) => (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={flair}>
      <ModalBodyScrollOwnerContext.Provider value="required">
        <Component {...props} />
      </ModalBodyScrollOwnerContext.Provider>
    </PluginThemeProvider>
  );

  const surfaceRegistration = plugin.addSurface(id, WrappedComponent);
  const itemRegistration = plugin.addSidebarItem({
    id,
    title,
    icon,
    surface: id,
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // Host registrations expose `remove()`; tolerate hosts that return a bare
    // function or nothing so cleanup never throws.
    for (const registration of [itemRegistration, surfaceRegistration]) {
      if (!registration) continue;
      if (typeof registration === "function") {
        (registration as () => void)();
      } else if (typeof registration.remove === "function") {
        registration.remove();
      }
    }
  };
}

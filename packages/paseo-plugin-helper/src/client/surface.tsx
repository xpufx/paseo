import React, { type ComponentType } from "react";
import type { HostSurfaceProps as PluginSurfaceProps } from "./host.js";
import { PluginThemeProvider } from "./theme/provider.js";
import { ModalBodyScrollOwnerContext } from "./layout/ModalBody.js";
import type { VisualFlair } from "./theme/flair.js";

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
 */
export function registerSidebarSurface(
  plugin: SidebarSurfaceRegistrar,
  options: RegisterSidebarSurfaceOptions,
): void {
  const { id, title, icon, Component, flair } = options;

  const WrappedComponent: ComponentType<PluginSurfaceProps> = (props) => (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={flair}>
      <ModalBodyScrollOwnerContext.Provider value="required">
        <Component {...props} />
      </ModalBodyScrollOwnerContext.Provider>
    </PluginThemeProvider>
  );

  plugin.addSurface(id, WrappedComponent);
  plugin.addSidebarItem({
    id,
    title,
    icon,
    surface: id,
  });
}

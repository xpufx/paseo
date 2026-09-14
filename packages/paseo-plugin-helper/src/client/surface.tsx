import React, { type ComponentType } from "react";
import type { HostSurfaceProps as PluginSurfaceProps } from "./host.js";
import { PluginThemeProvider } from "./theme/provider.js";
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
 */
export function registerSidebarSurface(
  plugin: SidebarSurfaceRegistrar,
  options: RegisterSidebarSurfaceOptions,
): void {
  const { id, title, icon, Component, flair } = options;

  const WrappedComponent: ComponentType<PluginSurfaceProps> = (props) => (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={flair}>
      <Component {...props} />
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

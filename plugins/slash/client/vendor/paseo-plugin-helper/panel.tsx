import React, { type ComponentType } from "react";
import type {
  HostWorkspacePanelProps as PluginWorkspacePanelProps,
  HostAgentPanelProps as PluginAgentPanelProps,
} from "./host";
import { PluginThemeProvider } from "./theme/provider";
import type { VisualFlair } from "./theme/flair";

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
export interface WorkspacePanelRegistrar {
  addWorkspacePanel(contribution: any): any;
}

export interface RegisterWorkspacePanelOptions {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<PluginWorkspacePanelProps>;
  flair?: VisualFlair;
  /** Host locations in which the panel should be available. */
  locations?: string[];
}

export interface RegisterAgentPanelOptions {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<PluginAgentPanelProps>;
  flair?: VisualFlair;
}

/**
 * Registers a workspace-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
export function registerWorkspacePanel(
  plugin: WorkspacePanelRegistrar,
  options: RegisterWorkspacePanelOptions,
): () => void {
  const { id, title, icon, Component, flair, locations } = options;

  const WrappedComponent: ComponentType<PluginWorkspacePanelProps> = (props) => (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={flair}>
      <Component {...props} />
    </PluginThemeProvider>
  );

  const registration = plugin.addWorkspacePanel({
    id,
    title,
    icon,
    context: "workspace",
    locations,
    Component: WrappedComponent,
  });

  return () => {
    if (typeof registration === "function") registration();
    else registration?.remove?.();
  };
}

/**
 * Registers an agent-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
export function registerAgentPanel(
  plugin: WorkspacePanelRegistrar,
  options: RegisterAgentPanelOptions,
): void {
  const { id, title, icon, Component, flair } = options;

  const WrappedComponent: ComponentType<PluginAgentPanelProps> = (props) => (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={flair}>
      <Component {...props} />
    </PluginThemeProvider>
  );

  plugin.addWorkspacePanel({
    id,
    title,
    icon,
    context: "agent",
    Component: WrappedComponent,
  });
}

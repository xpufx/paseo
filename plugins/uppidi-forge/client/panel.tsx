import React from "react";
import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  ModalBodyScrollOwnerContext,
  PluginThemeProvider,
  type VisualFlair,
} from "paseo-plugin-helper/client";
import { UppidiForgeSurface } from "./surface.js";

export const UPPIDI_FORGE_FLAIR: VisualFlair = {
  radius: "rounded",
  density: "comfortable",
  surfaceStyle: "elevated",
  borderWidth: 1,
  headingTransform: "none",
};

export function UppidiForgePanel(props: PluginWorkspacePanelProps) {
  return (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={UPPIDI_FORGE_FLAIR}>
      <ModalBodyScrollOwnerContext.Provider value="required">
        <UppidiForgeSurface {...props} />
      </ModalBodyScrollOwnerContext.Provider>
    </PluginThemeProvider>
  );
}

export { UppidiForgePanel as UppidiForgeWorkspacePanel };

export function registerWorkspacePanel(client: PluginClientContext) {
  return client.addWorkspacePanel({
    id: "uppidi-forge",
    title: "Uppidi Forge",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: UppidiForgePanel,
  });
}

import React from "react";
import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  ModalBodyScrollOwnerContext,
  PluginThemeProvider,
  type VisualFlair,
} from "paseo-plugin-helper/client";
import { UppidiFleetSurface, UppidiForgeSurface } from "./surface.js";

export const UPPIDI_FLEET_FLAIR: VisualFlair = {
  radius: "rounded",
  density: "comfortable",
  surfaceStyle: "elevated",
  borderWidth: 1,
  headingTransform: "none",
};

export const UPPIDI_FORGE_FLAIR = UPPIDI_FLEET_FLAIR;

export function UppidiFleetPanel(props: PluginWorkspacePanelProps) {
  return (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={UPPIDI_FLEET_FLAIR}>
      <ModalBodyScrollOwnerContext.Provider value="required">
        <UppidiFleetSurface {...props} />
      </ModalBodyScrollOwnerContext.Provider>
    </PluginThemeProvider>
  );
}

export const UppidiForgePanel = UppidiFleetPanel;

export {
  UppidiFleetPanel as UppidiFleetWorkspacePanel,
  UppidiForgePanel as UppidiForgeWorkspacePanel,
};

export function registerWorkspacePanel(client: PluginClientContext) {
  return client.addWorkspacePanel({
    id: "uppidi-fleet",
    title: "Uppidi Fleet",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: UppidiFleetPanel,
  });
}

import React from "react";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { registerSidebarSurface } from "paseo-plugin-helper/lifecycle";
import { HostThemeProvider } from "./client/host-ui.js";
import { AgentMuxSurface } from "./client/agent-mux-surface.js";

export default function contribute(client: PluginClientContext) {
  initClientHelpers({ Icon, Modal, useRpc, useToast, ScrollView });

  const removeSurface = registerSidebarSurface(client, {
    id: "agent-mux",
    title: "Agent Mux",
    icon: "Layers",
    Component: (props: PluginSurfaceProps) => (
      <HostThemeProvider theme={props.theme}>
        <AgentMuxSurface />
      </HostThemeProvider>
    ),
  });

  const removeCommand = client.addCommandCenterItem({
    id: "open-agent-mux",
    title: "Open Agent Mux",
    icon: "Layers",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("agent-mux");
    },
  });

  return () => {
    removeCommand?.();
    removeSurface?.();
  };
}

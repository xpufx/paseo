import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerSidebarSurface } from "./client/vendor/paseo-plugin-helper/index";
import { MainSurface } from "./client/main";
import { crossDaemonTransformer, crossDaemonRenderer, outboxNoticeRenderer } from "./client/x-comms-timeline";
import { crossDaemonToolCallTransformer, crossDaemonToolCallRenderer } from "./client/x-comms-tool-call";
import { contributeClient } from "./client/x-comms-pill";
import { CrossDaemonPanel } from "./client/x-comms-panel";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  client.addTimelineTransformer(crossDaemonTransformer);
  client.addTimelineRenderer(crossDaemonRenderer);
  client.addTimelineRenderer(outboxNoticeRenderer);
  client.addTimelineTransformer(crossDaemonToolCallTransformer);
  client.addTimelineRenderer(crossDaemonToolCallRenderer);
  client.addWorkspacePanel({
    id: "x-comms",
    title: "X-comms",
    icon: "PhoneOutgoing",
    context: "agent",
    Component: CrossDaemonPanel,
  });
  // registerSidebarSurface injects <PluginThemeProvider> so the surface's
  // helper primitives resolve the host theme/layout (compact + mobile).
  registerSidebarSurface(client, {
    id: "main",
    title: "X-comms",
    icon: "PhoneOutgoing",
    Component: MainSurface,
  });
  const headerButtons = new Map<string, () => void>();
  const addHeaderButtonForWorkspace = (workspaceId: string) => {
    if (!workspaceId || headerButtons.has(workspaceId)) return;
    const registration = client.addHeaderButton({
      id: "x-comms",
      workspaceId,
      button: {
        title: "X-comms",
        icon: "PhoneOutgoing",
        behavior: { kind: "action", onPress: () => client.openSurface("main") },
      },
    });
    headerButtons.set(workspaceId, () => registration.remove());
  };
  const unsubscribeAgents = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert" || !update.agent.workspaceId) return;
    addHeaderButtonForWorkspace(update.agent.workspaceId);
  });
  // Register buttons for agents already present: subscribe only fires on
  // future upserts, so without this the icon is missing after a Paseo
  // restart until the next agent event.
  void Promise.resolve()
    .then(() => client.paseo.agents.list())
    .then(
      (res) => {
        const entries = Array.isArray(
          (res as unknown as { entries?: unknown }).entries,
        )
          ? (res as unknown as { entries: Array<{ agent?: { workspaceId?: unknown } }> }).entries
          : [];
        for (const { agent } of entries) {
          if (typeof agent?.workspaceId === "string") addHeaderButtonForWorkspace(agent.workspaceId);
        }
      },
      (err) => console.warn("[x-comms] Failed to list agents for header buttons:", err),
    );
  const disposePill = contributeClient(client);
  return () => {
    unsubscribeAgents();
    for (const remove of headerButtons.values()) remove();
    headerButtons.clear();
    disposePill();
  };
}

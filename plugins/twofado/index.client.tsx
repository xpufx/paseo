import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "./client/vendor/paseo-plugin-helper/index.ts";
import { ErrorBoundary } from "./client/error-boundary";
import {
  ApprovalHeaderIcon,
  ApprovalSurface,
  trackHeaderButton,
  untrackHeaderButton,
} from "./client/approvals";

export default function contribute(client: PluginClientContext) {
  initClientHelpers({ Icon, Modal, useRpc, useToast, ScrollView });

  const Surface = (props: PluginSurfaceProps) => (
    <ErrorBoundary label="approvals surface" fallback={null}>
      <ApprovalSurface {...props} />
    </ErrorBoundary>
  );
  client.addSurface("approvals", Surface);
  client.addSidebarItem({
    id: "approvals",
    title: "2fado",
    icon: "ShieldCheck",
    surface: "approvals",
  });
  client.addCommandCenterItem({
    id: "open-approvals",
    title: "Open 2fado",
    icon: "ShieldCheck",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("approvals");
    },
  });

  const buttons = new Map<string, () => void>();
  const addButton = (workspaceId: string) => {
    if (!workspaceId || buttons.has(workspaceId)) return;
    const registration = client.addHeaderButton({
      id: "twofado",
      workspaceId,
      button: {
        title: "2fado",
        icon: ApprovalHeaderIcon,
        behavior: { kind: "action", onPress: () => client.openSurface("approvals") },
      },
    });
    buttons.set(workspaceId, () => {
      untrackHeaderButton(workspaceId);
      registration.remove();
    });
    trackHeaderButton(workspaceId, registration);
  };
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert" || !update.agent.workspaceId) return;
    addButton(update.agent.workspaceId);
  });
  // Register buttons for agents already present: subscribe only fires on
  // future upserts, so without this the icon is missing after a Paseo
  // restart until the next agent event — including when the daemon is down
  // and the red down-state should be showing.
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
          if (typeof agent?.workspaceId === "string") addButton(agent.workspaceId);
        }
      },
      (err) => console.warn("[2fado] Failed to list agents for header buttons:", err),
    );

  return () => {
    unsubscribe();
    for (const remove of buttons.values()) remove();
    buttons.clear();
  };
}

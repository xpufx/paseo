import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  initClientHelpers,
  registerHelperSettingsScreen,
  registerSidebarSurface,
} from "paseo-plugin-helper/client";
import { ErrorBoundary } from "./client/error-boundary";
import {
  ApprovalHeaderIcon,
  ApprovalSurface,
  trackHeaderButton,
  untrackHeaderButton,
} from "./client/approvals";
import { approvalSettings } from "./shared/approval";

export default function contribute(client: PluginClientContext) {
  initClientHelpers({ Icon, Modal, useRpc, useToast, ScrollView });

  const removeSettings = registerHelperSettingsScreen(client, approvalSettings, {
    ui: { SettingsCard, SettingsSection, SettingsSwitch, SettingsSelect, SettingsInput },
    id: "twofado",
    title: "2fado",
    icon: "ShieldCheck",
  });

  const Surface = (props: PluginSurfaceProps) => (
    <ErrorBoundary label="approvals surface" fallback={null}>
      <ApprovalSurface {...props} />
    </ErrorBoundary>
  );
  // Helper primitive instead of a handrolled surface registration: besides
  // injecting the theme provider it marks the subtree as helper-scroll-owned,
  // so the page owns a working scroll region on a wide desktop window
  // (xpufx-org/paseo#213) rather than clipping.
  registerSidebarSurface(client, {
    id: "approvals",
    title: "2fado",
    icon: "ShieldCheck",
    Component: Surface,
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
    removeSettings();
    unsubscribe();
    for (const remove of buttons.values()) remove();
    buttons.clear();
  };
}

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import {
  initClientHelpers,
  registerComposerPill,
  registerSidebarSurface,
  registerWorkspacePanel,
} from "paseo-plugin-helper/client";
import {
  ISSUES_PILL_ID,
  ForgeIssuesModal,
  ForgeIssuesPanel,
} from "./client/issues-pill.js";
import { createForgeLabelResolver } from "./client/pill-label.js";
import {
  forgeLinkUserTransformer,
  forgeLinkAssistantTransformer,
  forgeLinkRenderer,
} from "./client/linkifier.js";
import {
  forgeBoardAlertUserTransformer,
  forgeBoardAlertAssistantTransformer,
  forgeBoardAlertRenderer,
} from "./client/board-alert.js";
import {
  forgejoWebhookUserTransformer,
  forgejoWebhookRenderer,
} from "./client/webhook-card.js";
import {
  forgejoNotificationRenderer,
} from "./client/notification-card.js";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  // Hook cards are registered before the linkifier: first-match-wins, and hook
  // messages carry a bare issue URL the linkifier would otherwise claim.
  const removeWebhookUser = client.addTimelineTransformer(forgejoWebhookUserTransformer);
  const removeWebhookRenderer = client.addTimelineRenderer(forgejoWebhookRenderer);
  const removeNotificationRenderer = client.addTimelineRenderer(forgejoNotificationRenderer);
  const removeUserLink = client.addTimelineTransformer(forgeLinkUserTransformer);
  const removeAssistantLink = client.addTimelineTransformer(forgeLinkAssistantTransformer);
  const removeLinkRenderer = client.addTimelineRenderer(forgeLinkRenderer);
  const removeBoardAlertUser = client.addTimelineTransformer(forgeBoardAlertUserTransformer);
  const removeBoardAlertAssistant = client.addTimelineTransformer(forgeBoardAlertAssistantTransformer);
  const removeBoardAlertRenderer = client.addTimelineRenderer(forgeBoardAlertRenderer);

  // RPC is host-provided and absent on some older hosts; the resolver degrades
  // to the workspace-name / ellipsis fallback instead of failing registration.
  const rawRpc = typeof client.rpc === "function" ? client.rpc.bind(client) : null;
  const forgeLabel = createForgeLabelResolver({
    rpc: (contract, input) =>
      rawRpc
        ? (rawRpc(contract as never, input as never) as Promise<unknown>)
        : Promise.reject(new Error("client.rpc unavailable")),
    resolveWorkspace: async (workspaceId) => {
      const workspace = await client.paseo.workspaces.ref(workspaceId).refresh();
      return workspace
        ? {
            directory: workspace.workspaceDirectory ?? undefined,
            projectRootPath: workspace.projectRootPath,
          }
        : null;
    },
  });

  const removePill = registerComposerPill(client, {
    id: ISSUES_PILL_ID,
    title: "issues",
    modalTitle: "Forge Issues",
    modalIcon: "GitPullRequest",
    icon: "GitPullRequest",
    resolveLabel: (ctx) => forgeLabel.resolve(ctx),
    refreshIntervalMs: 5000,
    renderModal: (props) => <ForgeIssuesModal {...props} />,
  });

  const removePanel = client.addWorkspacePanel({
    id: "forges-issues",
    title: "Forge Issues",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ForgeIssuesPanel,
  });

  return () => {
    removePanel();
    removePill();
    removeWebhookUser();
    removeWebhookRenderer();
    removeNotificationRenderer();
    removeUserLink();
    removeAssistantLink();
    removeLinkRenderer();
    removeBoardAlertUser();
    removeBoardAlertAssistant();
    removeBoardAlertRenderer();
  };
}

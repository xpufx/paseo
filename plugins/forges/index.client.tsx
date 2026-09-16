import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import {
  initClientHelpers,
  registerComposerPill,
} from "./client/vendor/paseo-plugin-helper/index.ts";
import {
  ISSUES_PILL_ID,
  ForgePill,
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

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
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
    renderPill: (props) => <ForgePill {...props} />,
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
    removeUserLink();
    removeAssistantLink();
    removeLinkRenderer();
    removeBoardAlertUser();
    removeBoardAlertAssistant();
    removeBoardAlertRenderer();
  };
}

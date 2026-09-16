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
  resolveForgeLabel,
} from "./client/issues-pill.js";
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

  const removePill = registerComposerPill(client, {
    id: ISSUES_PILL_ID,
    title: "issues",
    compactTitle: "iss",
    modalTitle: "Forge Issues",
    modalIcon: "GitPullRequest",
    icon: "GitPullRequest",
    resolveLabel: (ctx) => resolveForgeLabel(ctx),
    refreshIntervalMs: 0,
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

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import {
  initClientHelpers,
  registerComposerPill,
} from "./client/vendor/paseo-plugin-helper/index.ts";
import {
  ISSUES_PILL_ID,
  ForgejoPill,
  ForgejoIssuesModal,
  ForgejoIssuesPanel,
  resolveForgejoLabel,
} from "./client/issues-pill.js";
import {
  forgejoLinkUserTransformer,
  forgejoLinkAssistantTransformer,
  forgejoLinkRenderer,
} from "./client/linkifier.js";
import {
  forgejoBoardAlertUserTransformer,
  forgejoBoardAlertAssistantTransformer,
  forgejoBoardAlertRenderer,
} from "./client/board-alert.js";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  const removeUserLink = client.addTimelineTransformer(forgejoLinkUserTransformer);
  const removeAssistantLink = client.addTimelineTransformer(forgejoLinkAssistantTransformer);
  const removeLinkRenderer = client.addTimelineRenderer(forgejoLinkRenderer);
  const removeBoardAlertUser = client.addTimelineTransformer(forgejoBoardAlertUserTransformer);
  const removeBoardAlertAssistant = client.addTimelineTransformer(forgejoBoardAlertAssistantTransformer);
  const removeBoardAlertRenderer = client.addTimelineRenderer(forgejoBoardAlertRenderer);

  const removePill = registerComposerPill(client, {
    id: ISSUES_PILL_ID,
    title: "issues",
    compactTitle: "iss",
    modalTitle: "Forgejo Issues",
    modalIcon: "GitPullRequest",
    icon: "GitPullRequest",
    resolveLabel: (ctx) => resolveForgejoLabel(ctx),
    refreshIntervalMs: 0,
    renderPill: (props) => <ForgejoPill {...props} />,
    renderModal: (props) => <ForgejoIssuesModal {...props} />,
  });

  const removePanel = client.addWorkspacePanel({
    id: "forges-issues",
    title: "Forgejo Issues",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ForgejoIssuesPanel,
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

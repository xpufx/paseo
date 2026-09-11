import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import {
  initClientHelpers,
  registerComposerPill,
} from "paseo-plugin-helper/client";
import {
  ISSUES_PILL_ID,
  ForgejoPill,
  ForgejoIssuesModal,
  resolveForgejoLabel,
} from "./client/issues-pill.js";
import {
  forgejoLinkUserTransformer,
  forgejoLinkAssistantTransformer,
  forgejoLinkRenderer,
} from "./client/linkifier.js";

initClientHelpers({ Icon, Modal, useRpc, useToast });

export default function contribute(client: PluginClientContext) {
  const removeUserLink = client.addTimelineTransformer(forgejoLinkUserTransformer);
  const removeAssistantLink = client.addTimelineTransformer(forgejoLinkAssistantTransformer);
  const removeLinkRenderer = client.addTimelineRenderer(forgejoLinkRenderer);

  const removePill = registerComposerPill(client, {
    id: ISSUES_PILL_ID,
    title: "issues",
    compactTitle: "iss",
    modalTitle: "Forgejo Issues",
    modalIcon: "GitPullRequest",
    icon: "GitPullRequest",
    resolveLabel: (ctx) => resolveForgejoLabel(ctx),
    refreshIntervalMs: 15000,
    renderPill: (props) => <ForgejoPill {...props} />,
    renderModal: (props) => <ForgejoIssuesModal {...props} />,
  });

  return () => {
    removePill();
    removeUserLink();
    removeAssistantLink();
    removeLinkRenderer();
  };
}

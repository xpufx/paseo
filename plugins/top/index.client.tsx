import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  useToast,
  ScrollView,
  FlatList,
  TextInput as HostTextInput,
  copyText,
} from "@getpaseo/plugin/client/react-native";
import {
  bumpPluginLoadCount,
  initClientHelpers,
  notifyPluginReload,
} from "paseo-plugin-helper/core";
import { composeFeatureModules } from "paseo-plugin-helper/shared";
import { contributeClient as contributePillsClient } from "./client/pill";
import { TopTimelineTelemetryCard } from "./client/telemetry";
import { TurnCounterPanel } from "./client/turn-panel";
import {
  TOP_TIMELINE_KIND,
  TOP_TIMELINE_VERSION,
  topTimelineTelemetrySchema,
} from "./shared/resources";

notifyPluginReload("top");

initClientHelpers({
  Icon,
  Modal,
  useRpc,
  useToast,
  copyText,
  ScrollView,
  FlatList,
  TextInput: HostTextInput,
});

const topTimelineTelemetryFeature = {
  id: "top-timeline-telemetry",
  contributeClient(client: PluginClientContext) {
    return client.addTimelineRenderer({
      kind: TOP_TIMELINE_KIND,
      version: TOP_TIMELINE_VERSION,
      schema: topTimelineTelemetrySchema,
      Component: TopTimelineTelemetryCard,
    });
  },
};

const topCustomPillsFeature = {
  id: "top-custom-pills",
  contributeClient(client: PluginClientContext) {
    return contributePillsClient(client);
  },
};

const topTurnCounterFeature = {
  id: "top-turn-counter",
  contributeClient(client: PluginClientContext) {
    // Agent-scoped panel: exposes the deterministic turn index for the active
    // conversation (Turn #N + canonical seq) so a human and the agent resolve the
    // same reference. See client/turn-counter.ts. Agent panels are opened through
    // a command-center item, which forwards the active agent's openPanel.
    const removeTurnPanel = client.addWorkspacePanel({
      id: "top-turn-counter",
      title: "Turn Counter",
      icon: "Repeat",
      context: "agent",
      Component: TurnCounterPanel,
    });
    const removeTurnCommand = client.addCommandCenterItem({
      id: "top-turn-counter",
      title: "Turn Counter",
      icon: "Repeat",
      context: "agent",
      keywords: ["turn", "seq", "counter", "conversation"],
      onSelect(ctx) {
        ctx.openPanel("top-turn-counter");
      },
    });
    return () => {
      removeTurnCommand();
      removeTurnPanel();
    };
  },
};

const topClientFeatures = composeFeatureModules<any, PluginClientContext>([
  topTimelineTelemetryFeature,
  topCustomPillsFeature,
  topTurnCounterFeature,
]);

export default function contribute(client: PluginClientContext) {
  return topClientFeatures.contributeClient(client);
}

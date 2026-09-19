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
import { initClientHelpers } from "paseo-plugin-helper/client";
import { contributeClient } from "./client/pill";
import { TopTimelineTelemetryCard } from "./client/telemetry";
import { TurnCounterPanel } from "./client/turn-panel";
import {
  TOP_TIMELINE_KIND,
  TOP_TIMELINE_VERSION,
  topTimelineTelemetrySchema,
} from "./shared/resources";

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

export default function contribute(client: PluginClientContext) {
  const removeTimelineRenderer = client.addTimelineRenderer({
    kind: TOP_TIMELINE_KIND,
    version: TOP_TIMELINE_VERSION,
    schema: topTimelineTelemetrySchema,
    Component: TopTimelineTelemetryCard,
  });

  const cleanupClient = contributeClient(client);

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
    keywords: ["turn", "seq", "counter", "conversation"],
    context: "agent",
    onSelect(ctx) {
      ctx.openPanel("top-turn-counter");
    },
  });

  return () => {
    removeTurnCommand();
    removeTurnPanel();
    removeTimelineRenderer();
    cleanupClient();
  };
}

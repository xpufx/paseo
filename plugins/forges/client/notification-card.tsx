import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  PluginTimelineItemProps,
  PluginTimelineRendererContribution,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Badge } from "paseo-plugin-helper/client";
import {
  forgejoNotificationCardSchema,
  forgejoNotificationItem,
  type ForgejoNotificationCardData,
} from "../shared/notification.js";

/**
 * Forgejo digest notifications are emitted as host `notification` rows rather
 * than chat messages. Turn them into a typed card without claiming unrelated
 * notifications (including provider errors and other plugins' notices).
 */
export const forgejoNotificationTransformer: PluginTimelineTransformerContribution<"notification"> = {
  id: "forgejo-notification",
  query: { itemType: "notification" },
  transform({ item }) {
    return forgejoNotificationItem(item);
  },
};

function levelColor(
  theme: PluginTimelineItemProps<ForgejoNotificationCardData>["theme"],
  level: ForgejoNotificationCardData["level"],
) {
  if (level === "error") return theme.colors.statusDanger;
  if (level === "warning") return theme.colors.statusWarning;
  return theme.colors.accent;
}

export function ForgejoNotificationCard({
  item,
  theme,
}: PluginTimelineItemProps<ForgejoNotificationCardData>) {
  const color = levelColor(theme, item.data.level);
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }]}>
      <View style={styles.header}>
        <Icon name="Bell" size={14} color={color} />
        <Text style={[styles.title, { color: theme.colors.foreground }]}>Forgejo digest</Text>
        <Badge variant={item.data.level === "error" ? "danger" : item.data.level === "warning" ? "warning" : "info"} label={item.data.level} />
      </View>
      <Text style={[styles.message, { color: theme.colors.foreground }]}>{item.data.message}</Text>
      <Text style={[styles.footer, { color: theme.colors.foregroundMuted }]}>via forges</Text>
    </View>
  );
}

export const forgejoNotificationRenderer: PluginTimelineRendererContribution<
  typeof forgejoNotificationCardSchema
> = {
  kind: "forgejo-notification",
  version: 1,
  schema: forgejoNotificationCardSchema,
  Component: ForgejoNotificationCard,
};

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, padding: 8, marginVertical: 2, gap: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 12, fontWeight: "600", flex: 1 },
  message: { fontSize: 13 },
  footer: { fontSize: 10, fontStyle: "italic" },
});

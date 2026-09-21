import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { z } from "zod";

export const SlashCommandResultSchema = z.object({
  command: z.string(),
  status: z.enum(["ok", "error"]),
  body: z.string(),
});

export type SlashCommandResultData = z.infer<typeof SlashCommandResultSchema>;

export function SlashCommandResultCard({ item, theme }: PluginTimelineItemProps<SlashCommandResultData>) {
  const isError = item.data.status === "error";
  const badgeColor = isError ? theme.colors.statusDanger : theme.colors.statusSuccess;
  return (
    <View style={{ gap: 4, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: badgeColor, fontSize: 13 }}>{isError ? "✕" : "✓"}</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", fontFamily: "monospace" }}>
          /{item.data.command}
        </Text>
      </View>
      <Text style={{ color: isError ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
        {item.data.body}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>
        via S/ash
      </Text>
    </View>
  );
}

export function registerSlashTimeline(client: PluginClientContext): () => void {
  return client.addTimelineRenderer({
    kind: "slash-command-result",
    version: 1,
    schema: SlashCommandResultSchema,
    Component: SlashCommandResultCard,
  });
}

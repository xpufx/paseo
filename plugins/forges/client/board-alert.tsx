import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import type {
  PluginTimelineItemProps,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import {
  Badge,
  ForgeIcon,
} from "paseo-plugin-helper/client";
import {
  boardAlertTimelineSchema,
  classifyForgeUrl,
  parseBoardAlert,
} from "../shared/issues.js";
import { useActiveForgeIdentityForAgent } from "./active-forge.js";
import { ForeignLinkBadge } from "./foreign-link.js";
import { LabelChipList } from "./label-chip.js";

const boardAlertCardSchema = boardAlertTimelineSchema.extend({
  text: z.string(),
});
type BoardAlertCardData = z.infer<typeof boardAlertCardSchema>;
type BoardAlertIssueRowData = z.infer<typeof boardAlertTimelineSchema>;

function transformTextItem<T extends { text: string }>(item: T) {
  const parsed = parseBoardAlert(item.text);
  if (!parsed) return undefined;
  return {
    items: [
      {
        type: "plugin" as const,
        kind: "forge-board-alert",
        version: 1,
        data: { ...parsed, text: item.text },
      },
    ],
  } as any;
}

/**
 * Board-alert timeline transformer: raw autonomous-check dumps become
 * typed `forge-board-alert` items so the composer renders the
 * structured timeline card below instead of a text wall.
 */
export const forgeBoardAlertUserTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: "forge-board-alert-user",
  query: { itemType: "user_message" },
  transform({ item }) {
    return transformTextItem(item);
  },
};

export const forgeBoardAlertAssistantTransformer: PluginTimelineTransformerContribution<"assistant_message"> = {
  id: "forge-board-alert-assistant",
  query: { itemType: "assistant_message" },
  transform({ item }) {
    return transformTextItem(item);
  },
};

function BoardAlertIssueRow({
  theme,
  issue,
  foreign,
}: {
  theme: PluginTimelineItemProps<BoardAlertIssueRowData>["theme"];
  issue: BoardAlertIssueRowData["issues"][number];
  foreign: boolean;
}) {
  const open = issue.url
    ? () => {
        Linking.openURL(issue.url as string).catch(() => {});
      }
    : undefined;
  return (
    <View style={styles.issueRow}>
      <ForgeIcon host={issue.url} size={13} color={theme.colors.foregroundMuted} />
      <Badge variant="info" label={`#${issue.number}`} />
      <View style={styles.issueBody}>
        {open ? (
          <Pressable onPress={open} hitSlop={8}>
            <Text style={[styles.issueTitle, styles.issueTitleLink, { color: theme.colors.accent }]}>
              {issue.title}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.issueTitle, { color: theme.colors.foreground }]}>
            {issue.title}
          </Text>
        )}
        {issue.url ? (
          <Pressable onPress={open} hitSlop={8}>
            <Text style={[styles.issueUrl, { color: theme.colors.accent }]}>
              {issue.url}
            </Text>
          </Pressable>
        ) : null}
        <LabelChipList
          labels={issue.labels.map((name) => ({ name }))}
          style={styles.issueLabels}
        />
        {issue.action ? (
          <Text style={[styles.issueAction, { color: theme.colors.foregroundMuted }]}>
            {issue.action}
          </Text>
        ) : null}
      </View>
      {foreign ? <ForeignLinkBadge /> : null}
    </View>
  );
}

export function ForgeBoardAlertCard({
  item,
  theme,
  agentId,
}: PluginTimelineItemProps<BoardAlertCardData>) {
  const activeForge = useActiveForgeIdentityForAgent(agentId);
  const count = item.data.issues.length;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text style={[styles.bodyText, { color: theme.colors.foreground }]}>
        {item.data.text}
      </Text>
      <View style={styles.header}>
        <ForgeIcon
          host={activeForge?.host ?? item.data.issues[0]?.url}
          size={14}
          color={theme.colors.accent}
        />
        <Text style={[styles.title, { color: theme.colors.foreground }]}>
          Forge Board Alert
        </Text>
        <Badge
          variant="warning"
          label={count === 1 ? "1 actionable" : `${count} actionable`}
        />
      </View>
      <Text style={[styles.headline, { color: theme.colors.foregroundMuted }]}>
        {item.data.headline}
      </Text>
      <View style={styles.issues}>
        {item.data.issues.map((issue) => (
          <BoardAlertIssueRow
            key={issue.number}
            theme={theme}
            issue={issue}
            foreign={classifyForgeUrl(issue.url, activeForge) === "foreign"}
          />
        ))}
      </View>
      <Text style={[styles.footer, { color: theme.colors.foregroundMuted }]}>
        via forge
      </Text>
    </View>
  );
}

export const forgeBoardAlertRenderer = {
  kind: "forge-board-alert",
  version: 1,
  schema: boardAlertCardSchema,
  Component: ForgeBoardAlertCard,
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    marginVertical: 2,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  bodyText: {
    fontSize: 13,
  },
  headline: {
    fontSize: 11,
  },
  issues: {
    gap: 8,
  },
  issueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  issueBody: {
    flex: 1,
    gap: 2,
  },
  issueTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  issueTitleLink: {
    textDecorationLine: "underline",
  },
  issueUrl: {
    fontSize: 11,
    textDecorationLine: "underline",
  },
  issueLabels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  issueAction: {
    fontSize: 11,
    fontStyle: "italic",
  },
  footer: {
    fontSize: 10,
    fontStyle: "italic",
  },
});

import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type {
  PluginTimelineItemProps,
  PluginTimelineRendererContribution,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Badge, ForgeIcon, Icon } from "paseo-plugin-helper/client";
import {
  forgejoWebhookCardSchema,
  forgejoWebhookItem,
  type ForgejoSubject,
  type ForgejoWebhookCardData,
} from "../shared/webhook.js";

/**
 * Forgejo webhook timeline transformer: incoming hook deliveries become typed
 * `forgejo-webhook` items so the composer renders the event card below instead
 * of a raw chat line. Registered before the linkifier because hook messages
 * carry a bare issue URL the linkifier would otherwise claim first.
 */
export const forgejoWebhookUserTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: "forgejo-webhook",
  query: { itemType: "user_message" },
  transform({ item }) {
    return forgejoWebhookItem(item.text) as any;
  },
};

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {});
}

function SubjectRow({ theme, subject }: { theme: PluginTheme; subject: ForgejoSubject }) {
  const onPress = subject.url ? () => openUrl(subject.url as string) : undefined;
  const isPush = subject.kind === "push";
  return (
    <View style={styles.subjectRow}>
      <Icon
        name={isPush ? "GitCommit" : "GitPullRequest"}
        size={13}
        color={theme.colors.foregroundMuted}
      />
      {subject.number != null ? <Badge variant="info" label={`#${subject.number}`} /> : null}
      <View style={styles.subjectBody}>
        {subject.title ? (
          onPress ? (
            <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link">
              <Text style={[styles.subjectTitle, styles.link, { color: theme.colors.accent }]}>
                {subject.title}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.subjectTitle, { color: theme.colors.foreground }]}>
              {subject.title}
            </Text>
          )
        ) : null}
        {subject.ref ? (
          <Text style={[styles.subjectMeta, { color: theme.colors.foregroundMuted }]}>
            {subject.ref}
          </Text>
        ) : null}
        {subject.commits != null ? (
          <Text style={[styles.subjectMeta, { color: theme.colors.foregroundMuted }]}>
            {subject.commits} {subject.commits === 1 ? "commit" : "commits"}
          </Text>
        ) : null}
        {subject.commentId != null ? (
          <Text style={[styles.subjectMeta, { color: theme.colors.foregroundMuted }]}>
            comment #{subject.commentId}
          </Text>
        ) : null}
        {subject.url ? (
          <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link">
            <Text style={[styles.subjectUrl, styles.link, { color: theme.colors.accent }]}>
              {subject.url}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ForgejoWebhookCard({ item, theme }: PluginTimelineItemProps<ForgejoWebhookCardData>) {
  const data = item.data;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border },
      ]}
    >
      <View style={styles.header}>
        <ForgeIcon host={data.repoUrl} size={14} color={theme.colors.accent} />
        <Text style={[styles.title, { color: theme.colors.foreground }]}>Forgejo webhook</Text>
        <Badge
          variant="info"
          label={data.action ? `${data.event}:${data.action}` : data.event}
        />
      </View>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {data.repo}
        {data.sender ? ` · by ${data.sender}` : ""}
      </Text>
      {data.subject ? <SubjectRow theme={theme} subject={data.subject} /> : null}
      {data.body ? (
        <Text style={[styles.bodyText, { color: theme.colors.foreground }]} selectable>
          {data.body}
        </Text>
      ) : null}
      <Text style={[styles.footer, { color: theme.colors.foregroundMuted }]}>via forgejo</Text>
    </View>
  );
}

export const forgejoWebhookRenderer: PluginTimelineRendererContribution<
  typeof forgejoWebhookCardSchema
> = {
  kind: "forgejo-webhook",
  version: 1,
  schema: forgejoWebhookCardSchema,
  Component: ForgejoWebhookCard,
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
  meta: {
    fontSize: 11,
  },
  subjectRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  subjectBody: {
    flex: 1,
    gap: 2,
  },
  subjectTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  subjectMeta: {
    fontSize: 11,
  },
  subjectUrl: {
    fontSize: 11,
  },
  link: {
    textDecorationLine: "underline",
  },
  bodyText: {
    fontSize: 12,
  },
  footer: {
    fontSize: 10,
    fontStyle: "italic",
  },
});

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
  subjectLinkUrl,
  type ForgejoSubject,
  type ForgejoWebhookCardData,
} from "../shared/webhook.js";

/**
 * Forgejo webhook timeline transformer: incoming hook deliveries become typed
 * `forgejo-webhook` items so the composer renders the event card below instead
 * of a raw chat line. Registered before the linkifier because hook messages
 * carry a bare issue URL the linkifier would otherwise claim first.
 *
 * Presentation-only: `PluginTimelineTransformerContribution.transform` returns
 * `PluginTimelineItem[]`, a client-side render target. It has no reference to
 * mutate the source `AgentTimelineItem`, so the raw envelope + human line stays
 * verbatim in the agent's context. Nothing below may echo that text.
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
  const link = subjectLinkUrl(subject);
  const onPress = link ? () => openUrl(link) : undefined;
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
        {link ? (
          <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link">
            <Text style={[styles.subjectUrl, styles.link, { color: theme.colors.accent }]}>
              {link}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ForgejoWebhookCard({ item, theme }: PluginTimelineItemProps<ForgejoWebhookCardData>) {
  const data = item.data;
  const repoLink = data.repoUrl ? () => openUrl(data.repoUrl as string) : undefined;
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
      <View style={styles.metaRow}>
        {repoLink ? (
          <Pressable onPress={repoLink} hitSlop={8} accessibilityRole="link">
            <Text style={[styles.meta, styles.link, { color: theme.colors.accent }]}>
              {data.repo}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>{data.repo}</Text>
        )}
        {data.sender ? (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            · by {data.sender}
          </Text>
        ) : null}
      </View>
      {data.subject ? <SubjectRow theme={theme} subject={data.subject} /> : null}
      <Text style={[styles.footer, { color: theme.colors.foregroundMuted }]}>
        {data.version != null ? `via forgejo v${data.version}` : "via forgejo"}
      </Text>
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
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
  footer: {
    fontSize: 10,
    fontStyle: "italic",
  },
});

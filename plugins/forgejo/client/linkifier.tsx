import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import type {
  PluginTimelineItemProps,
  PluginTimelineTransformerContribution,
  PluginTimelineRendererContribution,
} from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { copyToClipboard } from "./vendor/paseo-plugin-helper/index.ts";
import {
  extractForgejoIssueUrls,
  type ForgejoIssueLink,
} from "../shared/issues.js";

const ForgejoIssueLinkSchema = z.object({
  text: z.string(),
  links: z.array(
    z.object({
      host: z.string(),
      owner: z.string(),
      repo: z.string(),
      number: z.number(),
      url: z.string(),
    }),
  ),
});
type ForgejoIssueLinkData = z.infer<typeof ForgejoIssueLinkSchema>;

function transformTextItem<T extends { text: string }>(item: T) {
  const links = extractForgejoIssueUrls(item.text);
  if (links.length === 0) return undefined;
  return {
    items: [
      {
        type: "plugin" as const,
        kind: "forgejo-issue-link",
        version: 1,
        data: {
          text: item.text,
          links: links.map((link) => ({
            host: link.host,
            owner: link.owner,
            repo: link.repo,
            number: link.number,
            url: link.url,
          })),
        },
      },
    ],
  };
}

/**
 * Timeline linkifier: any chat message carrying Forgejo issue URLs gets a
 * compact link card alongside it. Both user and assistant messages are
 * covered; messages without issue URLs pass through untouched.
 */
export const forgejoLinkUserTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: "forgejo-issue-link-user",
  query: { itemType: "user_message" },
  transform({ item }) {
    return transformTextItem(item);
  },
};

export const forgejoLinkAssistantTransformer: PluginTimelineTransformerContribution<"assistant_message"> = {
  id: "forgejo-issue-link-assistant",
  query: { itemType: "assistant_message" },
  transform({ item }) {
    return transformTextItem(item);
  },
};

function IssueLinkRow({ theme, link }: { theme: PluginTheme; link: ForgejoIssueLink }) {
  const open = () => {
    Linking.openURL(link.url).catch(() => {});
  };
  const copy = () => {
    copyToClipboard(link.url).catch(() => {});
  };
  return (
    <View style={styles.row}>
      <Icon name="ExternalLink" size={13} color={theme.colors.accent} />
      <Pressable style={styles.linkBody} onPress={open} hitSlop={8}>
        <Text style={[styles.linkText, { color: theme.colors.accent }]}>
          {link.owner}/{link.repo}#{link.number}
        </Text>
        <Text style={[styles.hostText, { color: theme.colors.foregroundMuted }]}>
          {link.host}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy issue link" onPress={copy} hitSlop={10}>
        <Text style={[styles.copyText, { color: theme.colors.foregroundMuted }]}>⧉</Text>
      </Pressable>
    </View>
  );
}

function ForgejoIssueLinks({ theme, item }: PluginTimelineItemProps<ForgejoIssueLinkData>) {
  return (
    <View style={styles.card}>
      <Text style={[styles.bodyText, { color: theme.colors.foreground }]}>
        {item.data.text}
      </Text>
      <View style={styles.header}>
        <Icon name="GitPullRequest" size={13} color={theme.colors.foregroundMuted} />
        <Text style={[styles.headerText, { color: theme.colors.foregroundMuted }]}>
          {item.data.links.length === 1 ? "Linked issue" : `${item.data.links.length} linked issues`}
        </Text>
      </View>
      {item.data.links.map((link) => (
        <IssueLinkRow key={`${link.host}/${link.owner}/${link.repo}#${link.number}`} theme={theme} link={link} />
      ))}
    </View>
  );
}

export const forgejoLinkRenderer: PluginTimelineRendererContribution<typeof ForgejoIssueLinkSchema> = {
  kind: "forgejo-issue-link",
  version: 1,
  schema: ForgejoIssueLinkSchema,
  Component: ForgejoIssueLinks,
};

const styles = StyleSheet.create({
  card: {
    paddingVertical: 4,
    gap: 4,
  },
  bodyText: {
    fontSize: 13,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerText: {
    fontSize: 11,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkBody: {
    flex: 1,
    gap: 1,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
  },
  hostText: {
    fontSize: 11,
  },
  copyText: {
    fontSize: 14,
  },
});

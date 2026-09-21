import React from "react";
import { Linking, Text, View } from "react-native";
import { z } from "zod";
import type {
  PluginTimelineItemProps,
  PluginTimelineTransformerContribution,
  PluginTimelineRendererContribution,
} from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Button, CopyButton, ForgeIcon } from "paseo-plugin-helper/client";
import {
  classifyForgeLink,
  classifyForgeUrl,
  extractBareForgeIssueUrls,
  parseMarkdownLite,
  type ForgeRepoIdentity,
  type ForgeIssueLink,
  type MarkdownLiteSpan,
} from "../shared/issues.js";
import { useActiveForgeIdentityForAgent } from "./active-forge.js";
import { FOREIGN_LINK_HINT, ForeignInlineMark, ForeignLinkBadge } from "./foreign-link.js";

const ForgeIssueLinkSchema = z.object({
  text: z.string(),
  links: z.array(
    z.object({
      host: z.string(),
      owner: z.string(),
      repo: z.string(),
      number: z.number(),
      commentId: z.number().optional(),
      url: z.string(),
    }),
  ),
});
type ForgeIssueLinkData = z.infer<typeof ForgeIssueLinkSchema>;

function transformTextItem<T extends { text: string }>(item: T) {
  const links = extractBareForgeIssueUrls(item.text);
  if (links.length === 0) return undefined;
  return {
    items: [
      {
        type: "plugin" as const,
        kind: "forge-issue-link",
        version: 1,
        data: {
          text: item.text,
          links: links.map((link) => ({
            host: link.host,
            owner: link.owner,
            repo: link.repo,
            number: link.number,
            ...(link.commentId != null ? { commentId: link.commentId } : {}),
            url: link.url,
          })),
        },
      },
    ],
  };
}

/**
 * Timeline linkifier: any chat message carrying forge issue URLs gets a
 * compact link card alongside it. Both user and assistant messages are
 * covered; messages without issue URLs pass through untouched.
 */
export const forgeLinkUserTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: "forge-issue-link-user",
  query: { itemType: "user_message" },
  transform({ item }) {
    return transformTextItem(item);
  },
};

export const forgeLinkAssistantTransformer: PluginTimelineTransformerContribution<"assistant_message"> = {
  id: "forge-issue-link-assistant",
  query: { itemType: "assistant_message" },
  transform({ item }) {
    return transformTextItem(item);
  },
};

function IssueLinkRow({
  theme,
  link,
  foreign,
}: {
  theme: PluginTheme;
  link: ForgeIssueLink;
  foreign: boolean;
}) {
  const open = () => {
    Linking.openURL(link.url).catch(() => {});
  };
  return (
    <View style={styles.row}>
      <ForgeIcon host={link.host} size={13} color={theme.colors.accent} />
      <Button
        label={`${link.owner}/${link.repo}#${link.number}`}
        size="sm"
        variant="ghost"
        style={styles.linkBody}
        onPress={open}
        accessibilityLabel={
          foreign
            ? `${link.owner}/${link.repo}#${link.number} on ${link.host} — ${FOREIGN_LINK_HINT}`
            : undefined
        }
      />
      <Text style={[styles.hostText, { color: theme.colors.foregroundMuted }]}>{link.host}</Text>
      {foreign ? <ForeignLinkBadge /> : null}
      <CopyButton text={link.url} label="Copy" accessibilityLabel="Copy issue link" />
    </View>
  );
}

function FormattedSpans({
  theme,
  spans,
  activeForge,
}: {
  theme: PluginTheme;
  spans: MarkdownLiteSpan[];
  activeForge: ForgeRepoIdentity | null;
}) {
  return (
    <Text style={[styles.bodyText, { color: theme.colors.foreground }]}>
      {spans.map((span, index) => {
        if (span.kind === "link") {
          const foreign = classifyForgeUrl(span.url, activeForge) === "foreign";
          return (
            <Text
              key={index}
              style={{ color: theme.colors.accent, fontWeight: "600" }}
              onPress={() => Linking.openURL(span.url).catch(() => {})}
            >
              {span.text}
              {foreign ? <ForeignInlineMark color={theme.colors.statusWarning} /> : null}
            </Text>
          );
        }
        if (span.kind === "code") {
          return (
            <Text key={index} style={{ fontFamily: "monospace" }}>
              {span.text}
            </Text>
          );
        }
        if (span.kind === "bold") {
          return (
            <Text key={index} style={{ fontWeight: "700" }}>
              {span.text}
            </Text>
          );
        }
        if (span.kind === "italic") {
          return (
            <Text key={index} style={{ fontStyle: "italic" }}>
              {span.text}
            </Text>
          );
        }
        return <Text key={index}>{span.text}</Text>;
      })}
    </Text>
  );
}

function ForgeIssueLinks({ theme, item, agentId }: PluginTimelineItemProps<ForgeIssueLinkData>) {
  const activeForge = useActiveForgeIdentityForAgent(agentId);
  const blocks = parseMarkdownLite(item.data.text);
  return (
    <View style={styles.card}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return (
            <Text
              key={index}
              selectable
              style={[styles.bodyText, { color: theme.colors.foregroundMuted, fontFamily: "monospace" }]}
            >
              {block.text}
            </Text>
          );
        }
        if (block.kind === "heading") {
          return <FormattedSpans key={index} theme={theme} spans={block.spans} activeForge={activeForge} />;
        }
        if (block.kind === "list") {
          return (
            <View key={index} style={{ gap: 2 }}>
              {block.items.map((spans, itemIndex) => (
                <View key={itemIndex} style={{ flexDirection: "row", gap: 6 }}>
                  <Text style={[styles.bodyText, { color: theme.colors.foregroundMuted }]}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <FormattedSpans theme={theme} spans={spans} activeForge={activeForge} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return <FormattedSpans key={index} theme={theme} spans={block.spans} activeForge={activeForge} />;
      })}
      <View style={styles.header}>
        <Icon name="GitPullRequest" size={13} color={theme.colors.foregroundMuted} />
        <Text style={[styles.headerText, { color: theme.colors.foregroundMuted }]}>
          {item.data.links.length === 1 ? "Linked issue" : `${item.data.links.length} linked issues`}
        </Text>
      </View>
      {item.data.links.map((link) => (
        <IssueLinkRow
          key={`${link.host}/${link.owner}/${link.repo}#${link.number}`}
          theme={theme}
          link={link}
          foreign={classifyForgeLink(link, activeForge) === "foreign"}
        />
      ))}
    </View>
  );
}

export const forgeLinkRenderer: PluginTimelineRendererContribution<typeof ForgeIssueLinkSchema> = {
  kind: "forge-issue-link",
  version: 1,
  schema: ForgeIssueLinkSchema,
  Component: ForgeIssueLinks,
};

const styles = {
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
  hostText: {
    fontSize: 11,
  },
} as const;

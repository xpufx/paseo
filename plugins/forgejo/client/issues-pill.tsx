import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useWorkspace } from "@getpaseo/plugin/client";
import type { PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import {
  ModalBody,
  Card,
  Button,
  Badge,
  EmptyState,
  SearchInput,
  Tabs,
  useRpcQuery,
  usePluginTheme,
  copyToClipboard,
  type RenderModalProps,
  type RenderPillProps,
  type PillLiveContext,
} from "paseo-plugin-helper/client";
import {
  formatIssueCountLabel,
  openIssuesContract,
  type ForgejoIssue,
} from "../shared/issues.js";

export const ISSUES_PILL_ID = "forgejo-issues";

interface IssueCountCache {
  directory?: string;
  count: number | null;
  at: number;
}

const countCache = new Map<string, IssueCountCache>();

function readCachedLabel(ctx: PillLiveContext): string | undefined {
  const cached = countCache.get(ctx.agentId);
  if (!cached) return undefined;
  return formatIssueCountLabel(cached.count);
}

export function resolveForgejoLabel(ctx: PillLiveContext): string | undefined {
  return readCachedLabel(ctx);
}

function rememberCount(agentId: string, directory: string | undefined, count: number | null) {
  countCache.set(agentId, { directory, count, at: Date.now() });
}

function useOpenIssues(workspaceId: string, agentId: string) {
  const directory = useWorkspace(
    workspaceId,
    (w: PluginWorkspaceSnapshot) => w?.directory,
  );
  const query = useRpcQuery(
    openIssuesContract,
    { directory: directory ?? undefined },
    { refetchInterval: 30000 },
  );
  useEffect(() => {
    if (query.data) {
      rememberCount(agentId, directory ?? undefined, query.data.error ? null : query.data.issues.length);
    }
  }, [agentId, directory, query.data]);
  return { directory, ...query };
}

export function ForgejoPill({ agentId, workspaceId, isOpen }: RenderPillProps) {
  const { colors } = usePluginTheme();
  const { data, isLoading } = useOpenIssues(workspaceId, agentId);
  const label = isLoading && !data ? "..." : formatIssueCountLabel(
    data && !data.error ? data.issues.length : null,
  );
  return (
    <View style={styles.pillContainer}>
      <Text style={[styles.title, { color: colors.foreground }, isOpen && styles.titleActive]}>
        {label}
      </Text>
    </View>
  );
}

function issueMatchesQuery(issue: ForgejoIssue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (String(issue.number) === q || `#${issue.number}` === q) return true;
  return (
    issue.title.toLowerCase().includes(q) ||
    issue.labels.some((label) => label.toLowerCase().includes(q))
  );
}

/**
 * Markdown reference for pasting into chat, e.g. `[#30 Turn count](url)`.
 * The repo web URL is derived from the RPC repo when available.
 */
function issueMarkdownRef(issue: ForgejoIssue, repo: string | null): string {
  const ref = `#${issue.number}: ${issue.title}`;
  if (!repo) return ref;
  return `[${ref}](https://forge.mrs.aager.de/${repo}/issues/${issue.number})`;
}

function IssueRow({
  number,
  title,
  state,
  labels,
  repo,
}: {
  number: number;
  title: string;
  state: string;
  labels: string[];
  repo: string | null;
}) {
  const { colors } = usePluginTheme();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyToClipboard(issueMarkdownRef({ number, title, state, labels }, repo))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  const open = () => {
    if (!repo) return;
    Linking.openURL(`https://forge.mrs.aager.de/${repo}/issues/${number}`).catch(() => {});
  };
  return (
    <View style={styles.row}>
      <Badge
        variant={state === "open" ? "success" : "neutral"}
        label={`#${number}`}
      />
      <Pressable style={styles.rowBody} onPress={open} hitSlop={4}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        {labels.length > 0 ? (
          <Text style={[styles.rowLabels, { color: colors.foregroundMuted }]}>
            {labels.join(", ")}
          </Text>
        ) : null}
      </Pressable>
      <Button
        size="sm"
        variant={copied ? "primary" : "ghost"}
        icon={copied ? "Check" : "Copy"}
        label={copied ? "Copied" : "Copy"}
        onPress={copy}
      />
    </View>
  );
}

export function ForgejoIssuesModal({ agentId, workspaceId, close }: RenderModalProps) {
  const { colors } = usePluginTheme();
  const { data, isLoading, isError, refetch, isRefetching } = useOpenIssues(workspaceId, agentId);
  const repo = data?.repo ?? null;
  const [activeTab, setActiveTab] = useState("issues");
  const [query, setQuery] = useState("");
  const issues = useMemo(
    () => (data && !data.error ? data.issues.filter((issue: ForgejoIssue) => issueMatchesQuery(issue, query)) : []),
    [data, query],
  );
  const failed = Boolean(data?.error) || isError;
  return (
    <ModalBody refreshing={isRefetching} onRefresh={() => { refetch(); }}>
      <Tabs
        tabs={[
          { id: "issues", label: "Open Issues", shortLabel: "Issues" },
          { id: "search", label: "Search", shortLabel: "Search" },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      {activeTab === "search" ? (
        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by keyword or #number…"
        />
      ) : null}
      <Card variant="elevated">
        <Card.Header
          title={data?.repo ? `Issues · ${data.repo}` : "Forgejo Issues"}
          subtitle={
            data && !data.error
              ? activeTab === "search" && query.trim()
                ? `${issues.length} of ${data.issues.length} match`
                : `${data.issues.length} open`
              : "Open issues for this workspace repo"
          }
        />
        {isLoading && !data ? (
          <Text style={[styles.hint, { color: colors.foregroundMuted }]}>Loading issues…</Text>
        ) : null}
        {failed ? (
          <EmptyState
            icon="AlertCircle"
            title="Issues unavailable"
            description={data?.error ?? "Could not reach Forgejo for this workspace."}
            actionLabel="Retry"
            onAction={() => refetch()}
          />
        ) : null}
        {data && !data.error && issues.length === 0 ? (
          <EmptyState
            icon={query.trim() ? "Search" : "CheckCircle2"}
            title={query.trim() ? "No matches" : "No open issues"}
            description={query.trim() ? "Try a different keyword or issue number." : "Nothing open on this repo right now."}
          />
        ) : null}
        {!failed
          ? issues.map((issue: ForgejoIssue) => (
              <IssueRow
                key={issue.number}
                number={issue.number}
                title={issue.title}
                state={issue.state}
                labels={issue.labels}
                repo={repo}
              />
            ))
          : null}
      </Card>
      <Text style={[styles.note, { color: colors.foregroundMuted }]}>
        Push-to-composer is unavailable: the v8 SDK exposes no composer-insert
        API, so copy the reference and paste it into chat.
      </Text>
      <View style={styles.actions}>
        <Button label="Refresh" variant="secondary" onPress={() => { refetch(); }} />
        <Button label="Close" variant="ghost" onPress={close} />
      </View>
    </ModalBody>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  title: {
    fontSize: 12,
    fontWeight: "500",
  },
  titleActive: {
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 6,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  rowLabels: {
    fontSize: 11,
  },
  note: {
    fontSize: 11,
    fontStyle: "italic",
  },
  hint: {
    fontSize: 12,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
});

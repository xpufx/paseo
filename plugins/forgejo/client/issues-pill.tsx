import React, { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useWorkspace } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import {
  ModalBody,
  Card,
  Button,
  Badge,
  EmptyState,
  SearchInput,
  Tabs,
  CodeBlock,
  CommandBox,
  KeyValue,
  KeyValueGroup,
  TextInput,
  useRpcQuery,
  useRpcMutation,
  usePluginTheme,
  copyToClipboard,
  useResponsive,
  getClientHost,
  type RenderModalProps,
  type RenderPillProps,
  type PillLiveContext,
} from "paseo-plugin-helper/client";
import {
  ATTENTION_LABELS,
  PRIORITY_ORDER,
  SPEC_LABELS,
  STATE_ORDER,
  addCommentContract,
  currentPriorityLabel,
  currentStateLabel,
  formatIssueCountLabel,
  issueDetailContract,
  nextStateLabel,
  openIssuesContract,
  setLabelContract,
  shortLabelName,
  stripAgentEnvelopeFooter,
  type AgentEnvelope,
  type ForgejoIssue,
  type IssueComment,
} from "../shared/issues.js";

export const ISSUES_PILL_ID = "forgejo-issues";

interface IssueCountCache {
  directory?: string;
  count: number | null;
  at: number;
}

const countCache = new Map<string, IssueCountCache>();

function readCachedLabel(ctx: PillLiveContext): string {
  const cached = countCache.get(ctx.agentId);
  if (!cached || cached.count == null) return "iss";
  return `${cached.count}`;
}

export function resolveForgejoLabel(ctx: PillLiveContext): string {
  return readCachedLabel(ctx);
}

function rememberCount(agentId: string, directory: string | undefined, count: number | null) {
  countCache.set(agentId, { directory, count, at: Date.now() });
}

function useDirectory(workspaceId: string): string | undefined {
  return useWorkspace(
    workspaceId,
    (w: PluginWorkspaceSnapshot) => w?.directory,
  ) as string | undefined;
}

function useOpenIssues(workspaceId: string, agentId: string) {
  const directory = useDirectory(workspaceId);
  const query = useRpcQuery(
    openIssuesContract,
    { directory: directory ?? undefined },
    { refetchInterval: 30000 },
  );
  const data = query.data;
  React.useEffect(() => {
    if (data) {
      rememberCount(agentId, directory ?? undefined, data.error ? null : data.issues.length);
    }
  }, [agentId, directory, data]);
  return { directory, ...query };
}

export function ForgejoPill({ agentId, workspaceId, isOpen }: RenderPillProps) {
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();
  const { Icon } = getClientHost();
  const { data, isLoading } = useOpenIssues(workspaceId, agentId);
  const count = data && !data.error ? data.issues.length : null;
  const label =
    isLoading && !data
      ? "..."
      : isCompact
        ? (count == null ? "iss" : `${count}`)
        : formatIssueCountLabel(count);
  return (
    <View
      accessibilityLabel={`Forgejo ${formatIssueCountLabel(count)}`}
      style={styles.pillContainer}
    >
      <Icon name="GitPullRequest" size={13} color={colors.foreground} />
      <Text
        numberOfLines={1}
        ellipsizeMode="clip"
        style={[styles.title, { color: colors.foreground }, isOpen && styles.titleActive]}
      >
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

function formatTimestamp(value: string | undefined | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function badgeVariantForLabel(label: string): "danger" | "warning" | "info" | "success" | "neutral" {
  if (label === "priority/0-SOS") return "danger";
  if (label === "state/3-verify") return "warning";
  if (label === "state/1-wip") return "info";
  if (label === "state/4-done" || label === "spec/2-approved") return "success";
  return "neutral";
}

/** Render markdown-lite: fenced blocks via CodeBlock, the rest as plain text. */
function MarkdownLite({ body }: { body: string }) {
  const { colors } = usePluginTheme();
  const segments = useMemo(() => {
    const parts = body.split(/```/);
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const newline = part.indexOf("\n");
        const language = newline > 0 ? part.slice(0, newline).trim() : undefined;
        const code = newline > 0 ? part.slice(newline + 1) : part;
        return { kind: "code" as const, text: code.replace(/\n$/, ""), language };
      }
      return { kind: "text" as const, text: part };
    });
  }, [body]);
  return (
    <View style={styles.markdown}>
      {segments.map((segment, index) =>
        segment.kind === "code" ? (
          <CodeBlock key={index} code={segment.text} language={segment.language} />
        ) : segment.text.trim() ? (
          <Text
            key={index}
            selectable
            style={[styles.bodyText, { color: colors.foreground }]}
          >
            {segment.text.trim()}
          </Text>
        ) : null,
      )}
    </View>
  );
}

function IssueRow({
  number,
  title,
  state,
  labels,
  repo,
  onSelect,
}: {
  number: number;
  title: string;
  state: string;
  labels: string[];
  repo: string | null;
  onSelect: (issueNumber: number) => void;
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
  return (
    <View style={styles.row}>
      <Badge
        variant={state === "open" ? "success" : "neutral"}
        label={`#${number}`}
      />
      <Pressable style={styles.rowBody} onPress={() => onSelect(number)} hitSlop={4}>
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

function AgentEnvelopeCard({ envelope }: { envelope: AgentEnvelope }) {
  const openSession = () => {
    const link = envelope.paseoLinks[0];
    if (!link) return;
    Linking.openURL(link).catch(() => {
      copyToClipboard(link).catch(() => {});
    });
  };
  return (
    <Card variant="tinted" style={styles.envelopeCard}>
      <Card.Header
        title={envelope.sessionTitle}
        subtitle={envelope.postedAt ?? undefined}
        badge={<Badge variant="info" label={envelope.agentShortId} />}
        icon="Bot"
      />
      <KeyValueGroup columns={2}>
        <KeyValue label="Model" value={envelope.model ?? "-"} mono />
        <KeyValue
          label="Branch"
          value={envelope.branch ? `${envelope.repo ?? ""}:${envelope.branch}` : "-"}
          mono
          copyable={Boolean(envelope.branch)}
        />
      </KeyValueGroup>
      {envelope.commitShas.length > 0 ? (
        <View style={styles.shaList}>
          {envelope.commitShas.map((sha) => (
            <CommandBox key={sha} command={sha} copyLabel={`Copy commit ${sha}`} />
          ))}
        </View>
      ) : null}
      {envelope.paseoLinks.length > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          icon="ExternalLink"
          label="Open agent session"
          onPress={openSession}
        />
      ) : null}
    </Card>
  );
}

function CommentCard({ comment }: { comment: IssueComment }) {
  const { colors } = usePluginTheme();
  const body = stripAgentEnvelopeFooter(comment.body) || comment.body;
  return (
    <Card style={styles.commentCard}>
      <Card.Header
        title={comment.author}
        subtitle={formatTimestamp(comment.createdAt)}
        icon="MessageSquare"
      />
      <MarkdownLite body={body} />
      {comment.envelope ? (
        <View style={styles.commentEnvelope}>
          <Text style={[styles.envelopeHint, { color: colors.foregroundMuted }]}>
            Agent envelope: {comment.envelope.sessionTitle} ({comment.envelope.agentShortId})
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function ScopedLabelGroup({
  title,
  labels,
  active,
  pending,
  onSelect,
}: {
  title: string;
  labels: readonly string[];
  active: string | null;
  pending: boolean;
  onSelect: (label: string) => void;
}) {
  const { colors } = usePluginTheme();
  return (
    <View style={styles.labelGroup}>
      <Text style={[styles.sectionTitle, { color: colors.foregroundMuted }]}>{title}</Text>
      <View style={styles.labelRow}>
        {labels.map((label) => (
          <Button
            key={label}
            size="sm"
            variant={active === label ? "primary" : "ghost"}
            label={shortLabelName(label)}
            disabled={pending}
            loading={pending && active === label}
            onPress={() => onSelect(label)}
          />
        ))}
      </View>
    </View>
  );
}

function IssueDetailView({
  workspaceId,
  issueNumber,
  onBack,
  onBoardRefresh,
}: {
  workspaceId: string;
  issueNumber: number;
  onBack: () => void;
  onBoardRefresh: () => void;
}) {
  const { colors } = usePluginTheme();
  const toast = useToast();
  const directory = useDirectory(workspaceId);
  const detail = useRpcQuery(
    issueDetailContract,
    { issueNumber, directory: directory ?? undefined },
    { refetchInterval: 30000 },
  );
  const [draft, setDraft] = useState("");
  const issue = detail.data && !detail.data.error ? detail.data.issue : null;
  const failed = Boolean(detail.data?.error) || detail.isError;

  const setLabel = useRpcMutation(setLabelContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error);
        return;
      }
      detail.refetch();
      onBoardRefresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not update labels");
    },
  });

  const addComment = useRpcMutation(addCommentContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setDraft("");
      detail.refetch();
      onBoardRefresh();
      toast.show("Comment posted", { variant: "success" });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not post comment");
    },
  });

  const labels = issue?.labels ?? [];
  const state = currentStateLabel(labels);
  const priority = issue ? currentPriorityLabel(labels) : null;
  const next = issue ? nextStateLabel(labels) : null;
  const labelPending = setLabel.isPending;
  const commentPending = addComment.isPending;

  return (
    <View style={styles.detail}>
      <Button
        size="sm"
        variant="ghost"
        icon="ArrowLeft"
        label="Back to issues"
        onPress={onBack}
      />
      {detail.isLoading && !detail.data ? (
        <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
          Loading issue #{issueNumber}…
        </Text>
      ) : null}
      {failed || (!detail.isLoading && !issue) ? (
        <EmptyState
          icon="AlertCircle"
          title={`Issue #${issueNumber} unavailable`}
          description={detail.data?.error ?? "Could not reach Forgejo for this workspace."}
          actionLabel="Retry"
          onAction={() => detail.refetch()}
        />
      ) : null}
      {issue ? (
        <>
          <Card variant="elevated">
            <Card.Header
              title={`#${issue.number} ${issue.title}`}
              subtitle={`by ${issue.author} · ${formatTimestamp(issue.updatedAt)}`}
            />
            <View style={styles.badgeRow}>
              {state ? <Badge variant={badgeVariantForLabel(state)} label={shortLabelName(state)} /> : null}
              {priority ? (
                <Badge variant={badgeVariantForLabel(priority)} label={shortLabelName(priority)} />
              ) : null}
              {labels
                .filter((label) => label !== state && label !== priority)
                .map((label) => (
                  <Badge key={label} variant={badgeVariantForLabel(label)} label={label} />
                ))}
            </View>
          </Card>

          <Card>
            <Card.Header title="Labels" subtitle="One tap applies; scope evicts the rest" icon="Tags" />
            {next ? (
              <Button
                variant="primary"
                icon="ArrowRight"
                label={state ? `Move to ${shortLabelName(next)}` : `Start ${shortLabelName(next)}`}
                disabled={labelPending}
                loading={labelPending}
                onPress={() => setLabel.mutate({ issueNumber, directory: directory ?? undefined, label: next })}
              />
            ) : null}
            <ScopedLabelGroup
              title="State"
              labels={STATE_ORDER}
              active={state}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ issueNumber, directory: directory ?? undefined, label })}
            />
            <ScopedLabelGroup
              title="Priority"
              labels={PRIORITY_ORDER}
              active={priority}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ issueNumber, directory: directory ?? undefined, label })}
            />
            <ScopedLabelGroup
              title="Attention"
              labels={ATTENTION_LABELS}
              active={labels.find((label) => (ATTENTION_LABELS as readonly string[]).includes(label)) ?? null}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ issueNumber, directory: directory ?? undefined, label })}
            />
            <ScopedLabelGroup
              title="Spec"
              labels={SPEC_LABELS}
              active={labels.find((label) => (SPEC_LABELS as readonly string[]).includes(label)) ?? null}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ issueNumber, directory: directory ?? undefined, label })}
            />
          </Card>

          <Card>
            <Card.Header title="Description" icon="FileText" />
            {issue.body.trim() ? (
              <MarkdownLite body={issue.body} />
            ) : (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>No description.</Text>
            )}
          </Card>

          <Card>
            <Card.Header
              title={`Agent envelopes (${issue.envelopes.length})`}
              subtitle="Minion ID · commit SHA · runtime"
              icon="Bot"
            />
            {issue.envelopes.length === 0 ? (
              <EmptyState
                icon="Cpu"
                title="No agent activity yet"
                description="Envelopes appear here once an agent comments with --envelope."
              />
            ) : (
              issue.envelopes.map((envelope) => (
                <AgentEnvelopeCard key={`${envelope.commentId}-${envelope.agentShortId}`} envelope={envelope} />
              ))
            )}
          </Card>

          <Card>
            <Card.Header
              title={`Comments (${issue.comments.length})`}
              icon="MessagesSquare"
            />
            {issue.comments.length === 0 ? (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>No comments yet.</Text>
            ) : (
              issue.comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)
            )}
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Quick comment…"
                multiline
                numberOfLines={3}
              />
              <Button
                variant="primary"
                icon="Send"
                label={commentPending ? "Posting…" : "Post"}
                disabled={!draft.trim() || commentPending}
                loading={commentPending}
                onPress={() => {
                  const body = draft.trim();
                  if (!body) return;
                  addComment.mutate({ issueNumber, directory: directory ?? undefined, body });
                }}
              />
            </View>
          </Card>
        </>
      ) : null}
    </View>
  );
}

export function ForgejoIssuesModal({ agentId, workspaceId, close }: RenderModalProps) {
  const { colors } = usePluginTheme();
  const { data, isLoading, isError, refetch, isRefetching } = useOpenIssues(workspaceId, agentId);
  const repo = data?.repo ?? null;
  const [activeTab, setActiveTab] = useState("issues");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const issues = useMemo(
    () => (data && !data.error ? data.issues.filter((issue: ForgejoIssue) => issueMatchesQuery(issue, query)) : []),
    [data, query],
  );
  const failed = Boolean(data?.error) || isError;
  return (
    <ModalBody refreshing={isRefetching} onRefresh={() => { refetch(); }}>
      {selected != null ? (
        <>
          <IssueDetailView
            workspaceId={workspaceId}
            issueNumber={selected}
            onBack={() => setSelected(null)}
            onBoardRefresh={() => refetch()}
          />
          <View style={styles.actions}>
            <Button label="Refresh" variant="secondary" onPress={() => { refetch(); }} />
            <Button label="Close" variant="ghost" onPress={close} />
          </View>
        </>
      ) : (
        <>
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
                    onSelect={setSelected}
                  />
                ))
              : null}
          </Card>
          <Text style={[styles.note, { color: colors.foregroundMuted }]}>
            Tap an issue to open its detail view. Push-to-composer is
            unavailable: the v8 SDK exposes no composer-insert API, so copy
            the reference and paste it into chat.
          </Text>
          <View style={styles.actions}>
            <Button label="Refresh" variant="secondary" onPress={() => { refetch(); }} />
            <Button label="Close" variant="ghost" onPress={close} />
          </View>
        </>
      )}
    </ModalBody>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 6,
    paddingHorizontal: 6,
    minWidth: 44,
    minHeight: 22,
    overflow: "hidden",
    flexShrink: 1,
  },
  title: {
    fontSize: 11,
    fontWeight: "500",
    flexShrink: 1,
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
  detail: {
    gap: 12,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  labelGroup: {
    gap: 6,
    paddingTop: 4,
  },
  labelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
  },
  markdown: {
    gap: 8,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 19,
  },
  envelopeCard: {
    gap: 8,
  },
  shaList: {
    gap: 6,
  },
  commentCard: {
    gap: 8,
  },
  commentEnvelope: {
    paddingTop: 4,
  },
  envelopeHint: {
    fontSize: 11,
    fontStyle: "italic",
  },
  composer: {
    gap: 8,
    paddingTop: 4,
  },
});

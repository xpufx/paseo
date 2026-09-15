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
  usePluginSettings,
  usePluginTheme,
  copyToClipboard,
  useResponsive,
  getClientHost,
  type RenderModalProps,
  type RenderPillProps,
  type PillLiveContext,
} from "./vendor/paseo-plugin-helper/index.ts";
import {
  ATTENTION_LABELS,
  PRIORITY_ORDER,
  SPEC_LABELS,
  STATE_ORDER,
  addCommentContract,
  currentPriorityLabel,
  currentStateLabel,
  displayNameForDirectory,
  displayRemoteForApi,
  formatIssueCountLabel,
  forgejoSettingsContract,
  type ForgejoSettings,
  issueDetailContract,
  nextStateLabel,
  openIssuesContract,
  parseForgejoRemote,
  parseMarkdownLite,
  setLabelContract,
  shortLabelName,
  stripAgentEnvelopeFooter,
  type AgentEnvelope,
  type ForgejoIssue,
  type IssueComment,
  type MarkdownLiteSpan,
} from "../shared/issues.js";

export const ISSUES_PILL_ID = "forges-issues";

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

/** Workspace display name everywhere: explicit label, else resolved repo. */
function useDisplayName(workspaceId: string, inferredRepo: string | null | undefined): string | null {
  const directory = useDirectory(workspaceId);
  const { settings } = usePluginSettings(forgejoSettingsContract);
  return displayNameForDirectory(settings, directory, inferredRepo);
}

function useOpenIssues(workspaceId: string, agentId?: string) {
  const directory = useDirectory(workspaceId);
  const { settings } = usePluginSettings(forgejoSettingsContract);
  const storedRemote = directory ? (settings.remotesByDirectory?.[directory] ?? "") : "";
  const query = useRpcQuery(
    openIssuesContract,
    { directory: directory ?? undefined, remoteUrl: storedRemote || undefined },
    { refetchInterval: 30000 },
  );
  const data = query.data;
  React.useEffect(() => {
    if (data) {
      rememberCount(agentId ?? workspaceId, directory ?? undefined, data.error ? null : data.issues.length);
    }
  }, [agentId, workspaceId, directory, data]);
  return { directory, ...query };
}

export function ForgejoPill({ agentId, workspaceId, isOpen }: RenderPillProps) {
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();
  const { Icon } = getClientHost();
  const { data, isLoading } = useOpenIssues(workspaceId, agentId);
  const count = data && !data.error ? (data.openIssueCount ?? data.issues.length) : null;
  const countLabel = formatIssueCountLabel(count);
  const displayName = useDisplayName(workspaceId, data?.repo);
  const fullLabel = displayName
    ? (count == null ? displayName : `${displayName} · ${count}`)
    : countLabel;
  const label =
    isLoading && !data
      ? "..."
      : isCompact
        ? (count == null ? "iss" : fullLabel)
        : fullLabel;
  return (
    <View
      accessibilityLabel={`Forgejo ${fullLabel}`}
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
  const digits = q.startsWith("#") ? q.slice(1) : q;
  if (/^\d+$/.test(digits) && String(issue.number).startsWith(digits)) return true;
  return (
    issue.title.toLowerCase().includes(q) ||
    issue.labels.some((label) => label.toLowerCase().includes(q))
  );
}

/**
 * Markdown reference for pasting into chat, e.g. `[#30 Turn count](url)`.
 * The repo web URL is derived from the RPC repo when available.
 */
function issueMarkdownRef(issue: ForgejoIssue, repo: string | null, host: string | null): string {
  const ref = `#${issue.number}: ${issue.title}`;
  if (!repo || !host) return ref;
  return `[${ref}](https://${host}/${repo}/issues/${issue.number})`;
}

function formatTimestamp(value: string | undefined | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function RepoVisibilityBadge({ visible }: { visible: boolean | null | undefined }) {
  if (visible == null) return null;
  return visible
    ? <Badge variant="success" label="public" icon="Globe" />
    : <Badge variant="neutral" label="private" icon="Lock" />;
}

function badgeVariantForLabel(label: string): "danger" | "warning" | "info" | "success" | "neutral" {  if (label === "priority/0-SOS") return "danger";
  if (label === "state/3-verify") return "warning";
  if (label === "state/1-wip") return "info";
  if (label === "state/4-done" || label === "spec/2-approved") return "success";
  return "neutral";
}

function renderInlineSpans(
  spans: MarkdownLiteSpan[],
  colors: { foreground: string; accent: string },
  keyPrefix: string,
) {
  return spans.map((span, index) => {
    const key = `${keyPrefix}-${index}`;
    if (span.kind === "bold") {
      return (
        <Text key={key} style={styles.bold}>
          {span.text}
        </Text>
      );
    }
    if (span.kind === "italic") {
      return (
        <Text key={key} style={styles.italic}>
          {span.text}
        </Text>
      );
    }
    if (span.kind === "code") {
      return (
        <Text key={key} style={styles.inlineCode}>
          {span.text}
        </Text>
      );
    }
    if (span.kind === "link") {
      return (
        <Text
          key={key}
          style={[styles.link, { color: colors.accent }]}
          onPress={() => {
            Linking.openURL(span.url).catch(() => {
              copyToClipboard(span.url).catch(() => {});
            });
          }}
        >
          {span.text}
        </Text>
      );
    }
    return <Text key={key}>{span.text}</Text>;
  });
}

/**
 * Markdown-lite for Forgejo bodies: headings, paragraphs, lists, links,
 * inline code/emphasis, and fenced code blocks. Outer Text stays
 * selectable; links open on tap with copy fallback.
 */
function MarkdownLite({ body }: { body: string }) {
  const { colors } = usePluginTheme();
  const blocks = useMemo(() => parseMarkdownLite(body), [body]);
  return (
    <View style={styles.markdown}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return <CodeBlock key={index} code={block.text} language={block.language} />;
        }
        if (block.kind === "heading") {
          return (
            <Text
              key={index}
              selectable
              style={[
                styles.bodyText,
                block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3,
                { color: colors.foreground },
              ]}
            >
              {renderInlineSpans(block.spans, colors, `h${index}`)}
            </Text>
          );
        }
        if (block.kind === "list") {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listRow}>
                  <Text selectable style={[styles.bullet, { color: colors.foreground }]}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <Text selectable style={[styles.listText, { color: colors.foreground }]}>
                    {renderInlineSpans(item, colors, `li${index}-${itemIndex}`)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text
            key={index}
            selectable
            style={[styles.bodyText, { color: colors.foreground }]}
          >
            {renderInlineSpans(block.spans, colors, `p${index}`)}
          </Text>
        );
      })}
    </View>
  );
}

function IssueRow({
  number,
  title,
  state,
  labels,
  repo,
  host,
  onSelect,
}: {
  number: number;
  title: string;
  state: string;
  labels: string[];
  repo: string | null;
  host: string | null;
  onSelect: (issueNumber: number) => void;
}) {
  const { colors } = usePluginTheme();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyToClipboard(issueMarkdownRef({ number, title, state, labels }, repo, host))
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
        badge={<Badge variant="neutral" label={envelope.agentShortId} />}
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
  const body = stripAgentEnvelopeFooter(comment.body) || comment.body;
  return (
    <Card style={styles.commentCard}>
      <Card.Header
        title={comment.author}
        subtitle={formatTimestamp(comment.createdAt)}
        icon="MessageSquare"
      />
      <MarkdownLite body={body} />
      {comment.envelope ? <AgentEnvelopeCard envelope={comment.envelope} /> : null}
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
  const displayName = useDisplayName(workspaceId, detail.data?.repo);
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
          description={detail.data?.error ?? "Could not reach the forge."}
          actionLabel="Retry"
          onAction={() => detail.refetch()}
        />
      ) : null}
      {issue ? (
        <>
          <Card variant="elevated">
            <Card.Header
              title={`#${issue.number} ${issue.title}`}
              subtitle={`${displayName ? `${displayName} · ` : ""}by ${issue.author} · ${formatTimestamp(issue.updatedAt)}`}
              badge={<RepoVisibilityBadge visible={detail.data?.repoPublic} />}
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
            {detail.data?.tokenValid !== true ? (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Read-only — labeling needs a valid token (see Settings).
              </Text>
            ) : (
            <>
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
            </>
            )}
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
              title={`Comments (${issue.comments.length})`}
              icon="MessagesSquare"
            />
            {issue.comments.length === 0 ? (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>No comments yet.</Text>
            ) : (
              issue.comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)
            )}
            {detail.data?.tokenValid !== true ? (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Read-only — commenting needs a valid token (see Settings).
              </Text>
            ) : (
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
            )}
          </Card>
        </>
      ) : null}
    </View>
  );
}

export function ForgejoIssuesView({
  agentId,
  workspaceId,
  onClose,
}: {
  agentId?: string;
  workspaceId: string;
  onClose?: () => void;
}) {
  const { colors } = usePluginTheme();
  const { data, isLoading, isError, refetch, isRefetching } = useOpenIssues(workspaceId, agentId);
  const directory = useDirectory(workspaceId);
  const { settings, updateSettingsAsync } = usePluginSettings(forgejoSettingsContract);
  const [remoteDraft, setRemoteDraft] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const storedRemote = directory ? (settings.remotesByDirectory?.[directory] ?? "") : "";
  const storedName = directory ? (settings.namesByDirectory?.[directory] ?? "") : "";
  const nameValue = nameDraft ?? storedName;
  const remoteValue = remoteDraft ?? storedRemote;
  const trimmedRemote = remoteValue.trim();
  const isBareRemote = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmedRemote);
  const derivedHost = parseForgejoRemote(data?.derivedRemote)?.host ?? null;
  const effectiveHost = trimmedRemote
    ? (parseForgejoRemote(trimmedRemote)?.host ?? (isBareRemote ? derivedHost : null))
    : derivedHost;
  const remoteInvalid = Boolean(trimmedRemote && !parseForgejoRemote(trimmedRemote) && !isBareRemote);
  const storedToken = effectiveHost ? (settings.tokensByHost?.[effectiveHost] ?? "") : "";
  const tokenValue = tokenDraft ?? storedToken;
  const saveSettings = async () => {
    if (!directory) return;
    setFormSaving(true);
    setFormError(null);
    try {
      const updates: Partial<ForgejoSettings> = {};
      if (remoteValue !== storedRemote) {
        const next = { ...(settings.remotesByDirectory ?? {}) };
        if (trimmedRemote) next[directory] = trimmedRemote;
        else delete next[directory];
        updates.remotesByDirectory = next;
      }
      if (tokenDraft != null && effectiveHost) {
        const next = { ...(settings.tokensByHost ?? {}) };
        if (tokenDraft.trim()) next[effectiveHost] = tokenDraft.trim();
        else delete next[effectiveHost];
        updates.tokensByHost = next;
      }
      if (nameValue !== storedName) {
        const next = { ...(settings.namesByDirectory ?? {}) };
        if (nameValue.trim()) next[directory] = nameValue.trim();
        else delete next[directory];
        updates.namesByDirectory = next;
      }
      await updateSettingsAsync(updates);
      setRemoteDraft(null);
      setTokenDraft(null);
      setNameDraft(null);
      refetch();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save settings");
    } finally {
      setFormSaving(false);
    }
  };
  const repo = data?.repo ?? null;
  const displayName = useDisplayName(workspaceId, repo);
  const [activeTab, setActiveTab] = useState("issues");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [extraIssues, setExtraIssues] = useState<ForgejoIssue[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const [extraHasMore, setExtraHasMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const resetPages = () => {
    setExtraIssues([]);
    setNextPage(2);
    setExtraHasMore(false);
    setMoreError(null);
  };
  React.useEffect(() => { resetPages(); }, [data?.repo]);
  const loadMore = useRpcMutation(openIssuesContract, {
    onSuccess: (result) => {
      if (result.error) {
        setMoreError(result.error);
        return;
      }
      setExtraIssues((prev) => [...prev, ...result.issues.filter((issue: ForgejoIssue) => !prev.some((p) => p.number === issue.number))]);
      setNextPage(result.page + 1);
      setExtraHasMore(result.hasMore);
      setMoreError(null);
    },
    onError: (error) => {
      setMoreError(error instanceof Error ? error.message : "Could not load more issues");
    },
  });
  const pool = useMemo(
    () => (data && !data.error ? [...data.issues, ...extraIssues] : [...extraIssues]),
    [data, extraIssues],
  );
  const issues = useMemo(
    () => pool.filter((issue: ForgejoIssue) => issueMatchesQuery(issue, query)),
    [pool, query],
  );
  const hasMore = extraHasMore || (data && !data.error ? data.hasMore : false);
  const failed = Boolean(data?.error) || isError;
  return (
    <ModalBody
      header={
        <Tabs
          tabs={[
            { id: "issues", label: "Open Issues", shortLabel: "Issues" },
            { id: "settings", label: "Settings", shortLabel: "Settings" },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      }
      headerMode="pinned"
      headerStyle={{
        backgroundColor: colors.surface0,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 6,
      }}
      refreshing={isRefetching}
      onRefresh={() => { refetch(); }}
    >
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
            {onClose ? <Button label="Close" variant="ghost" onPress={onClose} /> : null}
          </View>
        </>
      ) : (
        <>
          {activeTab === "settings" ? (
            <Card>
              <Card.Header
                title={displayName ? `Forgejo settings · ${displayName}` : "Forgejo settings"}
                subtitle={storedRemote.trim() ? "Explicit override active" : "Derived from git origin remote"}
                badge={<RepoVisibilityBadge visible={data?.repoPublic} />}
                icon="Settings"
              />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Remote accepts owner/repo, scp-like (git@host:owner/repo.git), ssh:// and https:// URLs.
                Leave empty to derive from the git origin remote.
                {data?.derivedRemote && !storedRemote.trim() ? ` Derived: ${displayRemoteForApi(data.derivedRemote)}` : null}
              </Text>
              <TextInput
                value={remoteValue}
                onChangeText={(text) => setRemoteDraft(text)}
                placeholder={displayRemoteForApi(data?.derivedRemote) ?? "e.g. https://forge.mrs.aager.de/xpufx/paseo"}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                {effectiveHost
                  ? `API token for ${effectiveHost}. Leave empty to remove it.`
                  : "API token — needs a resolvable host from the remote above."}
              </Text>
              <TextInput
                value={tokenValue}
                onChangeText={setTokenDraft}
                placeholder="Forgejo API token"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Name for this workspace on the pill. Leave empty to use the repo.
              </Text>
              <TextInput
                value={nameValue}
                onChangeText={setNameDraft}
                placeholder={data?.repo ?? "e.g. tea"}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {remoteInvalid ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  Remote is not a valid remote URL or owner/repo.
                </Text>
              ) : null}
              {data && !isLoading ? (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                  {data.repoPublic == null
                    ? "Repo visibility unknown (could not reach host)."
                    : data.repoPublic
                      ? "Repo is public — anonymous reads work."
                      : "Repo is private — a valid token is required."}
                  {data.tokenValid == null
                    ? " No token saved."
                    : data.tokenValid
                      ? " Token is valid."
                      : " Saved token was rejected."}
                </Text>
              ) : null}
              {formError ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  {formError}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Button
                  label={formSaving ? "Saving…" : "Save"}
                  variant="primary"
                  disabled={formSaving || !directory || remoteInvalid || (remoteValue === storedRemote && tokenDraft == null && nameValue === storedName) || (tokenDraft != null && !effectiveHost)}
                  loading={formSaving}
                  onPress={() => { void saveSettings(); }}
                />
              </View>
            </Card>
          ) : (
          <>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by keyword or #number…"
          />
          <Card variant="elevated">
            <Card.Header
              title={displayName ? `Issues · ${displayName}` : "Forgejo Issues"}
              badge={<RepoVisibilityBadge visible={data?.repoPublic} />}
              subtitle={
                data && !data.error
                  ? query.trim()
                    ? `${issues.length} of ${data.openIssueCount ?? pool.length} match`
                    : `${data.openIssueCount ?? pool.length} open`
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
                description={data?.error ?? "Could not reach the forge."}
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
                    host={data?.host ?? null}
                    onSelect={setSelected}
                  />
                ))
              : null}
            {!failed && hasMore && !query.trim() ? (
              <View style={styles.actions}>
                <Button
                  label={loadMore.isPending ? "Loading…" : "Load more"}
                  variant="secondary"
                  disabled={loadMore.isPending}
                  loading={loadMore.isPending}
                  onPress={() => { loadMore.mutate({ directory: directory ?? undefined, remoteUrl: storedRemote || undefined, page: nextPage }); }}
                />
              </View>
            ) : null}
            {moreError ? (
              <Text style={[styles.hint, { color: colors.foreground }]}>{moreError}</Text>
            ) : null}
          </Card>
          <Text style={[styles.note, { color: colors.foregroundMuted }]}>
            Tap an issue to open its detail view. Push-to-composer is
            unavailable: the v8 SDK exposes no composer-insert API, so copy
            the reference and paste it into chat.
          </Text>
          <View style={styles.actions}>
            <Button label="Refresh" variant="secondary" onPress={() => { resetPages(); refetch(); }} />
            {onClose ? <Button label="Close" variant="ghost" onPress={onClose} /> : null}
          </View>
          </>
          )}
        </>
      )}
    </ModalBody>
  );
}

export function ForgejoIssuesModal({ agentId, workspaceId, close }: RenderModalProps) {
  return <ForgejoIssuesView agentId={agentId} workspaceId={workspaceId} onClose={close} />;
}

export function ForgejoIssuesPanel({ workspaceId }: { workspaceId: string }) {
  return <ForgejoIssuesView workspaceId={workspaceId} />;
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
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  inlineCode: {
    fontFamily: "monospace",
    fontSize: 12,
  },
  link: {
    fontSize: 13,
    textDecorationLine: "underline",
  },
  heading1: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  heading2: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  heading3: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  list: {
    gap: 4,
  },
  listRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  bullet: {
    fontSize: 13,
    lineHeight: 19,
    minWidth: 14,
  },
  listText: {
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
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
  composer: {
    gap: 8,
    paddingTop: 4,
  },
});

import React, { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View, type ScrollView as ScrollViewInstance } from "react-native";
import { useWorkspace } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import {
  ModalBody,
  Card,
  Button,
  Badge,
  EmptyState,
  FormRow,
  SearchInput,
  Tabs,
  Toggle,
  CodeBlock,
  CommandBox,
  KeyValue,
  KeyValueGroup,
  TextInput,
  Collapsible,
  ActionBar,
  ForgeIcon,
  HighlightedText,
  useRpcQuery,
  useRpcMutation,
  usePluginSettings,
  usePluginTheme,
  copyToClipboard,
  getClientHost,
  type RenderModalProps,
  type RenderPillProps,
} from "paseo-plugin-helper/client";
import { hasHighlightMatch } from "paseo-plugin-helper/shared";
import { HookQueueView } from "./hook-queue-panel.js";
import {
  ATTENTION_LABELS,
  PRIORITY_ORDER,
  SPEC_LABELS,
  STATE_ORDER,
  activeForgeForDirectory,
  addCommentContract,
  classifyForgeUrl,
  createIssueContract,
  currentPriorityLabel,
  currentStateLabel,
  createRemoteSearchGate,
  displayNameForDirectory,
  displayRemoteForApi,
  deriveForgeAccess,
  effectiveForgeHost,
  forgeContextContract,
  forgeTargetsForWorkspace,
  isValidForgeTarget,
  forgeSettingsContract,
  installLabelsContract,
  parseLabelList,
  type ForgeAccessInput,
  type ForgeAccessState,
  type ForgeSettings,
  type InstallLabelMode,
  issueDetailContract,
  nextStateLabel,
  openIssuesContract,
  parseMarkdownLite,
  resolveIssueSearchLayer,
  searchIssuesContract,
  setLabelContract,
  shortLabelName,
  stripAgentEnvelopeFooter,
  writeGateNotice,
  type AgentEnvelope,
  type ForgeRepoIdentity,
  type ForgeIssue,
  type ForgeLabel,
  type IssueComment,
  type MarkdownLiteSpan,
  workspaceNameKey,
} from "../shared/issues.js";
import { useActiveForgeIdentity } from "./active-forge.js";
import { forgePillLabel } from "./pill-label.js";
import { ForeignInlineMark } from "./foreign-link.js";
import { LabelChip, LabelChipList } from "./label-chip.js";

export const ISSUES_PILL_ID = "forges-issues";

function useDirectory(workspaceId: string): string | undefined {
  return useWorkspace(
    workspaceId,
    (w: PluginWorkspaceSnapshot) => w?.directory,
  ) as string | undefined;
}

/** Main-repo root backing a workspace (shared by its worktrees), if known. */
function useWorkspaceRoot(workspaceId: string): string | undefined {
  return useWorkspace(
    workspaceId,
    (w: PluginWorkspaceSnapshot) => w?.projectRootPath,
  ) as string | undefined;
}

/** Settings key for the workspace display name (worktrees share the main root). */
function useWorkspaceNameKey(workspaceId: string): string {
  return workspaceNameKey(useDirectory(workspaceId), useWorkspaceRoot(workspaceId));
}

/** Workspace display name everywhere: explicit label, else resolved repo. */
function useDisplayName(workspaceId: string, inferredRepo: string | null | undefined): string | null {
  const nameKey = useWorkspaceNameKey(workspaceId);
  const { settings } = usePluginSettings(forgeSettingsContract);
  return displayNameForDirectory(settings, nameKey, inferredRepo);
}

function useOpenIssues(workspaceId: string) {
  const directory = useDirectory(workspaceId);
  const { settings } = usePluginSettings(forgeSettingsContract);
  const forgeTarget = activeForgeForDirectory(settings, directory) ?? "";
  const query = useRpcQuery(
    openIssuesContract,
    { directory: directory ?? undefined, remoteUrl: forgeTarget || undefined },
    { refetchInterval: 30000 },
  );
  return { directory, ...query };
}

export function ForgePill({ workspaceId, isOpen }: RenderPillProps) {
  const { colors } = usePluginTheme();
  const { data, isLoading, directory } = useOpenIssues(workspaceId);
  const activeForge = useActiveForgeIdentity(directory);
  const forgeHost = activeForge?.host ?? data?.host ?? null;
  const count = data && !data.error ? (data.openIssueCount ?? data.issues.length) : null;
  const displayName = useDisplayName(workspaceId, data?.repo);
  const label = forgePillLabel({ displayName, count, loading: isLoading && !data });
  return (
    <View
      accessibilityLabel={`Forge ${label}`}
      style={styles.pillContainer}
    >
      <ForgeIcon host={forgeHost} size={13} color={colors.foreground} />
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

function issueMatchesQuery(issue: ForgeIssue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.startsWith("#") ? q.slice(1) : q;
  if (/^\d+$/.test(digits) && String(issue.number).startsWith(digits)) return true;
  return (
    issue.title.toLowerCase().includes(q) ||
    issue.labels.some((label) => label.toLowerCase().includes(q))
  );
}

/** Trailing-edge debounce: emits `value` only after it stops changing. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const REMOTE_SEARCH_DEBOUNCE_MS = 300;

/**
 * Scrolls the helper-owned `ModalBody` scroller to a measured match target the
 * moment a search trigger changes. `resolveY` is polled briefly so a target
 * that lays out after the keystroke is still reached. Best-effort: when the
 * host owns the scroll (`scrollRef` null — desktop dialogs and popovers) there
 * is no scroller to move and this is a no-op.
 */
function useMatchScrollTarget(
  scrollRef: React.RefObject<ScrollViewInstance | null>,
  trigger: string,
  resolveY: () => number | null,
): void {
  const scrollTo = React.useCallback(
    (y: number) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    },
    [scrollRef],
  );
  const resolveRef = React.useRef(resolveY);
  resolveRef.current = resolveY;
  React.useEffect(() => {
    if (!trigger.trim()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const attempt = () => {
      const y = resolveRef.current();
      if (y != null) {
        scrollTo(y);
        return;
      }
      if (tries++ < 8) timer = setTimeout(attempt, 25);
    };
    timer = setTimeout(attempt, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [trigger, scrollTo]);
}

// Operator-only surface: the optional label-set install stays wired for our own
// board but never renders in the release (issue #163). The matching RPC is not
// registered either, so there is no end-user path to it.
const LABEL_SET_INSTALL_VISIBLE = false;

/**
 * Markdown reference for pasting into chat, e.g. `[#30 Turn count](url)`.
 * The repo web URL is derived from the RPC repo when available.
 */
function issueMarkdownRef(
  issue: Pick<ForgeIssue, "number" | "title">,
  repo: string | null,
  host: string | null,
): string {
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

/**
 * Host-resolved forge mark for headers and rows. The helper's `ForgeIcon`
 * resolves the host to its brand mark (generic for unknown hosts), so the
 * plugin carries no host table of its own.
 */
function ForgeMark({ host, size = 14 }: { host?: string | null; size?: number }) {
  const { colors } = usePluginTheme();
  return <ForgeIcon host={host} size={size} color={colors.foregroundMuted} />;
}

/**
 * Combined visibility + auth chips, derived from the same access state for
 * both the issues and settings pages (issue #152). The auth chip is what
 * tells the user whether edits are enabled on a public repo.
 */
function RepoAccessChips({ access }: { access: ForgeAccessState }) {
  return (
    <View style={styles.accessChips}>
      {access.visibilityLabel ? (
        <Badge
          variant={access.visibility === "public" ? "success" : "neutral"}
          label={access.visibilityLabel}
          icon={access.visibility === "public" ? "Globe" : "Lock"}
        />
      ) : null}
      <Badge
        variant={access.authVariant}
        label={access.authLabel}
        icon={access.authIcon}
      />
    </View>
  );
}

/** Card-header identity cluster: the forge mark beside the access chips. */
function ForgeCardChips({ host, access }: { host?: string | null; access: ForgeAccessState }) {
  return (
    <View style={styles.accessChips}>
      <ForgeMark host={host} />
      <RepoAccessChips access={access} />
    </View>
  );
}

/** Single derivation both pages render from: visibility × token state. */
function useRepoAccess(input: ForgeAccessInput): ForgeAccessState {
  return useMemo(
    () => deriveForgeAccess(input),
    [input.repoPublic, input.tokenPresent, input.tokenValid, input.repoWritePermission],
  );
}

function issueLabelChips(issue: Pick<ForgeIssue, "labels" | "labelDetails">): ForgeLabel[] {
  // Prefer the color-bearing API view; fall back to names for older payloads.
  if (issue.labelDetails.length > 0) return issue.labelDetails;
  return issue.labels.map((name) => ({ name }));
}

/**
 * Color map for labels seen on the loaded board, keyed by name. The editor's
 * candidate vocabulary is static, so this is how a picker chip learns the
 * forge's color for a label the issue itself does not carry.
 */
function boardLabelMap(issues: readonly ForgeIssue[]): Map<string, ForgeLabel> {
  const map = new Map<string, ForgeLabel>();
  for (const issue of issues) {
    for (const label of issue.labelDetails) {
      if (!map.has(label.name)) map.set(label.name, label);
    }
  }
  return map;
}

function editorLabelChips(
  names: readonly string[],
  known: Map<string, ForgeLabel>,
): ForgeLabel[] {
  return names.map((name) => known.get(name) ?? { name });
}

function renderInlineSpans(
  spans: MarkdownLiteSpan[],
  colors: { foreground: string; accent: string; statusWarning: string },
  keyPrefix: string,
  activeForge: ForgeRepoIdentity | null,
  query: string,
) {
  return spans.map((span, index) => {
    const key = `${keyPrefix}-${index}`;
    if (span.kind === "bold") {
      return (
        <Text key={key} style={styles.bold}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "italic") {
      return (
        <Text key={key} style={styles.italic}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "code") {
      return (
        <Text key={key} style={styles.inlineCode}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "link") {
      const foreign = classifyForgeUrl(span.url, activeForge) === "foreign";
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
          <HighlightedText text={span.text} query={query} />
          {foreign ? <ForeignInlineMark color={colors.statusWarning} /> : null}
        </Text>
      );
    }
    return <HighlightedText key={key} text={span.text} query={query} />;
  });
}

/**
 * Markdown-lite for forge bodies: headings, paragraphs, lists, links,
 * inline code/emphasis, and fenced code blocks. Outer Text stays
 * selectable; links open on tap with copy fallback. Forge issue links that
 * point outside the active repo get an inline `foreign` marker.
 */
function MarkdownLite({
  body,
  activeForge,
  query = "",
}: {
  body: string;
  activeForge: ForgeRepoIdentity | null;
  /** Active search query; matches inside inline spans are highlighted. */
  query?: string;
}) {
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
              {renderInlineSpans(block.spans, colors, `h${index}`, activeForge, query)}
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
                    {renderInlineSpans(item, colors, `li${index}-${itemIndex}`, activeForge, query)}
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
            {renderInlineSpans(block.spans, colors, `p${index}`, activeForge, query)}
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
  query,
  onLayoutY,
}: {
  number: number;
  title: string;
  state: string;
  labels: ForgeLabel[];
  repo: string | null;
  host: string | null;
  onSelect: (issueNumber: number) => void;
  /** Active search query; title and labels highlight their matches. */
  query?: string;
  onLayoutY?: (y: number) => void;
}) {
  const { colors } = usePluginTheme();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyToClipboard(issueMarkdownRef({ number, title }, repo, host))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  return (
    <View style={styles.row} onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}>
      <ForgeMark host={host} />
      <Badge
        variant={state === "open" ? "success" : "neutral"}
        label={`#${number}`}
      />
      <Badge
        variant={state === "open" ? "success" : "neutral"}
        label={state === "closed" ? "Closed" : "Open"}
      />
      <Pressable style={styles.rowBody} onPress={() => onSelect(number)} hitSlop={4}>
        <HighlightedText
          text={title}
          query={query ?? ""}
          style={[styles.rowTitle, { color: colors.foreground }]}
        />
        <LabelChipList labels={labels} style={styles.rowLabels} query={query} />
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

function CommentCard({
  comment,
  issueUrl,
  activeForge,
  query,
}: {
  comment: IssueComment;
  issueUrl: string;
  activeForge: ForgeRepoIdentity | null;
  query?: string;
}) {
  const { colors } = usePluginTheme();
  const { Icon } = getClientHost();
  const body = stripAgentEnvelopeFooter(comment.body) || comment.body;
  const target = comment.url || issueUrl;
  const open = () => {
    Linking.openURL(target).catch(() => {});
  };
  const copy = () => {
    copyToClipboard(target).catch(() => {});
  };
  return (
    <Card style={styles.commentCard}>
      <Card.Header
        title={comment.author}
        subtitle={formatTimestamp(comment.createdAt)}
        icon="MessageSquare"
      />
      <View style={styles.commentRow}>
        <Icon name="ExternalLink" size={13} color={colors.accent} />
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open comment by ${comment.author}`}
          style={styles.commentBody}
          onPress={open}
          hitSlop={8}
        >
          <MarkdownLite body={body} activeForge={activeForge} query={query} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy comment link"
          onPress={copy}
          hitSlop={10}
        >
          <Text style={[styles.copyText, { color: colors.foregroundMuted }]}>⧉</Text>
        </Pressable>
      </View>
      {comment.envelope ? <AgentEnvelopeCard envelope={comment.envelope} /> : null}
    </Card>
  );
}

/** Gated edit notice with a working route to fix the credential state. */
function ReadOnlyNotice({
  access,
  capability,
  onAction,
}: {
  access: ForgeAccessState;
  capability: string;
  onAction: () => void;
}) {
  const { colors } = usePluginTheme();
  return (
    <View style={styles.readOnlyNotice}>
      <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
        {writeGateNotice(access, capability)}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        icon="Settings"
        label="Add a token"
        onPress={onAction}
      />
    </View>
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
  labels: readonly ForgeLabel[];
  active: string | null;
  pending: boolean;
  onSelect: (label: string) => void;
}) {
  const { colors, touchTargetMin } = usePluginTheme();
  const hitSlop = Math.max(0, (touchTargetMin - 32) / 2);
  return (
    <View style={styles.labelGroup}>
      <Text style={[styles.sectionTitle, { color: colors.foregroundMuted }]}>{title}</Text>
      <View style={styles.labelRow}>
        {labels.map((label) => (
          <Pressable
            key={label.name}
            onPress={() => onSelect(label.name)}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel={shortLabelName(label.name)}
            hitSlop={hitSlop}
            style={pending && active === label.name ? styles.labelChipPending : undefined}
          >
            <LabelChip label={label} selected={active === label.name} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * Compose surface for opening a ticket on the active forge (issue #200).
 * Gated on the shared access state: hidden when anonymous (no path to a write),
 * the #193 scope hint when the token is accepted but under-scoped, and the
 * enabled form otherwise. The list refreshes on success.
 */
function NewIssueComposer({
  directory,
  forgeTarget,
  access,
  onCreated,
  onOpenSettings,
}: {
  directory?: string;
  forgeTarget: string;
  access: ForgeAccessState;
  onCreated: () => void;
  onOpenSettings: () => void;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const create = useRpcMutation(createIssueContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setLabelsText("");
      setExpanded(false);
      onCreated();
      toast.show(result.number ? `Created issue #${result.number}` : "Issue created", {
        variant: "success",
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not create issue");
    },
  });
  // Anonymous hosts have no path to a write, so the surface is hidden entirely;
  // every other non-editable state keeps the gate visible with its explanation.
  if (access.auth === "anonymous") return null;
  if (!access.canEdit) {
    return (
      <ReadOnlyNotice access={access} capability="creating issues" onAction={onOpenSettings} />
    );
  }
  const pending = create.isPending;
  const canSubmit = title.trim().length > 0 && !pending;
  const submit = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    create.mutate({
      directory: directory ?? undefined,
      remoteUrl: forgeTarget || undefined,
      title: nextTitle,
      body: body.trim(),
      labels: parseLabelList(labelsText),
    });
  };
  return (
    <Collapsible
      title="New issue"
      subtitle="Open a ticket on the active forge"
      icon="Plus"
      isExpanded={expanded}
      onToggle={setExpanded}
    >
      <View style={styles.newIssueForm}>
        <FormRow label="Title">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Short, specific title"
            autoCapitalize="sentences"
          />
        </FormRow>
        <FormRow label="Description" description="Markdown supported.">
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What needs to happen?"
            multiline
            numberOfLines={4}
          />
        </FormRow>
        <Collapsible title="Labels" subtitle="Optional — comma-separated names" icon="Tags">
          <FormRow label="Label names">
            <TextInput
              value={labelsText}
              onChangeText={setLabelsText}
              placeholder="state/1-wip, priority/1-high"
            />
          </FormRow>
        </Collapsible>
        <ActionBar>
          <Button
            label="Cancel"
            variant="ghost"
            disabled={pending}
            onPress={() => setExpanded(false)}
          />
          <Button
            label={pending ? "Creating…" : "Create issue"}
            variant="primary"
            icon="Plus"
            disabled={!canSubmit}
            loading={pending}
            onPress={submit}
          />
        </ActionBar>
      </View>
    </Collapsible>
  );
}

function IssueDetailView({
  workspaceId,
  issueNumber,
  forgeTarget,
  activeForge,
  boardLabels,
  query,
  scrollRef,
  onBack,
  onBoardRefresh,
  onOpenSettings,
}: {
  workspaceId: string;
  issueNumber: number;
  forgeTarget: string;
  activeForge: ForgeRepoIdentity | null;
  boardLabels: Map<string, ForgeLabel>;
  /** Active search query; matched title/label/body/comment text is highlighted. */
  query: string;
  /** Helper-owned ModalBody scroller, used for best-effort go-to-match. */
  scrollRef: React.RefObject<ScrollViewInstance | null>;
  onBack: () => void;
  onBoardRefresh: () => void;
  onOpenSettings: () => void;
}) {
  const { colors } = usePluginTheme();
  const toast = useToast();
  const directory = useDirectory(workspaceId);
  const baseInput = {
    issueNumber,
    directory: directory ?? undefined,
    remoteUrl: forgeTarget || undefined,
  };
  const detail = useRpcQuery(
    issueDetailContract,
    baseInput,
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
  const candidates = useMemo(() => {
    const known = new Map(boardLabels);
    for (const label of issue?.labelDetails ?? []) known.set(label.name, label);
    return {
      state: editorLabelChips(STATE_ORDER, known),
      priority: editorLabelChips(PRIORITY_ORDER, known),
      attention: editorLabelChips(ATTENTION_LABELS, known),
      spec: editorLabelChips(SPEC_LABELS, known),
    };
  }, [boardLabels, issue?.labelDetails]);
  const access = useRepoAccess({
    repoPublic: detail.data?.repoPublic,
    tokenPresent: detail.data?.tokenPresent,
    tokenValid: detail.data?.tokenValid,
    repoWritePermission: detail.data?.repoWritePermission,
  });
  // Go-to-match (issue #190): section offsets reported relative to the detail
  // root, then resolved to the first section that contains the query. Only the
  // helper-owned scroller can move; when the host owns it this is a no-op.
  const detailTop = React.useRef(0);
  const titleY = React.useRef<number | null>(null);
  const bodyY = React.useRef<number | null>(null);
  const commentsY = React.useRef<number | null>(null);
  const commentYs = React.useRef(new Map<number, number>());
  const firstCommentMatch = issue
    ? issue.comments.findIndex((comment) => hasHighlightMatch(comment.body, query))
    : -1;
  useMatchScrollTarget(
    scrollRef,
    query.trim() && issue ? `${query.trim()}|${issue.number}|${issue.comments.length}` : "",
    () => {
      if (!issue) return null;
      const top = detailTop.current;
      if (
        hasHighlightMatch(issue.title, query) ||
        issue.labels.some((label) => hasHighlightMatch(label, query))
      ) {
        return top + (titleY.current ?? 0);
      }
      if (hasHighlightMatch(issue.body, query)) {
        return top + (bodyY.current ?? 0);
      }
      if (firstCommentMatch >= 0) {
        const commentY = commentYs.current.get(issue.comments[firstCommentMatch].id);
        if (commentY == null) return null;
        return top + (commentsY.current ?? 0) + commentY;
      }
      return null;
    },
  );

  return (
    <View
      style={styles.detail}
      onLayout={(e) => {
        detailTop.current = e.nativeEvent.layout.y;
      }}
    >
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
          <View
            onLayout={(e) => {
              titleY.current = e.nativeEvent.layout.y;
            }}
          >
            <Card variant="elevated">
              <Card.Header
                title={`#${issue.number} ${issue.title}`}
                highlightQuery={query}
                subtitle={`${displayName ? `${displayName} · ` : ""}by ${issue.author} · ${formatTimestamp(issue.updatedAt)}`}
                badge={<ForgeCardChips host={activeForge?.host} access={access} />}
              />
              <LabelChipList
                labels={issueLabelChips(issue)}
                style={styles.badgeRow}
                query={query}
              />
            </Card>
          </View>

          <Card>
            <Card.Header title="Labels" subtitle="One tap applies; scope evicts the rest" icon="Tags" />
            {!access.canEdit ? (
              <ReadOnlyNotice access={access} capability="labeling" onAction={onOpenSettings} />
            ) : (
            <>
            {next ? (
              <Button
                variant="primary"
                icon="ArrowRight"
                label={state ? `Move to ${shortLabelName(next)}` : `Start ${shortLabelName(next)}`}
                disabled={labelPending}
                loading={labelPending}
                onPress={() => setLabel.mutate({ ...baseInput, label: next })}
              />
            ) : null}
            <ScopedLabelGroup
              title="State"
              labels={candidates.state}
              active={state}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ ...baseInput, label })}
            />
            <ScopedLabelGroup
              title="Priority"
              labels={candidates.priority}
              active={priority}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ ...baseInput, label })}
            />
            <ScopedLabelGroup
              title="Attention"
              labels={candidates.attention}
              active={labels.find((label) => (ATTENTION_LABELS as readonly string[]).includes(label)) ?? null}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ ...baseInput, label })}
            />
            <ScopedLabelGroup
              title="Spec"
              labels={candidates.spec}
              active={labels.find((label) => (SPEC_LABELS as readonly string[]).includes(label)) ?? null}
              pending={labelPending}
              onSelect={(label) => setLabel.mutate({ ...baseInput, label })}
            />
            </>
            )}
          </Card>

          <View
            onLayout={(e) => {
              bodyY.current = e.nativeEvent.layout.y;
            }}
          >
            <Card>
              <Card.Header title="Description" icon="FileText" />
              {issue.body.trim() ? (
                <MarkdownLite body={issue.body} activeForge={activeForge} query={query} />
              ) : (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>No description.</Text>
              )}
            </Card>
          </View>

          <View
            onLayout={(e) => {
              commentsY.current = e.nativeEvent.layout.y;
            }}
          >
            <Card>
              <Card.Header
                title={`Comments (${issue.comments.length})`}
                icon="MessagesSquare"
              />
              {issue.comments.length === 0 ? (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>No comments yet.</Text>
              ) : (
                issue.comments.map((comment) => (
                  <View
                    key={comment.id}
                    onLayout={(e) => {
                      commentYs.current.set(comment.id, e.nativeEvent.layout.y);
                    }}
                  >
                    <CommentCard
                      comment={comment}
                      issueUrl={issue.webUrl}
                      activeForge={activeForge}
                      query={query}
                    />
                  </View>
                ))
              )}
            {!access.canEdit ? (
              <ReadOnlyNotice access={access} capability="commenting" onAction={onOpenSettings} />
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
                  addComment.mutate({ ...baseInput, body });
                }}
              />
            </View>
            )}
          </Card>
          </View>
        </>
      ) : null}
    </View>
  );
}

export function ForgeIssuesView({
  workspaceId,
  onClose,
}: {
  agentId?: string;
  workspaceId: string;
  onClose?: () => void;
}) {
  const { colors } = usePluginTheme();
  const toast = useToast();
  const { data, isLoading, isError, refetch, isRefetching } = useOpenIssues(workspaceId);
  const access = useRepoAccess({
    repoPublic: data?.repoPublic,
    tokenPresent: data?.tokenPresent,
    tokenValid: data?.tokenValid,
    repoWritePermission: data?.repoWritePermission,
  });
  const directory = useDirectory(workspaceId);
  const projectRootPath = useWorkspaceRoot(workspaceId);
  const nameKey = workspaceNameKey(directory, projectRootPath);
  const activeForge = useActiveForgeIdentity(directory);
  const { settings, updateSettings, updateSettingsAsync } = usePluginSettings(forgeSettingsContract);
  // Git-origin context queried separately so the token/name fields render from
  // persisted settings even while the issues query is loading or unavailable.
  const forgeContext = useRpcQuery(forgeContextContract, { directory: directory ?? undefined });
  const [forgeDraft, setForgeDraft] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [forgeBusy, setForgeBusy] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const forgeTargets = forgeTargetsForWorkspace(settings, directory);
  const activeForgeValue = activeForgeForDirectory(settings, directory) ?? "";
  const forgeTarget = activeForgeValue;
  const derivedRemote =
    forgeContext.data?.derivedRemote ?? data?.derivedRemote ?? null;
  const effectiveHost = effectiveForgeHost(activeForgeValue, derivedRemote);
  const activeForgeInvalid = Boolean(activeForgeValue.trim()) && !isValidForgeTarget(activeForgeValue);
  const forgeDraftInvalid = Boolean(forgeDraft?.trim()) && !isValidForgeTarget(forgeDraft);
  const forgeOptions: Array<{ label: string; value: string }> = [
    { label: "Auto — derive from the git origin remote", value: "" },
    ...forgeTargets.map((target) => ({ label: target, value: target })),
  ];
  if (activeForgeValue && !forgeTargets.includes(activeForgeValue)) {
    forgeOptions.push({ label: activeForgeValue, value: activeForgeValue });
  }
  const storedName = nameKey ? (settings.namesByDirectory?.[nameKey] ?? "") : "";
  const nameValue = nameDraft ?? storedName;
  const storedToken = effectiveHost ? (settings.tokensByHost?.[effectiveHost] ?? "") : "";
  const tokenValue = tokenDraft ?? storedToken;
  const selectForge = (value: string) => {
    if (!directory) return;
    updateSettings({
      activeForgeByDirectory: { ...(settings.activeForgeByDirectory ?? {}), [directory]: value },
    });
  };
  const addForge = async () => {
    const target = (forgeDraft ?? "").trim();
    if (!target) {
      setForgeError("Enter a remote URL or owner/repo to add.");
      return;
    }
    if (!isValidForgeTarget(target)) {
      setForgeError("Forge target must be a remote URL or owner/repo, e.g. https://codeberg.org/owner/repo.");
      return;
    }
    if (!directory) {
      setForgeError("Workspace directory is still loading — try again in a moment.");
      return;
    }
    setForgeBusy(true);
    setForgeError(null);
    try {
      const alreadyWatched = forgeTargets.includes(target);
      const list = alreadyWatched ? forgeTargets : [...forgeTargets, target];
      // Editing the list supersedes the legacy single remote: fold it into the
      // list and clear the legacy key so the two sources cannot disagree.
      const nextRemotes = { ...(settings.remotesByDirectory ?? {}) };
      delete nextRemotes[directory];
      await updateSettingsAsync({
        forgesByDirectory: { ...(settings.forgesByDirectory ?? {}), [directory]: list },
        remotesByDirectory: nextRemotes,
        activeForgeByDirectory: { ...(settings.activeForgeByDirectory ?? {}), [directory]: target },
      });
      setForgeDraft(null);
      toast.show(alreadyWatched ? `Already watching ${target}` : `Added ${target}`, {
        variant: "success",
      });
    } catch (error) {
      setForgeError(error instanceof Error ? error.message : "Could not add forge");
    } finally {
      setForgeBusy(false);
    }
  };
  const removeForge = (target: string) => {
    if (!directory) return;
    const list = forgeTargets.filter((entry) => entry !== target);
    const nextForges = { ...(settings.forgesByDirectory ?? {}) };
    if (list.length) nextForges[directory] = list;
    else delete nextForges[directory];
    const nextRemotes = { ...(settings.remotesByDirectory ?? {}) };
    delete nextRemotes[directory];
    const currentActive = activeForgeForDirectory(settings, directory) ?? "";
    updateSettings({
      forgesByDirectory: nextForges,
      remotesByDirectory: nextRemotes,
      activeForgeByDirectory: {
        ...(settings.activeForgeByDirectory ?? {}),
        [directory]: currentActive === target ? (list[0] ?? "") : currentActive,
      },
    });
  };
  const saveSettings = async () => {
    if (!directory) return;
    setFormSaving(true);
    setFormError(null);
    try {
      const updates: Partial<ForgeSettings> = {};
      if (tokenDraft != null && effectiveHost) {
        const next = { ...(settings.tokensByHost ?? {}) };
        if (tokenDraft.trim()) next[effectiveHost] = tokenDraft.trim();
        else delete next[effectiveHost];
        updates.tokensByHost = next;
      }
      if (nameValue !== storedName) {
        const next = { ...(settings.namesByDirectory ?? {}) };
        if (nameValue.trim()) next[nameKey] = nameValue.trim();
        else delete next[nameKey];
        updates.namesByDirectory = next;
      }
      await updateSettingsAsync(updates);
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
  const [installChoiceOpen, setInstallChoiceOpen] = useState(false);
  const [installSummary, setInstallSummary] = useState<string | null>(null);
  const installLabels = useRpcMutation(installLabelsContract, {
    onSuccess: (result) => {
      if (result.error) {
        setInstallSummary(result.error);
        return;
      }
      setInstallChoiceOpen(false);
      setInstallSummary(
        `Installed: ${result.created.length} created, ${result.removed.length} removed, ${result.skipped.length} already present.`,
      );
      refetch();
    },
    onError: (error) => {
      setInstallSummary(error instanceof Error ? error.message : "Could not install labels");
    },
  });
  const runInstall = (mode: InstallLabelMode) => {
    setInstallSummary(null);
    installLabels.mutate({
      directory: directory ?? undefined,
      remoteUrl: forgeTarget || undefined,
      mode,
    });
  };
  const [activeTab, setActiveTab] = useState("issues");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [extraIssues, setExtraIssues] = useState<ForgeIssue[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const [extraHasMore, setExtraHasMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Live remote search (issue #139). Off by default: the tab filters the loaded
  // snapshot instantly. On, the debounced query goes to the selected forge and
  // the instant client filter keeps rendering until a current result lands.
  const [remoteSearch, setRemoteSearch] = useState(false);
  const [remoteIssues, setRemoteIssues] = useState<ForgeIssue[] | null>(null);
  const [remoteResultQuery, setRemoteResultQuery] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remotePending, setRemotePending] = useState(false);
  const searchGate = React.useRef(createRemoteSearchGate());
  const searchIssuesMutation = useRpcMutation(searchIssuesContract);
  const debouncedQuery = useDebouncedValue(query, REMOTE_SEARCH_DEBOUNCE_MS);
  const remoteQuery = remoteSearch ? debouncedQuery.trim() : "";
  React.useEffect(() => {
    const generation = searchGate.current.begin();
    if (!remoteQuery) {
      setRemoteIssues(null);
      setRemoteResultQuery(null);
      setRemoteError(null);
      setRemotePending(false);
      return;
    }
    let cancelled = false;
    setRemotePending(true);
    void searchIssuesMutation
      .mutateAsync({
        directory: directory ?? undefined,
        remoteUrl: forgeTarget || undefined,
        query: remoteQuery,
        page: 1,
      })
      .then((result) => {
        // Out-of-order guard: only the newest dispatch may publish, and an
        // unmounted surface never sets state.
        if (cancelled || !searchGate.current.accept(generation)) return;
        setRemotePending(false);
        if (result.error) {
          setRemoteIssues(null);
          setRemoteResultQuery(null);
          setRemoteError(result.error);
          return;
        }
        setRemoteError(null);
        setRemoteIssues(result.issues);
        setRemoteResultQuery(remoteQuery);
      })
      .catch(() => {
        if (cancelled || !searchGate.current.accept(generation)) return;
        setRemotePending(false);
        setRemoteIssues(null);
        setRemoteResultQuery(null);
        setRemoteError("Remote search failed");
      });
    return () => {
      cancelled = true;
    };
  }, [remoteQuery, directory, forgeTarget, searchIssuesMutation.mutateAsync]);
  const resetPages = () => {
    setExtraIssues([]);
    setNextPage(2);
    setExtraHasMore(false);
    setMoreError(null);
  };
  React.useEffect(() => { resetPages(); }, [data?.repo, forgeTarget]);
  const loadMore = useRpcMutation(openIssuesContract, {
    onSuccess: (result) => {
      if (result.error) {
        setMoreError(result.error);
        return;
      }
      setExtraIssues((prev) => [...prev, ...result.issues.filter((issue: ForgeIssue) => !prev.some((p) => p.number === issue.number))]);
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
  const boardLabels = useMemo(() => boardLabelMap(pool), [pool]);
  const clientIssues = useMemo(
    () => pool.filter((issue: ForgeIssue) => issueMatchesQuery(issue, query)),
    [pool, query],
  );
  const searchLayer = useMemo(
    () =>
      resolveIssueSearchLayer({
        query,
        remoteEnabled: remoteSearch && remoteQuery.length > 0,
        remoteQuery: remoteResultQuery,
        remoteIssues,
        remoteError,
        clientIssues,
      }),
    [query, remoteSearch, remoteQuery, remoteResultQuery, remoteIssues, remoteError, clientIssues],
  );
  const issues = searchLayer.issues;
  const activeQuery = debouncedQuery.trim();
  const scrollRef = React.useRef<ScrollViewInstance | null>(null);
  const listTop = React.useRef(0);
  const rowTops = React.useRef(new Map<number, number>());
  const firstMatchNumber = activeQuery && issues.length > 0 ? issues[0].number : null;
  // Go-to-match (issue #190): scroll the results container to the first match
  // when the debounced query settles. Disabled while a detail view is open (the
  // detail runs its own target) and when the helper does not own the scroller.
  useMatchScrollTarget(
    scrollRef,
    selected == null && activeQuery
      ? `${activeQuery}|${firstMatchNumber ?? ""}|${issues.length}`
      : "",
    () => {
      if (firstMatchNumber == null) return null;
      const y = rowTops.current.get(firstMatchNumber);
      return y == null ? null : listTop.current + y;
    },
  );
  const hasMore = extraHasMore || (data && !data.error ? data.hasMore : false);
  const failed = Boolean(data?.error) || isError;
  return (
    <ModalBody
      header={
        <Tabs
          tabs={[
            { id: "issues", label: "Open Issues", shortLabel: "Issues" },
            { id: "queues", label: "Hook Queues", shortLabel: "Queues" },
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
      scrollRef={scrollRef}
    >
      {activeTab === "queues" ? (
        <HookQueueView onClose={onClose} embedded />
      ) : selected != null ? (
        <>
          <IssueDetailView
            workspaceId={workspaceId}
            issueNumber={selected}
            forgeTarget={forgeTarget}
            activeForge={activeForge}
            boardLabels={boardLabels}
            query={activeQuery}
            scrollRef={scrollRef}
            onBack={() => setSelected(null)}
            onBoardRefresh={() => refetch()}
            onOpenSettings={() => {
              setSelected(null);
              setActiveTab("settings");
            }}
          />
          <View style={styles.actions}>
            <Button label="Refresh" variant="secondary" onPress={() => { refetch(); }} />
            {onClose ? <Button label="Close" variant="ghost" onPress={onClose} /> : null}
          </View>
        </>
      ) : (
        <>
          {activeTab === "settings" ? (
            <>
            <Card variant="elevated">
              <Card.Header
                title={displayName ? `Remotes & watch targets · ${displayName}` : "Remotes & watch targets"}
                subtitle="What this workspace watches — active forge and known remotes"
                badge={<ForgeCardChips host={activeForge?.host ?? effectiveHost} access={access} />}
                icon="GitBranch"
              />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Pick which forge this workspace watches. Issues and search follow the
                active forge; Auto derives from the git origin remote.
              </Text>
              <SettingsSelect
                label="Active forge"
                hint="Explicit selection wins; an unreachable or invalid forge fails instead of deriving."
                value={activeForgeValue}
                options={forgeOptions}
                onValueChange={selectForge}
                disabled={!directory}
              />
              {activeForgeInvalid ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  Selected forge is not a valid remote URL or owner/repo.
                </Text>
              ) : null}
              <FormRow
                label="Add a remote"
                description="Remote URL or owner/repo for another forge, e.g. https://codeberg.org/owner/repo."
              >
                <TextInput
                  value={forgeDraft ?? ""}
                  onChangeText={(value) => {
                    setForgeDraft(value);
                    if (forgeError) setForgeError(null);
                  }}
                  placeholder="https://codeberg.org/owner/repo"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="Plus"
                    label={forgeBusy ? "Adding…" : "Add remote"}
                    disabled={!(forgeDraft ?? "").trim() || forgeBusy}
                    loading={forgeBusy}
                    onPress={() => { void addForge(); }}
                  />
                </View>
              </FormRow>
              {forgeDraftInvalid ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  Forge target must be a remote URL or owner/repo.
                </Text>
              ) : null}
              {forgeError ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  {forgeError}
                </Text>
              ) : null}
              {forgeTargets.length > 0 ? (
                <View style={styles.forgeList}>
                  {forgeTargets.map((target) => (
                    <View key={target} style={styles.forgeRow}>
                      <ForgeMark host={target} />
                      <Text
                        numberOfLines={1}
                        style={[styles.forgeTarget, { color: colors.foreground }]}
                      >
                        {target}
                      </Text>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="Trash2"
                        label="Remove"
                        onPress={() => removeForge(target)}
                      />
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                  No remotes added yet — Auto uses the git origin remote.
                </Text>
              )}
              {derivedRemote && !activeForgeValue ? (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                  Derived: {displayRemoteForApi(derivedRemote)}
                </Text>
              ) : null}
            </Card>
            <Card>
              <Card.Header
                title="Authentication & workspace metadata"
                subtitle="Saved together by the button below — not by adding a remote"
                icon="ShieldCheck"
              />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                These apply to the active forge above and are saved separately from
                the remote list.
              </Text>
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                {effectiveHost
                  ? `API token for ${effectiveHost}. Leave empty to remove it.`
                  : "API token — needs a resolvable host from the forge above."}
              </Text>
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Minimum scopes: {access.requiredScopes}.
              </Text>
              <TextInput
                value={tokenValue}
                onChangeText={setTokenDraft}
                placeholder="Forge API token"
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
              {failed && data?.error ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  Forge unavailable: {data.error}
                </Text>
              ) : null}
              {data && !isLoading && !data.error ? (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                  {access.summary}
                </Text>
              ) : null}
              {formError ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  {formError}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Button
                  label={formSaving ? "Saving…" : "Save token & settings"}
                  variant="primary"
                  disabled={formSaving || !directory || activeForgeInvalid || (tokenDraft == null && nameValue === storedName) || (tokenDraft != null && !effectiveHost)}
                  loading={formSaving}
                  onPress={() => { void saveSettings(); }}
                />
              </View>
            </Card>
            {LABEL_SET_INSTALL_VISIBLE ? (
            <Card>
              <Card.Header
                title="Paseo label set"
                subtitle="Optional — copy our workflow taxonomy onto this repo"
                icon="Tags"
              />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                Installs our state/, priority/, attention/ and spec/ labels.
                Nothing is written until you pick an option below. Labels in
                other scopes — yours or a foreign board's — are never touched.
              </Text>
              {!access.canEdit ? (
                <Text style={[styles.hint, { color: colors.foreground }]}>
                  A valid API token is required to install labels. Add one above and save.
                </Text>
              ) : null}
              {installChoiceOpen ? (
                <>
                  <Text style={[styles.hint, { color: colors.foreground }]}>
                    Keep existing labels, or replace the labels in our scopes —
                    removes any conflicting state/, priority/, attention/ or
                    spec/ label, then installs ours.
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="Plus"
                      label="Keep existing"
                      disabled={!directory || installLabels.isPending}
                      loading={installLabels.isPending}
                      onPress={() => runInstall("merge")}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      icon="Trash2"
                      label="Replace our scopes"
                      disabled={!directory || installLabels.isPending}
                      onPress={() => runInstall("replace")}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      label="Cancel"
                      disabled={installLabels.isPending}
                      onPress={() => {
                        setInstallChoiceOpen(false);
                        setInstallSummary(null);
                      }}
                    />
                  </View>
                </>
              ) : (
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="Tags"
                    label="Install label set…"
                    disabled={!directory || !access.canEdit || installLabels.isPending}
                    onPress={() => {
                      setInstallChoiceOpen(true);
                      setInstallSummary(null);
                    }}
                  />
                </View>
              )}
              {installSummary ? (
                <Text style={[styles.hint, { color: colors.foregroundMuted }]}>{installSummary}</Text>
              ) : null}
            </Card>
            ) : null}
            </>
          ) : (
          <>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by keyword or #number…"
          />
          <FormRow
            label="Search the forge"
            description="Query the selected forge for open and closed issues. Off filters the loaded snapshot instantly."
          >
            <Toggle value={remoteSearch} onValueChange={setRemoteSearch} />
          </FormRow>
          <NewIssueComposer
            directory={directory}
            forgeTarget={forgeTarget}
            access={access}
            onCreated={() => {
              resetPages();
              refetch();
            }}
            onOpenSettings={() => setActiveTab("settings")}
          />
          <View
            onLayout={(e) => {
              listTop.current = e.nativeEvent.layout.y;
            }}
          >
          <Card variant="elevated">
            <Card.Header
              title={displayName ? `Issues · ${displayName}` : "Forge Issues"}
              badge={<ForgeCardChips host={activeForge?.host ?? data?.host} access={access} />}
              subtitle={
                data && !data.error
                  ? query.trim()
                    ? searchLayer.source === "remote"
                      ? `${issues.length} match${issues.length === 1 ? "" : "es"} (open and closed)`
                      : `${issues.length} of ${data.openIssueCount ?? pool.length} match`
                    : `${data.openIssueCount ?? pool.length} open`
                  : "Open issues for this workspace repo"
              }
            />
            {isLoading && !data ? (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>Loading issues…</Text>
            ) : null}
            {remotePending ? (
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>Searching the forge…</Text>
            ) : null}
            {remoteError ? (
              <Text style={[styles.hint, { color: colors.foreground }]}>{remoteError}</Text>
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
                description={
                  query.trim()
                    ? remoteSearch
                      ? "No open or closed issues matched on this forge."
                      : "Try a different keyword or issue number."
                    : "Nothing open on this repo right now."
                }
              />
            ) : null}
            {!failed
              ? issues.map((issue: ForgeIssue) => (
                  <IssueRow
                    key={issue.number}
                    number={issue.number}
                    title={issue.title}
                    state={issue.state}
                    labels={issueLabelChips(issue)}
                    repo={repo}
                    host={data?.host ?? null}
                    onSelect={setSelected}
                    query={activeQuery}
                    onLayoutY={(y) => rowTops.current.set(issue.number, y)}
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
                  onPress={() => { loadMore.mutate({ directory: directory ?? undefined, remoteUrl: forgeTarget || undefined, page: nextPage }); }}
                />
              </View>
            ) : null}
            {moreError ? (
              <Text style={[styles.hint, { color: colors.foreground }]}>{moreError}</Text>
            ) : null}
          </Card>
          </View>
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

export function ForgeIssuesModal({ agentId, workspaceId, close }: RenderModalProps) {
  return <ForgeIssuesView agentId={agentId} workspaceId={workspaceId} onClose={close} />;
}

export function ForgeIssuesPanel({ workspaceId }: { workspaceId: string }) {
  return <ForgeIssuesView workspaceId={workspaceId} />;
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
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  note: {
    fontSize: 11,
    fontStyle: "italic",
  },
  hint: {
    fontSize: 12,
    paddingVertical: 8,
  },
  accessChips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  forgeList: {
    gap: 4,
    paddingVertical: 4,
  },
  forgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  forgeTarget: {
    fontSize: 12,
    flex: 1,
  },
  readOnlyNotice: {
    gap: 4,
    alignItems: "flex-start",
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
  labelChipPending: {
    opacity: 0.5,
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
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  commentBody: {
    flex: 1,
  },
  copyText: {
    fontSize: 14,
  },
  composer: {
    gap: 8,
    paddingTop: 4,
  },
  newIssueForm: {
    gap: 8,
  },
});

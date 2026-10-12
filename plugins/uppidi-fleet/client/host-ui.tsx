/**
 * Re-export the shared UI composition package for `plugins/uppidi-fleet`
 * (xpufx-org/paseo#976, #1218, #1271).
 *
 * All canonical cards, buttons, badges, inputs, form rows, action bars,
 * tabs, collapsibles, code blocks, gauges, tables, and theme providers
 * come directly from `@xpufx/paseo-plugin-ui`.
 *
 * Fleet-specific composite widgets (AgentEnvelopeCard, CommentCard,
 * NewIssueComposer, TicketLifecycleView, ForgeIcon) are preserved here.
 */

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Image,
  Linking,
  Platform,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import {
  ATTENTION_LABELS,
  PRIORITY_ORDER,
  SPEC_LABELS,
  STATE_ORDER,
  addCommentContract,
  createIssueContract,
  currentPriorityLabel,
  currentStateLabel,
  forgeMarkSource,
  getClientHost,
  issueDetailContract,
  nextStateLabel,
  parseLabelList,
  parseMarkdownLite,
  resolveForgeMark,
  setLabelContract,
  shortLabelName,
  stripAgentEnvelopeFooter,
  useRpcMutation,
  useRpcQuery,
  writeGateNotice,
  type AgentEnvelope,
  type ForgeAccessState,
  type ForgeLabel,
  type ForgeMarkInput,
  type IssueComment,
  type MarkdownLiteSpan,
} from "paseo-plugin-helper/core";
import {
  HostAboutSection,
  HostActionBar,
  HostAttentionBeacon,
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostCodeBlock,
  HostCollapsible,
  HostCommandBox,
  HostCopyButton,
  HostDataTable,
  HostEmptyState,
  HostFormRow,
  HostGrid,
  HostHighlightedText,
  HostInlineButton,
  HostInteractiveRow,
  HostKeyValue,
  HostKeyValueGroup,
  HostLayoutProvider,
  HostMetricGauge,
  HostModalBody,
  HostModalSection,
  HostProgressBar,
  HostResponsive,
  HostRow,
  HostScroll,
  HostSearchInput,
  HostSectionHeader,
  HostSelect,
  HostStack,
  HostStatusDot,
  HostTabs,
  HostTextInput,
  HostThemeProvider,
  HostToggle,
  HostVital,
  ModalBodyScrollOwnerContext,
  alpha,
  getStatusColor,
  sanitizeFluidStyle,
  useHostLayout,
  useHostTheme,
  useModalBodyScrollOwner,
  type HostActionBarProps,
  type HostAttentionBeaconMode,
  type HostAttentionBeaconProps,
  type HostAttentionBeaconTone,
  type HostBadgeProps,
  type HostBadgeSize,
  type HostBadgeStyle,
  type HostButtonProps,
  type HostButtonSize,
  type HostButtonVariant,
  type HostCardHeaderProps,
  type HostCardProps,
  type HostCodeBlockProps,
  type HostCollapsibleProps,
  type HostCommandBoxProps,
  type HostDataColumn,
  type HostDataTableProps,
  type HostEmptyStateProps,
  type HostFormRowProps,
  type HostGridProps,
  type HostHighlightedTextProps,
  type HostInteractiveRowProps,
  type HostKeyValueGroupProps,
  type HostKeyValueProps,
  type HostModalBodyProps,
  type HostResponsiveProps,
  type HostRowProps,
  type HostSearchInputProps,
  type HostSelectOption,
  type HostSelectProps,
  type HostStackProps,
  type HostStatusDotProps,
  type HostSurfaceVariant,
  type HostTabItem,
  type HostTabsProps,
  type HostTextInputProps,
} from "@xpufx/paseo-plugin-ui";

export const ActionBar = HostActionBar;
export const AttentionBeacon = HostAttentionBeacon;
export const Badge = HostBadge;
export const Button = HostButton;
export const Card = HostCard;
export const CardHeader = HostCardHeader;
export const CodeBlock = HostCodeBlock;
export const Collapsible = HostCollapsible;
export const CommandBox = HostCommandBox;
export const CopyButton = HostCopyButton;
export const DataTable = HostDataTable;
export const EmptyState = HostEmptyState;
export const FormRow = HostFormRow;
export const Grid = HostGrid;
export const HighlightedText = HostHighlightedText;
export const InlineButton = HostInlineButton;
export const InteractiveRow = HostInteractiveRow;
export const KeyValue = HostKeyValue;
export const KeyValueGroup = HostKeyValueGroup;
export const MetricGauge = HostMetricGauge;
export const ModalBody = HostModalBody;
export const Responsive = HostResponsive;
export const Row = HostRow;
export const Select = HostSelect;
export const Stack = HostStack;
export const VStack = HostStack;
export const StatusDot = HostStatusDot;
export const Tabs = HostTabs;
export const TextInput = HostTextInput;
export const Toggle = HostToggle;

export {
  HostAboutSection,
  HostActionBar,
  HostAttentionBeacon,
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostCodeBlock,
  HostCollapsible,
  HostCommandBox,
  HostCopyButton,
  HostDataTable,
  HostEmptyState,
  HostFormRow,
  HostGrid,
  HostHighlightedText,
  HostInlineButton,
  HostInteractiveRow,
  HostKeyValue,
  HostKeyValueGroup,
  HostLayoutProvider,
  HostMetricGauge,
  HostModalBody,
  HostModalSection,
  HostProgressBar,
  HostResponsive,
  HostRow,
  HostScroll,
  HostSearchInput,
  HostSectionHeader,
  HostSelect,
  HostStack,
  HostStatusDot,
  HostTabs,
  HostTextInput,
  HostThemeProvider,
  HostToggle,
  HostVital,
  ModalBodyScrollOwnerContext,
  alpha,
  getStatusColor,
  sanitizeFluidStyle,
  useHostLayout,
  useHostTheme,
  useModalBodyScrollOwner,
};

export type ActionBarProps = HostActionBarProps;
export type AttentionBeaconMode = HostAttentionBeaconMode;
export type AttentionBeaconProps = HostAttentionBeaconProps;
export type AttentionBeaconTone = HostAttentionBeaconTone;
export type BadgeProps = HostBadgeProps;
export type BadgeSize = HostBadgeSize;
export type BadgeStyle = HostBadgeStyle;
export type ButtonProps = HostButtonProps;
export type ButtonSize = HostButtonSize;
export type ButtonVariant = HostButtonVariant;
export type CardHeaderProps = HostCardHeaderProps;
export type CardProps = HostCardProps;
export type CodeBlockProps = HostCodeBlockProps;
export type CollapsibleProps = HostCollapsibleProps;
export type CommandBoxProps = HostCommandBoxProps;
export type DataColumn<T = any> = HostDataColumn<T>;
export type DataTableProps<T = any> = HostDataTableProps<T>;
export type EmptyStateProps = HostEmptyStateProps;
export type FormRowProps = HostFormRowProps;
export type GridProps = HostGridProps;
export type HighlightedTextProps = HostHighlightedTextProps;
export type InteractiveRowProps = HostInteractiveRowProps;
export type KeyValueGroupProps = HostKeyValueGroupProps;
export type KeyValueProps = HostKeyValueProps;
export type ModalBodyProps = HostModalBodyProps;
export type ResponsiveProps = HostResponsiveProps;
export type RowProps = HostRowProps;
export type SearchInputProps = HostSearchInputProps;
export type SelectOption = HostSelectOption;
export type SelectProps = HostSelectProps;
export type StackProps = HostStackProps;
export type StatusDotProps = HostStatusDotProps;
export type SurfaceVariant = HostSurfaceVariant;
export type TabItem = HostTabItem;
export type TabsProps = HostTabsProps;
export type TextInputProps = HostTextInputProps;
import { useFleetTheme } from "./theme.js";

/**
 * Keeps both ends of a long value when the available width cannot show it all.
 * The fleet repo keys all start with the same forge host, so a plain tail
 * truncation erases the only part that distinguishes one option from another.
 */
export function middleTruncate(text: string, maxLength = 34): string {
  if (text.length <= maxLength) return text;
  const ellipsis = "…";
  const keep = Math.max(1, maxLength - ellipsis.length);
  const front = Math.ceil(keep / 2);
  const back = keep - front;
  return `${text.slice(0, front)}${ellipsis}${text.slice(text.length - back)}`;
}

/**
 * Fleet search input with pinned 26px compact height support (#645).
 */
export function SearchInput(props: SearchInputProps) {
  const { isCompact } = useHostLayout();
  const height = props.height ?? (isCompact ? 36 : 40);
  return <HostSearchInput {...props} height={height} />;
}

export interface ModalContentProps extends Omit<ModalBodyProps, "scrollMode"> {
  children: ReactNode;
  scrollable?: boolean;
}

export function ModalContent({ children, scrollable = true, ...bodyProps }: ModalContentProps) {
  const Modal = getClientHost().Modal;
  const Content = (Modal as any)?.Content;
  const inner = (
    <ModalBodyScrollOwnerContext.Provider value={scrollable ? "host" : "required"}>
      <ModalBody {...bodyProps}>{children}</ModalBody>
    </ModalBodyScrollOwnerContext.Provider>
  );
  if (!Content) return inner;
  return <Content scrollable={scrollable}>{inner}</Content>;
}

// --- forge icon ------------------------------------------------------------

export interface ForgeIconProps extends ForgeMarkInput {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}

export function ForgeIcon({ host, kind, size = 16, color, style, accessibilityLabel }: ForgeIconProps) {
  const { colors } = useFleetTheme();
  const markColor = color ?? colors.foreground;
  const mark = resolveForgeMark({ host, kind });
  const source = mark.custom && Platform.OS === "web" ? forgeMarkSource(mark.kind, markColor) : null;
  if (!source) {
    return <Icon name={mark.lucideName} size={size} color={markColor} />;
  }
  return (
    <Image
      accessibilityLabel={accessibilityLabel ?? mark.label}
      accessibilityRole="image"
      accessible
      source={source}
      style={[{ width: size, height: size }, style]}
    />
  );
}

// --- ticket views ----------------------------------------------------------

function formatTimestamp(value: string | undefined | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function editorLabelChips(names: readonly string[], known: Map<string, ForgeLabel>): ForgeLabel[] {
  return names.map((name) => known.get(name) ?? { name });
}

function renderInlineSpans(spans: MarkdownLiteSpan[], accent: string, keyPrefix: string, query: string) {
  return spans.map((span, index) => {
    const key = `${keyPrefix}-${index}`;
    if (span.kind === "bold") {
      return (
        <Text key={key} style={{ fontWeight: "700" }}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "italic") {
      return (
        <Text key={key} style={{ fontStyle: "italic" }}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "code") {
      return (
        <Text key={key} style={{ fontFamily: "monospace", fontSize: 12, backgroundColor: `${accent}18` }}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "link") {
      return (
        <Text
          key={key}
          style={{ color: accent, textDecorationLine: "underline" }}
          onPress={() => {
            Linking.openURL(span.url).catch(() => {
              copyText(span.url).catch(() => {});
            });
          }}
        >
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    return <HighlightedText key={key} text={span.text} query={query} />;
  });
}

export function MarkdownLite({ body, query = "" }: { body: string; query?: string }) {
  const { colors, typography } = useFleetTheme();
  const blocks = useMemo(() => parseMarkdownLite(body), [body]);
  return (
    <Stack gap="xs" style={{ width: "100%" }}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return <CodeBlock key={index} code={block.text} language={block.language} />;
        }
        if (block.kind === "heading") {
          const fontSize = block.level === 1 ? 18 : block.level === 2 ? 16 : 14;
          return (
            <Text key={index} selectable style={[typography.heading, { fontSize, fontWeight: "700", color: colors.foreground, marginTop: 4 }]}>
              {renderInlineSpans(block.spans, colors.accent, `h${index}`, query)}
            </Text>
          );
        }
        if (block.kind === "list") {
          return (
            <Stack key={index} gap="xxs" style={{ paddingLeft: 4 }}>
              {block.items.map((item, itemIndex) => (
                <Row key={itemIndex} align="flex-start" gap="xs">
                  <Text selectable style={[typography.body, { color: colors.foregroundMuted }]}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <Text selectable style={[typography.body, { color: colors.foreground, flex: 1 }]}>
                    {renderInlineSpans(item, colors.accent, `li${index}-${itemIndex}`, query)}
                  </Text>
                </Row>
              ))}
            </Stack>
          );
        }
        return (
          <Text key={index} selectable style={[typography.body, { color: colors.foreground, lineHeight: 20 }]}>
            {renderInlineSpans(block.spans, colors.accent, `p${index}`, query)}
          </Text>
        );
      })}
    </Stack>
  );
}

export function AgentEnvelopeCard({ envelope }: { envelope: AgentEnvelope }) {
  const openSession = () => {
    const link = envelope.paseoLinks[0];
    if (link) Linking.openURL(link).catch(() => {});
  };
  return (
    <Card variant="tinted" style={{ marginTop: 6 }}>
      <CardHeader
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
        <Stack gap="xxs" style={{ marginTop: 4 }}>
          {envelope.commitShas.map((sha) => (
            <CommandBox key={sha} command={sha} copyLabel={`Copy commit ${sha}`} />
          ))}
        </Stack>
      ) : null}
      {envelope.paseoLinks.length > 0 ? (
        <Button size="sm" variant="ghost" icon="ExternalLink" label="Open agent session" onPress={openSession} />
      ) : null}
    </Card>
  );
}

export function CommentCard({ comment, issueUrl, query }: { comment: IssueComment; issueUrl?: string; query?: string }) {
  const body = stripAgentEnvelopeFooter(comment.body) || comment.body;
  const target = comment.url || issueUrl || "";
  const open = () => {
    if (target) Linking.openURL(target).catch(() => {});
  };
  return (
    <Card variant="flat" style={{ marginVertical: 4 }}>
      <CardHeader title={comment.author} subtitle={formatTimestamp(comment.createdAt)} icon="MessageSquare" />
      <Stack gap="xs" style={{ padding: 8 }}>
        <MarkdownLite body={body} query={query} />
        {target ? (
          <Row justify="flex-end" align="center" gap="xs">
            <Button
              size="sm"
              variant="ghost"
              icon="ExternalLink"
              label="Open comment"
              accessibilityLabel={`Open comment by ${comment.author}`}
              onPress={open}
            />
          </Row>
        ) : null}
      </Stack>
      {comment.envelope ? <AgentEnvelopeCard envelope={comment.envelope} /> : null}
    </Card>
  );
}

export function ScopedLabelGroup({
  title,
  labels,
  active,
  pending = false,
  onSelect,
}: {
  title: string;
  labels: readonly ForgeLabel[];
  active: string | null;
  pending?: boolean;
  onSelect: (label: string) => void;
}) {
  const { colors, typography } = useFleetTheme();
  return (
    <Stack gap="xxs" style={{ marginVertical: 2 }}>
      <Text style={[typography.caption, { color: colors.foregroundMuted, fontWeight: "600" }]}>{title}</Text>
      <Row wrap gap="xxs">
        {labels.map((label) => (
          <Button
            key={label.name}
            onPress={() => onSelect(label.name)}
            disabled={pending}
            accessibilityLabel={shortLabelName(label.name)}
            size="sm"
            variant={active === label.name ? "primary" : "ghost"}
            label={shortLabelName(label.name)}
          />
        ))}
      </Row>
    </Stack>
  );
}

export interface NewIssueComposerProps {
  directory?: string;
  remoteUrl?: string;
  access?: ForgeAccessState;
  onCreated?: (number?: number) => void;
  onOpenSettings?: () => void;
}

export function NewIssueComposer({ directory, remoteUrl, access, onCreated, onOpenSettings }: NewIssueComposerProps) {
  const { colors, typography } = useFleetTheme();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const create = useRpcMutation(createIssueContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast?.error?.(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setLabelsText("");
      setExpanded(false);
      onCreated?.(result.number ?? undefined);
      toast?.show?.(result.number ? `Created issue #${result.number}` : "Issue created", { variant: "success" });
    },
    onError: (error) => {
      toast?.error?.(error instanceof Error ? error.message : "Could not create issue");
    },
  });
  if (access && access.auth === "anonymous") return null;
  if (access && !access.canEdit) {
    return (
      <Card variant="flat" style={{ padding: 8 }}>
        <Text style={[typography.caption, { color: colors.foregroundMuted }]}>{writeGateNotice(access, "creating issues")}</Text>
        {onOpenSettings ? (
          <Button size="sm" variant="secondary" icon="Settings" label="Add a token" onPress={onOpenSettings} />
        ) : null}
      </Card>
    );
  }
  const pending = create.isPending;
  const canSubmit = title.trim().length > 0 && !pending;
  const submit = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    create.mutate({
      directory: directory ?? undefined,
      remoteUrl: remoteUrl || undefined,
      title: nextTitle,
      body: body.trim(),
      labels: parseLabelList(labelsText),
    });
  };
  return (
    <Collapsible title="New ticket" subtitle="Open a ticket on the active forge" icon="Plus" isExpanded={expanded} onToggle={setExpanded}>
      <Stack gap="xs" style={{ padding: 8 }}>
        <FormRow label="Title">
          <TextInput value={title} onChangeText={setTitle} placeholder="Short, specific title" autoCapitalize="sentences" />
        </FormRow>
        <FormRow label="Description" description="Markdown supported.">
          <TextInput value={body} onChangeText={setBody} placeholder="What needs to happen?" multiline numberOfLines={4} />
        </FormRow>
        <Collapsible title="Labels" subtitle="Optional — comma-separated names" icon="Tags">
          <FormRow label="Label names">
            <TextInput value={labelsText} onChangeText={setLabelsText} placeholder="state/1-wip, priority/1-high" />
          </FormRow>
        </Collapsible>
        <ActionBar>
          <Button label="Cancel" variant="ghost" disabled={pending} onPress={() => setExpanded(false)} />
          <Button label={pending ? "Creating…" : "Create ticket"} variant="primary" icon="Plus" disabled={!canSubmit} loading={pending} onPress={submit} />
        </ActionBar>
      </Stack>
    </Collapsible>
  );
}

export interface TicketLifecycleViewProps {
  issueNumber: number;
  workspaceId?: string;
  directory?: string;
  remoteUrl?: string;
  repo?: string | null;
  query?: string;
  boardLabels?: Map<string, ForgeLabel>;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  children?: ReactNode;
}

export function TicketLifecycleView({
  issueNumber,
  directory,
  remoteUrl,
  query = "",
  boardLabels,
  onRefresh,
  children,
}: TicketLifecycleViewProps) {
  const { colors, typography } = useFleetTheme();
  const toast = useToast();
  const baseInput = { issueNumber, directory: directory ?? undefined, remoteUrl: remoteUrl || undefined };
  const detail = useRpcQuery(issueDetailContract, baseInput, { refetchInterval: 30000 });
  const [commentDraft, setCommentDraft] = useState("");
  const setLabel = useRpcMutation(setLabelContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast?.error?.(result.error);
        return;
      }
      detail.refetch();
      onRefresh?.();
    },
    onError: (error) => toast?.error?.(error instanceof Error ? error.message : "Could not update labels"),
  });
  const addComment = useRpcMutation(addCommentContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast?.error?.(result.error);
        return;
      }
      setCommentDraft("");
      detail.refetch();
      onRefresh?.();
      toast?.show?.("Comment posted", { variant: "success" });
    },
    onError: (error) => toast?.error?.(error instanceof Error ? error.message : "Could not post comment"),
  });
  const issue = detail.data && !detail.data.error ? detail.data.issue : null;
  const labels = issue?.labels ?? [];
  const state = currentStateLabel(labels);
  const priority = issue ? currentPriorityLabel(labels) : null;
  const next = issue ? nextStateLabel(labels) : null;
  const labelPending = setLabel.isPending;
  const commentPending = addComment.isPending;
  const candidates = useMemo(() => {
    const known = new Map(boardLabels ?? new Map());
    for (const label of issue?.labelDetails ?? []) known.set(label.name, label);
    return {
      state: editorLabelChips(STATE_ORDER, known),
      priority: editorLabelChips(PRIORITY_ORDER, known),
      attention: editorLabelChips(ATTENTION_LABELS, known),
      spec: editorLabelChips(SPEC_LABELS, known),
    };
  }, [boardLabels, issue?.labelDetails]);
  const handleSelectLabel = (labelName: string) => {
    setLabel.mutate({ issueNumber, directory: directory ?? undefined, remoteUrl: remoteUrl || undefined, label: labelName });
  };
  const handlePostComment = () => {
    const text = commentDraft.trim();
    if (!text) return;
    addComment.mutate({ issueNumber, directory: directory ?? undefined, remoteUrl: remoteUrl || undefined, body: text });
  };
  return (
    <Stack gap="sm" style={{ width: "100%" }}>
      {detail.isLoading && !detail.data ? (
        <Text style={[typography.caption, { color: colors.foregroundMuted }]}>Loading ticket #{issueNumber}…</Text>
      ) : null}
      {detail.data?.error || (!detail.isLoading && !issue) ? (
        <EmptyState
          icon="AlertCircle"
          title={`Ticket #${issueNumber} unavailable`}
          description={detail.data?.error ?? "Could not reach forge host."}
          actionLabel="Retry"
          onAction={() => detail.refetch()}
        />
      ) : null}
      <Stack gap="xs" style={{ paddingVertical: 4 }}>
        {next ? (
          <Row align="center" gap="xs">
            <Button
              size="sm"
              variant="secondary"
              icon="ArrowRight"
              label={`Move to ${shortLabelName(next).toLowerCase()}`}
              loading={labelPending}
              disabled={labelPending}
              onPress={() => handleSelectLabel(next)}
            />
          </Row>
        ) : null}
        <ScopedLabelGroup title="Workflow State" labels={candidates.state} active={state} pending={labelPending} onSelect={handleSelectLabel} />
        <ScopedLabelGroup title="Priority" labels={candidates.priority} active={priority} pending={labelPending} onSelect={handleSelectLabel} />
        <ScopedLabelGroup
          title="Attention"
          labels={candidates.attention}
          active={labels.find((l) => (ATTENTION_LABELS as readonly string[]).includes(l)) ?? null}
          pending={labelPending}
          onSelect={handleSelectLabel}
        />
        <ScopedLabelGroup
          title="Spec"
          labels={candidates.spec}
          active={labels.find((l) => (SPEC_LABELS as readonly string[]).includes(l)) ?? null}
          pending={labelPending}
          onSelect={handleSelectLabel}
        />
      </Stack>
      {children}
      {issue?.body ? (
        <Card variant="flat" style={{ marginVertical: 4 }}>
          <CardHeader title="Description" icon="FileText" />
          <View style={{ padding: 8 }}>
            <MarkdownLite body={issue.body} query={query} />
          </View>
        </Card>
      ) : null}
      <Card variant="flat" style={{ marginTop: 8 }}>
        <CardHeader title={`Comments${issue?.comments ? ` (${issue.comments.length})` : ""}`} icon="MessageSquare" />
        <Stack gap="xs" style={{ padding: 8 }}>
          {issue?.comments && issue.comments.length > 0 ? (
            issue.comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} issueUrl={issue.webUrl} query={query} />
            ))
          ) : (
            <Text style={[typography.caption, { color: colors.foregroundMuted }]}>No comments yet.</Text>
          )}
          <Stack gap="xxs" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <TextInput value={commentDraft} onChangeText={setCommentDraft} placeholder="Write a comment…" multiline numberOfLines={3} />
            <Row justify="flex-end">
              <Button
                size="sm"
                variant="primary"
                icon="Send"
                label={commentPending ? "Posting…" : "Post comment"}
                disabled={!commentDraft.trim() || commentPending}
                loading={commentPending}
                onPress={handlePostComment}
              />
            </Row>
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
}

export { useRpcMutation, useRpcQuery };

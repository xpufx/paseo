import React, { useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  scopeOfLabel,
  shortLabelName,
  type ForgeLabel,
} from "@xpufx/backend-tickets/client";
import {
  HostBadge,
  HostButton,
  HostRow,
  HostStack,
  HostStatusDot,
  HostTextInput,
  useHostTheme,
} from "../index.js";
import { HostCommentCard } from "./comment-card.js";
import { HostMarkdownLite } from "./markdown-lite.js";
import { HostScopedLabelGroup } from "./scoped-label-group.js";
import {
  describeCiStatus,
  describePullRequest,
  describeReviewDecision,
  detectBranchPill,
  detectCiStatus,
  detectLinkedPullRequest,
  extractChecklist,
  setChecklistItemChecked,
} from "./card-artifacts.js";
import {
  getKanbanKeydownTarget,
  type KanbanKeyboardEventLike,
} from "./kanban-keyboard.js";
import type { ChecklistItem, IssueDetailData, KanbanIssue } from "./types.js";

const LABEL_SCOPE_ORDER = [
  "state",
  "attention",
  "priority",
  "review",
  "spec",
  "size",
  "kind",
  "target",
];

function groupLabelsByScope(labels: readonly ForgeLabel[]): Array<[string, ForgeLabel[]]> {
  const groups = new Map<string, ForgeLabel[]>();
  for (const label of labels) {
    const scope = scopeOfLabel(label.name) ?? "other";
    const bucket = groups.get(scope);
    if (bucket) bucket.push(label);
    else groups.set(scope, [label]);
  }
  return [...groups.entries()].sort((a, b) => {
    const rankA = LABEL_SCOPE_ORDER.indexOf(a[0]);
    const rankB = LABEL_SCOPE_ORDER.indexOf(b[0]);
    return (rankA < 0 ? LABEL_SCOPE_ORDER.length : rankA) -
      (rankB < 0 ? LABEL_SCOPE_ORDER.length : rankB);
  });
}

function scopeTitle(scope: string): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export interface IssueDetailDrawerProps {
  visible: boolean;
  issue: KanbanIssue | null;
  detail?: IssueDetailData | null;
  onClose: () => void;
  query?: string;
  activeStateLabel?: string | null;
  labelPending?: boolean;
  onSelectLabel?: (label: string) => void;
  onToggleChecklistItem?: (item: ChecklistItem, checked: boolean) => void;
  onSubmitComment?: (body: string) => void | Promise<void>;
  width?: number;
}

/**
 * Non-modal slide-over for inspecting an issue without leaving the board: full
 * markdown body, task-list toggles, scoped label quick toggles, PR/CI artifacts,
 * the comment timeline, and a composer.
 */
export function HostIssueDetailDrawer({
  visible,
  issue,
  detail = null,
  onClose,
  query,
  activeStateLabel = null,
  labelPending = false,
  onSelectLabel,
  onToggleChecklistItem,
  onSubmitComment,
  width = 420,
}: IssueDetailDrawerProps) {
  const { colors } = useHostTheme();
  const [localBody, setLocalBody] = useState(detail?.body ?? "");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    setLocalBody(detail?.body ?? "");
  }, [detail?.body]);

  useEffect(() => {
    if (!visible || !isWeb) return;
    const target = getKanbanKeydownTarget();
    if (!target) return;
    const handler = (event: KanbanKeyboardEventLike) => {
      if (event.key !== "Escape") return;
      event.preventDefault?.();
      onClose();
    };
    target.addEventListener("keydown", handler);
    return () => target.removeEventListener("keydown", handler);
  }, [visible, isWeb, onClose]);

  const branch = issue ? detectBranchPill(issue) : null;
  const pullRequest = issue ? detectLinkedPullRequest(issue) : null;
  const pullRequestBadge = pullRequest ? describePullRequest(pullRequest) : null;
  const reviewBadge = pullRequest ? describeReviewDecision(pullRequest.reviewDecision) : null;
  const ciStatus = issue ? detectCiStatus(issue) : "unknown";
  const ciBadge = describeCiStatus(ciStatus);
  const checklist = useMemo(() => extractChecklist(localBody), [localBody]);
  const labelGroups = useMemo(
    () => groupLabelsByScope(detail?.labels ?? []),
    [detail?.labels],
  );

  if (!visible || !issue) return null;

  const handleToggleChecklist = (item: ChecklistItem) => {
    const nextChecked = !item.checked;
    setLocalBody((body) => setChecklistItemChecked(body, item.index, nextChecked));
    onToggleChecklistItem?.({ ...item, checked: nextChecked }, nextChecked);
  };

  const handleSubmitComment = async () => {
    const body = draft.trim();
    if (!body || !onSubmitComment) return;
    setSubmitting(true);
    try {
      await onSubmitComment(body);
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  };

  const openPullRequest = () => {
    const target = pullRequest?.url ?? issue.url;
    if (!target) return;
    Linking.openURL(target).catch(() => {});
  };

  return (
    <View
      testID="issue-detail-drawer"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        flexDirection: "row",
        justifyContent: "flex-end",
      }}
    >
      <Pressable
        testID="issue-detail-drawer-backdrop"
        accessibilityRole="button"
        accessibilityLabel="Close issue detail drawer"
        onPress={onClose}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.45)",
        }}
      />
      <View
        testID="issue-detail-drawer-panel"
        style={{
          width,
          maxWidth: "100%",
          height: "100%",
          backgroundColor: colors.surface0,
          borderLeftWidth: 1,
          borderLeftColor: colors.border,
          padding: 16,
          gap: 12,
        }}
      >
        {/* Header */}
        <HostRow justify="between" align="flex-start" gap="sm">
          <HostStack gap="xxs" style={{ flex: 1, minWidth: 0 }}>
            <HostRow gap="xs" align="center" wrap>
              <HostBadge label={`#${issue.number}`} variant="accent" size="sm" />
              {issue.repo ? <HostBadge label={issue.repo} variant="neutral" size="sm" /> : null}
            </HostRow>
            <Text
              selectable
              style={{
                color: colors.foreground,
                fontWeight: "700",
                fontSize: 15,
                lineHeight: 20,
              }}
            >
              {issue.title}
            </Text>
          </HostStack>
          <HostButton
            testID="issue-detail-close"
            label="Close"
            variant="ghost"
            size="sm"
            icon="X"
            accessibilityLabel={`Close issue #${issue.number} details`}
            onPress={onClose}
          />
        </HostRow>

        {/* Artifact strip: branch / PR / review / CI */}
        {(branch || pullRequestBadge || ciBadge) && (
          <HostRow gap="xs" align="center" wrap>
            {branch && <HostBadge label={branch} variant="neutral" size="sm" icon="GitBranch" />}
            {pullRequestBadge && pullRequest && (
              <HostButton
                testID="issue-detail-pr"
                label={pullRequestBadge.label}
                variant="secondary"
                size="sm"
                icon={pullRequestBadge.icon}
                accessibilityLabel={`Open linked pull request ${pullRequestBadge.label}`}
                onPress={openPullRequest}
              />
            )}
            {reviewBadge && (
              <HostBadge label={reviewBadge.label} variant={reviewBadge.variant} size="sm" />
            )}
            {ciBadge && (
              <HostRow testID="issue-detail-ci" gap="xxs" align="center">
                <HostStatusDot
                  variant={ciBadge.variant}
                  size="sm"
                  pulse={ciStatus === "running"}
                />
                <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                  {ciBadge.label}
                </Text>
              </HostRow>
            )}
          </HostRow>
        )}

        {/* Body */}
        <ScrollView
          testID="issue-detail-drawer-scroll"
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
        >
          {labelGroups.length > 0 && onSelectLabel ? (
            <HostStack gap="xs">
              {labelGroups.map(([scope, labels]) => (
                <HostScopedLabelGroup
                  key={scope}
                  title={scopeTitle(scope)}
                  labels={labels.map((label) => ({ name: shortLabelName(label.name) }))}
                  active={scope === "state" ? activeStateLabel : null}
                  pending={labelPending}
                  onSelect={onSelectLabel}
                />
              ))}
            </HostStack>
          ) : null}

          {localBody ? (
            <HostMarkdownLite body={localBody} query={query} />
          ) : (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              No description provided.
            </Text>
          )}

          {checklist.length > 0 && (
            <HostStack gap="xs" testID="issue-detail-checklist">
              <Text
                style={{
                  color: colors.foregroundMuted,
                  fontWeight: "600",
                  fontSize: 11,
                }}
              >
                Checklist
              </Text>
              {checklist.map((item) => (
                <Pressable
                  key={item.index}
                  testID={`issue-checklist-item-${item.index}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.checked }}
                  accessibilityLabel={`Mark "${item.text}" ${
                    item.checked ? "unchecked" : "checked"
                  }`}
                  onPress={() => handleToggleChecklist(item)}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      color: item.checked ? colors.statusSuccess : colors.foregroundMuted,
                      fontSize: 13,
                    }}
                  >
                    {item.checked ? "☑" : "☐"}
                  </Text>
                  <Text
                    style={{
                      flex: 1,
                      color: item.checked ? colors.foregroundMuted : colors.foreground,
                      fontSize: 13,
                      lineHeight: 18,
                      textDecorationLine: item.checked ? "line-through" : "none",
                    }}
                  >
                    {item.text}
                  </Text>
                </Pressable>
              ))}
            </HostStack>
          )}

          {/* Comment timeline */}
          <HostStack gap="xs" testID="issue-detail-comments">
            <Text
              style={{
                color: colors.foregroundMuted,
                fontWeight: "600",
                fontSize: 11,
              }}
            >
              Comments{detail?.comments?.length ? ` (${detail.comments.length})` : ""}
            </Text>
            {(detail?.comments ?? []).length === 0 ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                No comments yet.
              </Text>
            ) : (
              (detail?.comments ?? []).map((comment) => (
                <HostCommentCard
                  key={comment.id}
                  comment={comment}
                  issueUrl={detail?.webUrl}
                  query={query}
                />
              ))
            )}
          </HostStack>

          {/* Composer */}
          {onSubmitComment ? (
            <HostStack gap="xs" testID="issue-detail-composer">
              <HostTextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write a comment..."
                multiline
                numberOfLines={3}
              />
              <HostRow justify="flex-end">
                <HostButton
                  testID="issue-detail-comment-submit"
                  label="Comment"
                  variant="primary"
                  size="sm"
                  icon="Send"
                  disabled={draft.trim().length === 0}
                  loading={submitting}
                  accessibilityLabel={`Post comment on issue #${issue.number}`}
                  onPress={handleSubmitComment}
                />
              </HostRow>
            </HostStack>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

export { HostIssueDetailDrawer as IssueDetailDrawer };

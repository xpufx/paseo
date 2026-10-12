import { canonicalLabel } from "@xpufx/backend-tickets/client";
import type { StatusVariant } from "../types.js";
import type {
  ChecklistItem,
  CiStatus,
  KanbanIssue,
  LinkedPullRequest,
  PullRequestReviewDecision,
  PullRequestState,
} from "./types.js";

const FEATURE_BRANCH_PREFIXES = [
  "feat/",
  "feature/",
  "fix/",
  "bugfix/",
  "hotfix/",
  "chore/",
  "refactor/",
  "docs/",
  "test/",
  "release/",
  "exp/",
  "spike/",
];

const BRANCH_LABEL_PATTERN = /^(?:branch|git\/branch)\/(.+)$/;
const PULL_REQUEST_LABEL_PATTERN = /^(?:pr|pull|pull-request|pullrequest|linked-pr)\/(\d+)$/;
const PULL_REQUEST_URL_PATTERN = /\/(?:pulls?|merge_requests)\/(\d+)/;

export interface CardArtifactBadge {
  label: string;
  variant: StatusVariant;
  icon?: string;
}

/**
 * Resolves the branch shown as a pill on a card. Explicit `issue.branch` wins;
 * hosts that only project labels can carry it as `branch/<name>`.
 */
export function detectBranchPill(issue: KanbanIssue): string | null {
  if (typeof issue.branch === "string" && issue.branch.trim()) {
    return issue.branch.trim();
  }
  for (const raw of issue.labels ?? []) {
    const label = canonicalLabel(String(raw).trim().toLowerCase());
    const match = BRANCH_LABEL_PATTERN.exec(label);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function isFeatureBranch(branch: string): boolean {
  const value = branch.trim().toLowerCase();
  return FEATURE_BRANCH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function stateFromLabels(labels: readonly string[]): PullRequestState | undefined {
  for (const label of labels) {
    if (
      label === "pr/merged" ||
      label === "pull/merged" ||
      label === "pull-request/merged" ||
      label === "status/merged"
    ) {
      return "merged";
    }
    if (
      label === "pr/draft" ||
      label === "pr/wip" ||
      label === "pull/draft" ||
      label === "pull-request/draft"
    ) {
      return "draft";
    }
    if (
      label === "pr/open" ||
      label === "pr/opened" ||
      label === "pull/open" ||
      label === "pull-request/open"
    ) {
      return "open";
    }
    if (
      label === "pr/closed" ||
      label === "pull/closed" ||
      label === "pull-request/closed"
    ) {
      return "closed";
    }
  }
  return undefined;
}

function reviewFromLabels(labels: readonly string[]): PullRequestReviewDecision | undefined {
  for (const label of labels) {
    if (label === "review/approved") return "approved";
    if (label === "review/changes-requested") return "changes-requested";
    if (label === "review/needed" || label === "state/review-needed") {
      return "pending";
    }
  }
  return undefined;
}

/**
 * Normalizes an explicit pull request, a `pr/<n>` label, or a PR URL into the
 * card artifact shape. Returns `null` when the issue carries no PR signal.
 */
export function detectLinkedPullRequest(issue: KanbanIssue): LinkedPullRequest | null {
  const labels = (issue.labels ?? []).map((label) =>
    canonicalLabel(String(label).trim().toLowerCase()),
  );
  const explicit = issue.pullRequest ?? issue.pullRequests?.[0];

  let detected: LinkedPullRequest | null = explicit ? { ...explicit } : null;
  let url = detected?.url;

  if (!detected) {
    for (const label of labels) {
      const match = PULL_REQUEST_LABEL_PATTERN.exec(label);
      if (match) {
        detected = { number: Number(match[1]) };
        break;
      }
    }
  }

  if (!url && issue.url) {
    const match = PULL_REQUEST_URL_PATTERN.exec(issue.url);
    if (match) {
      url = issue.url;
      if (!detected) detected = { number: Number(match[1]) };
    }
  }

  const state = detected?.state ?? stateFromLabels(labels);
  const reviewDecision = detected?.reviewDecision ?? reviewFromLabels(labels);

  if (!detected) {
    if (!state && !reviewDecision) return null;
    detected = {};
  }

  return {
    ...detected,
    state: state ?? "unknown",
    reviewDecision: reviewDecision ?? "unknown",
    draft: detected.draft ?? state === "draft",
    ...(url ? { url } : {}),
  };
}

function normalizeCiStatus(value: string): CiStatus {
  const normalized = value.trim().toLowerCase();
  const scoped = /^(?:ci|checks)\/(.+)$/.exec(normalized);
  const token = scoped?.[1] ?? normalized;
  if (["passing", "pass", "passed", "success", "succeeded", "green", "ok"].includes(token)) {
    return "passing";
  }
  if (["failing", "fail", "failed", "failure", "error", "red"].includes(token)) {
    return "failing";
  }
  if (["running", "in_progress", "in-progress", "started", "progress"].includes(token)) {
    return "running";
  }
  if (["pending", "queued", "waiting"].includes(token)) {
    return "pending";
  }
  return "unknown";
}

/**
 * Resolves the CI indicator status. Explicit `issue.ciStatus` wins; otherwise
 * the first recognized `ci/*` or `checks/*` label is used.
 */
export function detectCiStatus(issue: KanbanIssue): CiStatus {
  if (issue.ciStatus) {
    const normalized = normalizeCiStatus(String(issue.ciStatus));
    if (normalized !== "unknown") return normalized;
  }
  for (const raw of issue.labels ?? []) {
    const normalized = normalizeCiStatus(canonicalLabel(String(raw).trim().toLowerCase()));
    if (normalized !== "unknown") return normalized;
  }
  return "unknown";
}

export function describePullRequest(pr: LinkedPullRequest): CardArtifactBadge {
  const prefix = pr.number ? `#${pr.number} ` : "";
  switch (pr.state) {
    case "merged":
      return { label: `${prefix}merged`, variant: "success", icon: "GitMerge" };
    case "closed":
      return { label: `${prefix}closed`, variant: "danger", icon: "GitPullRequestClosed" };
    case "draft":
      return { label: `${prefix}draft`, variant: "neutral", icon: "GitPullRequestDraft" };
    case "open":
      return { label: `${prefix}PR`, variant: "info", icon: "GitPullRequest" };
    default:
      return { label: `${prefix}PR`, variant: "neutral", icon: "GitPullRequest" };
  }
}

export function describeReviewDecision(
  decision: PullRequestReviewDecision | undefined,
): CardArtifactBadge | null {
  switch (decision) {
    case "approved":
      return { label: "Approved", variant: "success", icon: "Check" };
    case "changes-requested":
      return { label: "Changes requested", variant: "warning", icon: "MessageSquareWarning" };
    case "pending":
      return { label: "Review pending", variant: "neutral", icon: "Clock" };
    default:
      return null;
  }
}

export function describeCiStatus(status: CiStatus): CardArtifactBadge | null {
  switch (status) {
    case "passing":
      return { label: "CI passing", variant: "success" };
    case "failing":
      return { label: "CI failing", variant: "danger" };
    case "running":
      return { label: "CI running", variant: "warning" };
    case "pending":
      return { label: "CI pending", variant: "neutral" };
    default:
      return null;
  }
}

const CHECKLIST_LINE_PATTERN = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/;

/** Parses GitHub/Forgejo task-list lines (`- [ ]` / `- [x]`) from a body. */
export function extractChecklist(body: string | undefined | null): ChecklistItem[] {
  if (!body || typeof body !== "string") return [];
  const items: ChecklistItem[] = [];
  body.split(/\r?\n/).forEach((line, lineIndex) => {
    const match = CHECKLIST_LINE_PATTERN.exec(line);
    if (!match) return;
    items.push({
      index: items.length,
      line: lineIndex + 1,
      text: match[3].trim(),
      checked: match[2].toLowerCase() === "x",
    });
  });
  return items;
}

/** Rewrites one checklist item's checked state, preserving the rest of the body. */
export function setChecklistItemChecked(
  body: string,
  index: number,
  checked: boolean,
): string {
  const lines = body.split(/\r?\n/);
  let seen = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = CHECKLIST_LINE_PATTERN.exec(lines[i]);
    if (!match) continue;
    seen += 1;
    if (seen === index) {
      lines[i] = `${match[1]}[${checked ? "x" : " "}] ${match[3]}`;
      break;
    }
  }
  return lines.join("\n");
}

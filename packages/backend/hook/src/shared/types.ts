/**
 * Canonical event model shared across all forge integrations.
 *
 * Every webhook — Forgejo, Gitea, GitHub, GitLab — is normalised into a
 * `NormalizedEvent` so downstream consumers never need to reason about
 * vendor-specific payload shapes.
 */

// ── Forge identifiers ────────────────────────────────────────────────

export type ForgeId = "forgejo" | "gitea" | "github" | "gitlab";

// ── Action enums ─────────────────────────────────────────────────────

export type PushAction = "created" | "deleted" | "force";
export type IssueAction =
  | "opened"
  | "edited"
  | "closed"
  | "reopened"
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "locked"
  | "unlocked"
  | "pinned"
  | "unpinned";
export type PullRequestAction =
  | "opened"
  | "edited"
  | "closed"
  | "reopened"
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "locked"
  | "unlocked"
  | "review_requested"
  | "review_request_removed"
  | "ready_for_review"
  | "locked"
  | "unlocked"
  | "auto_merge_enabled"
  | "synchronize";
export type IssueCommentAction = "created" | "edited" | "deleted";

// ── NormalizedEvent ──────────────────────────────────────────────────

export interface NormalizedEvent {
  /** Unique identifier for this webhook delivery (vendor-supplied). */
  id: string;
  /** Which forge sent this event. */
  forge: ForgeId;
  /** Event type / action (push, issues, pull_request, issue_comment). */
  action: string;
  /** Repository slug as `<owner>/<repo>` or full URL. */
  repository: string;
  /** Branch, tag, or PR ref that triggered the event. */
  ref?: string;
  /** Commit SHA(s) for push events. */
  commits?: string[];
  /** Issue number for issue / issue_comment events. */
  issueNumber?: number;
  /** Pull-request number for pull_request events. */
  pullRequestNumber?: number;
  /** Sender / actor login. */
  sender: string;
  /** ISO-8601 timestamp from the webhook header/payload. */
  timestamp: string;
  /** Raw payload preserved for audit / replay. */
  raw: Record<string, unknown>;
}

// ── Signature validation models ──────────────────────────────────────

export interface SignatureHeader {
  /** The value of the signature header (e.g. `sha256=...`). */
  value: string;
  /** Name of the header (e.g. `X-Hub-Signature-256`, `X-Gitlab-Token`). */
  name: string;
}

export type HookProvider = "forgejo" | "github" | "gitlab";

// ── Queue models ─────────────────────────────────────────────────────

export interface QueuedHookEvent extends NormalizedEvent {
  /** Monotonic enqueue sequence number. */
  seq: number;
  /** When the event was enqueued (ms since epoch). */
  enqueuedAt: number;
  /** Number of retry attempts so far. */
  retries: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export type QueueState = "idle" | "paused" | "processing";

// In-process port of platform `scripts/forgejo-issues-check` (#733).
//
// The Python original was the plugin's only hard runtime dependency: the board
// sweep exec'd that script from the operator's ~/bin every 15 minutes because
// it could not run in the daemon's node context. This module moves the logic
// into the plugin. `teax` remains the Forgejo transport (operator-provided,
// same as before); only the Python interpreter dependency is gone.
//
// Parity with the Python original is proved, not assumed: the ported regression
// suite (`server/issues-check.test.ts`) mirrors `forgejo-issues-check.test.py`
// fixture for fixture, and a cross-implementation comparison against the Python
// original over representative board states is recorded in
// `docs/issues-check-parity.md`. Where this module intentionally diverges, the
// divergence is marked inline and documented there.
//
// Deterministic board checker: evaluates a Forgejo issue board with a
// deterministic multi-factor priority tuple (tier, urgency, effort, age) and
// serves as Layer 1 of the Dual-Engine Orchestration Model. It identifies
// DISPATCHABLE tasks (spec/2-approved, unblocked, active state) needing zero
// operator approval, and surfaces items requiring Orchestrator Layer 2
// reasoning (deliverable pre-flight, pre-code shaping, gated checklists,
// decomposition, dependency blocking, human feedback and first-seen tickets).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

// Dual-read label aliases (platform#247): legacy numeric -> canonical numberless.
const LABEL_ALIASES: Readonly<Record<string, string>> = {
  "state/0-triage": "state/triage",
  "state/1-wip": "state/wip",
  "state/2-review": "state/review",
  "state/3-verify": "state/verify",
  "state/4-done": "state/done",
  "attention/0-orchestrator": "attention/orchestrator",
  "attention/1-agent": "attention/agent",
  "attention/2-user": "attention/user",
  "attention/3-ignore": "attention/ignore",
  "priority/0-SOS": "priority/sos",
  "priority/1-high": "priority/high",
  "priority/2-normal": "priority/normal",
  "priority/3-low": "priority/low",
  "priority/4-backburner": "priority/backburner",
  "spec/0-needed": "spec/needed",
  "spec/1-checklist": "spec/checklist",
  "spec/2-approved": "spec/approved",
  "size/0-cheap": "size/cheap",
  "size/1-medium": "size/medium",
  "size/2-expensive": "size/expensive",
  "size/3-chunk": "size/chunk",
  "linked/0-needs-split": "linked/needs-split",
  "upstream/1-blocked": "upstream/blocked",
};

/** Canonical numberless spelling; unknown labels pass through. */
export function canonicalLabel(label: string): string {
  return LABEL_ALIASES[label] ?? label;
}

export const STALE_WIP_LABEL = "state/wip";
export const STALE_WIP_REMINDER_MARKER = "<!-- forgejo-issues-check:stale-wip-reminder -->";
/** Human-readable body of the stale-WIP triage notice, before the marker/footer. */
export const STALE_WIP_NOTICE_TEXT =
  "WIP has had no update past the configured timeout; returning it to orchestrator triage " +
  "to check status, ownership, and next action.";

/**
 * Build the stale-WIP triage notice. The marker stays byte-identical to the
 * external checker's so host runs, Action runs, and the router interoperate; an
 * optional envelope footer is appended for the in-router path. The marker is
 * itself the idempotency key `hasStaleWipReminder` looks for.
 */
export function staleWipNoticeBody({ envelope }: { envelope?: string | null } = {}): string {
  const footer = envelope ? `\n\n---\n${envelope}` : "";
  return `${STALE_WIP_NOTICE_TEXT}\n\n${STALE_WIP_REMINDER_MARKER}${footer}`;
}
// A stop-work or ignore directive always wins over automated recovery. Closed
// issues are not returned by getOpenIssues(), and state/done is defensive.
export const STALE_WIP_SKIP_LABELS: ReadonlySet<string> = new Set([
  "flag/stop-work",
  "flag/wont-do",
  "attention/ignore",
  "state/done",
]);

// Blocking states for autonomous coding workers. Carried over from the source
// module's surface; the checker itself reasons through the label sets below.
export const WORKER_BLOCKING_LABELS: ReadonlySet<string> = new Set([
  "state/wip",
  "state/review",
  "state/verify",
  "state/done",
  "dep/blocked",
  "upstream/blocked",
  "flag/stop-work",
  "flag/wont-do",
  "attention/orchestrator",
  "attention/user",
  "attention/ignore",
  "size/chunk",
  "linked/needs-split",
  "spec/needed",
  "spec/checklist",
]);

// --- Priority weights (lower = higher urgency) ---

export const TIER_WEIGHTS: Readonly<Record<string, number>> = {
  "priority/sos": 0,
  "priority/high": 1,
  "priority/normal": 2,
  "priority/low": 3,
  "priority/backburner": 4,
};

export const KIND_WEIGHTS: Readonly<Record<string, number>> = {
  "flag/security": 0,
  "kind/bug": 1,
  "kind/feature": 2,
  "kind/chore": 3,
  "kind/refactor": 3,
  "kind/docs": 4,
  "kind/explore": 5,
  "kind/discussion": 6,
  "kind/idea": 7,
  "kind/meta": 8,
};

export const EFFORT_WEIGHTS: Readonly<Record<string, number>> = {
  "size/cheap": 0, // Quick wins first
  "size/medium": 1,
  "size/expensive": 2,
  "size/chunk": 3,
};

export interface ForgejoIssue {
  number: number;
  title?: string;
  state?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  comments?: number;
  labels?: unknown;
  [key: string]: unknown;
}

/** Forgejo comment payload: only the fields the checker reads are typed. */
export interface ForgejoComment {
  user?: { login?: string } | null;
  body?: unknown;
  [key: string]: unknown;
}

/** [tier, urgency, effort, created_at] — lower sorts first; age is a string sort. */
export type PriorityTuple = [number, number, number, string];

export interface IssueSignature {
  updated_at: string;
  labels: string[];
  comments_count: number;
}

export interface RankedCandidate {
  number: number;
  title: string;
  labels: string[];
  priority_tuple: PriorityTuple;
  category: string;
  is_dispatchable: boolean;
  /** Present only on first-seen candidates. */
  is_new?: boolean;
  /** Present only on human-feedback candidates. */
  last_comment_by?: string;
  last_comment_snippet?: string;
  reason: string;
}

export interface StaleWipResult {
  number: number;
  reminded: boolean;
  recovered: boolean;
  dry_run: boolean;
}

export interface IssuesCheckOutcome {
  /** Python exits 1 iff any candidate was reported; 0 otherwise. */
  exitCode: 0 | 1;
  rankedCandidates: RankedCandidate[];
  staleWipRecovery: StaleWipResult[];
  savedState: Record<string, IssueSignature>;
}

export type IssuesCheckRole = "orchestrator" | "worker";

/**
 * Board identities are operator-specific, so they are configuration rather than
 * literals: the published plugin must not name a person, and the PII hygiene
 * gate on the publish surface enforces that.
 *
 * `trusted` logins count as human feedback even when the body carries an agent
 * marker. `nonHuman` logins are the board owner, whose own comments are not
 * inbound feedback. Both default to empty, which reduces the rule to its
 * general form: any comment without an agent marker is human feedback, whoever
 * wrote it. That default is the intended behaviour for a public install.
 *
 * Divergence from the Python original is recorded in
 * docs/issues-check-parity.md (scenario 10): with the identities configured to
 * match, the port reproduces the original exactly.
 */
export function boardIdentityConfig(env: Record<string, string | undefined> = process.env): {
  trusted: Set<string>;
  nonHuman: Set<string>;
} {
  const parse = (value: string | undefined): Set<string> =>
    new Set(
      (value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  return {
    trusted: parse(env.PASEO_BOARD_TRUSTED_LOGINS),
    nonHuman: parse(env.PASEO_BOARD_NON_HUMAN_LOGINS),
  };
}

/**
 * Transport failure of the issues query. Divergence from the Python original
 * (recorded in docs/issues-check-parity.md): the script treated a failing
 * `teax` call as an empty board and exited 0 silently, which is exactly the
 * silent degradation #733 removes. Here the failure propagates to the caller.
 */
export class IssuesCheckTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssuesCheckTransportError";
  }
}

/** Label names exactly as the issue carries them; missing names stay undefined. */
function labelNames(issue: ForgejoIssue): Array<string | undefined> {
  const raw = Array.isArray(issue?.labels) ? issue.labels : [];
  return raw.map((label) => {
    const name =
      label && typeof label === "object" ? (label as { name?: unknown }).name : undefined;
    return typeof name === "string" ? canonicalLabel(name) : undefined;
  });
}

function labelSet(issue: ForgejoIssue): Set<string | undefined> {
  return new Set(labelNames(issue));
}

export function cacheFilePath(repo: string): string {
  const slug = repo.replaceAll("/", "_");
  const home = process.env.HOME ?? homedir();
  return join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "board-state", `${slug}.json`);
}

/**
 * Parse Forgejo's ISO-8601 timestamps as UTC epoch-ms; invalid timestamps are
 * safe skips. Mirrors the Python `parse_forgejo_timestamp`: a value without a
 * timezone designator is coerced to UTC rather than read as local time — the
 * reason this is not the watchdog's `parseIsoTimestamp`, which reads naive
 * strings as local time.
 */
export function parseForgejoTimestamp(value: unknown): number | null {
  if (!value || typeof value !== "string") return null;
  const normalized = value.replaceAll("Z", "+00:00");
  // JS reads a timezone-less ISO string as local time; the Python original
  // treats it as UTC (datetime without tzinfo -> replace(tzinfo=utc)).
  const hasTz = /(?:[+-]\d{2}:?\d{2}|Z)$/.test(value.trim());
  if (hasTz) {
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = Date.parse(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(`${normalized}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Return a stale WIP age in milliseconds, or null when the issue must not be
 * recovered. Forgejo's issue-level `updated_at` is the canonical activity
 * timestamp: it advances for edits, comments, and board changes. This
 * intentionally treats every visible ticket update as activity; a malformed or
 * missing value is never guessed, so automation cannot reclaim an uncertain
 * ticket.
 */
export function staleWipAge(issue: ForgejoIssue, now: number): number | null {
  const labels = labelSet(issue);
  const state = issue?.state ?? null;
  if (state !== null && state !== "open") return null;
  if (!labels.has(STALE_WIP_LABEL) || [...labels].some((label) => label != null && STALE_WIP_SKIP_LABELS.has(label))) {
    return null;
  }
  const updatedAt = parseForgejoTimestamp(issue?.updated_at);
  if (updatedAt === null) return null;
  const age = now - updatedAt;
  return age >= 0 ? age : null;
}

export function hasStaleWipReminder(comments: ForgejoComment[]): boolean {
  return comments.some((comment) => String(comment?.body ?? "").includes(STALE_WIP_REMINDER_MARKER));
}

/** Run a bounded Forgejo command without interpolating issue content into a shell. */
export async function runStaleWipCommand(
  command: string[],
  inputText?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    // The child may exit without reading its stdin (subprocess.run's
    // communicate() swallows the BrokenPipeError; so does this).
    child.stdin?.on("error", () => {});
    child.on("error", (err) => {
      process.stderr.write(`stale WIP recovery failed: ${String(err.message ?? err)}\n`);
      resolve(false);
    });
    child.on("close", (code) => {
      if (code) {
        process.stderr.write(`stale WIP recovery failed: ${stderr.trim()}\n`);
        resolve(false);
        return;
      }
      resolve(true);
    });
    child.stdin?.end(inputText ?? "");
  });
}

/**
 * Comment once, then return stale work to orchestrator triage.
 *
 * The marker makes a partial failure safe: a later sweep skips the duplicate
 * comment and retries only the label transition. Label edits name only the two
 * workflow labels, preserving priority, kind, and every unrelated label.
 */
export async function recoverStaleWipIssue(
  io: Pick<IssuesCheckIo, "getIssueComments" | "runStaleWipCommand">,
  hostname: string,
  repo: string,
  issue: ForgejoIssue,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<StaleWipResult> {
  const number = issue.number;
  const comments = await io.getIssueComments(hostname, repo, number);
  const alreadyReminded = hasStaleWipReminder(comments);
  if (dryRun) {
    return { number, reminded: !alreadyReminded, recovered: false, dry_run: true };
  }
  if (!alreadyReminded) {
    const reminder = staleWipNoticeBody();
    const posted = await io.runStaleWipCommand(
      [
        "teax",
        "api",
        "-X",
        "POST",
        `repos/${repo}/issues/${number}/comments`,
        "--hostname",
        hostname,
        "--data",
        "@-",
      ],
      JSON.stringify({ body: reminder }),
    );
    if (!posted) {
      return { number, reminded: false, recovered: false, dry_run: false };
    }
  }
  const recovered = await io.runStaleWipCommand([
    "teax",
    "issue",
    "edit",
    String(number),
    "--hostname",
    hostname,
    "-R",
    repo,
    "--add-label",
    "attention/orchestrator",
    "--remove-label",
    STALE_WIP_LABEL,
  ]);
  return { number, reminded: !alreadyReminded, recovered, dry_run: false };
}

/** Recover open WIP tickets whose canonical activity timestamp exceeds the threshold. */
export async function sweepStaleWipIssues(
  io: Pick<IssuesCheckIo, "getIssueComments" | "runStaleWipCommand">,
  hostname: string,
  repo: string,
  issues: ForgejoIssue[],
  thresholdHours: number,
  { now, dryRun = false }: { now?: number; dryRun?: boolean } = {},
): Promise<StaleWipResult[]> {
  const nowMs = now ?? Date.now();
  const thresholdSeconds = thresholdHours * 60 * 60;
  const results: StaleWipResult[] = [];
  for (const issue of issues) {
    const age = staleWipAge(issue, nowMs);
    if (age !== null && age / 1000 >= thresholdSeconds) {
      results.push(await recoverStaleWipIssue(io, hostname, repo, issue, { dryRun }));
    }
  }
  return results;
}

export function calculatePriorityTuple(issue: ForgejoIssue, isFeedbackDelta = false): PriorityTuple {
  const labels = labelSet(issue);

  // 1. Tier
  let tier: number;
  if (isFeedbackDelta) {
    tier = -1; // Human feedback preempts everything, including normal SOS
  } else {
    tier = 2; // default normal
    for (const label of labels) {
      if (label != null && Object.hasOwn(TIER_WEIGHTS, label)) tier = Math.min(tier, TIER_WEIGHTS[label]);
    }
  }

  // 2. Urgency (kind)
  let urgency = 5;
  for (const label of labels) {
    if (label != null && Object.hasOwn(KIND_WEIGHTS, label)) urgency = Math.min(urgency, KIND_WEIGHTS[label]);
  }

  // 3. Effort — the source assigns (not min), so the last matching label wins.
  let effort = 1; // default medium
  for (const label of labels) {
    if (label != null && Object.hasOwn(EFFORT_WEIGHTS, label)) effort = EFFORT_WEIGHTS[label];
  }

  // 4. Age (created_at ISO string sorts lexicographically)
  const createdAt = issue?.created_at ?? "";

  return [tier, urgency, effort, createdAt];
}

export function isDispatchableCandidate(labelSet: Set<string>): boolean {
  // Hard stop or ignore flags
  if (setIntersects(labelSet, ["flag/stop-work", "flag/wont-do", "attention/ignore", "state/done"])) {
    return false;
  }
  // Gated on user attention
  if (setIntersects(labelSet, ["attention/user"])) return false;
  // Dependency or upstream blocked
  if (setIntersects(labelSet, ["dep/blocked", "upstream/blocked"])) return false;
  // Oversized or needs splitting
  if (setIntersects(labelSet, ["size/chunk", "linked/needs-split"])) return false;
  // Active WIP (worker already assigned and actively executing)
  if (labelSet.has("state/wip")) return false;
  // Deliverable verification or review stages (pending orchestrator verification/PR merge)
  if (setIntersects(labelSet, ["state/verify", "state/review"])) return false;

  // Natural autonomous dispatch: Open tickets without user blockers or hard stops
  return true;
}

function setIntersects(set: Set<string>, labels: readonly string[]): boolean {
  return labels.some((label) => set.has(label));
}

export interface FeedbackInfo {
  author?: string;
  snippet?: string;
}

export function classifyCandidate(
  issue: ForgejoIssue,
  labelSet: Set<string>,
  { isNew = false, isFeedback = false, feedbackInfo = null }: {
    isNew?: boolean;
    isFeedback?: boolean;
    feedbackInfo?: FeedbackInfo | null;
  } = {},
): { category: string; is_dispatchable: boolean; reason: string } {
  if (isFeedback) {
    const author = feedbackInfo?.author ?? "operator";
    const snip = feedbackInfo?.snippet ?? "";
    return {
      category: "feedback",
      is_dispatchable: false,
      reason: `New human feedback from @${author} (Precedence Rule): '${snip}...'`,
    };
  }

  if (isNew) {
    if (setIntersects(labelSet, ["attention/user"])) {
      return {
        category: "user_attention",
        is_dispatchable: false,
        reason: "[NEW ISSUE - USER ATTENTION REQUIRED] Newly filed issue requires operator input or decision",
      };
    }
    return {
      category: "new_unseen",
      is_dispatchable: false,
      reason: "[NEW ISSUE FIRST-SEEN] Requires First-Look Ingestion: taxonomy classification, format check, and shaping checklist",
    };
  }

  if (labelSet.has("priority/sos")) {
    const isDisp = isDispatchableCandidate(labelSet);
    if (labelSet.has("state/verify") || labelSet.has("state/review")) {
      return {
        category: "sos",
        is_dispatchable: false,
        reason: "Preempt all work (SOS deliverable completed; pre-flight verification required)",
      };
    }
    return {
      category: "sos",
      is_dispatchable: isDisp,
      reason: isDisp
        ? "Preempt all work (SOS - Immediate autonomous dispatch)"
        : "Preempt all work (SOS - Orchestrator triage)",
    };
  }

  // User attention needed
  if (setIntersects(labelSet, ["attention/user"])) {
    return {
      category: "user_attention",
      is_dispatchable: false,
      reason: "Requires user attention / operator input or decision (attention/user)",
    };
  }

  // Deliverable verification
  if (labelSet.has("state/verify") || labelSet.has("state/review")) {
    return {
      category: "verification",
      is_dispatchable: false,
      reason: "Deliverable complete: worker completed implementation; Orchestrator pre-flight hygiene audit required",
    };
  }

  // Active WIP
  if (labelSet.has("state/wip")) {
    return {
      category: "in_progress",
      is_dispatchable: false,
      reason: "Work in progress by worker",
    };
  }

  // Decomposition
  if (labelSet.has("size/chunk") || labelSet.has("linked/needs-split")) {
    return {
      category: "decomposition",
      is_dispatchable: false,
      reason: "Decomposition required: Orchestrator must chunk or split across domain boundaries",
    };
  }

  // Dependency blocked
  if (labelSet.has("dep/blocked") || labelSet.has("upstream/blocked")) {
    return {
      category: "blocked",
      is_dispatchable: false,
      reason: "Blocked on dependency / upstream: Orchestrator must evaluate unblock status",
    };
  }

  // Pre-code shaping
  if (labelSet.has("spec/needed")) {
    return {
      category: "shaping",
      is_dispatchable: false,
      reason: "Pre-code shaping required: Orchestrator must formulate specification & checklist (spec/needed)",
    };
  }

  // Fully dispatchable worker task
  if (isDispatchableCandidate(labelSet)) {
    const target = labelNames(issue).find((label) => typeof label === "string" && label.startsWith("target/"));
    const targetStr = target ? ` [${target}]` : "";
    return {
      category: "dispatchable",
      is_dispatchable: true,
      reason: `Dispatchable task${targetStr} (unblocked, ready for autonomous execution)`,
    };
  }

  // Orchestrator explicit triage
  if (labelSet.has("attention/orchestrator")) {
    return {
      category: "orchestrator_triage",
      is_dispatchable: false,
      reason: "Requires Orchestrator triage / investigation",
    };
  }

  return {
    category: "orchestrator_triage",
    is_dispatchable: false,
    reason: "Actionable task",
  };
}

export function isActionable(labelSet: Set<string>, role: IssuesCheckRole = "orchestrator"): boolean {
  // SOS trumps all blockers except hard stop-work
  if (labelSet.has("priority/sos")) {
    if (labelSet.has("flag/stop-work") || labelSet.has("flag/wont-do")) return false;
    return true;
  }

  // General suppressors for everyone
  if (setIntersects(labelSet, ["flag/stop-work", "flag/wont-do", "attention/ignore"])) {
    return false;
  }
  if (labelSet.has("state/done")) return false;

  if (role === "worker") {
    // Workers can ONLY pick up dispatchable tasks
    return isDispatchableCandidate(labelSet);
  }

  // Orchestrator role
  if (setIntersects(labelSet, ["attention/user"])) {
    return true; // Orchestrator watches user-attention items to notify the operator
  }
  if (labelSet.has("attention/orchestrator")) return true;
  if (labelSet.has("size/chunk") || labelSet.has("linked/needs-split")) return true; // Orchestrator action needed to chunk/split
  if (labelSet.has("spec/needed") || labelSet.has("spec/checklist")) return true; // Shaping / gate tracking
  if (labelSet.has("state/verify") || labelSet.has("state/review")) return true; // Deliverable pre-flight verification
  if (labelSet.has("dep/blocked") || labelSet.has("upstream/blocked")) return true; // Dependency monitoring
  if (labelSet.has("attention/agent")) return true;
  if (labelSet.has("spec/approved")) return true;
  if (isDispatchableCandidate(labelSet)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// IO layer
// ---------------------------------------------------------------------------

export type OpenIssuesResult =
  | { ok: true; issues: ForgejoIssue[] }
  | { ok: false; error: string };

export interface IssuesCheckIo {
  getOpenIssues(hostname: string, repo: string): Promise<OpenIssuesResult>;
  getLatestComments(hostname: string, repo: string, issueNumber: number, count?: number): Promise<ForgejoComment[]>;
  getIssueComments(hostname: string, repo: string, issueNumber: number): Promise<ForgejoComment[]>;
  runStaleWipCommand(command: string[], inputText?: string): Promise<boolean>;
  loadCache(repo: string): Promise<Record<string, IssueSignature>>;
  saveCache(state: Record<string, IssueSignature>, repo: string): Promise<void>;
}

/** One teax invocation; mirrors the Python `run_cmd` contract (stdout only). */
function teaxRun(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("teax", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      resolve({ code: 127, stdout: "", stderr: String(err.message ?? err) });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function parseJsonList<T>(stdout: string): T[] | null {
  try {
    const data = JSON.parse(stdout);
    return Array.isArray(data) ? (data as T[]) : null;
  } catch {
    return null;
  }
}

export type TeaxRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/**
 * Default IO: `teax` as the Forgejo transport and `~/.cache` for board state —
 * the same plumbing the Python original used, minus the Python interpreter.
 * Unlike the original, a failing issues query is an error, not an empty board:
 * that conflation was the silent degradation #733 removes.
 */
export function createDefaultIssuesCheckIo(runner: TeaxRunner = teaxRun): IssuesCheckIo {
  return {
    async getOpenIssues(hostname, repo) {
      const allIssues: ForgejoIssue[] = [];
      const limit = 50;
      const maxPages = 20;

      for (let page = 1; page <= maxPages; page++) {
        const res = await runner([
          "api",
          `repos/${repo}/issues?state=open&sort=updated&order=desc&limit=${limit}&page=${page}`,
          "--hostname",
          hostname,
        ]);
        if (res.code !== 0) {
          return {
            ok: false,
            error: `teax issues query failed on page ${page} (rc=${res.code}): ${res.stderr.trim() || "no output"}`,
          };
        }
        const out = res.stdout.trim();
        if (!out) break;
        const pageIssues = parseJsonList<ForgejoIssue>(out);
        if (!pageIssues) {
          return { ok: false, error: `teax issues query returned non-list output on page ${page}` };
        }
        if (pageIssues.length === 0) break;
        allIssues.push(...pageIssues);
        if (pageIssues.length < limit) break;
      }

      return { ok: true, issues: allIssues };
    },

    // Comment reads stay best-effort ([] on failure), as in the original:
    // they only gate feedback detection, never the whole run.
    async getLatestComments(hostname, repo, issueNumber, count = 3) {
      const res = await teaxRun(["api", `repos/${repo}/issues/${issueNumber}/comments`, "--hostname", hostname]);
      if (res.code !== 0) return [];
      const out = res.stdout.trim();
      if (!out) return [];
      const data = parseJsonList<ForgejoComment>(out);
      return data ? data.slice(-count) : [];
    },

    async getIssueComments(hostname, repo, issueNumber) {
      const res = await teaxRun(["api", `repos/${repo}/issues/${issueNumber}/comments`, "--hostname", hostname]);
      if (res.code !== 0) return [];
      const out = res.stdout.trim();
      if (!out) return [];
      return parseJsonList<ForgejoComment>(out) ?? [];
    },

    runStaleWipCommand,

    async loadCache(repo) {
      const file = cacheFilePath(repo);
      if (!existsSync(file)) return {};
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return {};
      }
    },

    async saveCache(state, repo) {
      const file = cacheFilePath(repo);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(state, null, 2));
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry (port of the script's main())
// ---------------------------------------------------------------------------

export interface IssuesCheckOptions {
  hostname?: string;
  repo?: string;
  force?: boolean;
  all?: boolean;
  role?: IssuesCheckRole;
  /** Return open state/1-wip issues with no update for this many hours to orchestrator triage. */
  staleWipHours?: number;
  /**
   * Whether to run the stale-WIP recovery sweep for open `state/1-wip` tickets.
   * `HookRouter.runBoardCheck` delegates to this sweep directly when
   * `staleWipSweepEnabled` is true (defaulting to enabled outside test mode).
   * Defaults to true.
   */
  sweepStaleWip?: boolean;
  dryRun?: boolean;
  /** Injectable clock; defaults to the real current time. */
  now?: number;
  io?: IssuesCheckIo;
}

export const ISSUES_CHECK_DEFAULT_HOSTNAME = "forge.mrs.uppidi.com";
export const ISSUES_CHECK_DEFAULT_REPO = "xpufx/paseo-plugin-helper";
export const ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS = 2.0;

/**
 * Deterministic ordering for the priority tuple: numeric tiers, then the
 * lexicographic created_at string, exactly like Python's tuple comparison.
 */
function comparePriorityTuples(a: PriorityTuple, b: PriorityTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  if (a[3] !== b[3]) return a[3] < b[3] ? -1 : 1;
  return 0;
}

/** Python `sorted()` order: code-point lexicographic. */
function sortedLabels(labels: Array<string | undefined>): string[] {
  return labels.filter((label): label is string => typeof label === "string").sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Order-independent deep equality for the cached signature comparison. */
function signaturesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => signaturesEqual(item, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((key) => signaturesEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

/**
 * Run one deterministic board check. Faithful port of the script's main():
 * sweep stale WIP, diff against the persisted board-state cache, rank
 * candidates, persist the new state. `exitCode` mirrors the CLI contract
 * (1 iff candidates were reported); callers render or consume
 * `rankedCandidates` directly.
 */
export async function runIssuesCheck(options: IssuesCheckOptions = {}): Promise<IssuesCheckOutcome> {
  const hostname = options.hostname ?? ISSUES_CHECK_DEFAULT_HOSTNAME;
  const repo = options.repo ?? ISSUES_CHECK_DEFAULT_REPO;
  const force = options.force ?? false;
  const all = options.all ?? false;
  const role = options.role ?? "orchestrator";
  const staleWipHours = options.staleWipHours ?? ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS;
  const sweepStaleWip = options.sweepStaleWip ?? true;
  const dryRun = options.dryRun ?? false;
  const io = options.io ?? createDefaultIssuesCheckIo();

  if (staleWipHours < 0) {
    throw new Error("--stale-wip-hours must be non-negative");
  }

  const fetched = await io.getOpenIssues(hostname, repo);
  if (!fetched.ok) {
    throw new IssuesCheckTransportError(fetched.error);
  }
  const issues = fetched.issues;
  if (issues.length === 0) {
    return { exitCode: 0, rankedCandidates: [], staleWipRecovery: [], savedState: {} };
  }

  const staleWipResults = sweepStaleWip
    ? await sweepStaleWipIssues(io, hostname, repo, issues, staleWipHours, {
        now: options.now,
        dryRun,
      })
    : [];

  const cache = await io.loadCache(repo);
  const newState: Record<string, IssueSignature> = {};
  const candidates: RankedCandidate[] = [];
  const { trusted: trustedLogins, nonHuman: nonHumanLogins } = boardIdentityConfig();

  for (const issue of issues) {
    const num = issue.number;
    // Direct `issue["title"]`/`l["name"]` indexing in the source cannot be
    // expressed as a crash in typed TS; missing values coerce, which only
    // differs on payloads the API never produces.
    const title = typeof issue.title === "string" ? issue.title : "";
    const updatedAt = issue.updated_at ?? "";
    const labels = labelNames(issue);
    const labelStrings = labels.filter((label): label is string => typeof label === "string");
    const labelsSet = new Set<string>(labelStrings);

    const issueSig: IssueSignature = {
      updated_at: updatedAt,
      labels: sortedLabels(labels),
      comments_count: issue.comments ?? 0,
    };
    newState[String(num)] = issueSig;

    const cachedSig = cache?.[String(num)];
    const isNew = cachedSig == null;
    const isChanged = force ? true : !signaturesEqual(cachedSig, issueSig);

    if (
      setIntersects(labelsSet, ["attention/ignore"]) &&
      !labelsSet.has("priority/sos")
    ) {
      continue;
    }

    // Universal human feedback precedence rule
    let isFeedback = false;
    let feedbackAuthor = "";
    let feedbackSnippet = "";
    if ((isChanged || force) && (issue.comments ?? 0) > 0) {
      const comments = await io.getLatestComments(hostname, repo, num, 2);
      if (comments.length > 0) {
        const lastComment = comments[comments.length - 1];
        const author = lastComment?.user?.login ?? "";
        const body = typeof lastComment?.body === "string" ? lastComment.body : "";
        if (trustedLogins.has(author) || (!body.includes("[x-agent]") && !body.includes("<sub>🤖") && !nonHumanLogins.has(author))) {
          // Verified human author
          isFeedback = true;
          feedbackAuthor = author;
          feedbackSnippet = body.slice(0, 100).replaceAll("\n", " ");
        }
      }
    }

    if (isFeedback) {
      const pTuple = calculatePriorityTuple(issue, true);
      const cl = classifyCandidate(issue, labelsSet, {
        isFeedback: true,
        feedbackInfo: { author: feedbackAuthor, snippet: feedbackSnippet },
      });
      candidates.push({
        number: num,
        title,
        labels: labelStrings,
        priority_tuple: pTuple,
        category: cl.category,
        is_dispatchable: cl.is_dispatchable,
        last_comment_by: feedbackAuthor,
        last_comment_snippet: feedbackSnippet,
        reason: cl.reason,
      });
      continue;
    }

    // Check brand new (first-seen) issue — highest priority for orchestrator triage
    if (isNew) {
      const pTuple = calculatePriorityTuple(issue, true);
      const cl = classifyCandidate(issue, labelsSet, { isNew: true });
      candidates.push({
        number: num,
        title,
        labels: labelStrings,
        priority_tuple: pTuple,
        is_new: true,
        category: cl.category,
        is_dispatchable: cl.is_dispatchable,
        reason: cl.reason,
      });
      continue;
    }

    if (isActionable(labelsSet, role)) {
      if (isChanged || all) {
        const pTuple = calculatePriorityTuple(issue);
        const cl = classifyCandidate(issue, labelsSet);
        candidates.push({
          number: num,
          title,
          labels: labelStrings,
          priority_tuple: pTuple,
          category: cl.category,
          is_dispatchable: cl.is_dispatchable,
          reason: cl.reason,
        });
      }
    }
  }

  await io.saveCache(newState, repo);

  if (candidates.length === 0) {
    return { exitCode: 0, rankedCandidates: [], staleWipRecovery: staleWipResults, savedState: newState };
  }

  // Sort candidates deterministically by priority tuple (stable, like Python).
  candidates.sort((a, b) => comparePriorityTuples(a.priority_tuple, b.priority_tuple));

  return {
    exitCode: 1,
    rankedCandidates: candidates,
    staleWipRecovery: staleWipResults,
    savedState: newState,
  };
}

// ---------------------------------------------------------------------------
// Renderers (port of the script's output stage)
// ---------------------------------------------------------------------------

/**
 * Python `json.dumps(..., indent=2)` byte-compatible JSON: `ensure_ascii`
 * escapes anything outside printable ASCII, including astral code points as
 * surrogate pairs.
 */
function ensureAsciiJson(json: string): string {
  let out = "";
  for (const ch of json) {
    const code = ch.codePointAt(0) as number;
    // JSON.stringify already escaped every in-string control character; the
    // only raw control byte left is the structural indent newline (0x0a).
    // Python's ensure_ascii escapes exactly what is outside 0x20-0x7e.
    if (code === 0x0a || (code >= 0x20 && code <= 0x7e)) {
      out += ch;
    } else if (code > 0xffff) {
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const low = ((code - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
    } else {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    }
  }
  return out;
}

/**
 * Render the `--json` report exactly as the Python script prints it (the
 * trailing newline of `print()` excluded). `timestamp` is wall-clock; the
 * Python original formats it with microseconds and a `+00:00` offset while
 * JS dates carry millisecond precision — a recorded, unconsumed difference.
 */
export function renderIssuesCheckJson(outcome: IssuesCheckOutcome, timestamp = new Date().toISOString()): string {
  const payload = {
    timestamp,
    stale_wip_recovery: outcome.staleWipRecovery,
    ranked_candidates: outcome.rankedCandidates,
  };
  return ensureAsciiJson(JSON.stringify(payload, null, 2));
}

/** Python `%g` formatting (default precision 6) for the stale-WIP hours. */
function formatPythonG(value: number): string {
  if (value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -4 || exponent >= 6) {
    const mantissa = value.toExponential(5).split("e");
    const digits = mantissa[0].replace(/\.?0+$/, "");
    const exp = Number(mantissa[1]);
    const sign = exp < 0 ? "-" : "+";
    return `${digits}e${sign}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  const decimals = Math.max(0, 5 - exponent);
  let out = value.toFixed(decimals);
  if (out.includes(".")) out = out.replace(/\.?0+$/, "");
  return out;
}

/**
 * Render the default markdown report exactly as the Python script prints it
 * (the trailing newline of `print()` excluded).
 */
export function renderIssuesCheckMarkdown(
  outcome: IssuesCheckOutcome,
  opts: { hostname: string; repo: string; role: IssuesCheckRole; staleWipHours: number; dryRun: boolean },
): string {
  const lines: string[] = [];
  const candidates = outcome.rankedCandidates;
  const issueLink = (c: RankedCandidate) => `[#${c.number}](https://${opts.hostname}/${opts.repo}/issues/${c.number})`;

  const sosIdx = new Set<number>();
  const userAttentionIdx = new Set<number>();
  candidates.forEach((c, i) => {
    if (c.category === "sos") sosIdx.add(i);
  });
  candidates.forEach((c, i) => {
    if (c.category === "user_attention" && !sosIdx.has(i)) userAttentionIdx.add(i);
  });
  const dispatchableIdx = new Set<number>();
  candidates.forEach((c, i) => {
    if (c.is_dispatchable && !sosIdx.has(i) && !userAttentionIdx.has(i)) dispatchableIdx.add(i);
  });
  const inGroup = (i: number) => sosIdx.has(i) || userAttentionIdx.has(i) || dispatchableIdx.has(i);
  const byCategory = (category: string) =>
    candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.category === category).map(({ i }) => i);
  const verificationIdx = byCategory("verification");
  const shapingIdx = byCategory("shaping");
  const gatedSpecIdx = byCategory("gated_spec");
  const verificationSet = new Set(verificationIdx);
  const shapingSet = new Set(shapingIdx);
  const gatedSpecSet = new Set(gatedSpecIdx);
  const othersIdx = candidates
    .map((_, i) => i)
    .filter(
      (i) => !inGroup(i) && !verificationSet.has(i) && !shapingSet.has(i) && !gatedSpecSet.has(i),
    );

  const printSection = (title: string, idxs: number[]) => {
    if (idxs.length === 0) return;
    lines.push("", `## ${title} (${idxs.length})`, "");
    for (const i of idxs) {
      const c = candidates[i];
      const [tier, urgency, effort, age] = c.priority_tuple;
      const labels = c.labels.length > 0 ? c.labels.join(", ") : "_(no labels)_";
      lines.push(`- ${issueLink(c)} — ${c.title}`);
      lines.push(`  - **Score:** tier ${tier} · urgency ${urgency} · effort ${effort} · created ${age.slice(0, 10)}`);
      lines.push(`  - **Labels:** ${labels}`);
      lines.push(`  - **Action:** ${c.reason}`);
    }
  };

  lines.push("# Forgejo Deterministic Board Ranking");
  lines.push("", `**${candidates.length} actionable** · role \`${opts.role}\` · repo \`${opts.repo}\``);
  if (outcome.staleWipRecovery.length > 0) {
    const recovered = outcome.staleWipRecovery.filter((result) => result.recovered).length;
    const mode = opts.dryRun ? "would recover" : "recovered";
    lines.push(
      "",
      `**Stale WIP:** ${mode} ${recovered}/${outcome.staleWipRecovery.length} issue(s) after ${formatPythonG(opts.staleWipHours)}h`,
    );
  }

  printSection("CRITICAL SOS (PREEMPT ALL WORK)", [...sosIdx]);
  printSection("USER ATTENTION REQUIRED (AWAITING OPERATOR INPUT)", [...userAttentionIdx]);
  printSection("DISPATCHABLE TASKS - AUTONOMOUS EXECUTION (NO APPROVAL NEEDED)", [...dispatchableIdx]);
  printSection("DELIVERABLE VERIFICATION - READY FOR PRE-FLIGHT AUDIT", verificationIdx);
  printSection("PRE-CODE SHAPING - ORCHESTRATOR SPECIFICATION REQUIRED", shapingIdx);
  printSection("HOLDING FOR OPERATOR APPROVAL (SPEC CHECKLIST)", gatedSpecIdx);
  printSection("ORCHESTRATOR REASONING & TRIAGE", othersIdx);

  lines.push("", "---", "");
  lines.push("Dispatchable items can be executed immediately. Orchestrator reasons about the rest.");
  return `${lines.join("\n")}\n`;
}

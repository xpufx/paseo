import type {
  UppidiIssue,
  HookQueueItem,
  UppidiAgent,
  UppidiRunner,
  CandidateModelMetrics,
  TaskProfileMetrics,
} from "./contracts.js";

// --- Issues & PRs ---

export type IssuePreset =
  | "all"
  | "needs-attention"
  | "triage-review"
  | "in-progress"
  | "verify";

export type IssueSortField =
  | "number"
  | "title"
  | "status"
  | "comments"
  | "repo";

export type SortDirection = "asc" | "desc";

export function filterIssues(
  issues: UppidiIssue[],
  preset: IssuePreset,
  query: string
): UppidiIssue[] {
  const normalizedQuery = query.trim().toLowerCase();
  return issues.filter((issue) => {
    let matchesPreset = true;
    switch (preset) {
      case "needs-attention":
        matchesPreset =
          issue.attention.startsWith("attention/0-") ||
          issue.attention.startsWith("attention/1-") ||
          issue.attention.startsWith("attention/2-");
        break;
      case "triage-review":
        matchesPreset =
          issue.status === "Review" ||
          issue.labels.some((l) => l.includes("state/0-triage") || l.includes("state/2-review"));
        break;
      case "in-progress":
        matchesPreset =
          (issue.status === "In progress" && !issue.labels.some((l) => l.includes("state/3-verify") || l.includes("state/4-done"))) ||
          issue.labels.some((l) => l.includes("state/1-wip"));
        break;
      case "verify":
        matchesPreset =
          issue.labels.some((l) => l.includes("state/3-verify"));
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      String(issue.number),
      issue.title,
      issue.repo,
      issue.branch ?? "",
      issue.labels.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortIssues(
  issues: UppidiIssue[],
  field: IssueSortField,
  direction: SortDirection
): UppidiIssue[] {
  const sorted = [...issues];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "number":
        return (a.number - b.number) * mul;
      case "title":
        return a.title.localeCompare(b.title) * mul;
      case "status":
        return a.status.localeCompare(b.status) * mul;
      case "comments":
        return (a.comments - b.comments) * mul;
      case "repo":
        return a.repo.localeCompare(b.repo) * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Hook Queues ---

export type QueuePreset = "all" | "pending-processing" | "dead-failed";

export type QueueSortField = "repo" | "depth" | "status";

export function filterQueues(
  queues: HookQueueItem[],
  preset: QueuePreset,
  query: string
): HookQueueItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return queues.filter((q) => {
    let matchesPreset = true;
    switch (preset) {
      case "pending-processing":
        matchesPreset = q.depth > 0 || q.isBusy;
        break;
      case "dead-failed":
        matchesPreset = q.paused;
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      q.key,
      q.orchestrator?.agentId ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortQueues(
  queues: HookQueueItem[],
  field: QueueSortField,
  direction: SortDirection
): HookQueueItem[] {
  const sorted = [...queues];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "repo":
        return a.key.localeCompare(b.key) * mul;
      case "depth":
        return (a.depth - b.depth) * mul;
      case "status": {
        const statusA = a.paused ? "paused" : a.isBusy ? "busy" : "ready";
        const statusB = b.paused ? "paused" : b.isBusy ? "busy" : "ready";
        return statusA.localeCompare(statusB) * mul;
      }
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Fleet & Agents ---

export type AgentPreset = "all" | "active" | "idle" | "blocked";

export type AgentSortField = "name" | "status" | "category" | "provider";

export function filterAgents(
  agents: UppidiAgent[],
  preset: AgentPreset,
  query: string
): UppidiAgent[] {
  const normalizedQuery = query.trim().toLowerCase();
  return agents.filter((a) => {
    let matchesPreset = true;
    switch (preset) {
      case "blocked":
        matchesPreset =
          a.status === "error" ||
          a.deterministicState === "failed:error" ||
          a.deterministicState === "failed:quota-exhausted" ||
          a.deterministicState === "failed:spawn" ||
          a.deterministicState === "failed:timeout";
        break;
      case "active":
        matchesPreset =
          a.deterministicState === "working" ||
          a.deterministicState === "running" ||
          (a.status === "running" && a.deterministicState !== "sleeping" && a.deterministicState !== "idle:waiting");
        break;
      case "idle":
        matchesPreset =
          a.status === "idle" ||
          a.deterministicState === "idle:waiting" ||
          a.deterministicState === "sleeping" ||
          a.deterministicState === "idle:quota-exhausted";
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      a.id,
      a.shortId,
      a.name,
      a.category,
      a.provider ?? "",
      a.model ?? "",
      a.cwd ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortAgents(
  agents: UppidiAgent[],
  field: AgentSortField,
  direction: SortDirection
): UppidiAgent[] {
  const sorted = [...agents];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "name":
        return a.name.localeCompare(b.name) * mul;
      case "status":
        return a.status.localeCompare(b.status) * mul;
      case "category":
        return a.category.localeCompare(b.category) * mul;
      case "provider":
        return (a.provider ?? "").localeCompare(b.provider ?? "") * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

// --- CI Runners ---

export type RunnerPreset = "all" | "online" | "offline";

export type RunnerSortField = "name" | "status" | "lastSeen";

export function filterRunners(
  runners: UppidiRunner[],
  preset: RunnerPreset,
  query: string
): UppidiRunner[] {
  const normalizedQuery = query.trim().toLowerCase();
  return runners.filter((r) => {
    let matchesPreset = true;
    switch (preset) {
      case "online":
        matchesPreset = r.status === "online";
        break;
      case "offline":
        matchesPreset = r.status === "offline";
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      r.id,
      r.name,
      r.labels.join(" "),
      r.lastJob ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortRunners(
  runners: UppidiRunner[],
  field: RunnerSortField,
  direction: SortDirection
): UppidiRunner[] {
  const sorted = [...runners];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "name":
        return a.name.localeCompare(b.name) * mul;
      case "status":
        return a.status.localeCompare(b.status) * mul;
      case "lastSeen":
        return (a.lastSeen ?? "").localeCompare(b.lastSeen ?? "") * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Benchmark Candidate Models Matrix ---

export type MetricPreset =
  | "all"
  | "high-pass"
  | "bugfix-suitable"
  | "liaison-suitable";

export type MetricSortField =
  | "passRate"
  | "latency"
  | "trials"
  | "model";

export function filterMetricCandidates(
  candidates: CandidateModelMetrics[],
  preset: MetricPreset,
  query: string
): CandidateModelMetrics[] {
  const normalizedQuery = query.trim().toLowerCase();
  return candidates.filter((c) => {
    let matchesPreset = true;
    switch (preset) {
      case "high-pass":
        matchesPreset = c.overallPassRate >= 85;
        break;
      case "bugfix-suitable":
        matchesPreset =
          c.recommendedRoles.includes("Worker/Coder") ||
          c.recommendedRoles.includes("Code") ||
          c.profiles.some((p: TaskProfileMetrics) => p.taskProfile === "code-modification" && p.passRate >= 80);
        break;
      case "liaison-suitable":
        matchesPreset =
          c.recommendedRoles.includes("Front Desk") ||
          c.recommendedRoles.includes("Liaison") ||
          c.profiles.some((p: TaskProfileMetrics) => p.taskProfile === "chat-conversation" && p.passRate >= 85);
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      c.model,
      c.recommendedRoles.join(" "),
      c.profiles.map((p: TaskProfileMetrics) => `${p.taskProfile} ${p.advisory}`).join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortMetricCandidates(
  candidates: CandidateModelMetrics[],
  field: MetricSortField,
  direction: SortDirection
): CandidateModelMetrics[] {
  const sorted = [...candidates];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "passRate":
        return (a.overallPassRate - b.overallPassRate) * mul;
      case "latency":
        return (a.medianWallMs - b.medianWallMs) * mul;
      case "trials":
        return (a.totalTrials - b.totalTrials) * mul;
      case "model":
        return a.model.localeCompare(b.model) * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

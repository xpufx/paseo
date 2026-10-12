import type {
  FleetAgent,
  HookQueueItem,
} from "./types.js";

export type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// 1. Repo Matching Helpers
// ---------------------------------------------------------------------------

export function isRepoMatching(targetRepo: string, candidateRepo: string): boolean {
  if (!targetRepo || !candidateRepo) return false;
  const t = targetRepo.trim().toLowerCase().replace(/\.git$/, "");
  const c = candidateRepo.trim().toLowerCase().replace(/\.git$/, "");
  if (t === c) return true;

  const tParts = t.split("/").filter(Boolean);
  const cParts = c.split("/").filter(Boolean);

  if (tParts.length >= 2 && cParts.length >= 2) {
    const tTail = `${tParts[tParts.length - 2]}/${tParts[tParts.length - 1]}`;
    const cTail = `${cParts[cParts.length - 2]}/${cParts[cParts.length - 1]}`;
    if (tTail === cTail) return true;
  }

  const tBase = tParts[tParts.length - 1];
  const cBase = cParts[cParts.length - 1];
  return Boolean(tBase && cBase && tBase === cBase);
}

export const repoMatches = isRepoMatching;

// ---------------------------------------------------------------------------
// 2. Bulk Archive Eligibility
// ---------------------------------------------------------------------------

export function isAgentEligibleForBulkArchive(agent?: FleetAgent | null): boolean {
  if (!agent) return false;
  const category = (agent.category || "").toLowerCase();
  if (category === "front-desk" || category === "orchestrator") {
    return false;
  }
  const status = (agent.status || "").toLowerCase();
  const det = (agent.deterministicState || "").toLowerCase();
  if (status === "running" || det === "working" || det === "running") {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3. Agent Filtering & Sorting
// ---------------------------------------------------------------------------

export type AgentPreset = "all" | "active" | "idle" | "blocked";
export type AgentSortField = "name" | "status" | "category" | "provider";

export function filterAgents(
  agents: FleetAgent[],
  preset: AgentPreset,
  query: string,
): FleetAgent[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(agents) ? agents : []).filter((a) => {
    if (!a) return false;
    let matchesPreset = true;
    switch (preset) {
      case "blocked":
        matchesPreset =
          a.status === "error" ||
          a.deterministicState === "permission-prompt" ||
          a.deterministicState === "attention-required" ||
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
      a.worktree ?? "",
      a.project ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortAgents(
  agents: FleetAgent[],
  field: AgentSortField,
  direction: SortDirection,
): FleetAgent[] {
  const sorted = [...(Array.isArray(agents) ? agents : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "name":
        return String(a.name ?? "").localeCompare(String(b.name ?? "")) * mul;
      case "status": {
        const statusA = `${a.status ?? ""}:${a.deterministicState ?? ""}`;
        const statusB = `${b.status ?? ""}:${b.deterministicState ?? ""}`;
        return statusA.localeCompare(statusB) * mul;
      }
      case "category":
        return String(a.category ?? "").localeCompare(String(b.category ?? "")) * mul;
      case "provider": {
        const provA = `${a.provider ?? ""}/${a.model ?? ""}`;
        const provB = `${b.provider ?? ""}/${b.model ?? ""}`;
        return provA.localeCompare(provB) * mul;
      }
      default:
        return 0;
    }
  });

  return sorted;
}

// ---------------------------------------------------------------------------
// 4. Hook Queue Filtering & Sorting
// ---------------------------------------------------------------------------

export type QueuePreset = "all" | "pending-processing" | "dead-failed";
export type QueueSortField = "repo" | "depth" | "status";

export function filterQueues(
  queues: HookQueueItem[],
  preset: QueuePreset,
  query: string,
): HookQueueItem[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(queues) ? queues : []).filter((q) => {
    if (!q) return false;
    let matchesPreset = true;
    switch (preset) {
      case "pending-processing":
        matchesPreset = (q.depth ?? 0) > 0 || q.isBusy;
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
  direction: SortDirection,
): HookQueueItem[] {
  const sorted = [...(Array.isArray(queues) ? queues : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "repo":
        return String(a.key ?? "").localeCompare(String(b.key ?? "")) * mul;
      case "depth":
        return ((a.depth ?? 0) - (b.depth ?? 0)) * mul;
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

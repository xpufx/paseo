import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type ForgeActionRunsInput,
  type ForgeActionRunsOutput,
  type ForgeActionRun,
  ForgeActionRunStatusSchema,
  ForgeActionRunConclusionSchema,
  ForgeActionRunEventSchema,
} from "../shared/contracts.js";
import { forgejoApiGet, forgejoToken, resolveForgejoHost } from "./forgejo-api.js";
import { getActiveHookRouter, getFleetRosterInfo } from "./hook-router.js";

/**
 * Parse a raw Forgejo action-run JSON object into our typed shape.
 * Forgejo returns fields with camelCase names; we normalise to the contract schema.
 */
function parseForgejoRun(raw: Record<string, unknown>, repoKey: string): ForgeActionRun {
  const user = (raw.user ?? {}) as Record<string, unknown>;
  const headCommit = (raw.head_commit ?? {}) as Record<string, unknown>;
  const runStartedAt = raw.run_started_at ?? null;
  const completedAt = raw.completed_at ?? null;

  // Resolve branch from ref: strip "refs/heads/" prefix.
  const ref = String(raw.ref ?? "");
  const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : ref || null;

  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ""),
    html_url: String(raw.html_url ?? ""),
    status: ForgeActionRunStatusSchema.parse(String(raw.status ?? "completed")),
    conclusion: raw.conclusion
      ? (ForgeActionRunConclusionSchema.parse(String(raw.conclusion)) as ForgeActionRun["conclusion"])
      : null,
    workflow_id: String(raw.workflow_id ?? ""),
    ref,
    branch,
    event: ForgeActionRunEventSchema.parse(String(raw.event ?? "push")),
    head_commit: {
      message: String(headCommit.message ?? ""),
      sha: String(headCommit.sha ?? ""),
    },
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    run_started_at: runStartedAt ? String(runStartedAt) : null,
    completed_at: completedAt ? String(completedAt) : null,
    user: {
      login: String(user.login ?? ""),
      avatar_url: user.avatar_url ? String(user.avatar_url) : null,
    },
    repo: repoKey,
    repo_url: `https://${resolveForgejoHost()}/${repoKey}`,
  };
}

/**
 * Fetch action runs for a single repository.
 */
async function fetchRepoActionRuns(
  repoKey: string,
  limit: number,
): Promise<{ runs: ForgeActionRun[]; error?: string }> {
  const host = resolveForgejoHost();
  const token = await forgejoToken(host);
  if (!token) {
    return { runs: [], error: "Forgejo token missing or invalid" };
  }

  const res = await forgejoApiGet<Record<string, unknown>[]>(
    `/api/v1/repos/${repoKey}/actions/runs?limit=${limit}`,
    { host, token },
  );

  if (res.outcome !== "ok") {
    return { runs: [], error: res.error };
  }

  const rawList = Array.isArray(res.data) ? res.data : [];
  const runs = rawList.map((r) => parseForgejoRun(r, repoKey));
  return { runs };
}

/**
 * Get enrolled repo keys from the hook router config for "all" mode queries.
 */
function getEnrolledRepoKeys(): string[] {
  const roster = getFleetRosterInfo();
  return Array.isArray(roster.enrolledRepos) ? roster.enrolledRepos : [];
}

export async function handleForgeActionRuns(
  input: ForgeActionRunsInput,
  _context?: PluginHandlerContext,
): Promise<ForgeActionRunsOutput> {
  const limit = Math.min(input.limit ?? 50, 100);

  // Single-repository mode: direct query.
  if (input.repo) {
    const result = await fetchRepoActionRuns(input.repo, limit);
    let runs = result.runs;

    // Apply status filter client-side.
    if (input.status !== "all") {
      runs = filterByStatus(runs, input.status);
    }

    // Sort newest first.
    runs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { ok: true, runs };
  }

  // All-enrolled-repos mode: parallel fetch with error resilience.
  const enrolledRepoKeys = getEnrolledRepoKeys();
  if (enrolledRepoKeys.length === 0) {
    return { ok: true, runs: [] };
  }

  const results = await Promise.allSettled(
    enrolledRepoKeys.map((repoKey) => fetchRepoActionRuns(repoKey, limit)),
  );

  const allRuns: ForgeActionRun[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allRuns.push(...result.value.runs);
    }
    // Settled but rejected → silently skip (resilient aggregation).
  }

  // Apply status filter.
  if (input.status !== "all") {
    const filtered = filterByStatus(allRuns, input.status);
    // Re-sort after filtering.
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { ok: true, runs: filtered };
  }

  // Sort newest first across all repos.
  allRuns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { ok: true, runs: allRuns };
}

/**
 * Client-side status filter matching the quick-filter chips.
 */
export function filterByStatus(
  runs: ForgeActionRun[],
  status: "running" | "failed" | "succeeded",
): ForgeActionRun[] {
  switch (status) {
    case "running":
      return runs.filter((r) => r.status === "in_progress");
    case "failed":
      return runs.filter((r) => r.conclusion === "failure");
    case "succeeded":
      return runs.filter((r) => r.conclusion === "success");
    default:
      return runs;
  }
}

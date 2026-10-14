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
 * Map a Forgejo terminal-status value to our canonical status/conclusion pair.
 *
 * Forgejo encodes conclusion into `rawStatus` — e.g. `"success"` means the run
 * is completed and succeeded. We translate those into the contract's dual
 * fields.
 */
function mapForgejoStatus(
  rawStatus: string | undefined,
): { status: ForgeActionRun["status"]; conclusion: ForgeActionRun["conclusion"] } {
  switch (rawStatus) {
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failure":
      return { status: "completed", conclusion: "failure" };
    case "cancelled":
      return { status: "completed", conclusion: "cancelled" };
    case "in_progress":
      return { status: "in_progress", conclusion: null };
    case "waiting":
      return { status: "waiting", conclusion: null };
    default:
      return {
        status: ForgeActionRunStatusSchema.parse(String(rawStatus ?? "completed")),
        conclusion: null,
      };
  }
}

/**
 * Parse a raw Forgejo action-run JSON object into our typed shape strictly adhering
 * to Forgejo's OpenAPI schema (#1176).
 */
function parseForgejoRun(raw: Record<string, unknown>, repoKey: string): ForgeActionRun {
  const rawUser = (raw.trigger_user ?? {}) as Record<string, unknown>;
  const commitSha = String(raw.commit_sha ?? "");
  const commitMessage = String(raw.title ?? "");

  const createdAt = String(raw.created ?? "");
  const updatedAt = String(raw.updated ?? "");
  const startedAt = raw.started ?? null;
  const stoppedAt = raw.stopped ?? null;

  const mapped = mapForgejoStatus(raw.status as string | undefined);

  // Resolve branch from prettyref, falling back to stripping "refs/heads/" from ref.
  const ref = String(raw.ref ?? "");
  const branch = raw.prettyref
    ? String(raw.prettyref)
    : ref.startsWith("refs/heads/")
      ? ref.slice(11)
      : ref || null;

  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ""),
    html_url: String(raw.html_url ?? ""),
    ...mapped,
    workflow_id: String(raw.workflow_id ?? ""),
    ref,
    branch,
    event: ForgeActionRunEventSchema.parse(String(raw.event ?? "push")),
    head_commit: {
      message: commitMessage,
      sha: commitSha,
    },
    created_at: createdAt,
    updated_at: updatedAt,
    run_started_at: startedAt ? String(startedAt) : null,
    completed_at: stoppedAt ? String(stoppedAt) : null,
    user: {
      login: String(rawUser.login ?? ""),
      avatar_url: rawUser.avatar_url ? String(rawUser.avatar_url) : null,
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

  const res = await forgejoApiGet<Record<string, unknown>>(
    `/api/v1/repos/${repoKey}/actions/runs?limit=${limit}`,
    { host, token },
  );

  if (res.outcome !== "ok") {
    return { runs: [], error: res.error };
  }

  // Forgejo returns { total_count: number, workflow_runs: [...] } envelope.
  const rawData = res.data as { total_count?: number; workflow_runs?: unknown[] } | undefined;
  const rawList = Array.isArray(rawData?.workflow_runs) ? rawData.workflow_runs : [];
  const runs = rawList.map((r: any) => parseForgejoRun(r as Record<string, unknown>, repoKey));
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

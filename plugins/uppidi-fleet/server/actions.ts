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
 * Forgejo collapses the GitHub-style two-field model (status + conclusion) into
 * a single `status` that carries both meanings — e.g. `"success"` means the run
 * is completed *and* succeeded.  We translate those into the contract's dual
 * fields so callers never see a mismatch.
 *
 * When `rawConclusion` is explicitly set it overrides the inferred conclusion
 * from `rawStatus` (this preserves backward compatibility with payloads that
 * carry both fields, such as older test fixtures).
 */
function mapForgejoStatus(
  rawStatus: string | undefined,
  rawConclusion?: string | null,
): { status: ForgeActionRun["status"]; conclusion: ForgeActionRun["conclusion"] } {
  /** Resolve a non-null conclusion string into the typed union, or null. */
  const parseConclusion = (val: string | null | undefined): ForgeActionRun["conclusion"] => {
    if (!val || val === "null") return null;
    return ForgeActionRunConclusionSchema.parse(val) as ForgeActionRun["conclusion"];
  };

  switch (rawStatus) {
    case "success":
      return { status: "completed", conclusion: parseConclusion(rawConclusion) ?? "success" };
    case "failure":
      return { status: "completed", conclusion: parseConclusion(rawConclusion) ?? "failure" };
    case "cancelled":
      return { status: "completed", conclusion: parseConclusion(rawConclusion) ?? "cancelled" };
    case "in_progress":
      return { status: "in_progress", conclusion: parseConclusion(rawConclusion) };
    case "waiting":
      return { status: "waiting", conclusion: parseConclusion(rawConclusion) };
    default:
      // Legacy / unknown status — honour an explicit conclusion if present.
      return {
        status: ForgeActionRunStatusSchema.parse(String(rawStatus ?? "completed")),
        conclusion: parseConclusion(rawConclusion),
      };
  }
}

/**
 * Parse a raw Forgejo action-run JSON object into our typed shape.
 * Forgejo returns fields with camelCase names; we normalise to the contract
 * schema.  Every field access is defensive because Forgejo's `WorkflowRun`
 * payload differs from GitHub's in several places (#1176).
 */
function parseForgejoRun(raw: Record<string, unknown>, repoKey: string): ForgeActionRun {
  // User: prefer trigger_user (the actor who triggered the run), fall back to user.
  const rawUser = (raw.trigger_user ?? raw.user ?? {}) as Record<string, unknown>;
  // Commit SHA: prefer top-level commit_sha, fall back to head_commit.sha.
  const rawHeadCommit = (raw.head_commit ?? {}) as Record<string, unknown>;
  const commitSha = String(raw.commit_sha ?? (rawHeadCommit.sha ?? ""));
  const commitMessage = String(raw.title ?? rawHeadCommit.message ?? "");

  // Timestamps: Forgejo may use short aliases alongside the full ISO names.
  const createdAt = String(raw.created ?? raw.created_at ?? "");
  const updatedAt = String(raw.updated ?? raw.updated_at ?? "");
  const startedAt = raw.started ?? raw.run_started_at ?? null;
  const stoppedAt = raw.stopped ?? raw.completed_at ?? null;

  // Status/conclusion: Forgejo uses a single `status` field that encodes both,
  // but honour an explicit `conclusion` for backward compat with payloads
  // carrying both fields (e.g. older test fixtures).
  const mapped = mapForgejoStatus(
    raw.status as string | undefined,
    raw.conclusion as string | null | undefined,
  );

  // Resolve branch from ref: strip "refs/heads/" prefix.
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

  // Forgejo returns { total_count, workflow_runs: [...] } — extract the array.
  const rawList = Array.isArray(res.data)
    ? res.data
    : Array.isArray((res.data as any)?.workflow_runs)
      ? (res.data as any).workflow_runs
      : [];
  const runs = rawList.map((r: Record<string, unknown>) => parseForgejoRun(r, repoKey));
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

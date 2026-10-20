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
 * Normalise a repository key or URL to a clean "owner/repo" slug.
 * Strips URL schemes, ports, scp-style git remotes, and hostnames.
 */
export function normalizeRepoSlug(repoKey: string): string {
  if (!repoKey || typeof repoKey !== "string") return "";
  let s = repoKey.trim();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^git@([^:]+):/, "$1/");
  s = s.replace(/^ssh:\/\/git@/, "");
  s = s.replace(/:\d+\//, "/");
  s = s.replace(/\.git$/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":"))) {
    return parts.slice(1).join("/");
  }
  return parts.join("/");
}

/**
 * Map a Forgejo terminal-status value to our canonical status/conclusion pair.
 *
 * Forgejo encodes conclusion into `rawStatus` — e.g. `"success"` means the run
 * is completed and succeeded. We translate those into the contract's dual
 * fields.
 */
export function mapForgejoStatus(
  rawStatus: string | undefined,
): { status: ForgeActionRun["status"]; conclusion: ForgeActionRun["conclusion"] } {
  switch (rawStatus) {
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failure":
      return { status: "completed", conclusion: "failure" };
    case "cancelled":
      return { status: "completed", conclusion: "cancelled" };
    case "running":
    case "in_progress":
      return { status: "in_progress", conclusion: null };
    case "blocked":
    case "waiting":
      return { status: "waiting", conclusion: null };
    case "skipped":
      return { status: "completed", conclusion: "skipped" };
    default: {
      const parsed = ForgeActionRunStatusSchema.safeParse(rawStatus);
      return {
        status: parsed.success ? parsed.data : "completed",
        conclusion: null,
      };
    }
  }
}

/**
 * Parse a raw Forgejo action-run JSON object into our typed shape strictly adhering
 * to Forgejo's OpenAPI schema (#1176).
 */
export function parseForgejoRun(raw: Record<string, unknown>, repoKey: string): ForgeActionRun {
  const cleanRepo = normalizeRepoSlug(repoKey) || repoKey;
  const host = resolveForgejoHost();
  try {
    const rawUser = (raw && typeof raw === "object" && raw.trigger_user && typeof raw.trigger_user === "object"
      ? raw.trigger_user
      : {}) as Record<string, unknown>;
    const commitSha = String(raw?.commit_sha ?? "");
    const commitMessage = String(raw?.title ?? "");

    const createdAt = String(raw?.created ?? "");
    const updatedAt = String(raw?.updated ?? "");
    const startedAt = raw?.started ?? null;
    const stoppedAt = raw?.stopped ?? null;

    const mapped = mapForgejoStatus(raw?.status as string | undefined);

    // Resolve branch from prettyref, falling back to stripping "refs/heads/" from ref.
    const ref = String(raw?.ref ?? "");
    const branch = raw?.prettyref
      ? String(raw?.prettyref)
      : ref.startsWith("refs/heads/")
        ? ref.slice(11)
        : ref || null;

    const parsedEvent = ForgeActionRunEventSchema.safeParse(String(raw?.event ?? "push"));
    const event = parsedEvent.success ? parsedEvent.data : "push";

    return {
      id: Number(raw?.id ?? 0),
      name: String(raw?.name ?? ""),
      html_url: String(raw?.html_url ?? ""),
      ...mapped,
      workflow_id: String(raw?.workflow_id ?? ""),
      ref,
      branch,
      event,
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
      repo: cleanRepo,
      repo_url: `https://${host}/${cleanRepo}`,
    };
  } catch {
    return {
      id: Number(raw?.id ?? 0),
      name: String(raw?.name ?? ""),
      html_url: String(raw?.html_url ?? ""),
      status: "completed",
      conclusion: null,
      workflow_id: "",
      ref: "",
      branch: null,
      event: "push",
      head_commit: { message: "", sha: "" },
      created_at: "",
      updated_at: "",
      run_started_at: null,
      completed_at: null,
      user: { login: "", avatar_url: null },
      repo: cleanRepo,
      repo_url: `https://${host}/${cleanRepo}`,
    };
  }
}

/**
 * Fetch action runs for a single repository.
 */
async function fetchRepoActionRuns(
  repoKey: string,
  limit: number,
  page: number = 1,
): Promise<{ runs: ForgeActionRun[]; total_count?: number; error?: string }> {
  const host = resolveForgejoHost();
  const token = await forgejoToken(host);
  if (!token) {
    return { runs: [], error: "Forgejo token missing or invalid" };
  }

  const slug = normalizeRepoSlug(repoKey);
  if (!slug) {
    return { runs: [], error: `Invalid repository key: ${repoKey}` };
  }

  const res = await forgejoApiGet<Record<string, unknown>>(
    `/api/v1/repos/${slug}/actions/runs?page=${page}&limit=${limit}`,
    { host, token },
  );

  if (res.outcome !== "ok") {
    return { runs: [], error: res.error };
  }

  // Forgejo returns { total_count: number, workflow_runs: [...] } envelope.
  const rawData = res.data as { total_count?: number; workflow_runs?: unknown[] } | undefined;
  const rawList = Array.isArray(rawData?.workflow_runs) ? rawData.workflow_runs : [];
  const totalCount = typeof rawData?.total_count === "number" ? rawData.total_count : undefined;
  const runs: ForgeActionRun[] = [];
  for (const r of rawList) {
    try {
      if (r && typeof r === "object") {
        runs.push(parseForgejoRun(r as Record<string, unknown>, slug));
      }
    } catch {
      // Unhandled error in an entry must never drop the entire list of runs
    }
  }
  return { runs, total_count: totalCount };
}

/**
 * Get enrolled repo keys from the hook router config for "all" mode queries.
 */
function getEnrolledRepoKeys(): string[] {
  const roster = getFleetRosterInfo();
  return Array.isArray(roster.enrolledRepos) ? roster.enrolledRepos : [];
}

export async function handleForgeActionRuns(
  input: Partial<ForgeActionRunsInput>,
  _context?: PluginHandlerContext,
): Promise<ForgeActionRunsOutput> {
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
  const status = input.status ?? "all";

  // Single-repository mode: direct query.
  if (input.repo) {
    const result = await fetchRepoActionRuns(input.repo, limit, page);
    let runs = result.runs;

    // Apply status filter client-side.
    if (status !== "all") {
      runs = filterByStatus(runs, status);
    }

    // Sort newest first.
    runs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const totalCount = result.total_count;
    const hasMore = totalCount !== undefined ? page * limit < totalCount : runs.length >= limit;

    return {
      ok: true,
      runs,
      page,
      limit,
      totalCount,
      hasMore,
      error: result.error,
    };
  }

  // All-enrolled-repos mode: parallel fetch with error resilience.
  const enrolledRepoKeys = getEnrolledRepoKeys();
  if (enrolledRepoKeys.length === 0) {
    return { ok: true, runs: [], page, limit, totalCount: 0, hasMore: false };
  }

  // Query up to limit * page runs from each enrolled repo (capped at 100) so we can
  // aggregate and sort chronologically before slicing for the current page.
  const fetchLimit = Math.min(Math.max(limit * page, 10), 100);
  const results = await Promise.allSettled(
    enrolledRepoKeys.map((repoKey) => fetchRepoActionRuns(repoKey, fetchLimit, 1)),
  );

  const allRuns: ForgeActionRun[] = [];
  let totalCount = 0;
  let hasValidTotalCount = false;

  for (const result of results) {
    if (result.status === "fulfilled") {
      allRuns.push(...result.value.runs);
      if (typeof result.value.total_count === "number") {
        totalCount += result.value.total_count;
        hasValidTotalCount = true;
      }
    }
    // Settled but rejected → silently skip (resilient aggregation).
  }

  let filteredRuns = allRuns;
  if (status !== "all") {
    filteredRuns = filterByStatus(allRuns, status);
  }

  // Sort newest first across all repos.
  filteredRuns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const startIndex = (page - 1) * limit;
  const pagedRuns = filteredRuns.slice(startIndex, startIndex + limit);

  const finalTotalCount = hasValidTotalCount ? totalCount : filteredRuns.length;
  const hasMore = hasValidTotalCount
    ? page * limit < totalCount
    : startIndex + limit < filteredRuns.length;

  return {
    ok: true,
    runs: pagedRuns,
    page,
    limit,
    totalCount: finalTotalCount,
    hasMore,
  };
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

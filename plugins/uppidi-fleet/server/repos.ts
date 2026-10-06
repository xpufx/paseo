import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type UppidiReposInput,
  type UppidiReposOutput,
  type UppidiRepo,
  type UppidiEnrollRepoInput,
  type UppidiEnrollRepoOutput,
  type UppidiUnenrollRepoInput,
  type UppidiUnenrollRepoOutput,
} from "../shared/contracts.js";
import { forgejoApiGet, forgejoToken, resolveForgejoHost } from "./forgejo-api.js";
import {
  canonicalRepoKey,
  getActiveHookRouter,
  getFleetRosterInfo,
  loadRouterConfig,
  saveRouterConfig,
} from "./hook-router.js";
import { isRepoMatching } from "../shared/sort-filter.js";

interface RawForgejoRepo {
  name: string;
  full_name: string;
  owner?: {
    login: string;
    username?: string;
  };
  html_url?: string;
  private?: boolean;
}

export async function handleUppidiRepos(
  input: UppidiReposInput,
  _context?: PluginHandlerContext,
): Promise<UppidiReposOutput> {
  const host = resolveForgejoHost();
  const token = await forgejoToken(host);

  let searchPath = "/api/v1/repos/search?limit=50";
  if (input?.query?.trim()) {
    searchPath += `&q=${encodeURIComponent(input.query.trim())}`;
  }

  let res = await forgejoApiGet<{ data: RawForgejoRepo[] } | RawForgejoRepo[]>(searchPath, { host, token });

  // If search endpoint failed with 404 or unexpected error, fall back to /api/v1/user/repos
  if (res.outcome !== "ok" && res.outcome === "http-error" && res.httpStatus === 404) {
    res = await forgejoApiGet<RawForgejoRepo[]>("/api/v1/user/repos?limit=50", { host, token });
  }

  if (res.outcome !== "ok") {
    let errorMsg = res.error;
    if (res.outcome === "http-error" && res.httpStatus === 401) {
      errorMsg = "Forgejo token missing or invalid";
    }
    return {
      ok: false,
      repos: [],
      error: errorMsg,
    };
  }

  let rawList: RawForgejoRepo[] = [];
  if (Array.isArray(res.data)) {
    rawList = res.data;
  } else if (res.data && Array.isArray((res.data as any).data)) {
    rawList = (res.data as any).data;
  }

  const roster = getFleetRosterInfo();
  const router = getActiveHookRouter();

  const repos: UppidiRepo[] = rawList.map((raw) => {
    const ownerName = raw.owner?.login || raw.owner?.username || raw.full_name?.split("/")[0] || "";
    const repoName = raw.name || raw.full_name?.split("/")[1] || "";
    const fullName = raw.full_name || (ownerName && repoName ? `${ownerName}/${repoName}` : repoName);
    const key = canonicalRepoKey(fullName) || `${host}/${fullName}`;
    const url = raw.html_url || `https://${host}/${fullName}`;
    const isPrivate = Boolean(raw.private);

    const isEnrolled = roster.enrolledRepos.some((r) => isRepoMatching(r, key));
    const isPaused = roster.pausedRepos.some((m) => isRepoMatching(m, key));

    let queueDepth = 0;
    for (const [qKey, depth] of Object.entries(roster.repoQueuedHooks)) {
      if (isRepoMatching(qKey, key)) {
        queueDepth += depth;
      }
    }

    let hasOrchestrator = false;
    if (router) {
      const orchRecord = router.readOrchestrator(key);
      hasOrchestrator = Boolean(orchRecord?.agentId);
    }

    return {
      key,
      name: repoName,
      fullName,
      owner: ownerName,
      host,
      url,
      private: isPrivate,
      enrolled: isEnrolled,
      paused: isPaused,
      hasOrchestrator,
      queueDepth,
    };
  });

  return {
    ok: true,
    repos,
  };
}

export async function handleUppidiEnrollRepo(
  input: UppidiEnrollRepoInput,
  _context?: PluginHandlerContext,
): Promise<UppidiEnrollRepoOutput> {
  const rawRepo = input.repo?.trim();
  if (!rawRepo) {
    return { ok: false, repo: "", enrolledRepos: [], error: "repo is required" };
  }

  const canonicalKey = canonicalRepoKey(rawRepo) ?? rawRepo;

  try {
    const router = getActiveHookRouter();
    if (router) {
      const enrolledRepos = router.enrollRepo(canonicalKey);
      return {
        ok: true,
        repo: canonicalKey,
        enrolledRepos,
        message: `Enrolled repository ${canonicalKey}`,
      };
    }

    const config = loadRouterConfig();
    const currentEnrolled = config.enrolledRepos ?? [];
    let updatedEnrolled: string[];
    if (currentEnrolled.some((r) => isRepoMatching(r, canonicalKey))) {
      updatedEnrolled = currentEnrolled;
    } else {
      updatedEnrolled = [...currentEnrolled, canonicalKey];
    }

    saveRouterConfig({ enrolledRepos: updatedEnrolled });

    return {
      ok: true,
      repo: canonicalKey,
      enrolledRepos: updatedEnrolled,
      message: `Enrolled repository ${canonicalKey}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      repo: canonicalKey,
      enrolledRepos: [],
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiUnenrollRepo(
  input: UppidiUnenrollRepoInput,
  _context?: PluginHandlerContext,
): Promise<UppidiUnenrollRepoOutput> {
  const rawRepo = input.repo?.trim();
  if (!rawRepo) {
    return { ok: false, repo: "", enrolledRepos: [], error: "repo is required" };
  }

  const canonicalKey = canonicalRepoKey(rawRepo) ?? rawRepo;

  try {
    const router = getActiveHookRouter();
    if (router) {
      const enrolledRepos = router.unenrollRepo(canonicalKey);
      return {
        ok: true,
        repo: canonicalKey,
        enrolledRepos,
        message: `Unenrolled repository ${canonicalKey}`,
      };
    }

    const config = loadRouterConfig();
    const currentEnrolled = config.enrolledRepos ?? [];
    const updatedEnrolled = currentEnrolled.filter((r) => !isRepoMatching(r, canonicalKey));

    saveRouterConfig({ enrolledRepos: updatedEnrolled });

    return {
      ok: true,
      repo: canonicalKey,
      enrolledRepos: updatedEnrolled,
      message: `Unenrolled repository ${canonicalKey}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      repo: canonicalKey,
      enrolledRepos: [],
      error: err?.message || String(err),
    };
  }
}

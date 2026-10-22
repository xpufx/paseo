
import type {
  FleetAgent,
  HookQueueItem,
} from "./types.js";
import {
  normalizeRepoKey,
  canonicalRepoKey,
} from "./types.js";

const _fs: any = (typeof process !== "undefined" ? (process as any).getBuiltinModule?.("node:fs") : null) ?? null;
const _path: any = (typeof process !== "undefined" ? (process as any).getBuiltinModule?.("node:path") : null) ?? null;
const _cp: any = (typeof process !== "undefined" ? (process as any).getBuiltinModule?.("node:child_process") : null) ?? null;

const existsSync = (p: any): boolean => Boolean(_fs?.existsSync?.(p));
const readdirSync = (p: any): any[] => (_fs?.readdirSync?.(p) ?? []);
const basename = (p: any): string => (_path?.basename?.(p) ?? String(p).split("/").pop() ?? "");
const join = (...parts: any[]): string => (_path?.join?.(...parts) ?? parts.join("/"));
const execFileSync = (cmd: any, args: any, opts: any): any => _cp?.execFileSync?.(cmd, args, opts);

// resolveWorkspaceForRepo is imported lazily to avoid a circular module load
// between client/filter and server/workspace.
type WorkspaceRecord = any;
type ProjectRecord = any;

export type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// 1. Repo Matching Helpers
// ---------------------------------------------------------------------------

interface RepoMatchContext {
  workspacesData?: WorkspaceRecord[];
  projectsData?: ProjectRecord[];
  workspaces?: WorkspaceRecord[];
  projects?: ProjectRecord[];
  knownRepos?: string[];
}

function normalizeContext(context: any): RepoMatchContext {
  if (!context) return {};
  if (Array.isArray(context)) {
    if (context.length === 0) return {};
    if (typeof context[0] === "string") return { knownRepos: context as string[] };
    return { workspacesData: context as WorkspaceRecord[] };
  }
  return context as RepoMatchContext;
}

function wsData(ctx: RepoMatchContext): WorkspaceRecord[] | undefined {
  return ctx.workspacesData ?? ctx.workspaces;
}

function projData(ctx: RepoMatchContext): ProjectRecord[] | undefined {
  return ctx.projectsData ?? ctx.projects;
}

function gitRootSha(dir: string | null | undefined): string | null {
  if (!dir || typeof dir !== "string") return null;
  const trimmed = dir.trim();
  if (!trimmed || !existsSync(trimmed)) return null;
  try {
    const out = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: trimmed,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = String(out).trim().split("\n").map((x: string) => x.trim()).filter(Boolean);
    return lines.length > 0 ? lines.sort()[0] : null;
  } catch {
    return null;
  }
}

function gitRemoteSlug(dir: string | null | undefined): string | null {
  if (!dir || typeof dir !== "string") return null;
  const trimmed = dir.trim();
  if (!trimmed || !existsSync(trimmed)) return null;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: trimmed,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim();
    if (!url) return null;
    return (canonicalRepoKey(url) ?? normalizeRepoKey(url))?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function slugMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = (canonicalRepoKey(a) ?? normalizeRepoKey(a) ?? a).toLowerCase();
  const cb = (canonicalRepoKey(b) ?? normalizeRepoKey(b) ?? b).toLowerCase();
  if (ca && cb) {
    if (ca === cb) return true;
    // tail match
    if (ca.endsWith(`/${cb}`) || cb.endsWith(`/${ca}`)) return true;
    const caBase = ca.split("/").filter(Boolean).pop();
    const cbBase = cb.split("/").filter(Boolean).pop();
    if (caBase && caBase === cbBase) return true;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function resolveSlugToSha(slug: string): string | null {
  const candidates = new Set<string>();
  const trimmed = slug.trim();
  if (existsSync(trimmed)) candidates.add(trimmed);
  try {
    // candidate host checkout dir: ~/code/<basename>
    const home = process.env.HOME || process.env.REAL_HOME;
    const base = trimmed.split("/").filter(Boolean).pop();
    if (home && base) candidates.add(join(home, "code", base));
  } catch {
    // ignore
  }
  const base = trimmed.split("/").filter(Boolean).pop();
  if (base) {
    const home = process.env.HOME || process.env.REAL_HOME;
    if (home) candidates.add(join(home, "code", base));
  }

  for (const dir of candidates) {
    const sha = gitRootSha(dir);
    if (!sha) continue;
    const remote = gitRemoteSlug(dir);
    if (remote) {
      if (slugMatches(remote, trimmed)) return sha;
    } else {
      // Fall back to basename trust when no remote is configured.
      const dirBase = basename(dir).toLowerCase();
      if (base && dirBase === base.toLowerCase()) return sha;
    }
  }

  // process.cwd() fallback
  const cwdRemote = gitRemoteSlug(process.cwd());
  if (cwdRemote && slugMatches(cwdRemote, trimmed)) {
    const sha = gitRootSha(process.cwd());
    if (sha) return sha;
  }
  return null;
}

function resolveShaToSlug(sha: string): string | null {
  const target = sha.trim().toLowerCase();
  // process.cwd()
  const cwdSha = gitRootSha(process.cwd());
  if (cwdSha && cwdSha.toLowerCase() === target) {
    const remote = gitRemoteSlug(process.cwd());
    if (remote) return remote;
  }
  // Scan ~/code
  const home = process.env.HOME || process.env.REAL_HOME;
  if (home) {
    const codeDir = join(home, "code");
    if (existsSync(codeDir)) {
      try {
        for (const entry of readdirSync(codeDir)) {
          const dir = join(codeDir, entry);
          const s = gitRootSha(dir);
          if (s && s.toLowerCase() === target) {
            const remote = gitRemoteSlug(dir);
            if (remote) return remote;
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}


function backendWorkspaceBridge(a: string, b: string, workspaces: any[], projects: any[]): boolean {
  if (!Array.isArray(workspaces) || workspaces.length === 0) return false;
  const projectsById = new Map<string, any>();
  for (const p of projects ?? []) {
    if (p?.projectId) projectsById.set(p.projectId, p);
  }
  const keysFor = (ws: any): Set<string> => {
    const keys = new Set<string>();
    const add = (v: any) => {
      if (!v || typeof v !== "string") return;
      const t = v.trim();
      if (!t) return;
      keys.add(t.toLowerCase());
      const n = normalizeRepoKey(t);
      if (n) keys.add(n.toLowerCase());
      const c = canonicalRepoKey(t);
      if (c) keys.add(c.toLowerCase());
    };
    add(ws.projectId);
    add(ws.projectKey);
    add(ws.repo);
    const proj = ws.projectId ? projectsById.get(ws.projectId) : undefined;
    add(proj?.projectId);
    add(proj?.projectKey);
    add(ws.mainRepoRoot);
    add(proj?.rootPath);
    add(ws.cwd);
    add(proj?.displayName);
    const dirs = [ws.mainRepoRoot, ws.worktreeRoot, proj?.rootPath, ws.cwd];
    for (const dir of dirs) {
      if (dir && typeof dir === "string" && existsSync(dir)) {
        const out = (() => {
          try {
            const r = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const lines = String(r).trim().split("\n").map((x: string) => x.trim()).filter(Boolean);
            return lines.length > 0 ? `git-root:${lines.sort()[0]}` : null;
          } catch { return null; }
        })();
        if (out) keys.add(out.toLowerCase());
      }
    }
    return keys;
  };

  const al = a.trim().toLowerCase();
  const bl = b.trim().toLowerCase();
  for (const ws of workspaces) {
    if (!ws?.workspaceId) continue;
    const keys = keysFor(ws);
    if (keys.has(al) && keys.has(bl)) return true;
  }
  return false;
}

export function isRepoMatching(targetRepo: string, candidateRepo: string, context?: any): boolean {
  // Support context passed as additional args in some callers.
  if (arguments.length > 3) {
    // ignore
  }
  if (!targetRepo || !candidateRepo) return false;
  const aRaw = String(targetRepo).trim();
  const bRaw = String(candidateRepo).trim();
  if (!aRaw || !bRaw) return false;
  if (aRaw.toLowerCase() === bRaw.toLowerCase()) return true;

  const ctx = normalizeContext(context);

  // Workspace-registry bridge: if both resolve to the same workspace, they match.
  const ws = wsData(ctx);
  if (ws && ws.length > 0) {
    if (backendWorkspaceBridge(aRaw, bRaw, ws, projData(ctx) ?? [])) return true;
  }

  const t = aRaw.toLowerCase().replace(/\.git$/, "");
  const c = bRaw.toLowerCase().replace(/\.git$/, "");

  if (t === c) return true;

  const tSent = t.startsWith("git-root:") || t.startsWith("non-git:");
  const cSent = c.startsWith("git-root:") || c.startsWith("non-git:");

  if (tSent || cSent) {
    if (tSent && cSent) return t === c;

    // non-git sentinels cannot be bridged to slugs
    if (t.startsWith("non-git:") || c.startsWith("non-git:")) return false;

    const sentinel = tSent ? t : c;
    const slug = tSent ? bRaw : aRaw;
    const sha = sentinel.startsWith("git-root:") ? sentinel.slice("git-root:".length).trim() : "";

    if (sha) {
      const slugSha = resolveSlugToSha(slug);
      if (slugSha && slugSha.toLowerCase() === sha) return true;

      const shaSlug = resolveShaToSlug(sha);
      if (shaSlug && slugMatches(shaSlug, slug)) return true;
    }
    return false;
  }

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

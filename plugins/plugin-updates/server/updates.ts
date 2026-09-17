import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { listPlugins, safeSpawn, type PaseoPluginInfo, type SafeSpawnResult } from "paseo-plugin-helper/server";
import { deriveSourceUrl, shortHash } from "../shared/updates";
import type {
  PluginUpdate,
  PluginUpdateActionResult,
  PluginUpdateChange,
  RefKind,
} from "../shared/updates";

const PROBE_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 30_000;
const UPDATE_TIMEOUT_MS = 120_000;
const RELOAD_TIMEOUT_MS = 60_000;

// This plugin's own install id. Paseo runs plugin backend code in the plugin's
// subprocess, so `paseo plugin reload plugin-updates` terminates the very
// process executing the update loop (#210). We therefore never reload ourselves
// from inside ourselves.
const SELF_PLUGIN_ID = "plugin-updates";

// Shown when the updater updated itself: the pull succeeded, but applying it
// requires a reload that only the host can safely perform.
const SELF_UPDATE_DETAIL =
  "Updated in place. Reload plugin-updates from Settings to apply (a plugin cannot safely reload itself).";

// Report-only verdict for an install whose tracked ref or plugin subdirectory is gone.
const MISSING_SOURCE_DETAIL = "Plugin does not exist at the source it was installed from.";

type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<SafeSpawnResult>;

type ReadDir = (dir: string) => Promise<Array<{ name: string; isDirectory(): boolean }>>;
type ReadFile = (file: string) => Promise<string>;
type Mkdir = (dir: string) => Promise<void>;

const runCommand: CommandRunner = (command, args, options) =>
  safeSpawn(command, args, { cwd: options.cwd, timeoutMs: options.timeoutMs });

const defaultReadDir: ReadDir = (dir) => fs.promises.readdir(dir, { withFileTypes: true });
const defaultReadFile: ReadFile = (file) => fs.promises.readFile(file, "utf8");
const defaultMkdir: Mkdir = async (dir) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

export interface ProbeDeps {
  pluginsRoot?: string;
  homeDir?: string;
  cacheRoot?: string;
  readDir?: ReadDir;
  readFile?: ReadFile;
  mkdir?: Mkdir;
  scanOrphans?: boolean;
}

function defaultPluginsRoot(): string {
  return path.join(homedir(), ".paseo", "plugins");
}

function outputOf(result: SafeSpawnResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function errorOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDir(value: string): string {
  return path.resolve(value.trim().replace(/\/+$/, ""));
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

const FULL_COMMIT_RE = /^[0-9a-f]{40,64}$/i;
// Git abbreviates commit ids down to as few as 7 hex chars; a ref matching this
// shape is a commit pin, not a movable branch/tag name.
const COMMIT_REF_RE = /^[0-9a-f]{7,64}$/i;

function isCommitSha(value: string): boolean {
  return COMMIT_REF_RE.test(value.trim());
}

function parseCommit(output: string): string | null {
  const value = output.trim();
  return FULL_COMMIT_RE.test(value) ? value : null;
}

function treeExpr(commit: string, subdir: string): string {
  return subdir ? `${commit}:${subdir}` : `${commit}^{tree}`;
}

function scopeLabel(subdir: string | null): string {
  if (subdir === null) return "the plugin";
  return subdir === "" ? "the repository root" : subdir;
}

async function git(
  runner: CommandRunner,
  args: string[],
  cwd: string | undefined,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<SafeSpawnResult> {
  try {
    return await runner("git", args, { cwd, timeoutMs });
  } catch (error) {
    return { stdout: "", stderr: errorOf(error), code: null, signal: null, durationMs: 0 };
  }
}

interface LsRemoteLine {
  sha: string;
  ref: string;
}

function parseLsRemote(output: string): LsRemoteLine[] {
  const lines: LsRemoteLine[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [sha, ref] = line.split(/\s+/);
    if (sha && ref && /^[0-9a-f]{40,64}$/i.test(sha)) lines.push({ sha, ref });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Managed install metadata (~/.paseo/plugins/sources.json + config fallback)
// ---------------------------------------------------------------------------

interface ManagedRecord {
  remote: string;
  requestedRef: string | null;
  trackingBranch: string | null;
  commit: string | null;
  pluginPath: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toManagedRecord(value: unknown): ManagedRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const remote = asString(record.remote);
  if (!remote) return null;
  const commit = asString(record.commit);
  return {
    remote,
    requestedRef: asString(record.requestedRef) ?? asString(record.ref),
    trackingBranch: asString(record.trackingBranch),
    commit: commit && /^[0-9a-f]{40,64}$/i.test(commit) ? commit : null,
    pluginPath: asString(record.pluginPath),
  };
}

async function readJson(
  readFile: ReadFile,
  file: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface PackageUrls {
  repositoryUrl: string | null;
  homepage: string | null;
}

// package.json `repository` is either a string or `{ url }`; treat both, and
// swallow any read/parse failure as "no metadata".
async function readPackageUrls(pluginPath: string | undefined, readFile: ReadFile): Promise<PackageUrls> {
  if (!pluginPath) return { repositoryUrl: null, homepage: null };
  const pkg = await readJson(readFile, path.join(pluginPath, "package.json"));
  if (!pkg) return { repositoryUrl: null, homepage: null };
  const repository = pkg.repository;
  const repositoryUrl =
    typeof repository === "string"
      ? asString(repository)
      : repository && typeof repository === "object"
        ? asString((repository as Record<string, unknown>).url)
        : null;
  return { repositoryUrl, homepage: asString(pkg.homepage) };
}

async function resolveSourceUrl(
  plugin: PaseoPluginInfo,
  identity: PluginIdentity,
  resolution: RefResolution,
  deps: ProbeDeps,
): Promise<string | null> {
  const urls = await readPackageUrls(plugin.path, deps.readFile ?? defaultReadFile);
  return deriveSourceUrl({
    repositoryUrl: urls.repositoryUrl,
    homepage: urls.homepage,
    remoteUrl: resolution.remoteUrl,
    ref: resolution.ref,
    subdir: identity.subdir,
  });
}

async function loadManagedRecords(deps: ProbeDeps): Promise<Map<string, ManagedRecord>> {
  const home = deps.homeDir ?? homedir();
  const pluginsRoot = deps.pluginsRoot ?? path.join(home, ".paseo", "plugins");
  const readFile = deps.readFile ?? defaultReadFile;
  const records = new Map<string, ManagedRecord>();

  const sources = await readJson(readFile, path.join(pluginsRoot, "sources.json"));
  if (sources) {
    for (const [id, value] of Object.entries(sources)) {
      const record = toManagedRecord(value);
      if (record) records.set(id, record);
    }
  }

  const config = await readJson(readFile, path.join(home, ".paseo", "config.json"));
  const configPlugins = config?.plugins;
  if (configPlugins && typeof configPlugins === "object") {
    for (const [id, value] of Object.entries(configPlugins as Record<string, unknown>)) {
      if (records.has(id)) continue;
      const record = toManagedRecord(value);
      if (record) records.set(id, record);
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Identity: (repo root, ref, subdir)
// ---------------------------------------------------------------------------

interface PluginIdentity {
  plugin: PaseoPluginInfo;
  repoRoot: string | null;
  subdir: string | null;
  managed: ManagedRecord | null;
}

async function resolveRepoRoot(pluginPath: string, runner: CommandRunner): Promise<string | null> {
  const result = await git(runner, ["rev-parse", "--show-toplevel"], pluginPath);
  if (result.code === 0 && result.stdout.trim()) return normalizeDir(result.stdout);
  return null;
}

async function resolveIdentity(
  plugin: PaseoPluginInfo,
  managed: ManagedRecord | null,
  runner: CommandRunner,
): Promise<PluginIdentity> {
  if (!plugin.path) return { plugin, repoRoot: null, subdir: null, managed };
  const repoRoot = await resolveRepoRoot(plugin.path, runner);
  if (!repoRoot) return { plugin, repoRoot: null, subdir: null, managed };
  let subdir = toPosix(path.relative(repoRoot, normalizeDir(plugin.path)));
  if (subdir === ".") subdir = "";
  if (managed?.pluginPath !== null && managed?.pluginPath !== undefined) {
    subdir = managed.pluginPath === "." ? "" : toPosix(managed.pluginPath);
  }
  return { plugin, repoRoot, subdir, managed };
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

type ReportOnly = "pinned" | "unpinned" | "no-upstream";

interface RefResolution {
  remote: string | null;
  remoteUrl: string | null;
  ref: string | null;
  refKind: RefKind | null;
  reportOnly: ReportOnly | null;
  detail: string | null;
}

function pinnedResolution(remote: string, ref: string | null): RefResolution {
  return {
    remote,
    remoteUrl: remote,
    ref,
    refKind: "sha",
    reportOnly: "pinned",
    detail: ref ? `Pinned to immutable commit ${shortHash(ref)} — report only` : "Pinned to an immutable commit — report only",
  };
}

async function resolveRef(
  identity: PluginIdentity,
  runner: CommandRunner,
): Promise<RefResolution> {
  const managed = identity.managed;
  if (managed) {
    // A tracked branch is the authoritative moving ref; only fall back to the
    // requested ref when there is no branch to track.
    if (managed.trackingBranch) {
      return {
        remote: managed.remote,
        remoteUrl: managed.remote,
        ref: managed.trackingBranch,
        refKind: "branch",
        reportOnly: null,
        detail: null,
      };
    }
    const requested = managed.requestedRef;
    if (requested && isCommitSha(requested)) {
      return pinnedResolution(managed.remote, requested);
    }
    if (!requested) {
      if (managed.commit) return pinnedResolution(managed.remote, managed.commit);
      return {
        remote: managed.remote,
        remoteUrl: managed.remote,
        ref: null,
        refKind: null,
        reportOnly: "unpinned",
        detail: "No ref recorded for this git-managed install — report only",
      };
    }
    return {
      remote: managed.remote,
      remoteUrl: managed.remote,
      ref: requested,
      refKind: "tag",
      reportOnly: null,
      detail: null,
    };
  }

  if (identity.plugin.source === "git" && identity.plugin.remote && identity.plugin.ref) {
    if (isCommitSha(identity.plugin.ref)) {
      return pinnedResolution(identity.plugin.remote, identity.plugin.ref);
    }
    return {
      remote: identity.plugin.remote,
      remoteUrl: identity.plugin.remote,
      ref: identity.plugin.ref,
      refKind: "branch",
      reportOnly: null,
      detail: null,
    };
  }

  if (!identity.repoRoot) {
    return { remote: null, remoteUrl: null, ref: null, refKind: null, reportOnly: "unpinned", detail: "Not a git repository" };
  }

  const upstream = await git(
    runner,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    identity.repoRoot,
  );
  const upstreamName = upstream.code === 0 ? upstream.stdout.trim() : "";
  if (upstreamName && upstreamName !== "HEAD") {
    const separator = upstreamName.indexOf("/");
    const remoteName = separator > 0 ? upstreamName.slice(0, separator) : upstreamName;
    const ref = separator > 0 ? upstreamName.slice(separator + 1) : null;
    const urlResult = await git(runner, ["remote", "get-url", remoteName], identity.repoRoot);
    const remoteUrl = urlResult.code === 0 ? urlResult.stdout.trim() : null;
    if (!ref) {
      return {
        remote: remoteName,
        remoteUrl: remoteUrl,
        ref: null,
        refKind: null,
        reportOnly: "unpinned",
        detail: "Unable to resolve the upstream branch name — report only",
      };
    }
    return {
      remote: remoteName,
      remoteUrl: remoteUrl ?? remoteName,
      ref,
      refKind: "branch",
      reportOnly: null,
      detail: null,
    };
  }

  const branchResult = await git(runner, ["rev-parse", "--abbrev-ref", "HEAD"], identity.repoRoot);
  const current = branchResult.code === 0 ? branchResult.stdout.trim() : "";
  if (!current || current === "HEAD") {
    return {
      remote: null,
      remoteUrl: null,
      ref: null,
      refKind: "detached",
      reportOnly: "unpinned",
      detail: "Detached HEAD — no upstream to compare; report only",
    };
  }
  return {
    remote: null,
    remoteUrl: null,
    ref: current,
    refKind: "branch",
    reportOnly: "no-upstream",
    detail: `Branch '${current}' has no upstream remote; report only`,
  };
}

// ---------------------------------------------------------------------------
// Remote cache + per-remote state (deduped per (remote, ref))
// ---------------------------------------------------------------------------

interface RemoteRefState {
  commit: string | null;
  refKind: RefKind | null;
  refExists: boolean;
  cacheDir: string;
  shallow: boolean;
  error: string | null;
}

interface RemoteCache {
  states: Map<string, Promise<RemoteRefState>>;
  cacheRoot: string;
}

function remoteKey(remoteUrl: string, ref: string): string {
  return `${remoteUrl}\0${ref}`;
}

function cacheDirFor(cacheRoot: string, remoteUrl: string, ref: string): string {
  const hash = createHash("sha256").update(remoteKey(remoteUrl, ref)).digest("hex").slice(0, 24);
  return path.join(cacheRoot, hash);
}

async function fetchIntoCache(
  cacheDir: string,
  remoteUrl: string,
  resolution: RefResolution,
  filtered: boolean,
  runner: CommandRunner,
  deps: ProbeDeps,
): Promise<string | null> {
  const mkdir = deps.mkdir ?? defaultMkdir;
  try {
    await mkdir(path.dirname(cacheDir));
  } catch {
    // git init below will surface a real failure if the directory is unusable.
  }
  const init = await git(runner, ["init", "--bare", "-q", cacheDir], undefined);
  if (init.code !== 0) {
    return outputOf(init) || "git init of the update cache failed";
  }
  const refArg =
    resolution.refKind === "tag" ? `refs/tags/${resolution.ref}` : (resolution.ref as string);
  const args = ["-C", cacheDir, "fetch", "--depth=1", "--no-tags"];
  if (filtered) args.push("--filter=tree:0");
  args.push(remoteUrl, refArg);
  const fetch = await git(runner, args, undefined, FETCH_TIMEOUT_MS);
  if (fetch.code !== 0) {
    return outputOf(fetch) || `git fetch ${remoteUrl} failed`;
  }
  return null;
}

async function resolveRemoteState(
  resolution: RefResolution,
  cache: RemoteCache,
  runner: CommandRunner,
  deps: ProbeDeps,
): Promise<RemoteRefState> {
  const remoteUrl = resolution.remoteUrl!;
  const ref = resolution.ref!;
  const cacheDir = cacheDirFor(cache.cacheRoot, remoteUrl, ref);

  // A bare tag name matches only the unpeeled `refs/tags/<tag>` line, which for
  // an annotated tag is the tag OBJECT, not the commit. Ask for the peeled ref
  // explicitly so the compared commit is the tag's target commit.
  const tagRef = `refs/tags/${ref}`;
  const ls = await git(runner, ["ls-remote", remoteUrl, ref, tagRef, `${tagRef}^{}`], undefined);
  if (ls.code !== 0) {
    return { commit: null, refKind: resolution.refKind, refExists: false, cacheDir, shallow: false, error: outputOf(ls) || "git ls-remote failed" };
  }
  const lines = parseLsRemote(ls.stdout);
  const heads = lines.filter((line) => line.ref.startsWith("refs/heads/"));
  const tags = lines.filter((line) => line.ref.startsWith("refs/tags/"));

  let commit: string | null = null;
  let refKind: RefKind | null = resolution.refKind;
  if (resolution.refKind !== "tag" && heads.length > 0) {
    commit = (heads.find((line) => line.ref === `refs/heads/${ref}`) ?? heads[0]!).sha;
    refKind = "branch";
  } else if (tags.length > 0) {
    // Annotated tags peel to the commit via `^{}`; lightweight tags have no
    // peeled entry, so the direct ref already points at the commit.
    const peeled = tags.find((line) => line.ref === `${tagRef}^{}`);
    const direct = tags.find((line) => line.ref === tagRef);
    commit = (peeled ?? direct ?? tags[0]!).sha;
    refKind = "tag";
  }
  if (!commit) {
    // The remote is reachable but holds no ref with this name: the tracked
    // branch/tag was deleted. That is report-only, not a raw git error.
    return { commit: null, refKind, refExists: false, cacheDir, shallow: false, error: null };
  }

  const resolved: RefResolution = { ...resolution, refKind };
  const fetchError = await fetchIntoCache(cacheDir, remoteUrl, resolved, true, runner, deps);
  if (fetchError) {
    return { commit, refKind, refExists: true, cacheDir, shallow: false, error: fetchError };
  }
  const shallowResult = await git(runner, ["-C", cacheDir, "rev-parse", "--is-shallow-repository"], undefined);
  const shallow = shallowResult.code === 0 && shallowResult.stdout.trim() === "true";
  return { commit, refKind, refExists: true, cacheDir, shallow, error: null };
}

async function getRemoteState(
  resolution: RefResolution,
  cache: RemoteCache,
  runner: CommandRunner,
  deps: ProbeDeps,
): Promise<RemoteRefState> {
  const key = remoteKey(resolution.remoteUrl!, resolution.ref!);
  let promise = cache.states.get(key);
  if (!promise) {
    promise = resolveRemoteState(resolution, cache, runner, deps);
    cache.states.set(key, promise);
  }
  return promise;
}

interface RemoteTree {
  tree: string | null;
  absent: boolean;
  error: string | null;
}

async function readRemoteTree(
  state: RemoteRefState,
  resolution: RefResolution,
  subdir: string,
  runner: CommandRunner,
  deps: ProbeDeps,
): Promise<RemoteTree> {
  let result = await git(runner, ["-C", state.cacheDir, "rev-parse", treeExpr(state.commit!, subdir)], undefined);
  if (result.code !== 0) {
    const message = outputOf(result);
    if (/not a valid object name|bad object|missing/i.test(message)) {
      const refetched = await fetchIntoCache(
        state.cacheDir,
        resolution.remoteUrl!,
        { ...resolution, refKind: state.refKind },
        false,
        runner,
        deps,
      );
      if (refetched) return { tree: null, absent: false, error: refetched };
      result = await git(runner, ["-C", state.cacheDir, "rev-parse", treeExpr(state.commit!, subdir)], undefined);
    }
  }
  if (result.code === 0) return { tree: parseCommit(result.stdout), absent: false, error: null };
  const message = outputOf(result);
  if (/does not exist|exists on disk, but not in/i.test(message)) {
    return { tree: null, absent: true, error: null };
  }
  return { tree: null, absent: false, error: message || "Unable to read the remote subdirectory tree" };
}

async function readLatestChange(
  cacheDir: string,
  commit: string,
  subdir: string,
  runner: CommandRunner,
  shallow: boolean,
): Promise<PluginUpdateChange> {
  if (shallow) return { commit, date: null, subject: null };
  const result = await git(
    runner,
    ["-C", cacheDir, "log", "-1", "--format=%H%x1f%cI%x1f%s", commit, "--", subdir || "."],
    undefined,
  );
  if (result.code === 0 && result.stdout.trim()) {
    const [changeCommit, date, subject] = result.stdout.trim().split("\x1f");
    if (changeCommit) return { commit: changeCommit, date: date ?? null, subject: subject ?? null };
  }
  return { commit, date: null, subject: null };
}

// ---------------------------------------------------------------------------
// Local side
// ---------------------------------------------------------------------------

interface LocalState {
  localCommit: string | null;
  localTree: string | null;
  dirty: boolean | null;
  workingTree: string | null;
}

async function revParseTree(
  runner: CommandRunner,
  repoRoot: string,
  commit: string,
  subdir: string,
): Promise<string | null> {
  const result = await git(runner, ["rev-parse", treeExpr(commit, subdir)], repoRoot);
  return result.code === 0 ? parseCommit(result.stdout) : null;
}

async function workingTreeHash(
  repoRoot: string,
  subdir: string,
  runner: CommandRunner,
): Promise<string | null> {
  const stash = await git(runner, ["stash", "create"], repoRoot);
  if (stash.code !== 0) return null;
  const commit = parseCommit(stash.stdout);
  if (!commit) return null;
  return revParseTree(runner, repoRoot, commit, subdir);
}

async function readLocalState(
  identity: PluginIdentity,
  runner: CommandRunner,
): Promise<LocalState> {
  const head = await git(runner, ["rev-parse", "HEAD"], identity.repoRoot!);
  const localCommit = parseCommit(head.stdout);
  const localTree = localCommit
    ? await revParseTree(runner, identity.repoRoot!, localCommit, identity.subdir ?? "")
    : null;

  let dirty: boolean | null = null;
  let workingTree: string | null = null;
  if (identity.plugin.source !== "git") {
    const status = await git(runner, ["status", "--porcelain", "--", identity.subdir || "."], identity.repoRoot!);
    if (status.code === 0) {
      dirty = status.stdout.trim().length > 0;
      if (dirty) workingTree = await workingTreeHash(identity.repoRoot!, identity.subdir ?? "", runner);
    }
  }
  return { localCommit, localTree, dirty, workingTree };
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

interface Verdict {
  status: PluginUpdate["status"];
  updateAvailable: boolean;
  detail: string;
}

async function isAncestor(
  runner: CommandRunner,
  repoRoot: string,
  ancestor: string,
  descendant: string,
): Promise<boolean | null> {
  const result = await git(runner, ["merge-base", "--is-ancestor", ancestor, descendant], repoRoot);
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  return null;
}

async function mergeBaseCommit(
  runner: CommandRunner,
  repoRoot: string,
  a: string,
  b: string,
): Promise<string | null> {
  const result = await git(runner, ["merge-base", a, b], repoRoot);
  return result.code === 0 ? parseCommit(result.stdout) : null;
}

async function classifyBranch(
  identity: PluginIdentity,
  resolution: RefResolution,
  local: LocalState,
  state: RemoteRefState,
  remote: RemoteTree,
  runner: CommandRunner,
): Promise<Verdict> {
  const scope = scopeLabel(identity.subdir);
  const localCommit = local.localCommit;
  const remoteCommit = state.commit;
  if (localCommit && remoteCommit && localCommit === remoteCommit) {
    return { status: "current", updateAvailable: false, detail: `Up to date with ${resolution.ref} (${shortHash(remoteCommit)})` };
  }
  if (local.localTree && remote.tree && local.localTree === remote.tree) {
    return { status: "current", updateAvailable: false, detail: `Subdirectory tree matches remote ${resolution.ref}` };
  }

  if (localCommit && remoteCommit) {
    const localBehind = await isAncestor(runner, identity.repoRoot!, localCommit, remoteCommit);
    if (localBehind === true) {
      return { status: "behind", updateAvailable: true, detail: `Remote ${resolution.ref} is ahead (${shortHash(remoteCommit)}); update available` };
    }
    const remoteBehind = await isAncestor(runner, identity.repoRoot!, remoteCommit, localCommit);
    if (remoteBehind === true) {
      return { status: "current", updateAvailable: false, detail: `Local is ahead of remote ${resolution.ref}; nothing to pull` };
    }
    const base = await mergeBaseCommit(runner, identity.repoRoot!, localCommit, remoteCommit);
    if (base) {
      const baseTree = await revParseTree(runner, identity.repoRoot!, base, identity.subdir ?? "");
      if (baseTree !== null && baseTree === remote.tree) {
        return {
          status: "current",
          updateAvailable: false,
          detail: `Local is ahead; remote ${resolution.ref} did not change ${scope} — nothing to pull`,
        };
      }
      if (baseTree === local.localTree) {
        return { status: "behind", updateAvailable: true, detail: `Remote ${resolution.ref} changed ${scope}; update available` };
      }
      return { status: "behind", updateAvailable: true, detail: `Both local and remote ${resolution.ref} changed ${scope}; update may conflict` };
    }
  }
  return { status: "behind", updateAvailable: true, detail: `Subdirectory tree differs from remote ${resolution.ref}; update available` };
}

function classifyTag(
  identity: PluginIdentity,
  resolution: RefResolution,
  state: RemoteRefState,
): Verdict {
  // `paseo plugin update` no-ops for any install without a tracking branch, so
  // a tag install is never actionable. Report-only: the tag never "moves" into
  // an update we could apply.
  const commit = identity.managed?.commit ?? state.commit;
  return {
    status: "pinned",
    updateAvailable: false,
    detail: `Pinned to tag ${resolution.ref} (${shortHash(commit)}) — tags are not auto-updated; report only`,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function emptyRow(plugin: PaseoPluginInfo, identity: PluginIdentity, resolution: RefResolution): PluginUpdate {
  return {
    id: plugin.id,
    path: plugin.path,
    source: plugin.source ?? null,
    sourceUrl: null,
    repoRoot: identity.repoRoot,
    subdir: identity.subdir,
    ref: resolution.ref,
    refKind: resolution.refKind,
    remote: resolution.remote,
    localCommit: null,
    remoteCommit: null,
    localTree: null,
    remoteTree: null,
    workingTree: null,
    dirty: null,
    updateAvailable: false,
    status: "current",
    error: null,
    detail: null,
    latestChange: null,
  };
}

function notARepoRow(plugin: PaseoPluginInfo): PluginUpdate {
  return {
    id: plugin.id,
    path: plugin.path,
    source: plugin.source ?? null,
    sourceUrl: null,
    repoRoot: null,
    subdir: null,
    ref: null,
    refKind: null,
    remote: null,
    localCommit: null,
    remoteCommit: null,
    localTree: null,
    remoteTree: null,
    workingTree: null,
    dirty: null,
    updateAvailable: false,
    status: "not-a-repo",
    error: null,
    detail: "Not a git repository — no git update possible",
    latestChange: null,
  };
}

interface ProbeContext {
  runner: CommandRunner;
  deps: ProbeDeps;
  cache: RemoteCache;
}

async function probeOne(
  identity: PluginIdentity,
  resolution: RefResolution,
  context: ProbeContext,
): Promise<PluginUpdate> {
  const plugin = identity.plugin;
  if (!identity.repoRoot) {
    const notARepo = notARepoRow(plugin);
    notARepo.sourceUrl = await resolveSourceUrl(plugin, identity, resolution, context.deps);
    return notARepo;
  }

  const row = emptyRow(plugin, identity, resolution);
  row.sourceUrl = await resolveSourceUrl(plugin, identity, resolution, context.deps);

  const local = await readLocalState(identity, context.runner);
  row.localCommit = local.localCommit;
  row.localTree = local.localTree;
  row.workingTree = local.workingTree;
  row.dirty = local.dirty;

  if (resolution.reportOnly) {
    row.status = resolution.reportOnly;
    row.detail = resolution.detail;
    return row;
  }
  if (!resolution.remoteUrl || !resolution.ref) {
    row.status = "error";
    row.error = "Unable to resolve a remote/ref for this plugin";
    return row;
  }

  const state = await getRemoteState(resolution, context.cache, context.runner, context.deps);
  if (state.error) {
    row.status = "error";
    row.error = state.error;
    return row;
  }
  row.remoteCommit = state.commit;
  row.refKind = state.refKind ?? resolution.refKind;

  if (!state.refExists || !state.commit) {
    row.status = "no-upstream";
    row.detail = MISSING_SOURCE_DETAIL;
    return row;
  }

  const remote = await readRemoteTree(state, resolution, identity.subdir ?? "", context.runner, context.deps);
  if (remote.error) {
    row.status = "error";
    row.error = remote.error;
    return row;
  }
  row.remoteTree = remote.tree;
  if (remote.absent) {
    row.status = "missing";
    row.detail = MISSING_SOURCE_DETAIL;
    return row;
  }
  row.latestChange = await readLatestChange(state.cacheDir, state.commit, identity.subdir ?? "", context.runner, state.shallow);

  const verdict =
    row.refKind === "tag"
      ? classifyTag(identity, resolution, state)
      : await classifyBranch(identity, resolution, local, state, remote, context.runner);

  row.status = verdict.status;
  row.updateAvailable = verdict.updateAvailable;
  row.detail = verdict.detail;
  return row;
}

async function probeInstalled(
  installed: PaseoPluginInfo[],
  runner: CommandRunner,
  deps: ProbeDeps = {},
): Promise<PluginUpdate[]> {
  const records = await loadManagedRecords(deps);
  const home = deps.homeDir ?? homedir();
  const cacheRoot = deps.cacheRoot ?? path.join(home, ".paseo", "plugins", ".cache", "plugin-updates");

  const identities: PluginIdentity[] = [];
  for (const plugin of installed) {
    identities.push(await resolveIdentity(plugin, records.get(plugin.id) ?? null, runner));
  }

  const resolutions: RefResolution[] = [];
  for (const identity of identities) {
    resolutions.push(await resolveRef(identity, runner));
  }

  const cache: RemoteCache = { states: new Map(), cacheRoot };
  const context: ProbeContext = { runner, deps, cache };

  const rows: PluginUpdate[] = [];
  for (let index = 0; index < identities.length; index += 1) {
    rows.push(await probeOne(identities[index]!, resolutions[index]!, context));
  }

  if (deps.scanOrphans !== false) {
    rows.push(...(await scanOrphanedDirs(installed, deps)));
  }
  return rows;
}

async function probePlugin(
  plugin: PaseoPluginInfo,
  runner: CommandRunner = runCommand,
  deps: ProbeDeps = { scanOrphans: false },
): Promise<PluginUpdate> {
  const rows = await probeInstalled([plugin], runner, deps);
  return rows[0]!;
}

export async function checkInstalledPlugins(
  _workspaceId?: string,
  runner: CommandRunner = runCommand,
  installedOverride?: PaseoPluginInfo[],
  deps: ProbeDeps = {},
): Promise<{ checkedAt: string; plugins: PluginUpdate[] }> {
  try {
    const installed = installedOverride ?? (await listPlugins({ forceRefresh: true }));
    const plugins = await probeInstalled(installed, runner, deps);
    return { checkedAt: new Date().toISOString(), plugins };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      plugins: [
        {
          id: "plugin-manager",
          path: "",
          source: null,
          sourceUrl: null,
          repoRoot: null,
          subdir: null,
          ref: null,
          refKind: null,
          remote: null,
          localCommit: null,
          remoteCommit: null,
          localTree: null,
          remoteTree: null,
          workingTree: null,
          dirty: null,
          updateAvailable: false,
          status: "error",
          error: `Unable to list installed plugins: ${errorOf(error)}`,
          detail: null,
          latestChange: null,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Orphans
// ---------------------------------------------------------------------------

async function scanOrphanedDirs(
  installed: PaseoPluginInfo[],
  deps: ProbeDeps,
): Promise<PluginUpdate[]> {
  const pluginsRoot = deps.pluginsRoot ?? defaultPluginsRoot();
  const readDir = deps.readDir ?? defaultReadDir;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readDir(pluginsRoot);
  } catch {
    return [];
  }
  const livePaths = installed
    .map((plugin) => plugin.path)
    .filter((value): value is string => Boolean(value))
    .map(normalizeDir);
  const rows: PluginUpdate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = normalizeDir(path.join(pluginsRoot, entry.name));
    const live = livePaths.some((livePath) => livePath === dir || livePath.startsWith(`${dir}${path.sep}`));
    if (live) continue;
    rows.push({
      id: `orphaned:${entry.name}`,
      path: dir,
      source: null,
      sourceUrl: null,
      repoRoot: null,
      subdir: null,
      ref: null,
      refKind: null,
      remote: null,
      localCommit: null,
      remoteCommit: null,
      localTree: null,
      remoteTree: null,
      workingTree: null,
      dirty: null,
      updateAvailable: false,
      status: "orphaned",
      error: null,
      detail: "Leftover managed directory from an uninstalled or failed install — not probed",
      latestChange: null,
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function actionResult(
  pluginId: string,
  status: "updated" | "error",
  error: string | null = null,
  output: string | null = null,
  requiresForce = false,
): PluginUpdateActionResult {
  return {
    pluginId,
    status,
    output: output ?? null,
    error: error ?? null,
    ...(requiresForce ? { requiresForce: true } : {}),
  };
}

async function invokePaseoUpdate(
  args: string[],
  runner: CommandRunner,
): Promise<{ status: "updated" | "error"; output: string | null; error: string | null }> {
  try {
    const result = await runner("paseo", ["plugin", "update", ...args], {
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    const output = outputOf(result) || null;
    if (result.code === 0) return { status: "updated", output, error: null };
    return { status: "error", output, error: output || `paseo plugin update exited with code ${result.code}` };
  } catch (error) {
    return { status: "error", output: null, error: errorOf(error) };
  }
}

async function reloadPlugin(
  pluginId: string,
  runner: CommandRunner,
): Promise<{ ok: boolean; output: string | null; error: string | null }> {
  try {
    const result = await runner("paseo", ["plugin", "reload", pluginId], {
      timeoutMs: RELOAD_TIMEOUT_MS,
    });
    const output = outputOf(result) || null;
    if (result.code === 0) return { ok: true, output, error: null };
    return { ok: false, output, error: output || `paseo plugin reload exited with code ${result.code}` };
  } catch (error) {
    return { ok: false, output: null, error: errorOf(error) };
  }
}

/**
 * Splits the plugins affected by a pull into those we may reload and the ones
 * we must not.
 *
 * `plugin-updates` MUST never reload itself: its handlers run inside the plugin
 * subprocess, so `paseo plugin reload plugin-updates` kills the process that is
 * mid-update — the crash/loop in #210. Callers report the self entry as updated
 * with a "reload from Settings" note instead.
 */
export function planReloads(
  ids: string[],
  selfId: string = SELF_PLUGIN_ID,
): { reload: string[]; skippedSelf: string[] } {
  const reload: string[] = [];
  const skippedSelf: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === selfId) skippedSelf.push(id);
    else reload.push(id);
  }
  return { reload, skippedSelf };
}

/**
 * Reloads plugins strictly one at a time.
 *
 * Reloads are serialized because each `paseo plugin reload` restarts a plugin
 * subprocess; overlapping them races the daemon's plugin registry (#210).
 */
async function reloadSerially(
  ids: string[],
  runner: CommandRunner,
): Promise<Array<{ id: string; ok: boolean; output: string | null; error: string | null }>> {
  const outcomes: Array<{ id: string; ok: boolean; output: string | null; error: string | null }> = [];
  for (const id of ids) {
    const reload = await reloadPlugin(id, runner);
    outcomes.push({ id, ...reload });
  }
  return outcomes;
}

interface PullOutcome {
  ok: boolean;
  requiresForce: boolean;
  output: string | null;
  error: string | null;
}

async function checkDirty(root: string, runner: CommandRunner): Promise<boolean | null> {
  const statusResult = await git(runner, ["status", "--porcelain"], root);
  if (statusResult.code !== 0) return null;
  return statusResult.stdout.trim().length > 0;
}

async function pullRoot(root: string, force: boolean, runner: CommandRunner): Promise<PullOutcome> {
  const dirty = await checkDirty(root, runner);
  if (dirty === null) {
    return { ok: false, requiresForce: false, output: null, error: "git status failed for the plugin repository" };
  }
  if (dirty && !force) {
    return {
      ok: false,
      requiresForce: true,
      output: null,
      error: "Working tree is dirty — refusing to pull. Re-run with force to override.",
    };
  }

  const head = parseCommit((await git(runner, ["rev-parse", "HEAD"], root)).stdout);
  const upstream = await git(runner, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root);
  const upstreamName = upstream.code === 0 ? upstream.stdout.trim() : "";
  if (head && upstreamName && upstreamName !== "HEAD") {
    const upstreamCommit = parseCommit((await git(runner, ["rev-parse", upstreamName], root)).stdout);
    if (upstreamCommit) {
      const remoteBehind = await isAncestor(runner, root, upstreamCommit, head);
      const localBehind = await isAncestor(runner, root, head, upstreamCommit);
      if (remoteBehind === false && localBehind === false) {
        return {
          ok: false,
          requiresForce: false,
          output: null,
          error: `Branch has diverged from ${upstreamName} — refusing to pull. Reconcile manually.`,
        };
      }
    }
  }

  const pull = await git(runner, ["pull", "--ff-only"], root, UPDATE_TIMEOUT_MS);
  const output = outputOf(pull) || null;
  if (pull.code !== 0) {
    return { ok: false, requiresForce: false, output, error: output || `git pull --ff-only exited with code ${pull.code}` };
  }
  return { ok: true, requiresForce: false, output, error: null };
}

async function idsSharingRoot(
  installed: PaseoPluginInfo[],
  records: Map<string, ManagedRecord>,
  root: string,
  runner: CommandRunner,
): Promise<string[]> {
  const resolved = await Promise.all(
    installed.map(async (plugin) => ({
      id: plugin.id,
      root: plugin.path ? (await resolveIdentity(plugin, records.get(plugin.id) ?? null, runner)).repoRoot : null,
    })),
  );
  return resolved.filter((entry) => entry.root === root).map((entry) => entry.id);
}

export interface UpdateOptions {
  force?: boolean;
  runner?: CommandRunner;
  installedOverride?: PaseoPluginInfo[];
  deps?: ProbeDeps;
}

export async function updatePlugin(
  pluginId: string,
  _workspaceId?: string,
  options: UpdateOptions = {},
): Promise<PluginUpdateActionResult> {
  const runner = options.runner ?? runCommand;
  const deps = options.deps ?? {};
  let installed: PaseoPluginInfo[];
  try {
    installed = options.installedOverride ?? (await listPlugins({ forceRefresh: true }));
  } catch (error) {
    return actionResult(pluginId, "error", `Unable to list installed plugins: ${errorOf(error)}`);
  }
  const info = installed.find((plugin) => plugin.id === pluginId);
  if (!info) return actionResult(pluginId, "error", `Plugin '${pluginId}' is not installed`);
  if (!info.path) return actionResult(pluginId, "error", `Plugin '${pluginId}' has no directory path`);

  if (info.source === "git") {
    const result = await invokePaseoUpdate([pluginId], runner);
    return actionResult(pluginId, result.status, result.error, result.output);
  }

  const records = await loadManagedRecords(deps);
  const identity = await resolveIdentity(info, records.get(pluginId) ?? null, runner);
  if (!identity.repoRoot) {
    return actionResult(pluginId, "error", `Plugin '${pluginId}' is not a git repository — no git update possible`);
  }
  const pull = await pullRoot(identity.repoRoot, options.force ?? false, runner);
  if (!pull.ok) {
    return actionResult(pluginId, "error", pull.error, pull.output, pull.requiresForce);
  }

  const ids = await idsSharingRoot(installed, records, identity.repoRoot, runner);
  // Never reload ourselves: this handler runs inside the plugin subprocess, so
  // reloading plugin-updates would kill the process mid-update (#210).
  const { reload, skippedSelf } = planReloads(ids);
  const reloadFailures: string[] = [];
  for (const outcome of await reloadSerially(reload, runner)) {
    if (!outcome.ok) reloadFailures.push(`${outcome.id}: ${outcome.error}`);
  }
  const output = pull.output ?? `Pulled ${identity.repoRoot}`;
  if (reloadFailures.length > 0) {
    return actionResult(pluginId, "error", `Pulled but failed to reload: ${reloadFailures.join("; ")}`, output);
  }
  // Updating ourselves: the pull succeeded, but only the host can apply it.
  if (skippedSelf.length > 0) {
    return actionResult(pluginId, "updated", null, `${output}\n${SELF_UPDATE_DETAIL}`);
  }
  return actionResult(pluginId, "updated", null, output);
}

export async function updateAllPlugins(
  _workspaceId?: string,
  options: UpdateOptions = {},
): Promise<{ results: PluginUpdateActionResult[] }> {
  const runner = options.runner ?? runCommand;
  const deps = options.deps ?? {};
  let installed: PaseoPluginInfo[];
  try {
    installed = options.installedOverride ?? (await listPlugins({ forceRefresh: true }));
  } catch (error) {
    return {
      results: [actionResult("all", "error", `Unable to list installed plugins: ${errorOf(error)}`)],
    };
  }

  const rows = await probeInstalled(installed, runner, { ...deps, scanOrphans: false });
  const directoryGroups = new Map<string, PluginUpdate[]>();
  const gitRows: PluginUpdate[] = [];
  for (const row of rows) {
    if (!row.updateAvailable) continue;
    if (row.source === "git") {
      gitRows.push(row);
      continue;
    }
    if (!row.repoRoot) continue;
    const group = directoryGroups.get(row.repoRoot) ?? [];
    group.push(row);
    directoryGroups.set(row.repoRoot, group);
  }

  const results: PluginUpdateActionResult[] = [];
  for (const row of gitRows) {
    const result = await invokePaseoUpdate([row.id], runner);
    results.push(actionResult(row.id, result.status, result.error, result.output));
  }

  // Phase 1: pull every affected directory root, collecting the outcome. Each
  // root is pulled exactly once (`directoryGroups` is keyed by root); reloads
  // are deliberately NOT interleaved here — a reload restarts a plugin
  // subprocess, and doing that mid-batch is what let a self/shared-root update
  // tear down the running updater and loop (#210).
  const pulled = new Map<string, { ids: string[]; pull: PullOutcome }>();
  for (const [root, group] of directoryGroups) {
    const ids = group.map((row) => row.id);
    const pull = await pullRoot(root, options.force ?? false, runner);
    pulled.set(root, { ids, pull });
  }

  // Phase 2: reload once, after every pull has completed, strictly serially.
  for (const [root, { ids, pull }] of pulled) {
    if (!pull.ok) {
      for (const id of ids) {
        results.push(actionResult(id, "error", pull.error, pull.output, pull.requiresForce));
      }
      continue;
    }
    const { reload, skippedSelf } = planReloads(ids);
    const outcomes = await reloadSerially(reload, runner);
    const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
    for (const id of ids) {
      if (skippedSelf.includes(id)) {
        results.push(
          actionResult(id, "updated", null, `${pull.output ?? `Pulled ${root}`}\n${SELF_UPDATE_DETAIL}`),
        );
        continue;
      }
      const reload = byId.get(id);
      results.push(
        reload?.ok
          ? actionResult(id, "updated", null, pull.output ?? `Pulled ${root}`)
          : actionResult(id, "error", reload?.error ?? "reload did not run", pull.output),
      );
    }
  }

  if (results.length === 0) {
    results.push(actionResult("all", "updated", null, "No plugins with remote updates"));
  }
  return { results };
}

export const testing = {
  probePlugin,
  probeInstalled,
  pullRoot,
  scanOrphanedDirs,
  checkInstalledPlugins,
  updatePlugin,
  updateAllPlugins,
  planReloads,
  loadManagedRecords,
  resolveIdentity,
  resolveRef,
  classifyBranch,
  classifyTag,
  SELF_PLUGIN_ID,
  PROBE_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  UPDATE_TIMEOUT_MS,
};

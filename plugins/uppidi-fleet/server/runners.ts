import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  getRunnerStatusConfig,
  type UppidiFleetStatus,
  type UppidiLocalRunner,
  type UppidiRunner,
  type UppidiRunnerScope,
  type UppidiRunnersOutput,
  type UppidiRunnerSource,
} from "../shared/contracts.js";
import {
  FORGEJO_API_TIMEOUT_MS,
  forgejoApiGet,
  forgejoToken,
  resolveForgejoHost,
} from "./forgejo-api.js";

const DEFAULT_REPO = "xpufx-org/paseo";
const PODMAN_TIMEOUT_MS = 3000;

export type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: any
) => Promise<{ stdout: string; stderr?: string }>;

let execFileAsync: ExecFileAsyncFn = promisify(execFile);

export function setExecFileAsyncForTest(fn: ExecFileAsyncFn | null): void {
  execFileAsync = fn || promisify(execFile);
}

/** `ActionRunner` as documented by the Forgejo runners API. */
interface RawForgejoRunner {
  id?: unknown;
  uuid?: unknown;
  name?: unknown;
  description?: unknown;
  ephemeral?: unknown;
  labels?: unknown;
  status?: unknown;
  version?: unknown;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The Forgejo runner scopes a repository's Actions jobs can draw from, in
 * descending specificity. A runner registered at repo, org, or user level all
 * serve the repo, so all three are read and merged rather than picking one and
 * hoping. Each scope reports its own outcome — a 403 on the repo scope must not
 * silently masquerade as "no runners".
 */
export function runnerScopeEndpoints(
  repo: string
): Array<{ scope: UppidiRunnerScope; path: string }> {
  const [owner, name] = repo.split("/");
  const scopes: Array<{ scope: UppidiRunnerScope; path: string }> = [];
  if (owner && name) {
    scopes.push({ scope: "repo", path: `/api/v1/repos/${owner}/${name}/actions/runners` });
  }
  if (owner) {
    scopes.push({ scope: "org", path: `/api/v1/orgs/${owner}/actions/runners` });
  }
  scopes.push({ scope: "user", path: `/api/v1/user/actions/runners` });
  return scopes;
}

/**
 * Projects raw `ActionRunner` records onto the panel contract. Every rendered
 * field comes from the API response; entries missing the identity the contract
 * requires are counted as skipped rather than surfaced under a made-up label.
 */
export function normalizeForgejoRunners(
  raw: unknown,
  scope: UppidiRunnerScope
): { runners: UppidiRunner[]; skipped: number } {
  const entries = Array.isArray(raw) ? raw : [];
  const runners: UppidiRunner[] = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      skipped += 1;
      continue;
    }
    const record = entry as RawForgejoRunner;
    const name = nonEmptyString(record.name);
    const uuid = nonEmptyString(record.uuid);
    const numericId =
      typeof record.id === "number" && Number.isFinite(record.id) ? String(record.id) : undefined;
    const id = uuid ?? numericId;
    if (!name || !id) {
      skipped += 1;
      continue;
    }
    const status = nonEmptyString(record.status) ?? "unknown";
    runners.push({
      id,
      name,
      status,
      available: getRunnerStatusConfig(status).available,
      scope,
      labels: Array.isArray(record.labels)
        ? record.labels.filter((label): label is string => typeof label === "string")
        : [],
      description: nonEmptyString(record.description),
      version: nonEmptyString(record.version),
      ephemeral: typeof record.ephemeral === "boolean" ? record.ephemeral : undefined,
    });
  }

  return { runners, skipped };
}

/** `podman ps --format json` emits an array; a single container arrives as an object. */
function parseContainerPayload(stdout: string): unknown[] {
  const trimmed = (stdout ?? "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // Malformed payload — reported as a local-source error by the caller.
  }
  return [];
}

/**
 * Containers running on this host. These are reported in their own group and
 * never folded into CI capacity: a developer's local container is not a runner
 * the CI fleet can schedule onto.
 */
export async function fetchLocalContainers(): Promise<{
  runners: UppidiLocalRunner[];
  error?: string;
}> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("podman", ["ps", "--format", "json"], {
      timeout: PODMAN_TIMEOUT_MS,
      encoding: "utf-8",
    }));
  } catch (err) {
    return { runners: [], error: err instanceof Error ? err.message : String(err) };
  }

  const runners: UppidiLocalRunner[] = [];
  for (const entry of parseContainerPayload(stdout)) {
    if (!entry || typeof entry !== "object") continue;
    const container = entry as Record<string, unknown>;
    const rawName = container.Names;
    const name =
      (Array.isArray(rawName) ? nonEmptyString(rawName[0]) : nonEmptyString(rawName)) ??
      nonEmptyString(container.Id) ??
      nonEmptyString(container.Image);
    const id = nonEmptyString(container.Id);
    if (!name || !id) continue;
    runners.push({
      id: id.slice(0, 12),
      name,
      status: nonEmptyString(container.State) ?? nonEmptyString(container.Status) ?? "unknown",
      image: nonEmptyString(container.Image),
      // Only shown when the runtime reports one — never a "recently active" guess.
      createdAt: nonEmptyString(container.CreatedAt) ?? nonEmptyString(container.Created),
    });
  }
  return { runners };
}

export async function handleUppidiRunners(
  _input: Record<string, never>,
  _context: PluginHandlerContext
): Promise<UppidiRunnersOutput> {
  const host = resolveForgejoHost();
  const repo = DEFAULT_REPO;
  const token = await forgejoToken(host);

  const scopes = runnerScopeEndpoints(repo);
  const responses = await Promise.all(
    scopes.map(async (scope) => ({
      ...scope,
      response: await forgejoApiGet<unknown>(scope.path, {
        host,
        token,
        timeoutMs: FORGEJO_API_TIMEOUT_MS,
      }),
    }))
  );

  const sources: UppidiRunnerSource[] = [];
  const runners: UppidiRunner[] = [];
  const seen = new Set<string>();

  for (const { scope, path, response } of responses) {
    if (response.outcome === "ok") {
      const { runners: scoped, skipped } = normalizeForgejoRunners(response.data, scope);
      for (const runner of scoped) {
        if (seen.has(runner.id)) continue;
        seen.add(runner.id);
        runners.push(runner);
      }
      sources.push({
        key: scope,
        kind: "forgejo-runners",
        endpoint: path,
        ok: true,
        httpStatus: response.httpStatus,
        runnerCount: scoped.length,
        error: skipped
          ? `${skipped} entr${skipped === 1 ? "y" : "ies"} omitted: no Forgejo id or name`
          : undefined,
      });
      continue;
    }
    sources.push({
      key: scope,
      kind: "forgejo-runners",
      endpoint: path,
      ok: false,
      failure: response.outcome === "http-error" ? "http" : "unreachable",
      httpStatus: response.outcome === "http-error" ? response.httpStatus : undefined,
      error: response.error,
    });
  }

  const fleetSources = sources.filter((s) => s.kind === "forgejo-runners");
  const answered = fleetSources.filter((s) => s.ok);
  const fleetStatus: UppidiFleetStatus =
    answered.length === 0
      ? fleetSources.some((s) => s.failure === "unreachable")
        ? "unreachable"
        : "forbidden"
      : runners.length === 0
        ? "empty"
        : "ok";

  const local = await fetchLocalContainers();
  sources.push({
    key: "local",
    kind: "local-containers",
    endpoint: "podman ps --format json",
    ok: !local.error,
    runnerCount: local.runners.length,
    error: local.error,
  });

  const unknown = fleetStatus === "unreachable" || fleetStatus === "forbidden";
  return {
    ok: !unknown,
    fleetStatus,
    runners,
    totalCount: runners.length,
    onlineCount: runners.filter((runner) => runner.available).length,
    sources,
    localRunners: local.runners,
    error: unknown ? firstFailure(fleetSources) : undefined,
  };
}

/** A one-line reason the fleet could not be read, preferring transport failures. */
function firstFailure(fleetSources: UppidiRunnerSource[]): string | undefined {
  const failed = fleetSources.filter((s) => !s.ok);
  if (failed.length === 0) return undefined;
  const unreachable = failed.find((s) => s.failure === "unreachable");
  const first = unreachable ?? failed[0]!;
  return `Forgejo runner API ${first.failure === "unreachable" ? "unreachable" : "rejected the request"}: ${first.error ?? "no reason reported"}`;
}

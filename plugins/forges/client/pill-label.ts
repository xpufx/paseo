import {
  activeForgeForDirectory,
  displayNameForDirectory,
  forgeSettingsContract,
  formatIssueCountLabel,
  openIssuesContract,
  workspaceNameKey,
  type ForgeSettings,
  type OpenIssuesOutput,
} from "../shared/issues.js";

export interface ForgePillLabelInput {
  /** Workspace display name (explicit label, else the resolved repo). */
  displayName?: string | null;
  /** Open issue count, or null/undefined while unknown. */
  count?: number | null;
  /** True while the first fetch is still in flight. */
  loading?: boolean;
}

/**
 * Composer pill label for a workspace's open issues.
 *
 * Resolution order: the workspace display name while the count is unknown
 * (`tea`), `name · N` once it resolves (`tea · 3`), the bare count when no
 * display name exists (`3 issues`), and an ellipsis while nothing is known.
 * Never a placeholder literal: the old `iss` regression came from a bare
 * fallback leaking into the host-rendered button label.
 */
export function forgePillLabel(input: ForgePillLabelInput = {}): string {
  if (input.loading) return "...";
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : null;
  const count = input.count ?? null;
  if (count == null) return displayName ?? "...";
  return displayName ? `${displayName} · ${count}` : formatIssueCountLabel(count);
}

/** Workspace coordinates the label resolver needs, mirroring the plugin snapshot. */
export interface ForgePillWorkspace {
  directory?: string;
  projectRootPath?: string;
}

export type ForgePillRpc = (contract: unknown, input: unknown) => Promise<unknown>;

/**
 * Host-provided capabilities the pill label needs outside React. On
 * button-shaped hosts (Paseo 0.8+) `renderPill` never mounts, so the label
 * resolver must fetch its own data instead of reading a hook-populated cache.
 */
export interface ForgePillRuntime {
  rpc: ForgePillRpc;
  resolveWorkspace: (workspaceId: string) => Promise<ForgePillWorkspace | null>;
  /** Injectable clock so tests can age the caches deterministically. */
  now?: () => number;
}

export interface ForgePillContext {
  agentId: string;
  workspaceId: string;
}

export interface ForgeLabelResolver {
  /** Resolves the live pill label, refreshing the count when stale. */
  resolve(ctx: ForgePillContext): Promise<string>;
}

interface CachedCount {
  directory?: string;
  count: number | null;
  displayName: string | null;
  at: number;
}

const PILL_DATA_TTL_MS = 15000;
const SETTINGS_TTL_MS = 30000;
const WORKSPACE_TTL_MS = 30000;

/**
 * Builds a self-contained composer pill label resolver.
 *
 * On button-shaped hosts the helper resolves the label once at registration and
 * then every refresh interval, so this resolver owns its data: it resolves the
 * workspace directory from the host, reads the plugin settings, and queries the
 * open-issues contract itself. Counts are cached per workspace with a TTL and a
 * shared in-flight guard so multiple agent pills in one workspace stay cheap.
 * Nothing here ever returns a placeholder literal — failures fall back to the
 * workspace name or an ellipsis.
 */
export function createForgeLabelResolver(runtime: ForgePillRuntime): ForgeLabelResolver {
  const now = runtime.now ?? (() => Date.now());
  const counts = new Map<string, CachedCount>();
  const countInflight = new Map<string, Promise<void>>();
  const workspaces = new Map<string, { info: ForgePillWorkspace | null; at: number }>();
  const workspaceInflight = new Map<string, Promise<ForgePillWorkspace | null>>();
  let settingsCache: { value: ForgeSettings; at: number } | null = null;
  let settingsInflight: Promise<ForgeSettings> | null = null;

  function readCachedLabel(ctx: ForgePillContext): string {
    const cached = counts.get(ctx.workspaceId);
    return forgePillLabel({ displayName: cached?.displayName ?? null, count: cached?.count ?? null });
  }

  async function resolveWorkspace(workspaceId: string): Promise<ForgePillWorkspace | null> {
    const cached = workspaces.get(workspaceId);
    if (cached && now() - cached.at < WORKSPACE_TTL_MS) return cached.info;
    let inflight = workspaceInflight.get(workspaceId);
    if (!inflight) {
      inflight = runtime
        .resolveWorkspace(workspaceId)
        .then((info) => {
          workspaces.set(workspaceId, { info, at: now() });
          return info;
        })
        .catch(() => null)
        .finally(() => {
          workspaceInflight.delete(workspaceId);
        });
      workspaceInflight.set(workspaceId, inflight);
    }
    return inflight;
  }

  async function resolveSettings(): Promise<ForgeSettings> {
    if (settingsCache && now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
    if (!settingsInflight) {
      settingsInflight = runtime
        .rpc(forgeSettingsContract.get, {})
        .then((value) => value as ForgeSettings)
        .catch(() => forgeSettingsContract.defaultSettings)
        .then((value) => {
          settingsCache = { value, at: now() };
          return value;
        })
        .finally(() => {
          settingsInflight = null;
        });
    }
    return settingsInflight;
  }

  async function refresh(ctx: ForgePillContext): Promise<void> {
    const workspace = await resolveWorkspace(ctx.workspaceId);
    const directory = workspace?.directory;
    const cached = counts.get(ctx.workspaceId);
    if (cached && cached.directory === directory && now() - cached.at < PILL_DATA_TTL_MS) return;

    const key = directory ?? ctx.workspaceId;
    let inflight = countInflight.get(key);
    if (!inflight) {
      inflight = (async () => {
        const settings = await resolveSettings();
        const remoteUrl = activeForgeForDirectory(settings, directory) ?? undefined;
        const data = (await runtime.rpc(openIssuesContract, {
          directory: directory ?? undefined,
          remoteUrl: remoteUrl || undefined,
        })) as OpenIssuesOutput | undefined;
        const count = data && !data.error ? (data.openIssueCount ?? data.issues.length) : null;
        const nameKey = workspaceNameKey(directory, workspace?.projectRootPath);
        const displayName = displayNameForDirectory(settings, nameKey, data?.repo);
        counts.set(ctx.workspaceId, { directory, count, displayName, at: now() });
      })()
        .catch(() => {
          // Keep the last cached label when the forge is unreachable.
        })
        .finally(() => {
          countInflight.delete(key);
        });
      countInflight.set(key, inflight);
    }
    await inflight;
  }

  return {
    resolve: async (ctx) => {
      await refresh(ctx);
      return readCachedLabel(ctx);
    },
  };
}

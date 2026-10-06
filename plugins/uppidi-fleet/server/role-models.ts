import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  RoleModelConfig,
  UppidiRoleModelsOutput,
  UppidiSetRoleModelInput,
  UppidiSetRoleModelOutput,
} from "../shared/contracts.js";

const defaultExecFileAsync = promisify(execFile);
let execFileAsync = defaultExecFileAsync;

export type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: unknown
) => Promise<{ stdout: string; stderr?: string }>;

// Test seam: the fleet suite stubs the CLI through this instead of shelling
// out to the real `paseo` binary (mirrors the agents.ts seam).
export function setExecFileAsyncForTest(fn: ExecFileAsyncFn | null): void {
  execFileAsync = (fn || defaultExecFileAsync) as typeof execFileAsync;
}

const SCOPED_CONFIG_FILENAME = "role-models.json";
const LEGACY_CONFIG_BASENAME = "uppidi-fleet-role-models.json";

const AGENT_MUX_PROFILE_HOME_RE = /(?:^|[\\/])\.agent-mux[\\/]profiles[\\/]/;

/**
 * Resolve the real user home even when `HOME` points into an agent-mux profile.
 * In a profile session `HOME` is `~/.agent-mux/profiles/<provider>/<profile>`
 * while the live Paseo state stays on the host home. agent-mux exports
 * `REAL_HOME` for every profile session, so prefer it; otherwise strip the
 * profile prefix so paths under `~/.paseo` still resolve to the host (#973).
 */
export function resolveHostHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = (env.HOME || homedir() || "").trim();
  if (!home || !AGENT_MUX_PROFILE_HOME_RE.test(home)) {
    return home;
  }
  const realHome = (env.REAL_HOME || "").trim();
  if (realHome) return realHome;
  const marker = home.match(AGENT_MUX_PROFILE_HOME_RE);
  if (marker && typeof marker.index === "number" && marker.index > 0) {
    return home.slice(0, marker.index);
  }
  return home;
}

/** Scoped role-model config path under the plugin data dir (#1012). */
export function defaultRoleModelsConfigPath(home: string = resolveHostHome()): string {
  return join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", SCOPED_CONFIG_FILENAME);
}

/**
 * Legacy unscoped role-model config paths in migration priority order: the
 * pre-#1012 home path introduced by #945, then the original `.paseo` location,
 * each with its `.bak` sibling.
 */
export function legacyRoleModelsConfigPaths(home: string = resolveHostHome()): string[] {
  const homeConfig = join(home, LEGACY_CONFIG_BASENAME);
  const paseoConfig = join(home, ".paseo", LEGACY_CONFIG_BASENAME);
  return [homeConfig, `${homeConfig}.bak`, paseoConfig, `${paseoConfig}.bak`];
}

// Resolved per call rather than at import time so an override set after the
// module loads still takes effect, and so an absolute override is honored
// instead of being re-rooted under the operator's home (#945).
function roleModelsConfigOverride(): string | null {
  const override = process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG?.trim();
  if (!override) return null;
  return isAbsolute(override) ? override : join(resolveHostHome(), override);
}

export function getRoleModelsConfigPath(): string {
  return roleModelsConfigOverride() ?? defaultRoleModelsConfigPath();
}

/**
 * One-time migration of a legacy unscoped role-model config into the scoped
 * plugin data dir. Copies the first readable legacy file only when the scoped
 * file does not exist yet, atomically, and leaves the original in place.
 * Returns true when a migration was performed.
 */
export function migrateLegacyRoleModelsConfig(
  configPath: string = defaultRoleModelsConfigPath(),
  legacyPaths: readonly string[] = legacyRoleModelsConfigPaths(),
): boolean {
  try {
    if (existsSync(configPath)) return false;
    for (const legacyPath of legacyPaths) {
      if (!legacyPath || legacyPath === configPath || !existsSync(legacyPath)) continue;
      let raw: string;
      try {
        raw = readFileSync(legacyPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      } catch {
        continue;
      }
      try {
        const dir = dirname(configPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, raw, "utf-8");
        renameSync(tmp, configPath);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    // Ignore migration errors and fall through to defaults.
  }
  return false;
}

export const DEFAULT_ROLE_MODELS: Record<string, RoleModelConfig> = {
  "front-desk": {
    role: "front-desk",
    primaryModel: "antigravity-acp/gemini-3.8-flash-low",
    fallbackGroup: [
      "antigravity-acp/gemini-3.8-flash-low",
      "uppidi/opencode-go/deepseek-v4.1-flash",
      "opencode/ollama-cloud/deepseek-v4.1-flash",
    ],
  },
  orchestrator: {
    role: "orchestrator",
    // Enabled-provider defaults (#987): the orchestrator spawn path must never
    // resolve to a disabled provider (antigravity-acp/codex) out of the box.
    primaryModel: "pi/commandcode/deepseek/deepseek-v4-flash",
    fallbackGroup: [
      "pi/commandcode/deepseek/deepseek-v4-flash",
      "pi/commandcode/deepseek/deepseek-v4.1-flash",
      "antigravity/gemini-3.8-flash-low",
    ],
  },
  "coding-agent": {
    role: "coding-agent",
    primaryModel: "codex/gpt-5.6-terra",
    fallbackGroup: [
      "codex/gpt-5.6-terra",
      "codex/gpt-5.6-luna",
      "uppidi/opencode-go/deepseek-v4.1-flash",
    ],
  },
  auditor: {
    role: "auditor",
    primaryModel: "uppidi/opencode-go/muse-spark-1.3-contributor",
    fallbackGroup: [
      "uppidi/opencode-go/muse-spark-1.3-contributor",
      "opencode/opencode/muse-spark-1.3-contributor-free",
    ],
  },
};

export function loadSavedRoleModels(): Record<string, RoleModelConfig> {
  try {
    const override = roleModelsConfigOverride();
    const configPath = override ?? defaultRoleModelsConfigPath();
    // Only the default scoped path auto-migrates: an explicit override (tests,
    // custom deployments) owns its own file lifecycle.
    if (!override) {
      migrateLegacyRoleModelsConfig(configPath);
    }
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return { ...DEFAULT_ROLE_MODELS, ...parsed };
      }
    }
  } catch {
    // Ignore read errors and fallback to defaults
  }
  return { ...DEFAULT_ROLE_MODELS };
}

export function saveRoleModels(roles: Record<string, RoleModelConfig>): void {
  try {
    const configPath = getRoleModelsConfigPath();
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(roles, null, 2), "utf-8");
  } catch {
    // Ignore write errors if permission denied
  }
}

export async function discoverAvailableModels(
  context?: PluginHandlerContext
): Promise<string[]> {
  void context;
  const models = new Set<string>();

  let providers: string[];
  try {
    providers = await listEnabledProviders();
  } catch {
    return [];
  }
  if (providers.length === 0) {
    return [];
  }

  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      try {
        const { stdout } = await execFileAsync(
          "paseo",
          ["provider", "models", provider, "--json"],
          {
            timeout: 5000,
            encoding: "utf-8",
          }
        );
        const parsed: unknown = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          return;
        }
        for (const m of parsed) {
          const id =
            typeof (m as { id?: unknown })?.id === "string"
              ? ((m as { id: string }).id as string)
              : null;
          if (id && id.length > 0) {
            models.add(`${provider}/${id}`);
          }
        }
      } catch {
        // A single provider failing (e.g. disabled after listing) must not
        // fail the whole discovery pass.
      }
    })
  );
  void perProvider;

  return Array.from(models).sort();
}

export async function listEnabledProviders(): Promise<string[]> {
  const { stdout } = await execFileAsync("paseo", ["provider", "ls", "--json"], {
    timeout: 5000,
    encoding: "utf-8",
  });
  const parsed: unknown = JSON.parse(stdout);
  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { providers?: unknown })?.providers)
      ? (parsed as { providers: unknown[] }).providers
      : [];
  const providers: string[] = [];
  for (const p of entries) {
    const rec = p as {
      provider?: unknown;
      id?: unknown;
      enabled?: unknown;
      status?: unknown;
    };
    const name =
      typeof rec?.provider === "string"
        ? rec.provider
        : typeof rec?.id === "string"
          ? rec.id
          : null;
    if (!name) {
      continue;
    }
    // `paseo provider ls --json` reports string fields such as
    // enabled: "Enabled"|"Disabled" and status: "available"|"unavailable".
    // Skip explicitly disabled/unavailable providers; attempt everything
    // else (including "error" status) and let per-provider failures fall out
    // naturally.
    const enabled = typeof rec?.enabled === "string" ? rec.enabled.toLowerCase() : "";
    const status = typeof rec?.status === "string" ? rec.status.toLowerCase() : "";
    if (enabled === "disabled" || status === "unavailable") {
      continue;
    }
    providers.push(name);
  }
  return providers;
}

export async function handleUppidiRoleModels(
  _input: Record<string, never>,
  context: PluginHandlerContext
): Promise<UppidiRoleModelsOutput> {
  try {
    const roles = loadSavedRoleModels();
    const availableModels = await discoverAvailableModels(context);
    return {
      ok: true,
      roles,
      availableModels,
    };
  } catch (err: any) {
    return {
      ok: false,
      roles: DEFAULT_ROLE_MODELS,
      availableModels: [],
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiSetRoleModel(
  input: UppidiSetRoleModelInput,
  _context: PluginHandlerContext
): Promise<UppidiSetRoleModelOutput> {
  try {
    const roles = loadSavedRoleModels();
    const existing = roles[input.role] || {
      role: input.role,
      primaryModel: input.primaryModel,
      fallbackGroup: [input.primaryModel],
    };

    roles[input.role] = {
      ...existing,
      primaryModel: input.primaryModel,
      fallbackGroup: input.fallbackGroup || existing.fallbackGroup || [input.primaryModel],
    };

    saveRoleModels(roles);

    return {
      ok: true,
      message: `Updated model for role ${input.role} to ${input.primaryModel}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

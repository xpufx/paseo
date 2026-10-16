/**
 * MCP Injection — agent.create hook that reads PASEO_FLEET_ROLE from env,
 * selects per-class MCP servers, and injects them via registerMcpInjection.
 *
 * Also exposes a settings-driven profile toggle so operators can enable or
 * disable specific MCP injection profiles (Serena, etc.) without redeploying.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import {
  createPluginLogger,
  registerMcpInjection,
  type McpInjectionServer,
} from "paseo-plugin-helper/server";
import {
  SERENA_MCP_PROFILE,
  type McpInjectionProfile,
  type UppidiFleetSettings,
} from "../shared/contracts.js";
import { getUppidiFleetSettingsStorage } from "./settings.js";

const log = createPluginLogger("uppidi-fleet", { subsystem: "mcp-injection" });

/** Marker key stamped by spawnPaseoAgent; stripped by this hook. */
export const FLEET_ROLE_ENV_KEY = "PASEO_FLEET_ROLE";

// ---------------------------------------------------------------------------
// Class → server mapping (research doc §4 matrix)
// ---------------------------------------------------------------------------

/** Canonical fleet role values produced by spawnPaseoAgent. */
export type FleetRole = "front-desk" | "orchestrator" | "coding-agent" | "worker" | "auditor";

/** Read-only default injected when no class marker is present. */
const READ_ONLY_DEFAULTS: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

/** Built-in profiles shipped with the fleet plugin. */
const BUILTIN_PROFILES: McpInjectionProfile[] = [SERENA_MCP_PROFILE];

/**
 * Resolve which profiles are active given user settings overrides.
 * `enabled` on the settings object gates all injection; per-profile toggles
 * override the built-in default.
 */
export function resolveActiveProfiles(
  settingsEnabled: boolean,
  profileToggles: Record<string, boolean>,
): McpInjectionProfile[] {
  if (!settingsEnabled) return [];
  return BUILTIN_PROFILES.filter((p) => profileToggles[p.id] !== false);
}

// ---------------------------------------------------------------------------
// Agent.create hook
// ---------------------------------------------------------------------------

/**
 * Register the MCP injection hook on the given server. Returns a cleanup
 * function that unregisters the hook.
 *
 * The hook:
 * 1. Checks whether the agent is a fleet agent via request.env.PASEO_FLEET_ROLE
 *    or request.config.env.PASEO_FLEET_ROLE.
 * 2. Injects profile-based MCP servers (e.g. Serena) only when enabled in settings
 *    AND the agent is a fleet agent.
 * 3. Injects class-appropriate MCP servers into `config.mcpServers`.
 * 4. Strips the env marker before returning so it doesn't leak to child processes.
 */
export function registerFleetMcpInjection(
  server: McpInjectionServer,
  settings: { enabled: boolean; profiles: Record<string, boolean> },
): () => void {
  // Defensive guard: tests may pass a mock server without `before`.
  if (typeof (server as any)?.before !== "function") {
    return () => {};
  }

  const removeHooks: (() => void)[] = [];

  // Helper to determine if an agent is fleet-managed.
  const isFleetAgent = (request: any): boolean =>
    Boolean(
      request.env?.[FLEET_ROLE_ENV_KEY] ||
      request.config?.env?.[FLEET_ROLE_ENV_KEY]
    );

  // Profile-based injection hook (settings-driven, filtered to fleet agents)
  // Registered first so it evaluates `isFleetAgent` before the per-class hook strips the marker.
  const activeProfiles = resolveActiveProfiles(settings.enabled, settings.profiles);
  if (activeProfiles.length > 0) {
    for (const profile of activeProfiles) {
      const serverName = `uppidi-mcp-${profile.id}`;
      try {
        const remove = registerMcpInjection(server, {
          serverName,
          config: {
            type: "stdio",
            command: profile.mcpCommand,
            args: profile.mcpArgs,
          },
          filter: ({ request }) => isFleetAgent(request),
        });
        removeHooks.push(remove);
        log.info(`injection: registered profile "${profile.id}" (${serverName})`, {
          command: `${profile.mcpCommand} ${profile.mcpArgs.join(" ")}`,
        });
      } catch (cause) {
        log.error(`injection: failed to register profile "${profile.id}": ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  } else if (settings.enabled) {
    log.info("injection: settings enabled but no profiles selected");
  }

  // Per-class injection hook — runs after profile injection
  removeHooks.push(
    server.before("agent.create", ({ request }) => {
      const role = (request.env?.[FLEET_ROLE_ENV_KEY] ?? (request.config as any)?.env?.[FLEET_ROLE_ENV_KEY]) as FleetRole | undefined;

      if (role) {
        // Strip the marker so it doesn't leak into child processes
        const nextEnv = request.env ? { ...request.env } : undefined;
        if (nextEnv) {
          delete nextEnv[FLEET_ROLE_ENV_KEY];
        }

        const nextConfigEnv = (request.config as any)?.env ? { ...(request.config as any).env } : undefined;
        if (nextConfigEnv) {
          delete nextConfigEnv[FLEET_ROLE_ENV_KEY];
        }

        log.debug(`injecting MCP servers for role "${role}"`, { role });

        return {
          ...request,
          ...(nextEnv ? { env: nextEnv } : {}),
          config: {
            ...request.config,
            ...(nextConfigEnv ? { env: nextConfigEnv } : {}),
            mcpServers: {
              ...(request.config.mcpServers ?? {}),
              // TODO: populate per-class servers from the matrix (§4 of research doc)
              // For now the class-specific layer is a placeholder until the
              // stdio transport decision (#1020 §5.1) lands.
            },
          },
        };
      }

      // No class marker — apply read-only defaults (no-op today).
      return request;
    }),
  );

  return () => {
    for (const fn of removeHooks) fn();
  };
}

/**
 * Register an agent.create before-hook that injects HOOK_ROUTER_BASE_URL
 * into request.config.env and request.env (#1398).
 */
export function registerHookRouterEnvInjection(
  server: McpInjectionServer | any,
  getSettings: () => UppidiFleetSettings = () => getUppidiFleetSettingsStorage().read(),
): () => void {
  if (typeof (server as any)?.before !== "function") {
    return () => {};
  }

  return server.before("agent.create", ({ request }: { request: any }) => {
    const settings = getSettings();
    const host = settings?.hookHost || "127.0.0.1";
    const port = settings?.hookPort || 8099;
    const routerUrl = `http://${host}:${port}`;

    if (!request.config) {
      request.config = {};
    }
    if (!request.config.env) {
      request.config.env = {};
    }
    request.config.env.HOOK_ROUTER_BASE_URL = routerUrl;

    if (!request.env) {
      request.env = {};
    }
    request.env.HOOK_ROUTER_BASE_URL = routerUrl;

    return request;
  });
}

/**
 * Stable path for the fleet MCP stdio server. Mirrors x-comms' stable-path
 * pattern so the binary survives plugin checkouts being replaced.
 */
export const STABLE_FLEET_BIN_DIRNAME = "bin";
export const STABLE_FLEET_SERVER_FILENAME = "fleet-mcp-server.bundled.mjs";

export function stableFleetServerPath(stateDirPath?: string): string {
  const home = process.env.HOME ?? homedir();
  const base = stateDirPath ?? join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
  return join(base, STABLE_FLEET_BIN_DIRNAME, STABLE_FLEET_SERVER_FILENAME);
}

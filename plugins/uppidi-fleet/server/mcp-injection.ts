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
} from "../shared/contracts.js";

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
 * 1. Reads `request.env.PASEO_FLEET_ROLE` to determine the agent class.
 * 2. Injects the class-appropriate MCP servers into `config.mcpServers`.
 * 3. Strips the env marker before returning so it doesn't leak.
 * 4. If injection profiles are enabled in settings, also adds those servers.
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

  // Per-class injection hook
  removeHooks.push(
    server.before("agent.create", ({ request }) => {
      const role = request.env?.[FLEET_ROLE_ENV_KEY] as FleetRole | undefined;

      if (role) {
        // Strip the marker so it doesn't leak into child processes
        const nextEnv = { ...request.env };
        delete nextEnv[FLEET_ROLE_ENV_KEY];

        log.debug(`injecting MCP servers for role "${role}"`, { role });

        return {
          request: {
            ...request,
            env: nextEnv,
            config: {
              ...request.config,
              mcpServers: {
                ...(request.config.mcpServers ?? {}),
                // TODO: populate per-class servers from the matrix (§4 of research doc)
                // For now the class-specific layer is a placeholder until the
                // stdio transport decision (#1020 §5.1) lands.
              },
            },
          },
        };
      }

      // No class marker — apply read-only defaults (no-op today).
      return request;
    }),
  );

  // Profile-based injection hook (settings-driven)
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

  return () => {
    for (const fn of removeHooks) fn();
  };
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

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PluginStorage, createPluginLogger, registerSettingsRpc } from "paseo-plugin-helper/server";
import {
  agentMuxClearCooldownRpc,
  agentMuxConfigRpc,
  agentMuxCooldownsRpc,
  agentMuxLogsRpc,
  agentMuxProbeRpc,
  agentMuxProfilesRpc,
  agentMuxStatusRpc,
  agentMuxToggleProfileRpc,
} from "../shared/contracts.js";
import { agentMuxSettings } from "../shared/settings.js";
import type { PluginSettingsValues } from "../shared/types.js";
import {
  runBwrapVersion,
  runClearCooldown,
  runConfig,
  runCooldowns,
  runLogs,
  runProbe,
  runProfiles,
  runStatus,
  runWrappers,
} from "./cli.js";
import {
  parseBwrapVersion,
  parseConfigListOutput,
  parseCooldownsOutput,
  parseLogsOutput,
  parseProbeOutput,
  parseProfileListOutput,
  parseStatusOutput,
  parseWrappersOutput,
} from "./parser.js";

const log = createPluginLogger("agent-mux");

export function registerAgentMuxHandlers(
  server: PluginServerContext,
  overrides?: {
    cli?: {
      runStatus?: typeof runStatus;
      runBwrapVersion?: typeof runBwrapVersion;
      runProfiles?: typeof runProfiles;
      runCooldowns?: typeof runCooldowns;
      runLogs?: typeof runLogs;
      runConfig?: typeof runConfig;
      runWrappers?: typeof runWrappers;
      runProbe?: typeof runProbe;
      runClearCooldown?: typeof runClearCooldown;
    };
    toggleStorage?: PluginStorage<Record<string, boolean>>;
    settingsStorage?: PluginStorage<PluginSettingsValues>;
  }
) {
  const toggleStorage =
    overrides?.toggleStorage ??
    new PluginStorage<Record<string, boolean>>("agent-mux", "profile-toggles.json", {
      defaultData: {},
    });

  const settingsStorage =
    overrides?.settingsStorage ??
    new PluginStorage<PluginSettingsValues>("agent-mux", "settings.json", {
      defaultData: agentMuxSettings.defaultSettings,
      schema: agentMuxSettings.schema,
    });

  const cli = {
    runStatus: overrides?.cli?.runStatus ?? runStatus,
    runBwrapVersion: overrides?.cli?.runBwrapVersion ?? runBwrapVersion,
    runProfiles: overrides?.cli?.runProfiles ?? runProfiles,
    runCooldowns: overrides?.cli?.runCooldowns ?? runCooldowns,
    runLogs: overrides?.cli?.runLogs ?? runLogs,
    runConfig: overrides?.cli?.runConfig ?? runConfig,
    runWrappers: overrides?.cli?.runWrappers ?? runWrappers,
    runProbe: overrides?.cli?.runProbe ?? runProbe,
    runClearCooldown: overrides?.cli?.runClearCooldown ?? runClearCooldown,
  };

  // Register settings RPC
  registerSettingsRpc(server, agentMuxSettings, settingsStorage);

  // 1. Status RPC
  server.handle(agentMuxStatusRpc, async (input) => {
    try {
      const [rawStatus, rawBwrap] = await Promise.all([
        cli.runStatus(input?.probe, input?.provider),
        cli.runBwrapVersion(),
      ]);
      const bwrapVersion = rawBwrap ? parseBwrapVersion(rawBwrap) : undefined;
      const profileOverride = process.env.AGENT_MUX_PROFILE || null;
      return parseStatusOutput(rawStatus, { bwrapVersion, profileOverride });
    } catch (err) {
      log.error("Failed to fetch agent-mux status", { error: err });
      throw err;
    }
  });

  // 2. Profiles RPC
  server.handle(agentMuxProfilesRpc, async (input) => {
    try {
      const raw = await cli.runProfiles(input?.provider);
      const parsed = parseProfileListOutput(raw);
      const toggles = toggleStorage.read() ?? {};

      // Merge saved enabled status
      for (const prov of parsed.providers) {
        for (const prof of prov.profiles) {
          const key = `${prov.id}:${prof.name}`;
          if (typeof toggles[key] === "boolean") {
            prof.enabled = toggles[key];
          }
        }
      }
      return parsed;
    } catch (err) {
      log.error("Failed to fetch agent-mux profiles", { error: err });
      throw err;
    }
  });

  // 3. Cooldowns RPC
  server.handle(agentMuxCooldownsRpc, async () => {
    try {
      const raw = await cli.runCooldowns();
      return parseCooldownsOutput(raw);
    } catch (err) {
      log.error("Failed to fetch agent-mux cooldowns", { error: err });
      throw err;
    }
  });

  // 4. Logs RPC
  server.handle(agentMuxLogsRpc, async (input) => {
    try {
      const raw = await cli.runLogs(input?.tail ?? 50);
      return parseLogsOutput(raw, input?.filterType);
    } catch (err) {
      log.error("Failed to fetch agent-mux logs", { error: err });
      throw err;
    }
  });

  // 5. Config RPC
  server.handle(agentMuxConfigRpc, async () => {
    try {
      const [rawConfig, rawWrappers] = await Promise.all([cli.runConfig(), cli.runWrappers()]);
      const configPayload = parseConfigListOutput(rawConfig);
      const wrappers = parseWrappersOutput(rawWrappers);
      configPayload.wrappers = wrappers;
      return configPayload;
    } catch (err) {
      log.error("Failed to fetch agent-mux config", { error: err });
      throw err;
    }
  });

  // 6. Probe RPC
  server.handle(agentMuxProbeRpc, async (input) => {
    try {
      const raw = await cli.runProbe(input.provider, input.profile, input.pool);
      return parseProbeOutput(raw, input.provider);
    } catch (err) {
      log.error("Failed to probe provider", { provider: input.provider, error: err });
      throw err;
    }
  });

  // 7. Toggle Profile RPC
  server.handle(agentMuxToggleProfileRpc, async (input) => {
    try {
      const key = `${input.provider}:${input.profile}`;
      const toggles = toggleStorage.read() ?? {};
      toggles[key] = input.enabled;
      toggleStorage.write(toggles);
      log.info(`Updated profile toggle ${key} -> ${input.enabled}`);
      return { ok: true, enabled: input.enabled };
    } catch (err) {
      log.error("Failed to toggle profile", { input, error: err });
      throw err;
    }
  });

  // 8. Clear Cooldown RPC
  server.handle(agentMuxClearCooldownRpc, async (input) => {
    try {
      const msg = await cli.runClearCooldown(input?.provider, input?.profile, input?.pool);
      return { ok: true, message: msg };
    } catch (err) {
      log.error("Failed to clear cooldown", { input, error: err });
      throw err;
    }
  });
}

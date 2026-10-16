import { describe, expect, it } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
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
import { registerAgentMuxHandlers } from "./handlers.js";

function createMockServer(): {
  server: PluginServerContext;
  handlers: Map<string, (input: any) => Promise<any>>;
} {
  const handlers = new Map<string, (input: any) => Promise<any>>();
  const server = {
    handle(contract: any, fn: any) {
      handlers.set(contract.name, fn);
    },
  } as unknown as PluginServerContext;
  return { server, handlers };
}

describe("registerAgentMuxHandlers", () => {
  it("registers and executes all RPC handlers", async () => {
    const { server, handlers } = createMockServer();

    let storageState: Record<string, boolean> = {};
    const mockStorage = {
      read: () => storageState,
      write: (data: Record<string, boolean>) => {
        storageState = data;
      },
    } as any;

    const mockCli = {
      runStatus: async () => `
=== agent-mux Provider & Profile Status [Isolation Mode: scoped] ===
Provider: Google Antigravity (antigravity)
  (No profiles configured at /profiles)
`,
      runBwrapVersion: async () => "bubblewrap 0.9.0",
      runProfiles: async () => `
=== Configured Account Profiles [Isolation Mode: scoped] ===
Provider: Google Antigravity (antigravity)
  • okt [Authenticated] (okt@test.com) -> /dir/okt
`,
      runCooldowns: async () => `
=== Active Quota Cooldown Locks ===
  (No active cooldown locks. All accounts are ready for routing.)
`,
      runLogs: async () => `
=== agent-mux Logs (/logs/agent-mux.log) ===
[2026-10-16T08:00:00.000Z] [INFO] System initialized
`,
      runConfig: async () => `
=== agent-mux Configuration ===
Config file: /config.json
Active surface_account: none
Active routingPolicy: pool-strict
Settings in config file:
{}
`,
      runWrappers: async () => `
=== agent-mux CLI Wrappers ===
  • agy [WRAPPED] /bin/agy -> /bin/agy.bin
`,
      runProbe: async () => `
=== Probing Google Antigravity ===
• Profile: okt
  [Probing okt (gemini)]... [HEALTHY: OK]
`,
      runClearCooldown: async () => "Cleared all active cooldown locks",
    };

    registerAgentMuxHandlers(server, {
      cli: mockCli,
      toggleStorage: mockStorage,
    });

    // Verify registration
    expect(handlers.has(agentMuxStatusRpc.name)).toBe(true);
    expect(handlers.has(agentMuxProfilesRpc.name)).toBe(true);
    expect(handlers.has(agentMuxCooldownsRpc.name)).toBe(true);
    expect(handlers.has(agentMuxLogsRpc.name)).toBe(true);
    expect(handlers.has(agentMuxConfigRpc.name)).toBe(true);
    expect(handlers.has(agentMuxProbeRpc.name)).toBe(true);
    expect(handlers.has(agentMuxToggleProfileRpc.name)).toBe(true);
    expect(handlers.has(agentMuxClearCooldownRpc.name)).toBe(true);

    // Call status handler
    const statusHandler = handlers.get(agentMuxStatusRpc.name)!;
    const statusRes = await statusHandler({});
    expect(statusRes.isolationMode).toBe("scoped");
    expect(statusRes.bwrapVersion).toBe("0.9.0");

    // Call profiles handler
    const profilesHandler = handlers.get(agentMuxProfilesRpc.name)!;
    const profilesRes = await profilesHandler({});
    expect(profilesRes.providers[0].profiles[0].name).toBe("okt");
    expect(profilesRes.providers[0].profiles[0].enabled).toBe(true);

    // Toggle profile
    const toggleHandler = handlers.get(agentMuxToggleProfileRpc.name)!;
    const toggleRes = await toggleHandler({
      provider: "antigravity",
      profile: "okt",
      enabled: false,
    });
    expect(toggleRes).toEqual({ ok: true, enabled: false });

    // Profiles again should reflect disabled
    const profilesRes2 = await profilesHandler({});
    expect(profilesRes2.providers[0].profiles[0].enabled).toBe(false);

    // Clear cooldown handler
    const clearHandler = handlers.get(agentMuxClearCooldownRpc.name)!;
    const clearRes = await clearHandler({});
    expect(clearRes.ok).toBe(true);
  });
});

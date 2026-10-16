import { describe, expect, it } from "vitest";
import {
  parseBwrapVersion,
  parseConfigListOutput,
  parseCooldownsOutput,
  parseLogsOutput,
  parseProbeOutput,
  parseProfileListOutput,
  parseRemainingSeconds,
  parseStatusOutput,
  parseWrappersOutput,
  stripAnsi,
} from "./parser.js";

describe("stripAnsi", () => {
  it("removes terminal color escapes", () => {
    const colored = "\x1B[31mError\x1B[0m: \x1B[32mSuccess\x1B[0m";
    expect(stripAnsi(colored)).toBe("Error: Success");
  });
});

describe("parseRemainingSeconds", () => {
  it("parses hours, minutes and seconds", () => {
    expect(parseRemainingSeconds("46h 19m 21s")).toBe(46 * 3600 + 19 * 60 + 21);
    expect(parseRemainingSeconds("17h 9m 23s")).toBe(17 * 3600 + 9 * 60 + 23);
    expect(parseRemainingSeconds("45s")).toBe(45);
    expect(parseRemainingSeconds("10m")).toBe(600);
    expect(parseRemainingSeconds("")).toBe(0);
  });
});

describe("parseBwrapVersion", () => {
  it("extracts bubblewrap version", () => {
    expect(parseBwrapVersion("bubblewrap 0.9.0\n")).toBe("0.9.0");
    expect(parseBwrapVersion("bubblewrap 1.2.3")).toBe("1.2.3");
    expect(parseBwrapVersion("unknown tool")).toBeUndefined();
  });
});

describe("parseStatusOutput", () => {
  it("parses empty status output", () => {
    const output = `
=== agent-mux Provider & Profile Status [Isolation Mode: scoped] ===

Provider: Google Antigravity (antigravity)
  (No profiles configured at /home/user/.agent-mux/profiles/antigravity)

Provider: OpenCode (opencode)
  (No profiles configured at /home/user/.agent-mux/profiles/opencode)
`;
    const res = parseStatusOutput(output, { bwrapVersion: "0.9.0", profileOverride: null });
    expect(res.isolationMode).toBe("scoped");
    expect(res.bwrapVersion).toBe("0.9.0");
    expect(res.profileOverride).toBeNull();
    expect(res.providers).toHaveLength(2);
    expect(res.providers[0].name).toBe("Google Antigravity");
    expect(res.providers[0].id).toBe("antigravity");
    expect(res.providers[0].profiles).toHaveLength(0);
    expect(res.quotaHealth).toBe("green");
    expect(res.activeCooldownsCount).toBe(0);
  });

  it("parses status with active profiles and cooldown pools", () => {
    const output = `
=== agent-mux Provider & Profile Status [Isolation Mode: scoped] ===

Provider: Google Antigravity (antigravity)
  • okt [Authenticated] (okt@uppidi.com):
      - Pool 'claude': [COOLDOWN (Resets in 46h19m)]
      - Pool 'gemini': [HEALTHY]
  • puf [Authenticated] (puf@uppidi.com):
      - Pool 'claude': [HEALTHY]
`;
    const res = parseStatusOutput(output);
    expect(res.isolationMode).toBe("scoped");
    expect(res.providers).toHaveLength(1);
    const agy = res.providers[0];
    expect(agy.profiles).toHaveLength(2);
    expect(agy.profiles[0].profile).toBe("okt");
    expect(agy.profiles[0].authenticated).toBe(true);
    expect(agy.profiles[0].accountIdentity).toBe("okt@uppidi.com");
    expect(agy.profiles[0].pools).toEqual([
      { pool: "claude", state: "COOLDOWN", details: "Resets in 46h19m" },
      { pool: "gemini", state: "HEALTHY", details: undefined },
    ]);
    expect(res.activeCooldownsCount).toBe(1);
    expect(res.quotaHealth).toBe("yellow");
  });

  it("sets red quotaHealth when all pools are in cooldown", () => {
    const output = `
=== agent-mux Provider & Profile Status [Isolation Mode: unscoped] ===

Provider: Pi (pi)
  • default [Authenticated]:
      - Pool 'default': [COOLDOWN (Rate limited)]
`;
    const res = parseStatusOutput(output);
    expect(res.quotaHealth).toBe("red");
    expect(res.activeCooldownsCount).toBe(1);
  });
});

describe("parseProfileListOutput", () => {
  it("parses profile inventory and detects sandboxed mode", () => {
    const output = `
\x1B[33m[!] Detected active sandboxed session; profile management must be run from the host environment.\x1B[0m
    Listing from a sandboxed session (tmpfs mounted over /home/user/.agent-mux/profiles); results may be incomplete.

=== Configured Account Profiles [Isolation Mode: scoped] ===

Provider: Google Antigravity (antigravity)
  • okt              [\x1B[31mmissing directory\x1B[0m] -> /home/user/.agent-mux/profiles/antigravity/okt
  • work             [\x1B[32mAuthenticated\x1B[0m] (work@company.com) -> /home/user/.agent-mux/profiles/antigravity/work
  • guest            [\x1B[33mPending login\x1B[0m] [unregistered] -> /home/user/.agent-mux/profiles/antigravity/guest
`;
    const res = parseProfileListOutput(output);
    expect(res.sandboxedWarning).toBe(true);
    expect(res.isolationMode).toBe("scoped");
    expect(res.providers).toHaveLength(1);
    const prov = res.providers[0];
    expect(prov.id).toBe("antigravity");
    expect(prov.name).toBe("Google Antigravity");
    expect(prov.profiles).toHaveLength(3);

    expect(prov.profiles[0]).toEqual({
      name: "okt",
      status: "missing directory",
      accountIdentity: undefined,
      registered: true,
      directory: "/home/user/.agent-mux/profiles/antigravity/okt",
      enabled: true,
    });

    expect(prov.profiles[1]).toEqual({
      name: "work",
      status: "Authenticated",
      accountIdentity: "work@company.com",
      registered: true,
      directory: "/home/user/.agent-mux/profiles/antigravity/work",
      enabled: true,
    });

    expect(prov.profiles[2]).toEqual({
      name: "guest",
      status: "Pending login",
      accountIdentity: undefined,
      registered: false,
      directory: "/home/user/.agent-mux/profiles/antigravity/guest",
      enabled: true,
    });
  });
});

describe("parseCooldownsOutput", () => {
  it("parses empty cooldowns list", () => {
    const output = `
=== Active Quota Cooldown Locks ===
  (No active cooldown locks. All accounts are ready for routing.)
`;
    const res = parseCooldownsOutput(output);
    expect(res.totalCount).toBe(0);
    expect(res.cooldowns).toHaveLength(0);
  });

  it("parses multiple active cooldown locks", () => {
    const output = `
=== Active Quota Cooldown Locks ===
  • antigravity:okt (pool: claude)
      Remaining: \x1B[33m46h 19m 21s\x1B[0m
      Reason:    Resets in 65h47m25s
      Reset At:  2026-10-18T07:08:13.604Z
  • antigravity:puf (pool: gemini)
      Remaining: \x1B[33m17h 51m 55s\x1B[0m
      Reason:    Individual quota reached. Resets in 17h52m52s.
      Reset At:  2026-10-17T02:40:47.825Z
`;
    const res = parseCooldownsOutput(output);
    expect(res.totalCount).toBe(2);
    expect(res.cooldowns[0]).toEqual({
      provider: "antigravity",
      profile: "okt",
      pool: "claude",
      remainingSeconds: 46 * 3600 + 19 * 60 + 21,
      remainingDisplay: "46h 19m 21s",
      reason: "Resets in 65h47m25s",
      resetAt: "2026-10-18T07:08:13.604Z",
    });
    expect(res.cooldowns[1].pool).toBe("gemini");
  });
});

describe("parseConfigListOutput", () => {
  it("parses config with overrides and JSON settings", () => {
    const output = `
=== agent-mux Configuration ===
Config file: /home/user/.agent-mux/config.json
Active surface_account: none (overridden by AGENT_MUX_SURFACE_ACCOUNT env)
Active routingPolicy:   pool-strict

Settings in config file:
{
  "surface_account": "none",
  "opencode_probe_model": "test-model",
  "profiles": [
    {
      "provider": "antigravity",
      "name": "okt"
    }
  ]
}
`;
    const res = parseConfigListOutput(output);
    expect(res.configFile).toBe("/home/user/.agent-mux/config.json");
    expect(res.activeSurfaceAccount).toBe("none");
    expect(res.surfaceAccountOverridden).toBe(true);
    expect(res.activeRoutingPolicy).toBe("pool-strict");
    expect(res.routingPolicyOverridden).toBe(false);
    expect(res.settings).toEqual({
      surface_account: "none",
      opencode_probe_model: "test-model",
      profiles: [{ provider: "antigravity", name: "okt" }],
    });
  });
});

describe("parseWrappersOutput", () => {
  it("parses wrapped and unwrapped binaries", () => {
    const output = `
=== agent-mux CLI Wrappers ===
  • agy        \x1B[32m[WRAPPED]\x1B[0m   /home/user/.local/bin/agy -> /home/user/.local/bin/agy.bin
  • opencode   \x1B[32m[WRAPPED]\x1B[0m   /home/user/.local/bin/opencode -> /usr/bin/opencode
  • pi         \x1B[33m[UNWRAPPED]\x1B[0m /usr/bin/pi
  • custom     [NOT FOUND in PATH]
`;
    const res = parseWrappersOutput(output);
    expect(res).toHaveLength(4);
    expect(res[0]).toEqual({
      binaryName: "agy",
      status: "WRAPPED",
      sourcePath: "/home/user/.local/bin/agy",
      targetPath: "/home/user/.local/bin/agy.bin",
    });
    expect(res[2]).toEqual({
      binaryName: "pi",
      status: "UNWRAPPED",
      sourcePath: "/usr/bin/pi",
      targetPath: undefined,
    });
    expect(res[3].status).toBe("NOT FOUND");
  });
});

describe("parseLogsOutput", () => {
  it("parses structured log lines and applies level filtering", () => {
    const output = `
=== agent-mux Logs (/home/user/.agent-mux/logs/agent-mux.log) ===
[2026-10-16T08:47:55.827Z] [SUPERVISOR] Failing over from 'puf' to 'okt'
[2026-10-16T08:48:08.016Z] [ROUTER] Fallback selection (ALL COOLDOWN) [pool-strict]: okt/gemini
[2026-10-16T08:48:41.168Z] [ERROR] Connection timed out
`;
    const all = parseLogsOutput(output);
    expect(all.logFile).toBe("/home/user/.agent-mux/logs/agent-mux.log");
    expect(all.entries).toHaveLength(3);
    expect(all.entries[0]).toEqual({
      raw: "[2026-10-16T08:47:55.827Z] [SUPERVISOR] Failing over from 'puf' to 'okt'",
      timestamp: "2026-10-16T08:47:55.827Z",
      level: "SUPERVISOR",
      message: "Failing over from 'puf' to 'okt'",
    });

    const errorOnly = parseLogsOutput(output, "ERROR");
    expect(errorOnly.entries).toHaveLength(1);
    expect(errorOnly.entries[0].level).toBe("ERROR");
  });
});

describe("parseProbeOutput", () => {
  it("parses probe results for a provider", () => {
    const output = `
=== Probing Google Antigravity ===
• Profile: okt
  [Probing okt (gemini)]... [HEALTHY: OK]
  [Probing okt (claude)]... [COOLDOWN: Rate limited: quota exceeded]
`;
    const res = parseProbeOutput(output, "antigravity");
    expect(res.provider).toBe("antigravity");
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toEqual({
      profile: "okt",
      pool: "gemini",
      state: "HEALTHY",
      details: "OK",
    });
    expect(res.results[1]).toEqual({
      profile: "okt",
      pool: "claude",
      state: "COOLDOWN",
      details: "Rate limited: quota exceeded",
    });
  });
});

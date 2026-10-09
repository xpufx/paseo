import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQueues, readRouterStatus, resolveRouterUrl } from "./queue.js";

const realFetch = globalThis.fetch;
const realEnv = process.env.FORGE_HOOK_URL;

/** Serve a fixed JSON body for `/status`, `/health`, and `/queues`. */
function stubRouter(routes: Record<string, unknown | "down">) {
  // Pin the endpoint so these tests do not resolve the developer's real
  // uppidi-fleet plugin settings. The URL is asserted directly in its own
  // tests; every other assertion is about the projection, not the host.
  process.env.FORGE_HOOK_URL = "http://127.0.0.1:8099";
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const body = routes[path];
    if (body === undefined || body === "down") {
      return { ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) } as never;
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as never;
  }) as never;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realEnv === undefined) delete process.env.FORGE_HOOK_URL;
  else process.env.FORGE_HOOK_URL = realEnv;
});

describe("router url resolution", () => {
  const realHome = process.env.HOME;

  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    delete process.env.FORGE_HOOK_URL;
  });

  function writePluginSettings(home: string, settings: Record<string, unknown>): void {
    const dir = join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  }

  function writeLegacyRouterConfig(home: string, settings: Record<string, unknown>): void {
    const dir = join(home, ".config", "uppidi-fleet");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "router-config.json"), JSON.stringify(settings));
  }

  it("reads the hook server address from uppidi-fleet plugin settings, not just loopback", () => {
    // The bug this fixes: the daemon is persisted at a LAN address, and falling
    // straight through to 127.0.0.1 made the surfaces report "cannot see the
    // router" on every machine that is not running it locally.
    delete process.env.FORGE_HOOK_URL;
    const home = mkdtempSync(join(tmpdir(), "router-home-"));
    writePluginSettings(home, { hookHost: "10.20.30.24", hookPort: 8099 });
    process.env.HOME = home;
    try {
      assert.equal(resolveRouterUrl(), "http://10.20.30.24:8099");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("maps a wildcard bind to loopback rather than dialling 0.0.0.0", () => {
    delete process.env.FORGE_HOOK_URL;
    const home = mkdtempSync(join(tmpdir(), "router-home-"));
    writePluginSettings(home, { hookHost: "0.0.0.0", hookPort: 8099 });
    process.env.HOME = home;
    try {
      assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("never consults the legacy ~/.config/uppidi-fleet/router-config.json mirror (#1164)", () => {
    delete process.env.FORGE_HOOK_URL;
    const home = mkdtempSync(join(tmpdir(), "router-home-"));
    writeLegacyRouterConfig(home, { host: "10.20.30.24", port: 8099 });
    process.env.HOME = home;
    try {
      assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers canonical plugin settings over the legacy mirror when both exist (#1164)", () => {
    delete process.env.FORGE_HOOK_URL;
    const home = mkdtempSync(join(tmpdir(), "router-home-"));
    writePluginSettings(home, { hookHost: "canonical.internal", hookPort: 8200 });
    writeLegacyRouterConfig(home, { host: "legacy.internal", port: 1111 });
    process.env.HOME = home;
    try {
      assert.equal(resolveRouterUrl(), "http://canonical.internal:8200");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("still prefers an explicit override over plugin settings", () => {
    const home = mkdtempSync(join(tmpdir(), "router-home-"));
    writePluginSettings(home, { hookHost: "10.20.30.24", hookPort: 8099 });
    process.env.HOME = home;
    try {
      assert.equal(resolveRouterUrl("http://explicit:1234/"), "http://explicit:1234");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers an explicit override, then the env var", () => {
    delete process.env.FORGE_HOOK_URL;
    assert.equal(resolveRouterUrl("http://router.internal:9000/"), "http://router.internal:9000");
    process.env.FORGE_HOOK_URL = "http://env-host:1234//";
    assert.equal(resolveRouterUrl(), "http://env-host:1234");
    assert.equal(resolveRouterUrl("http://explicit:1"), "http://explicit:1");
  });

  it("falls back to loopback only when no canonical settings exist", () => {
    delete process.env.FORGE_HOOK_URL;
    const home = mkdtempSync(join(tmpdir(), "router-home-"));
    process.env.HOME = home;
    try {
      assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("readQueues", () => {
  it("returns the router's queues verbatim", async () => {
    stubRouter({
      "/queues": { ok: true, service: "forgejo-hook", uptime: 12, paused: ["a/repo"], queues: [{ key: "a/repo", depth: 2 }] },
    });
    const result = await readQueues();
    assert.equal(result.ok, true);
    assert.equal(result.service, "forgejo-hook");
    assert.equal(result.queues.length, 1);
    assert.deepEqual(result.paused, ["a/repo"]);
  });

  it("defaults a partial payload rather than leaving holes for the view", async () => {
    stubRouter({ "/queues": { ok: true } });
    const result = await readQueues();
    assert.deepEqual(result.queues, []);
    assert.deepEqual(result.paused, []);
  });

  it("reports an unreachable router as an error, not as an empty queue", async () => {
    stubRouter({ "/queues": "down" });
    const result = await readQueues();
    assert.equal(result.ok, false);
    assert.ok(result.error?.startsWith("Unreachable:"));
    assert.deepEqual(result.queues, []);
  });
});

describe("readRouterStatus", () => {
  it("flattens the router's status and health into one read-out", async () => {
    stubRouter({
      "/status": {
        ok: true,
        service: "forgejo-hook",
        version: 3,
        uptime: 90,
        host: "127.0.0.1",
        port: 8099,
        configuredHost: "127.0.0.1",
        configuredPort: 8099,
        frontDesk: { agentId: "desk-1" },
        paused: ["a/repo"],
        totalQueued: 4,
        repoCount: 2,
      },
      "/health": { active: true, state: "listening", availableInterfaces: ["10.0.0.5"] },
    });
    const result = await readRouterStatus();
    assert.equal(result.ok, true);
    assert.equal(result.active, true);
    assert.equal(result.state, "listening");
    assert.equal(result.frontDeskAgentId, "desk-1");
    assert.equal(result.totalQueued, 4);
    assert.equal(result.repoCount, 2);
    assert.deepEqual(result.paused, ["a/repo"]);
    assert.deepEqual(result.availableInterfaces, ["10.0.0.5"]);
    assert.equal(result.url, "http://127.0.0.1:8099");
  });

  it("distinguishes a starting router from a disconnected one", async () => {
    // `/status` down, `/health` answering: the router is bound but not ready.
    stubRouter({ "/status": "down", "/health": { active: true, state: "starting" } });
    const starting = await readRouterStatus();
    assert.equal(starting.ok, false);
    assert.equal(starting.active, true);
    assert.equal(starting.state, "starting");
    assert.ok(starting.error);
  });

  it("reports a fully unreachable router", async () => {
    stubRouter({});
    const result = await readRouterStatus();
    assert.equal(result.ok, false);
    assert.equal(result.active, false);
    assert.equal(result.state, "unreachable");
    assert.equal(result.totalQueued, 0);
  });

  it("tolerates a missing /health endpoint without failing the read", async () => {
    const calls = stubRouter({ "/status": { ok: true, totalQueued: 1 } });
    const result = await readRouterStatus();
    assert.equal(result.ok, true);
    assert.ok(calls.includes("/status"));
    assert.ok(calls.includes("/health"));
  });
});

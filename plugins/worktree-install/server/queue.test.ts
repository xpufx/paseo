import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQueues, readRouterStatus, resolveRouterUrl } from "./queue.js";

const realFetch = globalThis.fetch;
const realEnv = process.env.FORGE_HOOK_URL;

/** Serve a fixed JSON body for `/status`, `/health`, and `/queues`. */
function stubRouter(routes: Record<string, unknown | "down">) {
  // Pin the endpoint so these tests do not resolve the developer's real
  // ~/.config/uppidi-fleet/router-config.json. The URL is asserted directly in
  // its own test; every other assertion is about the projection, not the host.
  process.env.FORGE_HOOK_CONFIG = "/nonexistent/router-config.json";
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

afterEach(() => {
  delete process.env.FORGE_HOOK_CONFIG;
});

describe("router url resolution", () => {
  it("reads the hook server address from the router config, not just loopback", () => {
    // The bug this fixes: the daemon is persisted at a LAN address, and falling
    // straight through to 127.0.0.1 made the surfaces report "cannot see the
    // router" on every machine that is not running it locally.
    delete process.env.FORGE_HOOK_URL;
    const dir = mkdtempSync(join(tmpdir(), "router-config-"));
    const file = join(dir, "router-config.json");
    writeFileSync(file, JSON.stringify({ host: "10.20.30.24", port: 8099 }));
    process.env.FORGE_HOOK_CONFIG = file;
    try {
      assert.equal(resolveRouterUrl(), "http://10.20.30.24:8099");
    } finally {
      delete process.env.FORGE_HOOK_CONFIG;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps a wildcard bind to loopback rather than dialling 0.0.0.0", () => {
    delete process.env.FORGE_HOOK_URL;
    const dir = mkdtempSync(join(tmpdir(), "router-config-"));
    const file = join(dir, "router-config.json");
    writeFileSync(file, JSON.stringify({ host: "0.0.0.0", port: 8099 }));
    process.env.FORGE_HOOK_CONFIG = file;
    try {
      assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
    } finally {
      delete process.env.FORGE_HOOK_CONFIG;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to loopback when the config is unreadable, and not to a hang", () => {
    delete process.env.FORGE_HOOK_URL;
    process.env.FORGE_HOOK_CONFIG = "/nonexistent/router-config.json";
    try {
      assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
    } finally {
      delete process.env.FORGE_HOOK_CONFIG;
    }
  });

  it("still prefers an explicit override over the config", () => {
    const dir = mkdtempSync(join(tmpdir(), "router-config-"));
    const file = join(dir, "router-config.json");
    writeFileSync(file, JSON.stringify({ host: "10.20.30.24", port: 8099 }));
    process.env.FORGE_HOOK_CONFIG = file;
    try {
      assert.equal(resolveRouterUrl("http://explicit:1234/"), "http://explicit:1234");
    } finally {
      delete process.env.FORGE_HOOK_CONFIG;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers an explicit override, then the env var", () => {
    delete process.env.FORGE_HOOK_URL;
    assert.equal(resolveRouterUrl("http://router.internal:9000/"), "http://router.internal:9000");
    process.env.FORGE_HOOK_URL = "http://env-host:1234//";
    assert.equal(resolveRouterUrl(), "http://env-host:1234");
    assert.equal(resolveRouterUrl("http://explicit:1"), "http://explicit:1");
  });

  it("falls back to loopback only when no config exists", () => {
    // Pinned to a missing config path: left unset, this test read whatever
    // ~/.config/uppidi-fleet/router-config.json happened to contain on the
    // developer's machine, which is exactly why it looked green before.
    delete process.env.FORGE_HOOK_URL;
    process.env.FORGE_HOOK_CONFIG = "/nonexistent/router-config.json";
    try {
      assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
    } finally {
      delete process.env.FORGE_HOOK_CONFIG;
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

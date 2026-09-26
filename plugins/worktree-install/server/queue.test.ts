import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readQueues, readRouterStatus, resolveRouterUrl } from "./queue.js";

const realFetch = globalThis.fetch;
const realEnv = process.env.FORGE_HOOK_URL;

/** Serve a fixed JSON body for `/status`, `/health`, and `/queues`. */
function stubRouter(routes: Record<string, unknown | "down">) {
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
  it("prefers an explicit override, then the env var, then loopback", () => {
    delete process.env.FORGE_HOOK_URL;
    assert.equal(resolveRouterUrl("http://router.internal:9000/"), "http://router.internal:9000");
    process.env.FORGE_HOOK_URL = "http://env-host:1234//";
    assert.equal(resolveRouterUrl(), "http://env-host:1234");
    assert.equal(resolveRouterUrl("http://explicit:1"), "http://explicit:1");
    delete process.env.FORGE_HOOK_URL;
    assert.equal(resolveRouterUrl(), "http://127.0.0.1:8099");
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

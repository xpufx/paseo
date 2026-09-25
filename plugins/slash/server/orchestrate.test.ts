import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOOK_URL, orchestrateHandover } from "./orchestrate";
import { allowedOperations, runOperation } from "./resources";
import { getSlashSettingsStorage } from "./settings";

const SECRET = "hook-secret-value";

let dir: string;

function secretFile(value = SECRET): string {
  const file = join(dir, "forgejo-hook.secret");
  writeFileSync(file, `${value}\n`, "utf8");
  return file;
}

function setSettings(patch: Record<string, unknown>): void {
  getSlashSettingsStorage().update((prev) => ({ ...prev, ...patch }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slash-orchestrate-"));
  getSlashSettingsStorage().reset();
  process.env.PASEO_FORGEJO_HOOK_SECRET_FILE = secretFile();
  delete process.env.PASEO_FORGEJO_HOOK_URL;
  delete process.env.FORGEJO_WEBHOOK_SECRET;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  getSlashSettingsStorage().reset();
  vi.unstubAllGlobals();
  delete process.env.PASEO_FORGEJO_HOOK_SECRET_FILE;
  delete process.env.PASEO_FORGEJO_HOOK_URL;
  delete process.env.FORGEJO_WEBHOOK_SECRET;
});

describe("orchestrateHandover", () => {
  it("POSTs the caller agent id with bearer auth and returns the hook result", async () => {
    const result = { key: "forge.example.com/owner/repo", agentId: "agent-1", previous: "agent-0" };
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(orchestrateHandover("agent-1")).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_HOOK_URL}/orchestrate`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(init.body))).toEqual({ agentId: "agent-1" });
  });

  it("honors the hook URL env override", async () => {
    process.env.PASEO_FORGEJO_HOOK_URL = "http://127.0.0.1:9000/";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await orchestrateHandover("agent-1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9000/orchestrate");
  });

  it("prefers the configured hook URL over the env override", async () => {
    process.env.PASEO_FORGEJO_HOOK_URL = "http://127.0.0.1:9000";
    setSettings({ hookUrl: "http://10.20.30.24:8099/" });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await orchestrateHandover("agent-1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://10.20.30.24:8099/orchestrate");
  });

  it("prefers the configured secret file over the env override", async () => {
    const other = join(dir, "other.secret");
    writeFileSync(other, "settings-secret\n", "utf8");
    process.env.PASEO_FORGEJO_HOOK_SECRET_FILE = join(dir, "missing.secret");
    setSettings({ hookSecretFile: other });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await orchestrateHandover("agent-1");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer settings-secret");
  });

  it("fails closed when the hook rejects, surfacing the reason without the secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ error: "unknown agent id" }), { status: 422 })),
    );

    await expect(orchestrateHandover("ghost")).rejects.toThrow("orchestrate rejected (422): unknown agent id");
    await expect(orchestrateHandover("ghost")).rejects.not.toThrow(SECRET);
  });

  it("fails closed when the hook is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8099");
      }),
    );

    await expect(orchestrateHandover("agent-1")).rejects.toThrow(
      `forgejo hook unreachable at ${DEFAULT_HOOK_URL}/orchestrate`,
    );
  });

  it("fails closed with no secret configured", async () => {
    process.env.PASEO_FORGEJO_HOOK_SECRET_FILE = join(dir, "missing.secret");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 })));

    await expect(orchestrateHandover("agent-1")).rejects.toThrow("secret unavailable");
  });

  it("requires a non-empty agent id", async () => {
    await expect(orchestrateHandover("  ")).rejects.toThrow("requires a caller agent id");
  });
});

describe("slash.orchestrate operation", () => {
  it("is allowlisted and threads the agent id to the hook", async () => {
    expect(await allowedOperations()).toContain("slash.orchestrate");

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      new Response(JSON.stringify({ agentId: JSON.parse(String(init.body)).agentId }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOperation("slash.orchestrate", {}, { agentId: "agent-9" })).resolves.toEqual({
      agentId: "agent-9",
    });
  });

  it("fails closed when the caller agent id is missing", async () => {
    await expect(runOperation("slash.orchestrate", {}, {})).rejects.toThrow("requires a caller agent id");
  });

  it("still rejects non-allowlisted operations", async () => {
    await expect(runOperation("slash.nope", {}, {})).rejects.toThrow("not allowlisted");
  });
});

describe("settings-driven operation bindings", () => {
  it("allowlists a custom binding layered over the seeds", async () => {
    setSettings({
      operationBindings: [{ name: "fleet.orch", primitive: "slash.orchestrate", params: {}, target: "" }],
    });
    const operations = await allowedOperations();
    expect(operations).toContain("fleet.orch");
    expect(operations).toContain("slash.orchestrate");
  });

  it("routes a custom binding to its target endpoint without code changes", async () => {
    setSettings({
      operationBindings: [
        { name: "fleet.orch", primitive: "slash.orchestrate", params: {}, target: "http://10.20.30.24:8099" },
      ],
    });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOperation("fleet.orch", {}, { agentId: "agent-7" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://10.20.30.24:8099/orchestrate");
  });

  it("rejects a binding that references an unknown primitive", async () => {
    setSettings({
      operationBindings: [{ name: "bogus", primitive: "nope.nope", params: {} }],
    });
    await expect(runOperation("bogus", {}, {})).rejects.toThrow("unknown primitive: nope.nope");
  });

  it("keeps slash.orchestrate resolvable after a custom binding is added (backward compat)", async () => {
    setSettings({
      operationBindings: [{ name: "fleet.orch", primitive: "slash.orchestrate", params: {}, target: "http://10.20.30.24:8099" }],
    });
    expect(await allowedOperations()).toContain("slash.orchestrate");

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runOperation("slash.orchestrate", {}, { agentId: "agent-1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${DEFAULT_HOOK_URL}/orchestrate`);
  });
});

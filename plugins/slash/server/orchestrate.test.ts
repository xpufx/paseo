import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOOK_URL, orchestrateHandover } from "./orchestrate";
import { allowedOperations, handleListOperations, redactHeaders, runOperation } from "./resources";
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
      operationBindings: [
        { name: "fleet.orch", kind: "primitive", primitive: "slash.orchestrate", params: {}, target: "" },
      ],
    });
    const operations = await allowedOperations();
    expect(operations).toContain("fleet.orch");
    expect(operations).toContain("slash.orchestrate");
  });

  it("routes a custom binding to its target endpoint without code changes", async () => {
    setSettings({
      operationBindings: [
        {
          name: "fleet.orch",
          kind: "primitive",
          primitive: "slash.orchestrate",
          params: {},
          target: "http://10.20.30.24:8099",
        },
      ],
    });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOperation("fleet.orch", {}, { agentId: "agent-7" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://10.20.30.24:8099/orchestrate");
  });

  it("rejects a binding that references an unknown primitive", async () => {
    setSettings({
      operationBindings: [{ name: "bogus", kind: "primitive", primitive: "nope.nope", params: {} }],
    });
    await expect(runOperation("bogus", {}, {})).rejects.toThrow("unknown primitive: nope.nope");
  });

  it("keeps slash.orchestrate resolvable after a custom binding is added (backward compat)", async () => {
    setSettings({
      operationBindings: [
        {
          name: "fleet.orch",
          kind: "primitive",
          primitive: "slash.orchestrate",
          params: {},
          target: "http://10.20.30.24:8099",
        },
      ],
    });
    expect(await allowedOperations()).toContain("slash.orchestrate");

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runOperation("slash.orchestrate", {}, { agentId: "agent-1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${DEFAULT_HOOK_URL}/orchestrate`);
  });
});

describe("data-driven http operation bindings", () => {
  function setHttpBinding(binding: Record<string, unknown>): void {
    setSettings({ operationBindings: [binding] });
  }

  it("executes a settings-defined http binding with zero code changes", async () => {
    setHttpBinding({
      name: "httpbin.get",
      kind: "http",
      http: { method: "GET", path: "/get", headers: { "x-tenant": "acme" } },
      auth: false,
      params: {},
      target: "http://hooks.example.com",
    });
    expect(await allowedOperations()).toContain("httpbin.get");

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOperation("httpbin.get", {}, {})).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://hooks.example.com/get");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-tenant"]).toBe("acme");
    expect(init.body).toBeUndefined();
  });

  it("falls back to hookUrl for the target and builds a POST body from bodyParams only", async () => {
    setSettings({ hookUrl: "http://10.0.0.1:8099", operationBindings: [] });
    getSlashSettingsStorage().update((prev) => ({
      ...prev,
      operationBindings: [
        {
          name: "notes.create",
          kind: "http",
          http: { method: "POST", path: "/notes", bodyParams: ["title"] },
          auth: false,
          params: {},
        },
      ],
    }));
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOperation("notes.create", { title: "hello", secret: "drop-me" }, {});
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://10.0.0.1:8099/notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ title: "hello" });
  });

  it("attaches the hook bearer secret only when auth is true", async () => {
    setSettings({ hookSecretFile: secretFile("http-secret") });
    getSlashSettingsStorage().update((prev) => ({
      ...prev,
      operationBindings: [
        { name: "auth.op", kind: "http", http: { method: "GET", path: "/a", bodyParams: [] }, auth: true, params: {} },
        { name: "open.op", kind: "http", http: { method: "GET", path: "/b", bodyParams: [] }, auth: false, params: {} },
      ],
    }));
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOperation("auth.op", {}, {});
    await runOperation("open.op", {}, {});

    const authHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const openHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(authHeaders.authorization).toBe("Bearer http-secret");
    expect(openHeaders.authorization).toBeUndefined();
  });

  it("redacts secret-bearing headers and never surfaces the secret on failure", async () => {
    setSettings({ hookSecretFile: secretFile("top-secret") });
    getSlashSettingsStorage().update((prev) => ({
      ...prev,
      operationBindings: [
        { name: "auth.fail", kind: "http", http: { method: "GET", path: "/x", bodyParams: [] }, auth: true, params: {} },
      ],
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ),
    );

    await expect(runOperation("auth.fail", {}, {})).rejects.toThrow('rejected (500): nope');
    await expect(runOperation("auth.fail", {}, {})).rejects.not.toThrow("top-secret");
  });

  it("redacts secret-bearing header values while preserving others", () => {
    expect(
      redactHeaders({ authorization: "Bearer x", Cookie: "a=b", "x-tenant": "acme", "proxy-authorization": "p" }),
    ).toEqual({
      authorization: "[redacted]",
      Cookie: "[redacted]",
      "x-tenant": "acme",
      "proxy-authorization": "[redacted]",
    });
  });

  it("refuses non-http(s) targets before fetch", async () => {
    setHttpBinding({
      name: "file.read",
      kind: "http",
      http: { method: "GET", path: "/etc/passwd" },
      auth: false,
      params: {},
      target: "file://",
    });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOperation("file.read", {}, {})).rejects.toThrow("must use http or https");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps oversized responses and flags truncation", async () => {
    setHttpBinding({
      name: "big.get",
      kind: "http",
      http: { method: "GET", path: "/big" },
      auth: false,
      params: {},
      target: "http://hooks.example.com",
    });
    const huge = JSON.stringify({ data: "x".repeat(200_000) });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, _init: RequestInit) => new Response(huge, { status: 200 })));

    const result = (await runOperation("big.get", {}, {})) as { truncated?: boolean };
    expect(result.truncated).toBe(true);
  });

  it("reflects the settings-defined catalog via slash.operations.list", async () => {
    setHttpBinding({
      name: "catalog.op",
      kind: "http",
      http: { method: "GET", path: "/catalog" },
      auth: false,
      params: {},
      target: "http://hooks.example.com",
    });
    const listed = await handleListOperations();
    expect(listed.rpc).toContain("catalog.op");
  });
});

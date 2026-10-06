import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createPermissionLogger,
  extractAgentAttribution,
  isPermissionEntry,
  normalizeDecision,
  PermissionLogStore,
  registerPermissionAuditServer,
  splitRequestEvent,
  splitResolveEvent,
  subscribePermissionEvents,
} from "./server.js";
import type { PermissionAuditEntry, ToolCallAuditEntry } from "./shared.js";

function entry(overrides: Partial<PermissionAuditEntry> = {}): PermissionAuditEntry {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    timestamp: "2026-09-28T10:00:00.000Z",
    agentId: "agent-1",
    kind: "tool",
    name: "bash",
    input: { command: "ls" },
    decision: "allow",
    ...overrides,
  };
}

function toolCallEntry(overrides: Partial<ToolCallAuditEntry> = {}): ToolCallAuditEntry {
  return {
    recordType: "tool_call",
    id: `call-${Math.random().toString(36).slice(2)}`,
    timestamp: "2026-09-28T10:00:00.000Z",
    agentId: "agent-1",
    kind: "tool_call",
    name: "Bash",
    input: { command: "ls" },
    outcome: "success",
    ...overrides,
  };
}

describe("PermissionLogStore", () => {
  let dir: string;
  let store: PermissionLogStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-log-"));
    store = new PermissionLogStore({ filePath: path.join(dir, "permissions.jsonl") });
  });

  it("reads empty when no log file exists", () => {
    expect(store.readAll()).toEqual([]);
  });

  it("appends entries as JSONL lines and reads them back", () => {
    store.append(entry({ id: "a" }));
    store.append(entry({ id: "b", decision: "deny" }));
    const lines = fs.readFileSync(store.filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => JSON.parse(line))).toBe(true);
    expect(store.readAll().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("skips corrupt lines instead of failing the whole log", () => {
    store.append(entry({ id: "a" }));
    fs.appendFileSync(store.filePath, "not-json\n");
    store.append(entry({ id: "b" }));
    expect(store.readAll().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("filters by agentId, model, decision, and date range", () => {
    store.append(entry({ id: "a", agentId: "a1", agentModel: "m1", decision: "allow", timestamp: "2026-09-10T00:00:00.000Z" }));
    store.append(entry({ id: "b", agentId: "a2", agentModel: "m1", decision: "deny", timestamp: "2026-09-20T00:00:00.000Z" }));
    store.append(entry({ id: "c", agentId: "a1", agentModel: "m2", decision: "deny", timestamp: "2026-09-25T00:00:00.000Z" }));

    expect(store.query({ agentId: "a1", limit: 100 }).total).toBe(2);
    expect(store.query({ model: "m1", limit: 100 }).total).toBe(2);
    expect(store.query({ decision: "deny", limit: 100 }).total).toBe(2);
    expect(
      store.query({ from: "2026-09-15", to: "2026-09-22", limit: 100 }).entries.map((e) => e.id),
    ).toEqual(["b"]);
  });

  it("readLatest and query resolve entries by id, reflecting pending-to-allowed transition", () => {
    store.append(entry({ id: "req-x", decision: "pending", timestamp: "2026-09-20T10:00:00.000Z" }));
    expect(store.query({ decision: "pending" }).total).toBe(1);
    expect(store.query({ decision: "allow" }).total).toBe(0);

    store.append(entry({ id: "req-x", decision: "allow", timestamp: "2026-09-20T10:00:05.000Z" }));
    expect(store.readAll()).toHaveLength(2);
    expect(store.readLatest()).toHaveLength(1);
    const latest = store.readLatest()[0];
    expect(latest && isPermissionEntry(latest) ? latest.decision : null).toBe("allow");
    expect(store.query({ decision: "pending" }).total).toBe(0);
    expect(store.query({ decision: "allow" }).total).toBe(1);
    expect(store.query({}).total).toBe(1);
  });

  it("searches tool names and serialized input, newest first, honoring limit", () => {
    store.append(entry({ id: "a", name: "bash", input: { command: "rm -rf /tmp/x" }, timestamp: "2026-09-10T00:00:00.000Z" }));
    store.append(entry({ id: "b", name: "read", input: { path: "/etc/hosts" }, timestamp: "2026-09-20T00:00:00.000Z" }));
    const result = store.query({ search: "rm -rf", limit: 100 });
    expect(result.entries.map((e) => e.id)).toEqual(["a"]);
    const limited = store.query({ limit: 1 });
    expect(limited.entries).toHaveLength(1);
    expect(limited.total).toBe(2);
    expect(limited.entries[0]?.id).toBe("b");
  });

  it("merges the legacy log path and keeps appending to the scoped path", () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-legacy-"));
    const primaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-primary-"));
    const legacyFile = path.join(legacyDir, "permissions.jsonl");
    const primaryFile = path.join(primaryDir, "permissions.jsonl");
    fs.writeFileSync(legacyFile, `${JSON.stringify(entry({ id: "old" }))}\n`, "utf8");
    const scoped = new PermissionLogStore({ filePath: primaryFile, legacyFilePath: legacyFile });
    expect(scoped.readAll().map((e) => e.id)).toEqual(["old"]);
    scoped.append(entry({ id: "new" }));
    expect(scoped.readAll().map((e) => e.id)).toEqual(["old", "new"]);
    expect(fs.readFileSync(legacyFile, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("round-trips tool-call records alongside permissions and survives reload", () => {
    store.append(
      toolCallEntry({
        id: "call-1",
        name: "Bash",
        input: { command: "ls" },
        outcome: "success",
        sequence: 4,
      }),
    );
    store.append(entry({ id: "req-1", decision: "deny" }));

    expect(store.readLatest()).toHaveLength(2);
    expect(store.query({ recordType: "tool_call", limit: 100 }).total).toBe(1);
    expect(store.query({ recordType: "permission", limit: 100 }).total).toBe(1);
    expect(store.query({ outcome: "success", limit: 100 }).entries[0]?.id).toBe("call-1");
    expect(store.query({ outcome: "failure", limit: 100 }).total).toBe(0);
    expect(store.query({ decision: "deny", limit: 100 }).total).toBe(1);

    const reopened = new PermissionLogStore({ filePath: store.filePath });
    expect(reopened.readLatest().map((e) => e.id).sort()).toEqual(["call-1", "req-1"]);
    expect(reopened.query({ recordType: "tool_call", limit: 100 }).total).toBe(1);
  });
});

describe("extractAgentAttribution", () => {
  it("resolves model, provider, mode, and title from agent context", () => {
    expect(
      extractAgentAttribution({
        id: "agent-1",
        title: "worker",
        model: "test-model",
        provider: "test-provider",
        modeId: "build",
        cwd: "/srv/app",
      }),
    ).toMatchObject({
      id: "agent-1",
      title: "worker",
      model: "test-model",
      provider: "test-provider",
      mode: "build",
      cwd: "/srv/app",
    });
  });

  it("handles nested agent envelopes and alternate key names", () => {
    expect(
      extractAgentAttribution({ agent: { agentId: "a9", modelId: "m", providerId: "p", mode: "plan" } }),
    ).toMatchObject({ id: "a9", model: "m", provider: "p", mode: "plan" });
  });

  it("returns empty attribution for non-objects", () => {
    expect(extractAgentAttribution(null)).toEqual({});
    expect(extractAgentAttribution("agent-1")).toEqual({});
  });
});

describe("normalizeDecision", () => {
  it("maps allow/approve variants", () => {
    expect(normalizeDecision({ behavior: "allow" })).toBe("allow");
    expect(normalizeDecision({ decision: "approve" })).toBe("allow");
    expect(normalizeDecision(true)).toBe("allow");
  });

  it("maps deny variants", () => {
    expect(normalizeDecision({ behavior: "deny" })).toBe("deny");
    expect(normalizeDecision({ decision: "denied" })).toBe("deny");
    expect(normalizeDecision(false)).toBe("deny");
  });

  it("returns null for undecidable payloads", () => {
    expect(normalizeDecision({})).toBeNull();
    expect(normalizeDecision(null)).toBeNull();
  });
});

describe("event capture and pairing", () => {
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-listener-"));
    const store = new PermissionLogStore({ filePath: path.join(dir, "permissions.jsonl") });
    const logger = createPermissionLogger({ store, now: () => "2026-09-28T10:00:00.000Z" });
    return { store, logger };
  }

  it("pairs a requested event with its resolution, keeping request input", () => {
    const { store, logger } = setup();
    const pendingEntry = logger.handleRequested({
      request: { id: "r1", kind: "tool", name: "bash", input: { command: "ls" } },
      agent: { id: "a1", model: "m1", provider: "p1", modeId: "build", cwd: "/srv" },
    });
    expect(pendingEntry).toMatchObject({
      id: "r1",
      agentId: "a1",
      decision: "pending",
    });
    expect(store.query({ decision: "pending" }).total).toBe(1);

    const recorded = logger.handleResolved({
      requestId: "r1",
      response: { behavior: "allow", updatedInput: { command: "ls -la" } },
    });
    expect(recorded).toMatchObject({
      id: "r1",
      agentId: "a1",
      agentModel: "m1",
      kind: "tool",
      name: "bash",
      decision: "allow",
    });
    expect(recorded?.input).toEqual({ command: "ls" });
    expect(store.readAll()).toHaveLength(2);
    expect(store.readLatest()).toHaveLength(1);
    expect(store.query({ decision: "pending" }).total).toBe(0);
    expect(store.query({ decision: "allow" }).total).toBe(1);
  });

  it("records resolutions that arrive without a prior request", () => {
    const { store, logger } = setup();
    const recorded = logger.handleResolved({
      request: { id: "r2", agentId: "a2", kind: "question", name: "ask", input: { q: "deploy?" } },
      response: { behavior: "deny", message: "not now" },
      agent: { id: "a2", title: "frontdesk" },
    });
    expect(recorded).toMatchObject({ id: "r2", agentId: "a2", decision: "deny" });
    expect(recorded?.denyReason).toBe("not now");
    expect(store.readAll()).toHaveLength(1);
  });

  it("reconciles pending permissions on agent turn activity when provider omits resolution event", () => {
    const { store, logger } = setup();
    logger.handleRequested({
      request: { id: "r_opencode", kind: "tool", name: "bash", input: { command: "git status" } },
      agent: { id: "a_opencode", model: "space-bunny", provider: "test-provider" },
    });
    expect(store.query({ decision: "pending" }).total).toBe(1);

    const resolved = logger.handleTurnActivity({ agentId: "a_opencode" });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ id: "r_opencode", decision: "allow" });
    expect(store.query({ decision: "pending" }).total).toBe(0);
    expect(store.query({ decision: "allow" }).total).toBe(1);
  });

  it("drops resolutions with no id, agent, or decision", () => {
    const { store, logger } = setup();
    expect(logger.handleResolved({})).toBeNull();
    expect(logger.handleRequested({})).toBeNull();
    expect(store.readAll()).toHaveLength(0);
  });

  it("splitRequestEvent reads context agent attribution as fallback", () => {
    const parsed = splitRequestEvent(
      { request: { id: "r3", kind: "mode", name: "switch" } },
      { agent: { id: "a3", model: "m3" } },
    );
    expect(parsed?.agentId).toBe("a3");
    expect(parsed?.attribution?.model).toBe("m3");
  });

  it("splitResolveEvent understands flat payloads", () => {
    const parts = splitResolveEvent(
      { id: "r4", agentId: "a4", kind: "tool", name: "write", behavior: "allow" },
      undefined,
    );
    expect(parts).toMatchObject({ requestId: "r4", agentId: "a4", decision: "allow", name: "write" });
  });
});

describe("subscribePermissionEvents", () => {
  it("subscribes to daemon permission topics and unsubscribes cleanly", () => {
    const seen: string[] = [];
    const server = {
      on: (name: string, _handler: (event: unknown, context: unknown) => void) => {
        seen.push(name);
        return () => {};
      },
    };
    const logger = createPermissionLogger({
      store: new PermissionLogStore({ filePath: path.join(os.tmpdir(), "perm-never.jsonl") }),
    });
    const off = subscribePermissionEvents(server, logger);
    expect(seen).toContain("agent.permission_resolved");
    expect(seen).toContain("agent.permission_requested");
    expect(() => off()).not.toThrow();
  });

  it("routes resolved events into the store via the subscribed handler", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-sub-"));
    const store = new PermissionLogStore({ filePath: path.join(dir, "permissions.jsonl") });
    const logger = createPermissionLogger({ store });
    const handlers = new Map<string, (event: unknown, context: unknown) => void>();
    const server = {
      on: (name: string, handler: (event: unknown, context: unknown) => void) => {
        handlers.set(name, handler);
        return () => {
          handlers.delete(name);
        };
      },
    };
    subscribePermissionEvents(server, logger);
    handlers.get("agent.permission_resolved")?.(
      { id: "r5", agentId: "a5", kind: "tool", name: "bash", behavior: "deny" },
      undefined,
    );
    expect(store.readAll()).toHaveLength(1);
    expect(store.readAll()[0]).toMatchObject({ id: "r5", decision: "deny" });
  });

  it("is a no-op when the server exposes no event bus", () => {
    const logger = createPermissionLogger({
      store: new PermissionLogStore({ filePath: path.join(os.tmpdir(), "perm-never.jsonl") }),
    });
    expect(() => subscribePermissionEvents({}, logger)()).not.toThrow();
    expect(vi.fn()).toBeDefined();
  });
});

describe("registerPermissionAuditServer", () => {
  it("wires query contracts and permission event subscription with a shared store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-register-"));
    const handled = new Map<string, (input: any) => unknown>();
    const seenEvents: string[] = [];
    const server = {
      on: (name: string, _handler: (event: unknown, context: unknown) => void) => {
        seenEvents.push(name);
        return () => {};
      },
      handle: (contract: { name: string }, handler: (input: any) => unknown) => {
        handled.set(contract.name, handler);
      },
    };
    const { store, unsubscribe } = registerPermissionAuditServer(server, {
      filePath: path.join(dir, "permissions.jsonl"),
      now: () => "2026-09-28T10:00:00.000Z",
    });
    expect(handled.has("permission-audit.query")).toBe(true);
    expect(handled.has("permission-logger.query")).toBe(true);
    expect(seenEvents).toContain("agent.permission_requested");

    store.append(entry({ id: "q1", agentId: "agent-7", decision: "deny" }));
    const result = handled.get("permission-audit.query")?.({ limit: 100 }) as {
      entries: PermissionAuditEntry[];
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.entries[0]?.agentId).toBe("agent-7");
    expect(() => unsubscribe()).not.toThrow();
  });
});

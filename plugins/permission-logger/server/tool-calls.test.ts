import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPermissionLogger, splitToolCallTimeline } from "./listener.js";
import { PermissionLogStore, isPermissionEntry, isToolCallEntry } from "./storage.js";
import type { ToolCallAuditEntry } from "./storage.js";

/**
 * Post-turn tool-call capture (#897): tool calls arrive only inside the
 * `agent.turn_ended` timeline, so the logger must extract them from that
 * snapshot, reconcile replays, and persist them alongside permission entries.
 */

function shellCall(callId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "tool_call",
    callId,
    name: "Bash",
    status: "completed",
    error: null,
    detail: { type: "shell", command: "ls -la", cwd: "/srv/app", output: "file.txt", exitCode: 0 },
    ...overrides,
  };
}

function turnEndedEvent(overrides: Record<string, unknown> = {}) {
  return {
    agent: { id: "agent-1", provider: "claude", cwd: "/srv/app", title: "worker" },
    turnId: "turn-1",
    outcome: { kind: "completed" },
    timeline: [
      { type: "user_message", text: "go" },
      shellCall("call-1"),
      {
        type: "tool_call",
        callId: "call-2",
        name: "Read",
        status: "failed",
        error: { message: "ENOENT" },
        detail: { type: "read", filePath: "/nope" },
      },
    ],
    ...overrides,
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-tool-calls-"));
  const store = new PermissionLogStore({ filePath: path.join(dir, "permissions.jsonl") });
  const logger = createPermissionLogger({ store, now: () => "2026-10-06T10:00:00.000Z" });
  return { store, logger };
}

function toolCalls(store: PermissionLogStore): ToolCallAuditEntry[] {
  return store.readLatest().filter(isToolCallEntry);
}

describe("splitToolCallTimeline", () => {
  it("extracts agent, turn, name, parameters, and outcome from tool_call items", () => {
    const captures = splitToolCallTimeline(turnEndedEvent());
    expect(captures).toHaveLength(2);
    expect(captures[0]).toMatchObject({
      id: "call-1",
      turnId: "turn-1",
      sequence: 1,
      agentId: "agent-1",
      name: "Bash",
      input: { command: "ls -la", cwd: "/srv/app" },
      outcome: "success",
    });
    expect(captures[1]).toMatchObject({
      id: "call-2",
      name: "Read",
      input: { filePath: "/nope" },
      outcome: "failure",
      error: { message: "ENOENT" },
    });
  });

  it("maps tool status onto the normalized outcome", () => {
    const captures = splitToolCallTimeline({
      agent: { id: "a1" },
      turnId: "t1",
      timeline: [
        shellCall("running", { status: "running" }),
        shellCall("canceled", { status: "canceled" }),
        shellCall("failed", { status: "failed", error: "boom" }),
      ],
    });
    expect(captures.map((capture) => capture.outcome)).toEqual([
      "canceled",
      "canceled",
      "failure",
    ]);
  });

  it("prefers a provider raw input and reads outcomes for unknown tools", () => {
    const captures = splitToolCallTimeline({
      agent: { id: "a1" },
      turnId: "t1",
      timeline: [
        {
          type: "tool_call",
          callId: "raw",
          name: "CustomTool",
          status: "completed",
          error: null,
          input: { alpha: 1 },
          detail: { type: "unknown", input: { alpha: 0 }, output: { done: true } },
        },
      ],
    });
    expect(captures[0]?.input).toEqual({ alpha: 1 });
    expect(captures[0]?.result).toEqual({ done: true });
  });

  it("ignores non-tool timeline items and events with no agent", () => {
    expect(splitToolCallTimeline({ timeline: [shellCall("x")] })).toHaveLength(0);
    expect(splitToolCallTimeline({ agent: { id: "a1" }, timeline: [{ type: "reasoning", text: "hm" }] })).toHaveLength(0);
  });
});

describe("tool-call capture on agent.turn_ended", () => {
  let store: PermissionLogStore;
  let logger: ReturnType<typeof createPermissionLogger>;

  beforeEach(() => {
    ({ store, logger } = setup());
  });

  it("persists tool calls with attribution and outcomes", () => {
    const stored = logger.handleTurnEnded(turnEndedEvent());
    expect(stored).toHaveLength(2);
    const calls = toolCalls(store);
    expect(calls.map((call) => call.id)).toEqual(["call-1", "call-2"]);
    expect(calls[0]).toMatchObject({
      recordType: "tool_call",
      agentId: "agent-1",
      agentProvider: "claude",
      agentTitle: "worker",
      agentCwd: "/srv/app",
      kind: "tool_call",
      outcome: "success",
      timestamp: "2026-10-06T10:00:00.000Z",
    });
    expect(calls[0]?.result).toEqual({ output: "file.txt", exitCode: 0 });
    expect(calls[1]?.outcome).toBe("failure");
    expect(calls[1]?.error).toEqual({ message: "ENOENT" });
  });

  it("orders same-timestamp calls by their timeline sequence, newest first", () => {
    logger.handleTurnEnded(turnEndedEvent());
    const queried = store.query({ recordType: "tool_call", limit: 100 });
    expect(queried.total).toBe(2);
    expect(queried.entries.map((entry) => entry.id)).toEqual(["call-2", "call-1"]);
    expect(queried.entries[0] && isToolCallEntry(queried.entries[0]) ? queried.entries[0].sequence : null).toBe(2);
  });

  it("is idempotent across replayed timelines", () => {
    logger.handleTurnEnded(turnEndedEvent());
    logger.handleTurnEnded(turnEndedEvent());
    logger.handleTurnEnded(turnEndedEvent());
    expect(store.readAll()).toHaveLength(2);
    expect(toolCalls(store)).toHaveLength(2);
  });

  it("reconciles a running call that later completes without duplicating it", () => {
    logger.handleTurnEnded(turnEndedEvent({ timeline: [shellCall("call-1", { status: "running" })] }));
    expect(toolCalls(store)[0]?.outcome).toBe("canceled");

    // Next turn's timeline replays the merged, now-completed item.
    logger.handleTurnEnded(turnEndedEvent({ turnId: "turn-2", timeline: [shellCall("call-1")] }));
    const calls = toolCalls(store);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.outcome).toBe("success");
    expect(store.readAll().filter(isToolCallEntry)).toHaveLength(2);
  });

  it("survives reload: a fresh logger on the same file does not re-append", () => {
    logger.handleTurnEnded(turnEndedEvent());
    const reopened = createPermissionLogger({
      store: new PermissionLogStore({ filePath: store.filePath }),
      now: () => "2026-10-06T11:00:00.000Z",
    });
    reopened.handleTurnEnded(turnEndedEvent());
    expect(fs.readFileSync(store.filePath, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("reconciles pending permissions and captures tool calls in the same turn end", () => {
    logger.handleRequested({
      request: { id: "r1", kind: "tool", name: "Bash", input: { command: "ls" } },
      agent: { id: "agent-1" },
    });
    logger.handleTurnEnded(turnEndedEvent());

    const records = store.readLatest();
    expect(records.filter(isPermissionEntry)).toHaveLength(1);
    const permission = records.find(isPermissionEntry);
    expect(permission && isPermissionEntry(permission) ? permission.decision : null).toBe("allow");
    expect(records.filter(isToolCallEntry)).toHaveLength(2);
  });

  it("keeps tool-call and permission keys separate for the same id", () => {
    store.append({
      id: "shared-id",
      timestamp: "2026-10-06T09:00:00.000Z",
      agentId: "agent-1",
      kind: "tool",
      name: "bash",
      input: { command: "ls" },
      decision: "allow",
    });
    logger.handleTurnEnded(
      turnEndedEvent({ timeline: [shellCall("shared-id")] }),
    );
    const records = store.readLatest();
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => (isToolCallEntry(record) ? "tool_call" : "permission")))).toEqual(
      new Set(["permission", "tool_call"]),
    );
  });
});

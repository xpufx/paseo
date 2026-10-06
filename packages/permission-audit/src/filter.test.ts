import { describe, expect, it } from "vitest";
import { filterAuditEntries, formatAuditTime, summarizeAuditInput } from "./filter.js";
import type { AuditRecord, PermissionAuditEntry, ToolCallAuditEntry } from "./shared.js";

function entry(overrides: Partial<PermissionAuditEntry> = {}): PermissionAuditEntry {
  return {
    id: "r1",
    timestamp: "2026-09-28T10:00:00.000Z",
    agentId: "agent-1",
    kind: "tool",
    name: "bash",
    input: { command: "ls" },
    decision: "allow",
    ...overrides,
  };
}

describe("filterAuditEntries", () => {
  const entries = [
    entry({ id: "a", name: "bash", agentId: "agent-1", decision: "allow" }),
    entry({ id: "b", name: "read", agentId: "agent-2", agentModel: "m2", decision: "deny" }),
    entry({ id: "c", name: "write", agentId: "agent-1", decision: "pending" }),
  ];

  it("passes everything through on the all filter without search", () => {
    expect(filterAuditEntries(entries, "all", "")).toHaveLength(3);
  });

  it("filters by decision", () => {
    expect(filterAuditEntries(entries, "deny", "").map((e) => e.id)).toEqual(["b"]);
    expect(filterAuditEntries(entries, "pending", "").map((e) => e.id)).toEqual(["c"]);
  });

  it("searches tool, agent, model, and serialized input", () => {
    expect(filterAuditEntries(entries, "all", "read").map((e) => e.id)).toEqual(["b"]);
    expect(filterAuditEntries(entries, "all", "agent-2").map((e) => e.id)).toEqual(["b"]);
    expect(filterAuditEntries(entries, "all", "m2").map((e) => e.id)).toEqual(["b"]);
    expect(filterAuditEntries(entries, "all", "AGENT-1").map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("combines decision and search filters", () => {
    expect(filterAuditEntries(entries, "allow", "agent-1").map((e) => e.id)).toEqual(["a"]);
    expect(filterAuditEntries(entries, "deny", "agent-1")).toHaveLength(0);
  });
});

describe("summarizeAuditInput", () => {
  it("renders placeholders and truncates long payloads", () => {
    expect(summarizeAuditInput(null)).toBe("—");
    expect(summarizeAuditInput(undefined)).toBe("—");
    expect(summarizeAuditInput("short")).toBe("short");
    expect(summarizeAuditInput("x".repeat(200))).toHaveLength(121);
    expect(summarizeAuditInput({ command: "ls" })).toContain("ls");
  });
});

describe("formatAuditTime", () => {
  it("passes through unparseable timestamps", () => {
    expect(formatAuditTime("not-a-date")).toBe("not-a-date");
    expect(formatAuditTime("2026-09-28T10:00:00.000Z")).not.toBe("2026-09-28T10:00:00.000Z");
  });
});

describe("filterAuditEntries across permission and tool-call records", () => {
  function toolCall(overrides: Partial<ToolCallAuditEntry> = {}): ToolCallAuditEntry {
    return {
      recordType: "tool_call",
      id: "c1",
      timestamp: "2026-10-06T10:00:00.000Z",
      turnId: "turn-7",
      sequence: 1,
      agentId: "agent-1",
      kind: "tool_call",
      name: "bash",
      input: { command: "ls" },
      outcome: "success",
      ...overrides,
    };
  }

  const mixed: AuditRecord[] = [
    entry({ id: "p1", name: "bash", decision: "allow" }),
    toolCall({ id: "c1", name: "Write", outcome: "success" }),
    toolCall({ id: "c2", name: "Read", outcome: "failure" }),
  ];

  it("filters by record type", () => {
    expect(filterAuditEntries(mixed, "all", "", "permission").map((e) => e.id)).toEqual(["p1"]);
    expect(filterAuditEntries(mixed, "all", "", "tool_call").map((e) => e.id)).toEqual(["c1", "c2"]);
  });

  it("excludes tool calls when a decision filter is active", () => {
    expect(filterAuditEntries(mixed, "allow", "").map((e) => e.id)).toEqual(["p1"]);
    expect(filterAuditEntries(mixed, "deny", "")).toHaveLength(0);
  });

  it("searches tool-call name, outcome, input, and turn id", () => {
    expect(filterAuditEntries(mixed, "all", "write").map((e) => e.id)).toEqual(["c1"]);
    expect(filterAuditEntries(mixed, "all", "failure").map((e) => e.id)).toEqual(["c2"]);
    expect(filterAuditEntries(mixed, "all", "turn-7").map((e) => e.id)).toEqual(["c1", "c2"]);
  });
});

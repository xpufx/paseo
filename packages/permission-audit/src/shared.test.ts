import { describe, expect, it } from "vitest";
import {
  AuditRecordSchema,
  PermissionAuditEntrySchema,
  PermissionQueryFilterSchema,
  ToolCallAuditEntrySchema,
  auditRecordKey,
  isPermissionEntry,
  isToolCallEntry,
  permissionAuditQuery,
  permissionLoggerQuery,
} from "./shared.js";
import { resolvePermissionLogPaths } from "./server.js";

describe("permission audit contracts", () => {
  it("validates audit entries and rejects decisions outside the enum", () => {
    const parsed = PermissionAuditEntrySchema.parse({
      id: "r1",
      timestamp: "2026-09-28T10:00:00.000Z",
      agentId: "a1",
      kind: "tool",
      name: "bash",
      input: { command: "ls" },
      decision: "allow",
    });
    expect(parsed.agentId).toBe("a1");
    expect(() =>
      PermissionAuditEntrySchema.parse({
        id: "r1",
        timestamp: "2026-09-28T10:00:00.000Z",
        agentId: "a1",
        kind: "tool",
        name: "bash",
        input: null,
        decision: "maybe",
      }),
    ).toThrow();
  });

  it("exposes the shared query contract alongside the legacy logger contract", () => {
    expect(permissionAuditQuery.name).toBe("permission-audit.query");
    expect(permissionLoggerQuery.name).toBe("permission-logger.query");
    expect(PermissionQueryFilterSchema.parse({}).limit).toBe(100);
  });
});

describe("tool-call audit records", () => {
  const BASE_TOOL_CALL = {
    recordType: "tool_call",
    id: "call-1",
    timestamp: "2026-10-06T10:00:00.000Z",
    agentId: "agent-1",
    kind: "tool_call",
    name: "Bash",
    input: { command: "ls" },
    outcome: "success",
  } as const;

  it("validates tool-call entries and rejects unknown outcomes", () => {
    const parsed = ToolCallAuditEntrySchema.parse({
      ...BASE_TOOL_CALL,
      turnId: "turn-1",
      sequence: 2,
      result: { output: "ok" },
    });
    expect(parsed.name).toBe("Bash");
    expect(parsed.outcome).toBe("success");
    expect(() => ToolCallAuditEntrySchema.parse({ ...BASE_TOOL_CALL, outcome: "maybe" })).toThrow();
    expect(() => ToolCallAuditEntrySchema.parse({ ...BASE_TOOL_CALL, recordType: "permission" })).toThrow();
  });

  it("parses both record kinds through the union and discriminates them", () => {
    const toolCall = AuditRecordSchema.parse(BASE_TOOL_CALL);
    const permission = AuditRecordSchema.parse({
      id: "req-1",
      timestamp: "2026-10-06T10:00:00.000Z",
      agentId: "agent-1",
      kind: "tool",
      name: "Bash",
      input: null,
      decision: "allow",
    });
    expect(isToolCallEntry(toolCall)).toBe(true);
    expect(isToolCallEntry(permission)).toBe(false);
    expect(isPermissionEntry(permission) ? permission.decision : null).toBe("allow");
  });

  it("keeps permission and tool-call identities distinct", () => {
    const toolCall = ToolCallAuditEntrySchema.parse(BASE_TOOL_CALL);
    const permission = PermissionAuditEntrySchema.parse({
      id: "call-1",
      timestamp: "2026-10-06T10:00:00.000Z",
      agentId: "agent-1",
      kind: "tool",
      name: "Bash",
      input: null,
      decision: "allow",
    });
    expect(auditRecordKey(toolCall)).not.toBe(auditRecordKey(permission));
  });

  it("accepts recordType and outcome query filters", () => {
    const parsed = PermissionQueryFilterSchema.parse({
      recordType: "tool_call",
      outcome: "failure",
    });
    expect(parsed.recordType).toBe("tool_call");
    expect(parsed.outcome).toBe("failure");
  });
});

describe("resolvePermissionLogPaths", () => {
  it("defaults to the plugin-scoped data dir with a legacy fallback", () => {
    const prior = process.env.PASEO_PERMISSION_LOG_PATH;
    delete process.env.PASEO_PERMISSION_LOG_PATH;
    try {
      const paths = resolvePermissionLogPaths();
      expect(paths.primary).toContain(".paseo");
      expect(paths.primary).toContain("plugin-data");
      expect(paths.primary.endsWith("permissions.jsonl")).toBe(true);
      expect(paths.legacy).toContain("logs");
      expect(paths.primary).not.toBe(paths.legacy);
    } finally {
      if (prior !== undefined) process.env.PASEO_PERMISSION_LOG_PATH = prior;
    }
  });

  it("honors the explicit path override", () => {
    const prior = process.env.PASEO_PERMISSION_LOG_PATH;
    process.env.PASEO_PERMISSION_LOG_PATH = "/tmp/custom-perms.jsonl";
    try {
      expect(resolvePermissionLogPaths().primary).toBe("/tmp/custom-perms.jsonl");
    } finally {
      if (prior !== undefined) {
        process.env.PASEO_PERMISSION_LOG_PATH = prior;
      } else {
        delete process.env.PASEO_PERMISSION_LOG_PATH;
      }
    }
  });
});

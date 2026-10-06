import { isToolCallEntry, type AuditRecord, type PermissionDecision } from "./shared.js";

export type DecisionFilter = "all" | PermissionDecision;
export type AuditTypeFilter = "all" | "permission" | "tool_call";

export function formatAuditTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

export function summarizeAuditInput(input: unknown): string {
  if (input === null || input === undefined) return "—";
  if (typeof input === "string") return input.length > 120 ? `${input.slice(0, 120)}…` : input;
  try {
    const text = JSON.stringify(input);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return "—";
  }
}

export function filterAuditEntries(
  records: AuditRecord[],
  decision: DecisionFilter,
  search: string,
  type: AuditTypeFilter = "all",
): AuditRecord[] {
  const needle = search.trim().toLowerCase();
  return records.filter((record) => {
    const toolCall = isToolCallEntry(record);
    if (type === "permission" && toolCall) return false;
    if (type === "tool_call" && !toolCall) return false;
    // Decisions only exist on permission records; a decision filter excludes tool calls.
    if (decision !== "all" && (toolCall || record.decision !== decision)) return false;
    if (!needle) return true;
    const haystack = [
      record.name,
      record.kind,
      record.agentId,
      record.agentModel ?? "",
      summarizeAuditInput(record.input),
      toolCall ? record.outcome : record.decision,
      toolCall ? record.turnId ?? "" : "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

import { isToolCallEntry, type AuditRecord, type PermissionDecision } from "./shared.js";

export type DecisionFilter = "all" | PermissionDecision;
export type AuditTypeFilter = "all" | "permission" | "tool_call";

export function formatAuditTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

/**
 * Middle-ellipsis for long values, keeping the leading key and the trailing
 * identifier. `maxLength` is the content budget; the returned string can be one
 * character longer once the ellipsis is inserted.
 */
function truncateMiddle(text: string, maxLength = 120): string {
  if (text.length <= maxLength) return text;
  const head = Math.ceil(maxLength / 2);
  const tail = Math.floor(maxLength / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function summarizeAuditInput(input: unknown): string {
  if (input === null || input === undefined) return "—";
  if (typeof input === "string") return truncateMiddle(input);
  try {
    return truncateMiddle(JSON.stringify(input));
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

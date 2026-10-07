import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AuditRecordSchema,
  PERMISSION_AUDIT_FILENAME,
  PERMISSION_AUDIT_PLUGIN_ID,
  PermissionAuditEntrySchema,
  ToolCallAuditEntrySchema,
  auditRecordKey,
  isPermissionEntry,
  isToolCallEntry,
  permissionAuditQuery,
  permissionLoggerQuery,
  type AuditRecord,
  type PermissionAuditEntry,
  type PermissionDecision,
  type PermissionLogPaths,
  type PermissionQueryFilter,
  type ToolCallAuditEntry,
  type ToolCallOutcome,
} from "../../../shared/vendor/permission-audit/shared.js";

export type {
  AuditRecord,
  PermissionAuditEntry,
  PermissionDecision,
  PermissionLogPaths,
  PermissionQueryFilter,
  ToolCallAuditEntry,
  ToolCallOutcome,
} from "../../../shared/vendor/permission-audit/shared.js";
export {
  AuditRecordSchema,
  PERMISSION_AUDIT_FILENAME,
  PERMISSION_AUDIT_PLUGIN_ID,
  PermissionAuditEntrySchema,
  ToolCallAuditEntrySchema,
  auditRecordKey,
  isPermissionEntry,
  isToolCallEntry,
  permissionAuditQuery,
  permissionLoggerQuery,
} from "../../../shared/vendor/permission-audit/shared.js";

export function resolvePermissionLogPaths(): PermissionLogPaths {
  const override = process.env.PASEO_PERMISSION_LOG_PATH?.trim();
  const legacy = path.join(os.homedir(), ".paseo", "logs", PERMISSION_AUDIT_FILENAME);
  if (override) return { primary: override, legacy };
  const primary = path.join(
    os.homedir(),
    ".paseo",
    "plugin-data",
    "xpufx",
    PERMISSION_AUDIT_PLUGIN_ID,
    PERMISSION_AUDIT_FILENAME,
  );
  return { primary, legacy };
}

export function resolveDefaultLogPath(): string {
  return resolvePermissionLogPaths().primary;
}

export interface PermissionLogStoreOptions {
  filePath?: string;
  legacyFilePath?: string;
}

function readJsonlFile(filePath: string): AuditRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const entries: AuditRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(AuditRecordSchema.parse(JSON.parse(trimmed)));
    } catch {
      continue;
    }
  }
  return entries;
}

function auditRecordSearchText(record: AuditRecord): string {
  const parts = [record.name, record.kind, record.agentId, record.agentModel ?? ""];
  if (isToolCallEntry(record)) {
    parts.push(
      record.outcome,
      record.turnId ?? "",
      JSON.stringify(record.input ?? null),
      JSON.stringify(record.error ?? null),
      JSON.stringify(record.result ?? null),
    );
  } else {
    parts.push(record.decision, JSON.stringify(record.input ?? null));
  }
  return parts.join(" ").toLowerCase();
}

function auditRecordSequence(record: AuditRecord): number {
  return isToolCallEntry(record) ? (record.sequence ?? 0) : 0;
}

/** Newest first; tool calls sharing a turn timestamp break the tie by timeline order. */
function compareAuditRecordsNewestFirst(a: AuditRecord, b: AuditRecord): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
  return auditRecordSequence(b) - auditRecordSequence(a);
}

export class PermissionLogStore {
  readonly filePath: string;
  readonly legacyFilePath: string | null;

  constructor(options: PermissionLogStoreOptions = {}) {
    const paths = resolvePermissionLogPaths();
    this.filePath = options.filePath ?? paths.primary;
    if (options.legacyFilePath !== undefined) {
      this.legacyFilePath = options.legacyFilePath;
    } else if (options.filePath) {
      this.legacyFilePath = null;
    } else {
      this.legacyFilePath = paths.legacy;
    }
  }

  append<T extends AuditRecord>(entry: T): T {
    const validated = AuditRecordSchema.parse(entry) as T;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(validated)}\n`, "utf8");
    return validated;
  }

  readAll(): AuditRecord[] {
    const entries: AuditRecord[] = [];
    if (this.legacyFilePath && this.legacyFilePath !== this.filePath) {
      entries.push(...readJsonlFile(this.legacyFilePath));
    }
    entries.push(...readJsonlFile(this.filePath));
    return entries;
  }

  readLatest(): AuditRecord[] {
    const byKey = new Map<string, AuditRecord>();
    for (const entry of this.readAll()) {
      byKey.set(auditRecordKey(entry), entry);
    }
    return Array.from(byKey.values());
  }

  query(filter: PermissionQueryFilter): { entries: AuditRecord[]; total: number } {
    const fromMs = filter.from ? Date.parse(filter.from) : NaN;
    const toMs = filter.to ? Date.parse(filter.to) : NaN;
    const search = filter.search?.trim().toLowerCase() ?? "";
    const matched = this.readLatest().filter((entry) => {
      if (filter.agentId && entry.agentId !== filter.agentId) return false;
      if (filter.model && entry.agentModel !== filter.model) return false;
      if (filter.provider && entry.agentProvider !== filter.provider) return false;
      if (
        filter.recordType &&
        (isToolCallEntry(entry) ? "tool_call" : "permission") !== filter.recordType
      ) {
        return false;
      }
      if (filter.decision && !(isPermissionEntry(entry) && entry.decision === filter.decision)) {
        return false;
      }
      if (filter.outcome && !(isToolCallEntry(entry) && entry.outcome === filter.outcome)) {
        return false;
      }
      if (filter.kind && entry.kind !== filter.kind) return false;
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(fromMs) && (Number.isNaN(ts) || ts < fromMs)) return false;
      if (!Number.isNaN(toMs) && (Number.isNaN(ts) || ts > toMs)) return false;
      if (search && !auditRecordSearchText(entry).includes(search)) return false;
      return true;
    });
    matched.sort(compareAuditRecordsNewestFirst);
    const limit = filter.limit ?? 100;
    return { entries: matched.slice(0, limit), total: matched.length };
  }
}

export interface AgentAttribution {
  id?: string;
  title?: string;
  model?: string;
  provider?: string;
  mode?: string;
  cwd?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const found = asString(source[key]);
      if (found) return found;
    }
  }
  return undefined;
}

export function extractAgentAttribution(agent: unknown): AgentAttribution {
  const root = asRecord(agent);
  if (!root) return {};
  const nested = asRecord(root.agent) ?? asRecord(root.session) ?? null;
  const sources = [root, nested];
  return {
    id: pickString(sources, ["id", "agentId"]),
    title: pickString(sources, ["title", "name"]),
    model: pickString(sources, ["model", "modelId"]),
    provider: pickString(sources, ["provider", "providerId"]),
    mode: pickString(sources, ["modeId", "mode"]),
    cwd: pickString(sources, ["cwd", "workingDirectory", "workdir"]),
  };
}

export function normalizeDecision(raw: unknown): PermissionDecision | null {
  const record = asRecord(raw);
  const candidates: unknown[] = [
    record?.behavior,
    record?.decision,
    record?.verdict,
    record?.approved,
    record?.allowed,
    typeof raw === "string" || typeof raw === "boolean" ? raw : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate === true || candidate === "allow" || candidate === "approve" || candidate === "approved") {
      return "allow";
    }
    if (candidate === false || candidate === "deny" || candidate === "denied" || candidate === "reject") {
      return "deny";
    }
  }
  return null;
}

export interface PendingPermissionRequest {
  id: string;
  timestamp: string;
  agentId?: string;
  kind?: string;
  name?: string;
  input?: unknown;
  attribution?: AgentAttribution;
}

interface ResolveParts {
  requestId?: string;
  agentId?: string;
  kind?: string;
  name?: string;
  input?: unknown;
  updatedInput?: unknown;
  denyReason?: string;
  decision?: PermissionDecision | null;
  attribution?: AgentAttribution;
}

function getAt(record: Record<string, unknown> | null, pathParts: string[]): unknown {
  let current: unknown = record;
  for (const key of pathParts) {
    const next = asRecord(current);
    if (!next) return undefined;
    current = next[key];
  }
  return current;
}

function firstDefined(values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

export function splitResolveEvent(event: unknown, context: unknown): ResolveParts {
  const root = asRecord(event) ?? {};
  const request = asRecord(root.request) ?? asRecord(root.permission) ?? null;
  const response =
    asRecord(root.response) ?? asRecord(root.result) ?? asRecord(root.resolution) ?? null;
  const contextRecord = asRecord(context);
  const contextAgent = contextRecord ? (contextRecord.agent ?? asRecord(contextRecord.paseo)?.agent) : undefined;

  const requestId =
    asString(root.requestId) ??
    asString(request?.id) ??
    asString(request?.requestId) ??
    asString(root.id);
  const decision =
    normalizeDecision(response) ??
    normalizeDecision(root) ??
    normalizeDecision(request) ??
    normalizeDecision(asRecord(root.response) ?? null);

  const attribution = extractAgentAttribution(
    firstDefined([root.agent, request?.agent, response?.agent, contextAgent]) ?? null,
  );

  return {
    requestId,
    agentId:
      asString(root.agentId) ??
      asString(request?.agentId) ??
      asString(response?.agentId) ??
      attribution.id,
    kind: asString(request?.kind) ?? asString(root.kind),
    name:
      asString(request?.name) ??
      asString(request?.title) ??
      asString(request?.tool) ??
      asString(root.name) ??
      asString(root.title),
    input: firstDefined([request?.input, root.input]),
    updatedInput: firstDefined([
      getAt(response, ["updatedInput"]),
      getAt(root, ["updatedInput"]),
      getAt(response, ["updatedPermissions"]),
    ]),
    denyReason:
      asString(response?.message) ??
      asString(response?.denyReason) ??
      asString(response?.reason) ??
      asString(root.message) ??
      asString(root.denyReason),
    decision,
    attribution,
  };
}

export function splitRequestEvent(event: unknown, context: unknown): PendingPermissionRequest | null {
  const root = asRecord(event) ?? {};
  const request = asRecord(root.request) ?? asRecord(root.permission) ?? root;
  const id = asString(request.id) ?? asString(request.requestId) ?? asString(root.requestId);
  if (!id) return null;
  const contextRecord = asRecord(context);
  const contextAgent = contextRecord ? (contextRecord.agent ?? asRecord(contextRecord.paseo)?.agent) : undefined;
  const attribution = extractAgentAttribution(
    firstDefined([root.agent, request.agent, contextAgent]) ?? null,
  );
  return {
    id,
    timestamp: asString(root.timestamp) ?? asString(request.timestamp) ?? new Date().toISOString(),
    agentId: asString(request.agentId) ?? asString(root.agentId) ?? attribution.id,
    kind: asString(request.kind) ?? asString(root.kind),
    name:
      asString(request.name) ??
      asString(request.title) ??
      asString(request.tool) ??
      asString(root.name),
    input: firstDefined([request.input, root.input]),
    attribution,
  };
}

function compact(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeToolOutcome(status: unknown): ToolCallOutcome {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "failure";
    default:
      // "canceled", or "running" when the turn ended before the call settled.
      return "canceled";
  }
}

/**
 * The daemon's tool-call timeline item carries the parameters inside its
 * structured `detail`; providers that expose a raw `input` are preferred when
 * present. Output is separated out by `toolCallResult`.
 */
function toolCallInput(
  item: Record<string, unknown>,
  detail: Record<string, unknown> | null,
): unknown {
  if (item.input !== undefined) return item.input;
  if (!detail) return null;
  switch (asString(detail.type)) {
    case "shell":
      return compact({ command: detail.command, cwd: detail.cwd }) ?? null;
    case "read":
      return compact({ filePath: detail.filePath, offset: detail.offset, limit: detail.limit }) ?? null;
    case "edit":
      return compact({
        filePath: detail.filePath,
        oldString: detail.oldString,
        newString: detail.newString,
      }) ?? null;
    case "write":
      return compact({ filePath: detail.filePath, content: detail.content }) ?? null;
    case "search":
      return compact({ query: detail.query, toolName: detail.toolName, mode: detail.mode }) ?? null;
    case "fetch":
      return compact({ url: detail.url, prompt: detail.prompt }) ?? null;
    case "worktree_setup":
      return compact({ worktreePath: detail.worktreePath, branchName: detail.branchName }) ?? null;
    case "sub_agent":
      return compact({
        subAgentType: detail.subAgentType,
        description: detail.description,
        childSessionId: detail.childSessionId,
      }) ?? null;
    case "plain_text":
      return compact({ label: detail.label }) ?? null;
    case "plan":
      return compact({ text: detail.text }) ?? null;
    case "unknown":
      return detail.input ?? null;
    default:
      return detail;
  }
}

function toolCallResult(detail: Record<string, unknown> | null): unknown {
  if (!detail) return undefined;
  switch (asString(detail.type)) {
    case "shell":
      return compact({ output: detail.output, exitCode: detail.exitCode });
    case "read":
      return detail.content ?? undefined;
    case "edit":
      return detail.unifiedDiff ?? undefined;
    case "search":
      return compact({
        content: detail.content,
        filePaths: detail.filePaths,
        webResults: detail.webResults,
        numFiles: detail.numFiles,
        numMatches: detail.numMatches,
      });
    case "fetch":
      return compact({
        result: detail.result,
        code: detail.code,
        codeText: detail.codeText,
        bytes: detail.bytes,
      });
    case "worktree_setup":
      return compact({ log: detail.log, commands: detail.commands });
    case "sub_agent":
      return compact({ log: detail.log, actions: detail.actions });
    case "plain_text":
      return detail.text ?? undefined;
    case "unknown":
      return detail.output ?? undefined;
    default:
      return undefined;
  }
}

export interface ToolCallCapture {
  id: string;
  turnId?: string;
  sequence: number;
  agentId: string;
  attribution: AgentAttribution;
  name: string;
  input: unknown;
  outcome: ToolCallOutcome;
  error?: unknown;
  result?: unknown;
}

/** Extracts one capture per `tool_call` item in an `agent.turn_ended` timeline. */
export function splitToolCallTimeline(event: unknown, context?: unknown): ToolCallCapture[] {
  const root = asRecord(event);
  if (!root) return [];
  const contextRecord = asRecord(context);
  const agentSource = firstDefined([
    root.agent,
    contextRecord?.agent,
    asRecord(contextRecord?.paseo)?.agent,
  ]);
  const attribution = extractAgentAttribution(agentSource ?? null);
  const agentId = asString(root.agentId) ?? attribution.id;
  if (!agentId) return [];

  const turnId = asString(root.turnId);
  const timeline = Array.isArray(root.timeline) ? root.timeline : [];
  const captures: ToolCallCapture[] = [];
  timeline.forEach((raw, index) => {
    const item = asRecord(raw);
    if (!item || item.type !== "tool_call") return;
    const detail = asRecord(item.detail);
    const capture: ToolCallCapture = {
      id: asString(item.callId) ?? `${turnId ?? "turn"}:${index}`,
      sequence: index,
      agentId,
      attribution,
      name: asString(item.name) ?? asString(detail?.type) ?? "tool",
      input: toolCallInput(item, detail),
      outcome: normalizeToolOutcome(item.status),
    };
    if (turnId) capture.turnId = turnId;
    if (item.error !== undefined && item.error !== null) capture.error = item.error;
    const result = toolCallResult(detail);
    if (result !== undefined) capture.result = result;
    captures.push(capture);
  });
  return captures;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null) ?? "null";
}

/** Identity of a captured call's content; excludes capture time and ordering. */
function toolCallFingerprint(entry: ToolCallAuditEntry): string {
  return [
    entry.turnId ?? "",
    entry.agentId,
    entry.name,
    entry.outcome,
    stableJson(entry.input),
    stableJson(entry.error),
    stableJson(entry.result),
  ].join("|");
}

export interface PermissionLoggerOptions {
  store: PermissionLogStore;
  now?: () => string;
  onRecord?: (entry: AuditRecord) => void;
}

export function createPermissionLogger(options: PermissionLoggerOptions) {
  const { store, onRecord } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const pending = new Map<string, PendingPermissionRequest>();

  function handleRequested(event: unknown, context?: unknown): PermissionAuditEntry | null {
    const parsed = splitRequestEvent(event, context);
    if (!parsed) return null;
    pending.set(parsed.id, parsed);

    const attribution = parsed.attribution ?? {};
    const agentId = parsed.agentId ?? attribution.id;
    if (!parsed.id || !agentId) return null;

    const candidate = {
      id: parsed.id,
      timestamp: parsed.timestamp ?? now(),
      agentId,
      agentTitle: attribution.title,
      agentModel: attribution.model,
      agentProvider: attribution.provider,
      agentMode: attribution.mode,
      agentCwd: attribution.cwd,
      kind: parsed.kind ?? "tool",
      name: parsed.name ?? "permission",
      input: parsed.input ?? null,
      decision: "pending" as const,
    };
    const validated = PermissionAuditEntrySchema.parse(candidate);
    const stored = store.append(validated);
    onRecord?.(stored);
    return stored;
  }

  function handleResolved(event: unknown, context?: unknown): PermissionAuditEntry | null {
    const parts = splitResolveEvent(event, context);
    const prior = parts.requestId ? pending.get(parts.requestId) : undefined;
    if (parts.requestId) pending.delete(parts.requestId);

    const attribution = {
      ...(prior?.attribution ?? {}),
      ...(parts.attribution ?? {}),
    };
    const agentId = parts.agentId ?? prior?.agentId ?? attribution.id;
    const decision = parts.decision;
    const id = parts.requestId ?? prior?.id;
    const kind = parts.kind ?? prior?.kind ?? "tool";
    const name = parts.name ?? prior?.name ?? "permission";
    if (!id || !agentId || !decision) return null;

    const candidate = {
      id,
      timestamp: now(),
      agentId,
      agentTitle: attribution.title,
      agentModel: attribution.model,
      agentProvider: attribution.provider,
      agentMode: attribution.mode,
      agentCwd: attribution.cwd,
      kind,
      name,
      input: firstDefined([parts.input, prior?.input]) ?? null,
      decision,
      updatedInput: parts.updatedInput,
      denyReason: parts.denyReason,
    };
    const parsed = PermissionAuditEntrySchema.parse(candidate);
    const stored = store.append(parsed);
    onRecord?.(stored);
    return stored;
  }

  function handleTurnActivity(event: unknown): PermissionAuditEntry[] {
    const root = asRecord(event);
    const agentId = asString(root?.agentId) ?? asString(asRecord(root?.agent)?.id);
    if (!agentId) return [];
    const resolved: PermissionAuditEntry[] = [];
    for (const [id, req] of pending.entries()) {
      if (req.agentId === agentId) {
        pending.delete(id);
        const attribution = req.attribution ?? {};
        const candidate = {
          id: req.id,
          timestamp: now(),
          agentId,
          agentTitle: attribution.title,
          agentModel: attribution.model,
          agentProvider: attribution.provider,
          agentMode: attribution.mode,
          agentCwd: attribution.cwd,
          kind: req.kind ?? "tool",
          name: req.name ?? "permission",
          input: req.input ?? null,
          decision: "allow" as const,
        };
        const parsed = PermissionAuditEntrySchema.parse(candidate);
        const stored = store.append(parsed);
        onRecord?.(stored);
        resolved.push(stored);
      }
    }
    return resolved;
  }

  const capturedToolCalls = new Map<string, string>();
  let toolCallsSeeded = false;

  // Seed from the persisted log so a daemon reload does not re-append calls the
  // turn-ended timeline replays on every subsequent turn.
  function seedCapturedToolCalls(): void {
    if (toolCallsSeeded) return;
    toolCallsSeeded = true;
    for (const existing of store.readLatest()) {
      if (isToolCallEntry(existing)) {
        capturedToolCalls.set(
          `${existing.agentId}:${existing.id}`,
          toolCallFingerprint(existing),
        );
      }
    }
  }

  function recordToolCall(capture: ToolCallCapture): ToolCallAuditEntry | null {
    seedCapturedToolCalls();
    const attribution = capture.attribution ?? {};
    const candidate: ToolCallAuditEntry = {
      recordType: "tool_call",
      id: capture.id,
      timestamp: now(),
      ...(capture.turnId ? { turnId: capture.turnId } : {}),
      sequence: capture.sequence,
      agentId: capture.agentId,
      ...(attribution.title ? { agentTitle: attribution.title } : {}),
      ...(attribution.model ? { agentModel: attribution.model } : {}),
      ...(attribution.provider ? { agentProvider: attribution.provider } : {}),
      ...(attribution.mode ? { agentMode: attribution.mode } : {}),
      ...(attribution.cwd ? { agentCwd: attribution.cwd } : {}),
      kind: "tool_call",
      name: capture.name,
      input: capture.input ?? null,
      outcome: capture.outcome,
      ...(capture.error !== undefined ? { error: capture.error } : {}),
      ...(capture.result !== undefined ? { result: capture.result } : {}),
    };
    const validated = ToolCallAuditEntrySchema.parse(candidate);
    const key = `${capture.agentId}:${capture.id}`;
    const fingerprint = toolCallFingerprint(validated);
    if (capturedToolCalls.get(key) === fingerprint) return null;
    capturedToolCalls.set(key, fingerprint);
    const stored = store.append(validated);
    onRecord?.(stored);
    return stored;
  }

  function handleTurnEnded(event: unknown, context?: unknown): AuditRecord[] {
    const stored: AuditRecord[] = [...handleTurnActivity(event)];
    for (const capture of splitToolCallTimeline(event, context)) {
      const record = recordToolCall(capture);
      if (record) stored.push(record);
    }
    return stored;
  }

  return { handleRequested, handleResolved, handleTurnActivity, handleTurnEnded, recordToolCall, pending };
}

const REQUESTED_EVENTS = ["agent.permission_requested", "permission.requested"];
const RESOLVED_EVENTS = ["agent.permission_resolved", "permission.resolved"];
const TURN_START_EVENTS = ["agent.turn_started"];
const TURN_ENDED_EVENTS = ["agent.turn_ended"];

interface EventedServer {
  on?: (event: string, handler: (event: unknown, context: unknown) => void) => () => void;
}

export function subscribePermissionEvents(
  server: EventedServer,
  logger: Pick<
    ReturnType<typeof createPermissionLogger>,
    "handleRequested" | "handleResolved" | "handleTurnActivity" | "handleTurnEnded"
  >,
): () => void {
  if (typeof server.on !== "function") return () => {};
  const offs: Array<() => void> = [];
  for (const name of REQUESTED_EVENTS) {
    try {
      offs.push(server.on(name, (event, context) => logger.handleRequested(event, context)));
    } catch {
      continue;
    }
  }
  for (const name of RESOLVED_EVENTS) {
    try {
      offs.push(server.on(name, (event, context) => logger.handleResolved(event, context)));
    } catch {
      continue;
    }
  }
  for (const name of TURN_START_EVENTS) {
    try {
      offs.push(server.on(name, (event) => logger.handleTurnActivity(event)));
    } catch {
      continue;
    }
  }
  for (const name of TURN_ENDED_EVENTS) {
    try {
      offs.push(server.on(name, (event, context) => logger.handleTurnEnded(event, context)));
    } catch {
      continue;
    }
  }
  return () => {
    for (const off of offs) {
      try {
        off();
      } catch {
        continue;
      }
    }
  };
}

export interface PermissionAuditServerOptions {
  filePath?: string;
  now?: () => string;
  onRecord?: (entry: AuditRecord) => void;
  logger?: { info: (message: string, details?: Record<string, unknown>) => void };
}

interface RpcServer {
  on?: (event: string, handler: (event: unknown, context: unknown) => void) => () => void;
  handle: (contract: { name: string }, handler: (input: any) => unknown) => void;
}

export function registerPermissionAuditServer(server: RpcServer, options: PermissionAuditServerOptions = {}) {
  const store = new PermissionLogStore({ filePath: options.filePath });
  const logger = createPermissionLogger({
    store,
    now: options.now,
    onRecord: options.onRecord ?? ((entry) => {
      if (isToolCallEntry(entry)) {
        options.logger?.info("tool call logged", {
          id: entry.id,
          agentId: entry.agentId,
          name: entry.name,
          outcome: entry.outcome,
          turnId: entry.turnId,
        });
        return;
      }
      options.logger?.info("permission decision logged", {
        id: entry.id,
        agentId: entry.agentId,
        name: entry.name,
        decision: entry.decision,
      });
    }),
  });

  const unsubscribe = subscribePermissionEvents(server, logger);
  const queryHandler = (input: PermissionQueryFilter) => store.query(input);
  server.handle(permissionAuditQuery, queryHandler);
  server.handle(permissionLoggerQuery, queryHandler);

  return { store, logger, unsubscribe };
}

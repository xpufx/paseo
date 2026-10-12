import type {
  FleetAgent,
  FleetAgentMetrics,
  PendingPermission,
  AgentAttentionReason,
  AgentBlockDetail,
  AgentLifecycleState,
} from "../client/types.js";
import {
  buildAgentBlockDetail,
  deriveLifecycleState,
  extractPermissionScope,
} from "../client/types.js";
import type { RawAgentRecord, WorkspaceProjectMap } from "../shared/classify.js";
import {
  categorizeAgent,
  deriveDeterministicState,
  extractAgentProject,
  extractAgentWorktree,
  extractAttributedWork,
} from "../shared/classify.js";
import { readQuotaAlertAgentIds, readWorkspaceProjectMap } from "./storage.js";

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function normalizePendingPermissions(raw: RawAgentRecord["pendingPermissions"]): PendingPermission[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingPermission[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || entry.requestId || "").trim();
    if (!id) continue;
    const permission: PendingPermission = { id };
    for (const key of ["requestId", "name", "title", "tool", "kind", "description"] as const) {
      const value = textOrUndefined(entry[key]);
      if (value) permission[key] = value;
    }
    const input = entry.input && typeof entry.input === "object" ? entry.input : entry.metadata;
    if (input && typeof input === "object") {
      permission.input = input as Record<string, unknown>;
    }
    const scope = extractPermissionScope(permission);
    if (scope) permission.scope = scope;
    out.push(permission);
  }
  return out;
}

export function normalizeAttentionReason(raw: unknown): AgentAttentionReason | null {
  return raw === "finished" || raw === "error" || raw === "permission" || raw === "input" ? raw : null;
}

export function normalizeAgentMetrics(raw: RawAgentRecord): FleetAgentMetrics | null {
  const usage = raw.lastUsage ?? null;
  const metrics: FleetAgentMetrics = {};

  const used = numberOrUndefined(usage?.contextWindowUsedTokens);
  const max = numberOrUndefined(usage?.contextWindowMaxTokens);
  const cached = numberOrUndefined(usage?.cachedInputTokens);
  const input = numberOrUndefined(usage?.inputTokens);
  const output = numberOrUndefined(usage?.outputTokens);
  const cost = numberOrUndefined(usage?.totalCostUsd);
  const turnStart = textOrUndefined(raw.activeTurn?.startedAt);
  const attention = textOrUndefined(raw.attentionTimestamp);

  if (used !== undefined) metrics.contextUsedTokens = used;
  if (max !== undefined) metrics.contextMaxTokens = max;
  if (cached !== undefined) metrics.cachedTokens = cached;
  if (input !== undefined) metrics.inputTokens = input;
  if (output !== undefined) metrics.outputTokens = output;
  if (cost !== undefined) metrics.costUsd = cost;
  if (turnStart !== undefined) metrics.activeTurnStartedAt = turnStart;
  if (attention !== undefined) metrics.attentionTimestamp = attention;

  return Object.keys(metrics).length > 0 ? metrics : null;
}

export function normalizeRawAgent(
  raw: RawAgentRecord,
  options?: {
    quotaAlertAgentIds?: Set<string>;
    workspaceProjectMap?: WorkspaceProjectMap;
    home?: string;
  },
): FleetAgent {
  const id = raw.id || "";
  const shortId = raw.shortId || id.slice(0, 7);
  const name = raw.name || raw.title || `Agent ${shortId}`;
  const category = categorizeAgent(name);
  const status = raw.status || "idle";

  const parentId =
    raw.parentId !== undefined
      ? raw.parentId
      : raw.ParentAgentId !== undefined
        ? raw.ParentAgentId
        : raw.labels?.["paseo.parent-agent-id"] || null;

  const attributedWork = extractAttributedWork(raw);
  const pendingPermissions = normalizePendingPermissions(raw.pendingPermissions);
  const attentionReason = normalizeAttentionReason(raw.attentionReason);
  const requiresAttention =
    pendingPermissions.length > 0 ||
    (raw.requiresAttention === true && attentionReason !== "finished");

  const quotaIds = options?.quotaAlertAgentIds ?? readQuotaAlertAgentIds({ home: options?.home });
  const projectMap = options?.workspaceProjectMap ?? readWorkspaceProjectMap({ home: options?.home });

  const { state: deterministicState, detail: stateDetail } = deriveDeterministicState(
    raw,
    attributedWork,
    quotaIds,
  );
  const lifecycleState: AgentLifecycleState = deriveLifecycleState(deterministicState);
  const blockDetail: AgentBlockDetail | undefined =
    lifecycleState === "waiting_for_input"
      ? buildAgentBlockDetail(id, pendingPermissions)
      : undefined;
  const metrics = normalizeAgentMetrics(raw);

  const project = extractAgentProject(
    raw,
    undefined,
    projectMap,
  );

  return {
    id,
    shortId,
    name,
    category,
    provider: raw.provider,
    model: raw.model || null,
    status,
    cwd: raw.cwd,
    created: raw.created || raw.createdAt,
    updatedAt: raw.updatedAt,
    lastActivityAt: raw.lastActivityAt || null,
    workspaceId: raw.workspaceId,
    parentId: parentId || null,
    deterministicState,
    stateDetail,
    lifecycleState,
    blockDetail: blockDetail ?? null,
    attributedWork,
    usage: raw.lastUsage || null,
    metrics,
    lastError: raw.lastError || null,
    url: raw.url || (id ? `paseo://agent/${id}` : undefined),
    worktree: extractAgentWorktree(raw),
    project,
    labels: raw.labels,
    pendingPermissions,
    requiresAttention,
    attentionReason,
  };
}

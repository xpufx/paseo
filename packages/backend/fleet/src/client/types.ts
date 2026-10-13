import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Agent Categories & Role Constants
// ---------------------------------------------------------------------------

export const CODING_AGENT_CATEGORY = "coding-agent" as const;

export const AgentCategorySchema = z.enum([
  "front-desk",
  "orchestrator",
  "coding-agent",
  "worker",
]);
export type AgentCategory = z.infer<typeof AgentCategorySchema>;
export type UppidiAgentCategory = AgentCategory;

export function isCodingAgentCategory(category?: string | null): boolean {
  const normalized = String(category ?? "").trim().toLowerCase();
  return normalized === CODING_AGENT_CATEGORY || normalized === "worker";
}

// ---------------------------------------------------------------------------
// 2. Deterministic State & Lifecycle
// ---------------------------------------------------------------------------

export const DeterministicAgentStateSchema = z.enum([
  "working",                // Running with attributed work
  "running",                // Running general task without specific issue attribution
  "sleeping",               // Idle orchestrator/frontdesk inactive > 15 minutes
  "idle:waiting",           // Idle agent waiting for turn/prompt
  "idle:quota-exhausted",   // Idle due to model quota exhaustion cooldown
  "attention-required",     // Blocked awaiting operator input/decision
  "permission-prompt",      // Blocked on a pending tool/permission request
  "failed:quota-exhausted", // Failed/aborted due to usage/quota limit
  "failed:spawn",           // Failed during process or session spawn
  "failed:timeout",         // Execution or connection timeout
  "failed:error",           // General agent crash or unhandled error
  "unknown",                // Fallback when signals cannot resolve
]);
export type DeterministicAgentState = z.infer<typeof DeterministicAgentStateSchema>;

export const AgentLifecycleStateSchema = z.enum([
  "running",
  "waiting_for_input",
  "idle",
  "errored",
  "completed",
]);
export type AgentLifecycleState = z.infer<typeof AgentLifecycleStateSchema>;

export function deriveLifecycleState(state: DeterministicAgentState): AgentLifecycleState {
  switch (state) {
    case "permission-prompt":
    case "attention-required":
      return "waiting_for_input";
    case "working":
    case "running":
      return "running";
    case "failed:quota-exhausted":
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      return "errored";
    case "idle:quota-exhausted":
    case "idle:waiting":
    case "sleeping":
    case "unknown":
    default:
      return "idle";
  }
}

export function isBlockedLifecycleState(state: AgentLifecycleState): boolean {
  return state === "waiting_for_input";
}

export function resolveAgentLifecycleState(agent: {
  lifecycleState?: AgentLifecycleState | null;
  deterministicState?: DeterministicAgentState | null;
} | null | undefined): AgentLifecycleState {
  if (!agent) return "idle";
  if (agent.lifecycleState) return agent.lifecycleState;
  return deriveLifecycleState(agent.deterministicState ?? "unknown");
}

// ---------------------------------------------------------------------------
// 3. Permissions & Attention
// ---------------------------------------------------------------------------

export const AgentAttentionReasonSchema = z.enum(["finished", "error", "permission", "input"]);
export type AgentAttentionReason = z.infer<typeof AgentAttentionReasonSchema>;

export const PendingPermissionSchema = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  tool: z.string().optional(),
  kind: z.string().optional(),
  description: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  scope: z.string().optional(),
});
export type PendingPermission = z.infer<typeof PendingPermissionSchema>;

const SCOPE_INPUT_KEYS = [
  "path",
  "paths",
  "directory",
  "directories",
  "dir",
  "cwd",
  "target",
  "scope",
  "file_path",
  "filePath",
  "file",
] as const;

const SCOPE_DESCRIPTION_PREFIX = /^\s*scope\s*:\s*/i;

function coerceScopeValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(coerceScopeValue)
      .filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  return undefined;
}

export function extractPermissionScope(
  permission: Pick<PendingPermission, "input" | "description" | "scope">,
): string | undefined {
  const explicit = permission.scope?.trim();
  if (explicit) return explicit;
  const input = permission.input;
  if (input && typeof input === "object") {
    for (const key of SCOPE_INPUT_KEYS) {
      const found = coerceScopeValue((input as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  const description = permission.description?.trim();
  if (!description) return undefined;
  const scoped = description.replace(SCOPE_DESCRIPTION_PREFIX, "").trim();
  return scoped || undefined;
}

export const AgentBlockDetailSchema = z.object({
  requiredPermissionId: z.string().optional(),
  scope: z.string().optional(),
  action: z.string().optional(),
  command: z.string(),
});
export type AgentBlockDetail = z.infer<typeof AgentBlockDetailSchema>;

export function getPendingPermissionAction(permission: PendingPermission): string {
  return (
    permission.title?.trim() ||
    permission.tool?.trim() ||
    permission.name?.trim() ||
    permission.kind?.trim() ||
    "tool permission"
  );
}

export function getPermissionAdjudicationCommand(
  agentId: string,
  permission?: PendingPermission | null,
): string {
  const reqId = permission?.id || permission?.requestId;
  return reqId ? `paseo permit allow ${agentId} ${reqId}` : `paseo permit allow ${agentId}`;
}

export function buildAgentBlockDetail(
  agentId: string,
  permissions: PendingPermission[] | null | undefined,
): AgentBlockDetail | undefined {
  if (!Array.isArray(permissions) || permissions.length === 0) return undefined;
  const permission = permissions[0]!;
  const reqId = permission.id || permission.requestId;
  const detail: AgentBlockDetail = {
    command: getPermissionAdjudicationCommand(agentId, permission),
  };
  if (reqId) detail.requiredPermissionId = reqId;
  const scope = extractPermissionScope(permission);
  if (scope) detail.scope = scope;
  const action = getPendingPermissionAction(permission);
  if (action) detail.action = action;
  return detail;
}

export function agentRequiresAttention(agent: {
  pendingPermissions?: PendingPermission[] | null;
  requiresAttention?: boolean;
  attentionReason?: AgentAttentionReason | string | null;
} | null | undefined): boolean {
  if (!agent) return false;
  const permissions = Array.isArray(agent.pendingPermissions) ? agent.pendingPermissions : [];
  if (permissions.length > 0) return true;
  if (agent.requiresAttention !== true) return false;
  return agent.attentionReason !== "finished";
}

export function getAgentAttentionReason(agent: {
  attentionReason?: AgentAttentionReason | string | null;
}): string | undefined {
  const reason = agent.attentionReason;
  if (!reason) return undefined;
  switch (reason) {
    case "permission":
      return "permission request";
    case "input":
      return "operator input";
    case "error":
      return "error";
    case "finished":
      return "finished";
    default:
      return String(reason);
  }
}

// ---------------------------------------------------------------------------
// 4. Agent Work & Metrics
// ---------------------------------------------------------------------------

export const FleetAgentWorkSchema = z.object({
  repo: z.string().optional(),
  issue: z.number().optional(),
  slug: z.string().optional(),
  branch: z.string().optional(),
});
export type FleetAgentWork = z.infer<typeof FleetAgentWorkSchema>;
export type UppidiAgentWork = FleetAgentWork;

export const FleetAgentUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
});
export type FleetAgentUsage = z.infer<typeof FleetAgentUsageSchema>;
export type UppidiAgentUsage = FleetAgentUsage;

export const FleetAgentMetricsSchema = z.object({
  contextUsedTokens: z.number().optional(),
  contextMaxTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  costUsd: z.number().optional(),
  activeTurnStartedAt: z.string().optional(),
  attentionTimestamp: z.string().optional(),
});
export type FleetAgentMetrics = z.infer<typeof FleetAgentMetricsSchema>;
export type UppidiAgentMetrics = FleetAgentMetrics;

// ---------------------------------------------------------------------------
// 5. Canonical Fleet Agent & Tree
// ---------------------------------------------------------------------------

export const FleetAgentSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  name: z.string(),
  category: AgentCategorySchema,
  roleSource: z.enum(["registry", "name-heuristic"]).optional(),
  nameCategory: AgentCategorySchema.optional(),
  roleDivergent: z.boolean().optional(),
  registryRepoKey: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().nullable().optional(),
  status: z.string(),
  cwd: z.string().optional(),
  created: z.string().optional(),
  updatedAt: z.string().optional(),
  lastActivityAt: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  parentName: z.string().optional(),
  parentCategory: AgentCategorySchema.optional(),
  deterministicState: DeterministicAgentStateSchema.default("unknown"),
  stateDetail: z.string().optional(),
  lifecycleState: AgentLifecycleStateSchema.optional(),
  blockDetail: AgentBlockDetailSchema.nullable().optional(),
  attributedWork: FleetAgentWorkSchema.nullable().optional(),
  usage: FleetAgentUsageSchema.nullable().optional(),
  metrics: FleetAgentMetricsSchema.nullable().optional(),
  lastError: z.string().nullable().optional(),
  url: z.string().optional(),
  worktree: z.string().optional(),
  project: z.string().optional(),
  isEnrolled: z.boolean().optional(),
  isPaused: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  hasOrchestrator: z.boolean().optional(),
  queuedHooksCount: z.number().optional(),
  isDetached: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  isMainDirty: z.boolean().optional(),
  mainDirtySummary: z.string().optional(),
  repoHeadBranch: z.string().optional(),
  isRepoRootOffMain: z.boolean().optional(),
  pendingPermissions: z.array(PendingPermissionSchema).optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: AgentAttentionReasonSchema.nullable().optional(),
});
export type FleetAgent = z.infer<typeof FleetAgentSchema>;
export type UppidiAgent = FleetAgent;

export interface FleetAgentTreeNode {
  agent: FleetAgent;
  depth: number;
  children: FleetAgentTreeNode[];
  isEnrolled?: boolean;
  isPaused?: boolean;
  hasOrchestrator?: boolean;
  queuedHooksCount?: number;
  isDetached?: boolean;
}

export const FleetAgentTreeNodeSchema: z.ZodType<FleetAgentTreeNode, any, any> = z.lazy(() =>
  z.object({
    agent: FleetAgentSchema,
    depth: z.number(),
    children: z.array(z.lazy(() => FleetAgentTreeNodeSchema)).default([]),
    isEnrolled: z.boolean().optional(),
    isPaused: z.boolean().optional(),
    hasOrchestrator: z.boolean().optional(),
    queuedHooksCount: z.number().optional(),
    isDetached: z.boolean().optional(),
  })
);
export type UppidiAgentTreeNode = FleetAgentTreeNode;

export const AgentRoleDivergenceSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  nameCategory: AgentCategorySchema,
  registryRole: AgentCategorySchema,
  reason: z.string(),
});
export type AgentRoleDivergence = z.infer<typeof AgentRoleDivergenceSchema>;

export const FleetOutputSchema = z.object({
  ok: z.boolean(),
  registryAuthoritative: z.boolean().default(false),
  roleDivergences: z.array(AgentRoleDivergenceSchema).default([]),
  frontDesk: z.array(FleetAgentSchema).default([]),
  orchestrators: z.array(FleetAgentSchema).default([]),
  workers: z.array(FleetAgentSchema).default([]),
  tree: z.array(FleetAgentTreeNodeSchema).default([]),
  enrolledRepos: z.array(z.string()).default([]),
  pausedRepos: z.array(z.string()).default([]),
  kanbanOnlyRepos: z.array(z.string()).default([]),
  mutedRepos: z.array(z.string()).default([]),
  repoQueuedHooks: z.record(z.string(), z.number()).default({}),
  totalCount: z.number().default(0),
  runningCount: z.number().default(0),
  idleCount: z.number().default(0),
  errorCount: z.number().default(0),
  error: z.string().optional(),
});
export type FleetOutput = z.infer<typeof FleetOutputSchema>;
export type UppidiAgentsOutput = FleetOutput;

// ---------------------------------------------------------------------------
// 6. Hook Queues
// ---------------------------------------------------------------------------

export const HookQueueMessageSchema = z.object({
  id: z.string(),
  ts: z.number().nullable().optional(),
  preview: z.string(),
});
export type HookQueueMessage = z.infer<typeof HookQueueMessageSchema>;

export const HookQueueItemSchema = z.object({
  key: z.string(),
  depth: z.number(),
  dropped: z.number().default(0),
  paused: z.boolean(),
  isBusy: z.boolean(),
  busyAttempts: z.number().default(0),
  orchestrator: z
    .object({
      agentId: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
      by: z.string().optional(),
    })
    .nullable()
    .optional(),
  messages: z.array(HookQueueMessageSchema).default([]),
});
export type HookQueueItem = z.infer<typeof HookQueueItemSchema>;

export const HookStatusOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  frontDesk: z
    .object({
      version: z.number().optional(),
      agentId: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
      by: z.string().optional(),
    })
    .nullable()
    .optional(),
  paused: z.array(z.string()).default([]),
  totalQueued: z.number().default(0),
  queues: z.array(HookQueueItemSchema).default([]),
  error: z.string().optional(),
});
export type HookStatusOutput = z.infer<typeof HookStatusOutputSchema>;

// ---------------------------------------------------------------------------
// 7. Activity & Signal Classification
// ---------------------------------------------------------------------------

export const FrontDeskActivityTypeSchema = z.enum([
  "user",
  "assistant",
  "thought",
  "tool",
  "dispatch",
  "decision",
  "error",
  "heartbeat",
  "system",
]);
export type FrontDeskActivityType = z.infer<typeof FrontDeskActivityTypeSchema>;
export type UppidiFrontDeskActivityType = FrontDeskActivityType;

export const FrontDeskActivityItemSchema = z.object({
  id: z.string(),
  timestamp: z.string().default(() => new Date().toISOString()),
  type: FrontDeskActivityTypeSchema,
  role: z.string(),
  title: z.string().optional(),
  text: z.string(),
  detail: z.string().optional(),
  isSignal: z.boolean().default(true),
  toolName: z.string().optional(),
  status: z.string().optional(),
});
export type FrontDeskActivityItem = z.infer<typeof FrontDeskActivityItemSchema>;
export type UppidiFrontDeskActivityItem = FrontDeskActivityItem;

export const DISPATCH_COMMAND_PATTERNS = [
  /\bpaseo\s+(send|permit|create|spawn|kill|archive)\b/i,
  /\bteax\s+(pr|issue)\s+(merge|close|create|assign)\b/i,
  /\bx_comms_send\b/i,
  /\bgit\s+push\b/i,
];

export const NOISE_TOOL_NAMES = new Set([
  "read_file",
  "cat",
  "grep_search",
  "find_by_name",
  "list_dir",
  "ls",
  "ps",
  "inspect_schedule",
  "schedule_logs",
  "inspect_provider",
  "list_models",
  "list_profiles",
  "list_workspaces",
  "view_file",
]);

export function isSignalActivityItem(item: FrontDeskActivityItem): boolean {
  if (typeof item.isSignal === "boolean") {
    return item.isSignal;
  }
  if (item.type === "user" || item.type === "assistant" || item.type === "dispatch" || item.type === "decision" || item.type === "error") {
    return true;
  }
  if (item.type === "heartbeat" || item.type === "thought") {
    return false;
  }
  if (item.type === "tool") {
    const lowerName = (item.toolName || "").toLowerCase();
    if (
      lowerName.includes("dispatch") ||
      lowerName.includes("send") ||
      lowerName.includes("permit") ||
      lowerName.includes("spawn") ||
      lowerName.includes("create_agent") ||
      lowerName.includes("kill_agent") ||
      lowerName.includes("archive")
    ) {
      return true;
    }
    return false;
  }
  return true;
}

export function parseTranscriptToActivityItems(
  transcript: string,
  fallbackTimestamp?: string,
): FrontDeskActivityItem[] {
  if (!transcript || !transcript.trim()) return [];
  const lines = transcript.split(/\r?\n/);
  const items: FrontDeskActivityItem[] = [];
  const baseTs = fallbackTimestamp || new Date().toISOString();

  let currentItem: Partial<FrontDeskActivityItem> | null = null;
  let counter = 0;

  function commitCurrent() {
    if (!currentItem || !currentItem.text?.trim()) return;
    const type = currentItem.type || "system";
    let isSignal = currentItem.isSignal;
    if (isSignal === undefined) {
      if (type === "user" || type === "assistant" || type === "dispatch" || type === "decision" || type === "error") {
        isSignal = true;
      } else if (type === "heartbeat" || type === "thought") {
        isSignal = false;
      } else if (type === "tool") {
        const text = currentItem.text || "";
        const toolName = currentItem.toolName || "";
        if (DISPATCH_COMMAND_PATTERNS.some((p) => p.test(text))) {
          currentItem.type = "dispatch";
          currentItem.role = "dispatch";
          isSignal = true;
        } else if (NOISE_TOOL_NAMES.has(toolName.toLowerCase())) {
          isSignal = false;
        } else {
          isSignal = false;
        }
      } else {
        isSignal = true;
      }
    }

    items.push({
      id: currentItem.id || `act-${counter++}`,
      timestamp: currentItem.timestamp || baseTs,
      type: currentItem.type || "system",
      role: currentItem.role || (type === "user" ? "operator" : type === "assistant" ? "front-desk" : type),
      title: currentItem.title,
      text: currentItem.text.trim(),
      detail: currentItem.detail,
      isSignal,
      toolName: currentItem.toolName,
      status: currentItem.status,
    });
    currentItem = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headerMatch = line.match(/^\[([A-Za-z0-9_-]+)\](?:\s+(.*))?$/);
    if (headerMatch) {
      commitCurrent();
      const tag = headerMatch[1];
      const remainder = headerMatch[2] || "";
      const lowerTag = tag.toLowerCase();

      if (lowerTag === "user") {
        const isWatchdog = remainder.startsWith("[Fleet ");
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "user",
          role: isWatchdog ? "watchdog" : "operator",
          title: isWatchdog ? "Fleet Watchdog / Sweep" : "Operator",
          text: remainder,
          isSignal: true,
        };
      } else if (lowerTag === "assistant") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "assistant",
          role: "front-desk",
          title: "Front Desk",
          text: remainder,
          isSignal: true,
        };
      } else if (lowerTag === "thought" || lowerTag === "thinking" || lowerTag === "reasoning") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "thought",
          role: "front-desk",
          title: "Reasoning",
          text: remainder,
          isSignal: false,
        };
      } else if (lowerTag === "heartbeat") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "heartbeat",
          role: "heartbeat",
          title: "Heartbeat",
          text: remainder,
          isSignal: false,
        };
      } else if (lowerTag === "error") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "error",
          role: "error",
          title: "Error",
          text: remainder,
          isSignal: true,
        };
      } else {
        const isDispatch = DISPATCH_COMMAND_PATTERNS.some((p) => p.test(remainder));
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: isDispatch ? "dispatch" : "tool",
          role: isDispatch ? "dispatch" : "tool",
          title: isDispatch ? `Dispatch (${tag})` : tag,
          text: remainder,
          toolName: tag,
          isSignal: isDispatch,
        };
      }
    } else if (currentItem) {
      currentItem.text = (currentItem.text ? `${currentItem.text}\n` : "") + line;
    } else if (line.trim()) {
      currentItem = {
        id: `act-${counter++}`,
        timestamp: baseTs,
        type: "assistant",
        role: "front-desk",
        title: "Front Desk",
        text: line,
        isSignal: true,
      };
    }
  }

  commitCurrent();
  return items;
}

// ---------------------------------------------------------------------------
// 8. Repository Identity & Coordinates
// ---------------------------------------------------------------------------

export const DEFAULT_FORGEJO_HOST = "forge.mrs.uppidi.com";
export const DEFAULT_PROJECT = "Default Project";

export function normalizeRepoKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (/^prj_[a-z0-9]+$/i.test(s)) return null;
  s = s.replace(/^git@([^:]+):/, "$1/");
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^ssh:\/\/git@/, "");
  s = s.replace(/:\d+\//, "/");
  s = s.replace(/\.git$/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  if (/^prj_[a-z0-9]+$/i.test(s)) return null;
  return s || null;
}

export function candidateRepoKeys(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const pushUnique = (k: string | null | undefined) => {
    if (k && !candidates.includes(k)) candidates.push(k);
  };

  pushUnique(trimmed);

  const normalized = normalizeRepoKey(trimmed);
  if (normalized) {
    pushUnique(normalized);

    if (normalized.includes("/")) {
      const parts = normalized.split("/");
      if (parts[0].includes(".") || parts[0].includes(":")) {
        const withoutHost = parts.slice(1).join("/");
        pushUnique(withoutHost);
      } else {
        pushUnique(`${DEFAULT_FORGEJO_HOST}/${normalized}`);
      }
    }
  }

  return candidates;
}

export function canonicalRepoKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const normalized = normalizeRepoKey(raw);
  if (!normalized) return null;
  if (!normalized.includes("/")) return normalized;
  const parts = normalized.split("/");
  if (parts[0].includes(".") || parts[0].includes(":")) {
    return normalized;
  }
  return `${DEFAULT_FORGEJO_HOST}/${normalized}`;
}

export function normalizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === DEFAULT_PROJECT) return trimmed;
  if (trimmed.includes("://") || trimmed.includes(DEFAULT_FORGEJO_HOST)) return trimmed;
  if (trimmed.startsWith("git@")) return trimmed;
  if (!trimmed.includes("/")) return trimmed;
  return `${DEFAULT_FORGEJO_HOST}/${trimmed}`;
}

export interface RepoCoordinates {
  host: string;
  owner: string;
  repo: string;
}

export interface CanonicalRepo extends RepoCoordinates {
  key: string;
  compact: string;
}

function toCanonical(coords: RepoCoordinates): CanonicalRepo {
  const host = coords.host.toLowerCase();
  return {
    host,
    owner: coords.owner,
    repo: coords.repo,
    key: `${host}/${coords.owner}/${coords.repo}`,
    compact: `${coords.owner}/${coords.repo}`,
  };
}

export function repoCoordinates(input: string | null | undefined): RepoCoordinates | null {
  const normalized = normalizeRepoKey(input);
  if (!normalized) return null;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const first = segments[0];
  const hasHost = first.includes(".") || first.includes(":");
  const host = hasHost ? first : DEFAULT_FORGEJO_HOST;
  const rest = hasHost ? segments.slice(1) : segments;
  if (rest.length < 2) return null;
  return {
    host,
    owner: rest[rest.length - 2],
    repo: rest[rest.length - 1],
  };
}

export interface ResolveCanonicalRepoOptions {
  knownRepos?: readonly string[] | null;
  host?: string;
}

export function resolveCanonicalRepo(
  input: string | null | undefined,
  options?: ResolveCanonicalRepoOptions,
): CanonicalRepo | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.toLowerCase() === "all") return null;

  const host = (options?.host ?? DEFAULT_FORGEJO_HOST).toLowerCase();
  const normalized = normalizeRepoKey(raw);
  if (!normalized) return null;

  const segments = normalized.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  const hasHost = first.includes(".") || first.includes(":");
  const rest = hasHost ? segments.slice(1) : segments;

  if (rest.length >= 2) {
    return toCanonical({
      host: hasHost ? first : host,
      owner: rest[rest.length - 2],
      repo: rest[rest.length - 1],
    });
  }

  if (rest.length !== 1) return null;
  const bare = rest[0];
  if (bare.includes(".") || bare.includes(":")) return null;

  const known = options?.knownRepos;
  if (!known || known.length === 0) return null;

  const matches = new Map<string, CanonicalRepo>();
  for (const candidate of known) {
    const coords = repoCoordinates(candidate);
    if (!coords) continue;
    if (coords.repo.toLowerCase() !== bare.toLowerCase()) continue;
    const canonical = toCanonical(coords);
    matches.set(canonical.key.toLowerCase(), canonical);
  }
  if (matches.size !== 1) return null;
  return [...matches.values()][0] ?? null;
}

export function canonicalRepoName(
  input: string | null | undefined,
  options?: ResolveCanonicalRepoOptions,
): string | null {
  return resolveCanonicalRepo(input, options)?.key ?? null;
}

export function compactRepoName(
  input: string | null | undefined,
  options?: ResolveCanonicalRepoOptions,
): string | null {
  return resolveCanonicalRepo(input, options)?.compact ?? null;
}

import { z } from 'zod';

// src/client/types.ts
var CODING_AGENT_CATEGORY = "coding-agent";
var AgentCategorySchema = z.enum([
  "front-desk",
  "orchestrator",
  "coding-agent",
  "worker"
]);
function isCodingAgentCategory(category) {
  const normalized = String(category ?? "").trim().toLowerCase();
  return normalized === CODING_AGENT_CATEGORY || normalized === "worker";
}
var DeterministicAgentStateSchema = z.enum([
  "working",
  // Running with attributed work
  "running",
  // Running general task without specific issue attribution
  "sleeping",
  // Idle orchestrator/frontdesk inactive > 15 minutes
  "idle:waiting",
  // Idle agent waiting for turn/prompt
  "idle:quota-exhausted",
  // Idle due to model quota exhaustion cooldown
  "attention-required",
  // Blocked awaiting operator input/decision
  "permission-prompt",
  // Blocked on a pending tool/permission request
  "failed:quota-exhausted",
  // Failed/aborted due to usage/quota limit
  "failed:spawn",
  // Failed during process or session spawn
  "failed:timeout",
  // Execution or connection timeout
  "failed:error",
  // General agent crash or unhandled error
  "unknown"
  // Fallback when signals cannot resolve
]);
var AgentLifecycleStateSchema = z.enum([
  "running",
  "waiting_for_input",
  "idle",
  "errored",
  "completed"
]);
function deriveLifecycleState(state) {
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
function isBlockedLifecycleState(state) {
  return state === "waiting_for_input";
}
function resolveAgentLifecycleState(agent) {
  if (!agent) return "idle";
  if (agent.lifecycleState) return agent.lifecycleState;
  return deriveLifecycleState(agent.deterministicState ?? "unknown");
}
var AgentAttentionReasonSchema = z.enum(["finished", "error", "permission", "input"]);
var PendingPermissionSchema = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  tool: z.string().optional(),
  kind: z.string().optional(),
  description: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  scope: z.string().optional()
});
var SCOPE_INPUT_KEYS = [
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
  "file"
];
var SCOPE_DESCRIPTION_PREFIX = /^\s*scope\s*:\s*/i;
function coerceScopeValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || void 0;
  }
  if (Array.isArray(value)) {
    const parts = value.map(coerceScopeValue).filter((v) => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : void 0;
  }
  return void 0;
}
function extractPermissionScope(permission) {
  const explicit = permission.scope?.trim();
  if (explicit) return explicit;
  const input = permission.input;
  if (input && typeof input === "object") {
    for (const key of SCOPE_INPUT_KEYS) {
      const found = coerceScopeValue(input[key]);
      if (found) return found;
    }
  }
  const description = permission.description?.trim();
  if (!description) return void 0;
  const scoped = description.replace(SCOPE_DESCRIPTION_PREFIX, "").trim();
  return scoped || void 0;
}
var AgentBlockDetailSchema = z.object({
  requiredPermissionId: z.string().optional(),
  scope: z.string().optional(),
  action: z.string().optional(),
  command: z.string()
});
function getPendingPermissionAction(permission) {
  return permission.title?.trim() || permission.tool?.trim() || permission.name?.trim() || permission.kind?.trim() || "tool permission";
}
function getPermissionAdjudicationCommand(agentId, permission) {
  const reqId = permission?.id || permission?.requestId;
  return reqId ? `paseo permit allow ${agentId} ${reqId}` : `paseo permit allow ${agentId}`;
}
function buildAgentBlockDetail(agentId, permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) return void 0;
  const permission = permissions[0];
  const reqId = permission.id || permission.requestId;
  const detail = {
    command: getPermissionAdjudicationCommand(agentId, permission)
  };
  if (reqId) detail.requiredPermissionId = reqId;
  const scope = extractPermissionScope(permission);
  if (scope) detail.scope = scope;
  const action = getPendingPermissionAction(permission);
  if (action) detail.action = action;
  return detail;
}
function agentRequiresAttention(agent) {
  if (!agent) return false;
  const permissions = Array.isArray(agent.pendingPermissions) ? agent.pendingPermissions : [];
  if (permissions.length > 0) return true;
  if (agent.requiresAttention !== true) return false;
  return agent.attentionReason !== "finished";
}
function getAgentAttentionReason(agent) {
  const reason = agent.attentionReason;
  if (!reason) return void 0;
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
var FleetAgentWorkSchema = z.object({
  repo: z.string().optional(),
  issue: z.number().optional(),
  slug: z.string().optional(),
  branch: z.string().optional()
});
var FleetAgentUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  totalCostUsd: z.number().optional()
});
var FleetAgentMetricsSchema = z.object({
  contextUsedTokens: z.number().optional(),
  contextMaxTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  costUsd: z.number().optional(),
  activeTurnStartedAt: z.string().optional(),
  attentionTimestamp: z.string().optional()
});
var FleetAgentSchema = z.object({
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
  attentionReason: AgentAttentionReasonSchema.nullable().optional()
});
var FleetAgentTreeNodeSchema = z.lazy(
  () => z.object({
    agent: FleetAgentSchema,
    depth: z.number(),
    children: z.array(z.lazy(() => FleetAgentTreeNodeSchema)).default([]),
    isEnrolled: z.boolean().optional(),
    isPaused: z.boolean().optional(),
    hasOrchestrator: z.boolean().optional(),
    queuedHooksCount: z.number().optional(),
    isDetached: z.boolean().optional()
  })
);
var AgentRoleDivergenceSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  nameCategory: AgentCategorySchema,
  registryRole: AgentCategorySchema,
  reason: z.string()
});
var FleetOutputSchema = z.object({
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
  error: z.string().optional()
});
var HookQueueMessageSchema = z.object({
  id: z.string(),
  ts: z.number().nullable().optional(),
  preview: z.string()
});
var HookQueueItemSchema = z.object({
  key: z.string(),
  depth: z.number(),
  dropped: z.number().default(0),
  paused: z.boolean(),
  isBusy: z.boolean(),
  busyAttempts: z.number().default(0),
  orchestrator: z.object({
    agentId: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
    by: z.string().optional()
  }).nullable().optional(),
  messages: z.array(HookQueueMessageSchema).default([])
});
var HookStatusOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  frontDesk: z.object({
    version: z.number().optional(),
    agentId: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
    by: z.string().optional()
  }).nullable().optional(),
  paused: z.array(z.string()).default([]),
  totalQueued: z.number().default(0),
  queues: z.array(HookQueueItemSchema).default([]),
  error: z.string().optional()
});
var FrontDeskActivityTypeSchema = z.enum([
  "user",
  "assistant",
  "thought",
  "tool",
  "dispatch",
  "decision",
  "error",
  "heartbeat",
  "system"
]);
var FrontDeskActivityItemSchema = z.object({
  id: z.string(),
  timestamp: z.string().default(() => (/* @__PURE__ */ new Date()).toISOString()),
  type: FrontDeskActivityTypeSchema,
  role: z.string(),
  title: z.string().optional(),
  text: z.string(),
  detail: z.string().optional(),
  isSignal: z.boolean().default(true),
  toolName: z.string().optional(),
  status: z.string().optional()
});
var DISPATCH_COMMAND_PATTERNS = [
  /\bpaseo\s+(send|permit|create|spawn|kill|archive)\b/i,
  /\bteax\s+(pr|issue)\s+(merge|close|create|assign)\b/i,
  /\bx_comms_send\b/i,
  /\bgit\s+push\b/i
];
var NOISE_TOOL_NAMES = /* @__PURE__ */ new Set([
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
  "view_file"
]);
function isSignalActivityItem(item) {
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
    if (lowerName.includes("dispatch") || lowerName.includes("send") || lowerName.includes("permit") || lowerName.includes("spawn") || lowerName.includes("create_agent") || lowerName.includes("kill_agent") || lowerName.includes("archive")) {
      return true;
    }
    return false;
  }
  return true;
}
function parseTranscriptToActivityItems(transcript, fallbackTimestamp) {
  if (!transcript || !transcript.trim()) return [];
  const lines = transcript.split(/\r?\n/);
  const items = [];
  const baseTs = fallbackTimestamp || (/* @__PURE__ */ new Date()).toISOString();
  let currentItem = null;
  let counter = 0;
  function commitCurrent() {
    if (!currentItem || !currentItem.text?.trim()) return;
    const type = currentItem.type || "system";
    let isSignal = currentItem.isSignal;
    if (isSignal === void 0) {
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
      status: currentItem.status
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
          isSignal: true
        };
      } else if (lowerTag === "assistant") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "assistant",
          role: "front-desk",
          title: "Front Desk",
          text: remainder,
          isSignal: true
        };
      } else if (lowerTag === "thought" || lowerTag === "thinking" || lowerTag === "reasoning") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "thought",
          role: "front-desk",
          title: "Reasoning",
          text: remainder,
          isSignal: false
        };
      } else if (lowerTag === "heartbeat") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "heartbeat",
          role: "heartbeat",
          title: "Heartbeat",
          text: remainder,
          isSignal: false
        };
      } else if (lowerTag === "error") {
        currentItem = {
          id: `act-${counter++}`,
          timestamp: baseTs,
          type: "error",
          role: "error",
          title: "Error",
          text: remainder,
          isSignal: true
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
          isSignal: isDispatch
        };
      }
    } else if (currentItem) {
      currentItem.text = (currentItem.text ? `${currentItem.text}
` : "") + line;
    } else if (line.trim()) {
      currentItem = {
        id: `act-${counter++}`,
        timestamp: baseTs,
        type: "assistant",
        role: "front-desk",
        title: "Front Desk",
        text: line,
        isSignal: true
      };
    }
  }
  commitCurrent();
  return items;
}
var DEFAULT_FORGEJO_HOST = "forge.mrs.uppidi.com";
var DEFAULT_PROJECT = "Default Project";
function normalizeRepoKey(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.startsWith("remote:")) s = s.slice("remote:".length);
  s = s.replace(/^git@([^:]+):/, "$1/");
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^ssh:\/\/git@/, "");
  s = s.replace(/:\d+\//, "/");
  s = s.replace(/\.git$/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  return s || null;
}
function candidateRepoKeys(raw) {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const candidates = [];
  const pushUnique = (k) => {
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
function canonicalRepoKey(raw) {
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
function normalizeProjectName(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === DEFAULT_PROJECT) return trimmed;
  if (trimmed.includes("://") || trimmed.includes(DEFAULT_FORGEJO_HOST)) return trimmed;
  if (trimmed.startsWith("git@")) return trimmed;
  if (!trimmed.includes("/")) return trimmed;
  return `${DEFAULT_FORGEJO_HOST}/${trimmed}`;
}
function toCanonical(coords) {
  const host = coords.host.toLowerCase();
  return {
    host,
    owner: coords.owner,
    repo: coords.repo,
    key: `${host}/${coords.owner}/${coords.repo}`,
    compact: `${coords.owner}/${coords.repo}`
  };
}
function repoCoordinates(input) {
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
    repo: rest[rest.length - 1]
  };
}
function resolveCanonicalRepo(input, options) {
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
      repo: rest[rest.length - 1]
    });
  }
  if (rest.length !== 1) return null;
  const bare = rest[0];
  if (bare.includes(".") || bare.includes(":")) return null;
  const known = options?.knownRepos;
  if (!known || known.length === 0) return null;
  const matches = /* @__PURE__ */ new Map();
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
function canonicalRepoName(input, options) {
  return resolveCanonicalRepo(input, options)?.key ?? null;
}
function compactRepoName(input, options) {
  return resolveCanonicalRepo(input, options)?.compact ?? null;
}
function formatProjectDisplay(project) {
  if (!project) {
    return { primaryName: "", rootShaPill: "" };
  }
  const p = typeof project === "string" ? { name: project } : project;
  let rootShaPill = "";
  const key = (p.projectKey ?? (typeof project === "string" ? project : "")).trim();
  if (key.startsWith("git-root:")) {
    const sha = key.slice("git-root:".length).trim();
    rootShaPill = sha ? `#${sha.slice(0, 7)}` : "";
  } else if (key.startsWith("non-git:")) {
    const hash = key.slice("non-git:".length).trim();
    rootShaPill = hash ? `non-git:${hash.slice(0, 7)}` : "";
  }
  let rawName = (p.displayName || p.repo || (p.name && !p.name.startsWith("git-root:") && !p.name.startsWith("non-git:") ? p.name : void 0) || (p.rootPath ? p.rootPath.split("/").filter(Boolean).pop() : void 0) || (p.cwd && !p.cwd.includes("/.paseo/worktrees/") ? p.cwd.split("/").filter(Boolean).pop() : void 0) || p.name || "").trim();
  if (rawName.startsWith("git-root:")) {
    const sha = rawName.slice("git-root:".length).trim();
    if (!rootShaPill) rootShaPill = sha ? `#${sha.slice(0, 7)}` : "";
    rawName = sha.slice(0, 7);
  } else if (rawName.startsWith("non-git:")) {
    const hash = rawName.slice("non-git:".length).trim();
    if (!rootShaPill) rootShaPill = hash ? `non-git:${hash.slice(0, 7)}` : "";
    rawName = hash.slice(0, 7);
  }
  let primaryName = "";
  let orgPill = void 0;
  const coords = repoCoordinates(rawName);
  if (coords) {
    primaryName = coords.repo;
    orgPill = coords.owner;
  } else if (rawName.includes("/")) {
    const parts = rawName.split("/").filter(Boolean);
    primaryName = parts[parts.length - 1];
    orgPill = parts.slice(0, -1).join("/");
  } else if (rawName) {
    primaryName = rawName;
  } else if (rootShaPill) {
    primaryName = rootShaPill.replace(/^#/, "");
  }
  let worktreePill = void 0;
  if (p.worktree) {
    worktreePill = p.worktree;
  } else if (p.branch) {
    worktreePill = p.branch;
  } else if (p.cwd && p.cwd.includes("/.paseo/worktrees/")) {
    const match = p.cwd.match(/\/\.paseo\/worktrees\/[^/]+\/([^/]+)/);
    if (match?.[1]) {
      worktreePill = match[1];
    }
  }
  return {
    primaryName: primaryName || (rootShaPill ? rootShaPill.replace(/^#/, "") : "unknown"),
    ...orgPill ? { orgPill } : {},
    rootShaPill,
    ...worktreePill ? { worktreePill } : {}
  };
}
function formatProjectOptionLabel(project) {
  const display = formatProjectDisplay(project);
  let label = display.primaryName;
  if (display.orgPill) {
    label += ` (${display.orgPill})`;
  }
  if (display.rootShaPill) {
    label += ` [${display.rootShaPill}]`;
  }
  return label;
}

// src/client/status.ts
function getStatusLightTone(agent) {
  if (!agent) return "warning";
  const detState = String(agent.deterministicState ?? "").toLowerCase().trim();
  const status = String(agent.status ?? "").toLowerCase().trim();
  if (detState.startsWith("failed") || status === "error" || status === "failed" || status === "failure" || status === "timeout" || status.includes("error") || status.includes("fail")) {
    return "danger";
  }
  if (detState.startsWith("idle") || detState === "sleeping" || detState === "permission-prompt" || detState === "attention-required" || status === "idle" || status === "waiting" || status === "paused" || status === "ready" || status === "standby") {
    return "warning";
  }
  if (detState === "working" || detState === "running" || status === "running" || status === "busy" || status === "working" || status === "executing") {
    return "success";
  }
  return "warning";
}
function getAgentCategoryIcon(category) {
  switch (category) {
    case "front-desk":
      return "Inbox";
    case "orchestrator":
      return "Network";
    case "coding-agent":
    case "worker":
      return "Terminal";
    default:
      return "Bot";
  }
}
function getDeterministicStateConfig(state, category) {
  let color = "#6b7280";
  let badgeVariant = "neutral";
  let dotVariant = "neutral";
  let stateIcon = "HelpCircle";
  let pulse = false;
  let label = "Unknown";
  switch (state) {
    case "working":
      color = "#10b981";
      badgeVariant = "success";
      dotVariant = "success";
      stateIcon = "Bot";
      pulse = true;
      label = "Working";
      break;
    case "running":
      color = "#3b82f6";
      badgeVariant = "info";
      dotVariant = "info";
      stateIcon = "Play";
      pulse = false;
      label = "Running";
      break;
    case "sleeping":
      color = "#a855f7";
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "Moon";
      pulse = false;
      label = "Sleeping";
      break;
    case "idle:waiting":
      color = "#9ca3af";
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "Clock";
      pulse = false;
      label = "Waiting";
      break;
    case "idle:quota-exhausted":
      color = "#f59e0b";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "Hourglass";
      pulse = false;
      label = "Quota Cooldown";
      break;
    case "permission-prompt":
      color = "#f59e0b";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "ShieldAlert";
      pulse = true;
      label = "Permission Needed";
      break;
    case "attention-required":
      color = "#f59e0b";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "BellRing";
      pulse = true;
      label = "Awaiting Input";
      break;
    case "failed:quota-exhausted":
      color = "#f97316";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "AlertTriangle";
      pulse = false;
      label = "Quota Exhausted";
      break;
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      color = "#ef4444";
      badgeVariant = "danger";
      dotVariant = "danger";
      stateIcon = "AlertOctagon";
      pulse = false;
      label = "Failed";
      break;
    case "unknown":
    default:
      color = "#6b7280";
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "HelpCircle";
      pulse = false;
      label = "Unknown";
      break;
  }
  return {
    state,
    color,
    badgeVariant,
    dotVariant,
    stateIcon,
    categoryIcon: getAgentCategoryIcon(category),
    pulse,
    label
  };
}
function computeHealthGauge(metrics, lastError, nowEpochMs = Date.now()) {
  const segments = [];
  if (metrics?.contextUsedTokens !== void 0 && metrics?.contextMaxTokens !== void 0 && metrics.contextMaxTokens > 0) {
    const ratio = Math.min(1, Math.max(0, metrics.contextUsedTokens / metrics.contextMaxTokens));
    let tone = "ok";
    if (ratio >= 0.9) tone = "critical";
    else if (ratio >= 0.75) tone = "warn";
    segments.push({ kind: "context", ratio, tone });
  }
  if (metrics?.activeTurnStartedAt) {
    const startMs = Date.parse(metrics.activeTurnStartedAt);
    if (!Number.isNaN(startMs)) {
      const elapsedSeconds = Math.max(0, (nowEpochMs - startMs) / 1e3);
      const ratio = Math.min(1, elapsedSeconds / 600);
      let tone = "ok";
      if (elapsedSeconds > 900) tone = "critical";
      else if (elapsedSeconds > 300) tone = "warn";
      segments.push({ kind: "turn", ratio, tone });
    }
  }
  if (lastError && lastError.trim()) {
    segments.push({ kind: "error", ratio: 1, tone: "critical" });
  }
  if (segments.length === 0) return null;
  let overall = "ok";
  if (segments.some((s) => s.tone === "critical")) overall = "critical";
  else if (segments.some((s) => s.tone === "warn")) overall = "warn";
  return { segments, overall };
}

// src/client/filter.ts
var _fs = (typeof process !== "undefined" ? process.getBuiltinModule?.("node:fs") : null) ?? null;
var _path = (typeof process !== "undefined" ? process.getBuiltinModule?.("node:path") : null) ?? null;
var _cp = (typeof process !== "undefined" ? process.getBuiltinModule?.("node:child_process") : null) ?? null;
var existsSync = (p) => Boolean(_fs?.existsSync?.(p));
var readdirSync = (p) => _fs?.readdirSync?.(p) ?? [];
var basename = (p) => _path?.basename?.(p) ?? String(p).split("/").pop() ?? "";
var join = (...parts) => _path?.join?.(...parts) ?? parts.join("/");
var execFileSync = (cmd, args, opts) => _cp?.execFileSync?.(cmd, args, opts);
function normalizeContext(context) {
  if (!context) return {};
  if (Array.isArray(context)) {
    if (context.length === 0) return {};
    if (typeof context[0] === "string") return { knownRepos: context };
    return { workspacesData: context };
  }
  return context;
}
function wsData(ctx) {
  return ctx.workspacesData ?? ctx.workspaces;
}
function projData(ctx) {
  return ctx.projectsData ?? ctx.projects;
}
function gitRootSha(dir) {
  if (!dir || typeof dir !== "string") return null;
  const trimmed = dir.trim();
  if (!trimmed || !existsSync(trimmed)) return null;
  try {
    const out = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: trimmed,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const lines = String(out).trim().split("\n").map((x) => x.trim()).filter(Boolean);
    return lines.length > 0 ? lines.sort()[0] : null;
  } catch {
    return null;
  }
}
function gitRemoteSlug(dir) {
  if (!dir || typeof dir !== "string") return null;
  const trimmed = dir.trim();
  if (!trimmed || !existsSync(trimmed)) return null;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: trimmed,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!url) return null;
    return (canonicalRepoKey(url) ?? normalizeRepoKey(url))?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
function slugMatches(a, b) {
  if (!a || !b) return false;
  const ca = (canonicalRepoKey(a) ?? normalizeRepoKey(a) ?? a).toLowerCase();
  const cb = (canonicalRepoKey(b) ?? normalizeRepoKey(b) ?? b).toLowerCase();
  if (ca && cb) {
    if (ca === cb) return true;
    if (ca.endsWith(`/${cb}`) || cb.endsWith(`/${ca}`)) return true;
    const caBase = ca.split("/").filter(Boolean).pop();
    const cbBase = cb.split("/").filter(Boolean).pop();
    if (caBase && caBase === cbBase) return true;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
function resolveSlugToSha(slug) {
  const candidates = /* @__PURE__ */ new Set();
  const trimmed = slug.trim();
  if (existsSync(trimmed)) candidates.add(trimmed);
  try {
    const home = process.env.HOME || process.env.REAL_HOME;
    const base2 = trimmed.split("/").filter(Boolean).pop();
    if (home && base2) candidates.add(join(home, "code", base2));
  } catch {
  }
  const base = trimmed.split("/").filter(Boolean).pop();
  if (base) {
    const home = process.env.HOME || process.env.REAL_HOME;
    if (home) candidates.add(join(home, "code", base));
  }
  for (const dir of candidates) {
    const sha = gitRootSha(dir);
    if (!sha) continue;
    const remote = gitRemoteSlug(dir);
    if (remote) {
      if (slugMatches(remote, trimmed)) return sha;
    } else {
      const dirBase = basename(dir).toLowerCase();
      if (base && dirBase === base.toLowerCase()) return sha;
    }
  }
  const cwdRemote = gitRemoteSlug(process.cwd());
  if (cwdRemote && slugMatches(cwdRemote, trimmed)) {
    const sha = gitRootSha(process.cwd());
    if (sha) return sha;
  }
  return null;
}
function resolveShaToSlug(sha) {
  const target = sha.trim().toLowerCase();
  const cwdSha = gitRootSha(process.cwd());
  if (cwdSha && cwdSha.toLowerCase() === target) {
    const remote = gitRemoteSlug(process.cwd());
    if (remote) return remote;
  }
  const home = process.env.HOME || process.env.REAL_HOME;
  if (home) {
    const codeDir = join(home, "code");
    if (existsSync(codeDir)) {
      try {
        for (const entry of readdirSync(codeDir)) {
          const dir = join(codeDir, entry);
          const s = gitRootSha(dir);
          if (s && s.toLowerCase() === target) {
            const remote = gitRemoteSlug(dir);
            if (remote) return remote;
          }
        }
      } catch {
      }
    }
  }
  return null;
}
function backendWorkspaceBridge(a, b, workspaces, projects) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) return false;
  const projectsById = /* @__PURE__ */ new Map();
  for (const p of projects ?? []) {
    if (p?.projectId) projectsById.set(p.projectId, p);
  }
  const keysFor = (ws) => {
    const keys = /* @__PURE__ */ new Set();
    const add = (v) => {
      if (!v || typeof v !== "string") return;
      const t = v.trim();
      if (!t) return;
      keys.add(t.toLowerCase());
      const n = normalizeRepoKey(t);
      if (n) keys.add(n.toLowerCase());
      const c = canonicalRepoKey(t);
      if (c) keys.add(c.toLowerCase());
    };
    add(ws.projectId);
    add(ws.projectKey);
    add(ws.repo);
    const proj = ws.projectId ? projectsById.get(ws.projectId) : void 0;
    add(proj?.projectId);
    add(proj?.projectKey);
    add(ws.mainRepoRoot);
    add(proj?.rootPath);
    add(ws.cwd);
    add(proj?.displayName);
    const dirs = [ws.mainRepoRoot, ws.worktreeRoot, proj?.rootPath, ws.cwd];
    for (const dir of dirs) {
      if (dir && typeof dir === "string" && existsSync(dir)) {
        const out = (() => {
          try {
            const r = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const lines = String(r).trim().split("\n").map((x) => x.trim()).filter(Boolean);
            return lines.length > 0 ? `git-root:${lines.sort()[0]}` : null;
          } catch {
            return null;
          }
        })();
        if (out) keys.add(out.toLowerCase());
      }
    }
    return keys;
  };
  const al = a.trim().toLowerCase();
  const bl = b.trim().toLowerCase();
  for (const ws of workspaces) {
    if (!ws?.workspaceId) continue;
    const keys = keysFor(ws);
    if (keys.has(al) && keys.has(bl)) return true;
  }
  return false;
}
function isRepoMatching(targetRepo, candidateRepo, context) {
  if (!targetRepo || !candidateRepo) return false;
  const aRaw = String(targetRepo).trim();
  const bRaw = String(candidateRepo).trim();
  if (!aRaw || !bRaw) return false;
  if (aRaw.toLowerCase() === bRaw.toLowerCase()) return true;
  const ctx = normalizeContext(context);
  const ws = wsData(ctx);
  if (ws && ws.length > 0) {
    if (backendWorkspaceBridge(aRaw, bRaw, ws, projData(ctx) ?? [])) return true;
  }
  const t = aRaw.toLowerCase().replace(/\.git$/, "");
  const c = bRaw.toLowerCase().replace(/\.git$/, "");
  if (t === c) return true;
  const tSent = t.startsWith("git-root:") || t.startsWith("non-git:");
  const cSent = c.startsWith("git-root:") || c.startsWith("non-git:");
  if (tSent || cSent) {
    if (tSent && cSent) return t === c;
    if (t.startsWith("non-git:") || c.startsWith("non-git:")) return false;
    const sentinel = tSent ? t : c;
    const slug = tSent ? bRaw : aRaw;
    const sha = sentinel.startsWith("git-root:") ? sentinel.slice("git-root:".length).trim() : "";
    if (sha) {
      const slugSha = resolveSlugToSha(slug);
      if (slugSha && slugSha.toLowerCase() === sha) return true;
      const shaSlug = resolveShaToSlug(sha);
      if (shaSlug && slugMatches(shaSlug, slug)) return true;
    }
    return false;
  }
  const tParts = t.split("/").filter(Boolean);
  const cParts = c.split("/").filter(Boolean);
  if (tParts.length >= 2 && cParts.length >= 2) {
    const tTail = `${tParts[tParts.length - 2]}/${tParts[tParts.length - 1]}`;
    const cTail = `${cParts[cParts.length - 2]}/${cParts[cParts.length - 1]}`;
    if (tTail === cTail) return true;
  }
  const tBase = tParts[tParts.length - 1];
  const cBase = cParts[cParts.length - 1];
  return Boolean(tBase && cBase && tBase === cBase);
}
var repoMatches = isRepoMatching;
function isAgentEligibleForBulkArchive(agent) {
  if (!agent) return false;
  const category = (agent.category || "").toLowerCase();
  if (category === "front-desk" || category === "orchestrator") {
    return false;
  }
  const status = (agent.status || "").toLowerCase();
  const det = (agent.deterministicState || "").toLowerCase();
  if (status === "running" || det === "working" || det === "running") {
    return false;
  }
  return true;
}
function filterAgents(agents, preset, query) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(agents) ? agents : []).filter((a) => {
    if (!a) return false;
    let matchesPreset = true;
    switch (preset) {
      case "blocked":
        matchesPreset = a.status === "error" || a.deterministicState === "permission-prompt" || a.deterministicState === "attention-required" || a.deterministicState === "failed:error" || a.deterministicState === "failed:quota-exhausted" || a.deterministicState === "failed:spawn" || a.deterministicState === "failed:timeout";
        break;
      case "active":
        matchesPreset = a.deterministicState === "working" || a.deterministicState === "running" || a.status === "running" && a.deterministicState !== "sleeping" && a.deterministicState !== "idle:waiting";
        break;
      case "idle":
        matchesPreset = a.status === "idle" || a.deterministicState === "idle:waiting" || a.deterministicState === "sleeping" || a.deterministicState === "idle:quota-exhausted";
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }
    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;
    const searchTarget = [
      a.id,
      a.shortId,
      a.name,
      a.category,
      a.provider ?? "",
      a.model ?? "",
      a.cwd ?? "",
      a.worktree ?? "",
      a.project ?? ""
    ].join(" ").toLowerCase();
    return searchTarget.includes(normalizedQuery);
  });
}
function sortAgents(agents, field, direction) {
  const sorted = [...Array.isArray(agents) ? agents : []];
  const mul = direction === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "name":
        return String(a.name ?? "").localeCompare(String(b.name ?? "")) * mul;
      case "status": {
        const statusA = `${a.status ?? ""}:${a.deterministicState ?? ""}`;
        const statusB = `${b.status ?? ""}:${b.deterministicState ?? ""}`;
        return statusA.localeCompare(statusB) * mul;
      }
      case "category":
        return String(a.category ?? "").localeCompare(String(b.category ?? "")) * mul;
      case "provider": {
        const provA = `${a.provider ?? ""}/${a.model ?? ""}`;
        const provB = `${b.provider ?? ""}/${b.model ?? ""}`;
        return provA.localeCompare(provB) * mul;
      }
      default:
        return 0;
    }
  });
  return sorted;
}
function filterQueues(queues, preset, query) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(queues) ? queues : []).filter((q) => {
    if (!q) return false;
    let matchesPreset = true;
    switch (preset) {
      case "pending-processing":
        matchesPreset = (q.depth ?? 0) > 0 || q.isBusy;
        break;
      case "dead-failed":
        matchesPreset = q.paused;
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }
    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;
    const searchTarget = [
      q.key,
      q.orchestrator?.agentId ?? ""
    ].join(" ").toLowerCase();
    return searchTarget.includes(normalizedQuery);
  });
}
function sortQueues(queues, field, direction) {
  const sorted = [...Array.isArray(queues) ? queues : []];
  const mul = direction === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "repo":
        return String(a.key ?? "").localeCompare(String(b.key ?? "")) * mul;
      case "depth":
        return ((a.depth ?? 0) - (b.depth ?? 0)) * mul;
      case "status": {
        const statusA = a.paused ? "paused" : a.isBusy ? "busy" : "ready";
        const statusB = b.paused ? "paused" : b.isBusy ? "busy" : "ready";
        return statusA.localeCompare(statusB) * mul;
      }
      default:
        return 0;
    }
  });
  return sorted;
}

export { AgentAttentionReasonSchema, AgentBlockDetailSchema, AgentCategorySchema, AgentLifecycleStateSchema, AgentRoleDivergenceSchema, CODING_AGENT_CATEGORY, DEFAULT_FORGEJO_HOST, DEFAULT_PROJECT, DISPATCH_COMMAND_PATTERNS, DeterministicAgentStateSchema, FleetAgentMetricsSchema, FleetAgentSchema, FleetAgentTreeNodeSchema, FleetAgentUsageSchema, FleetAgentWorkSchema, FleetOutputSchema, FrontDeskActivityItemSchema, FrontDeskActivityTypeSchema, HookQueueItemSchema, HookQueueMessageSchema, HookStatusOutputSchema, NOISE_TOOL_NAMES, PendingPermissionSchema, agentRequiresAttention, buildAgentBlockDetail, candidateRepoKeys, canonicalRepoKey, canonicalRepoName, compactRepoName, computeHealthGauge, deriveLifecycleState, extractPermissionScope, filterAgents, filterQueues, formatProjectDisplay, formatProjectOptionLabel, getAgentAttentionReason, getAgentCategoryIcon, getDeterministicStateConfig, getPendingPermissionAction, getPermissionAdjudicationCommand, getStatusLightTone, isAgentEligibleForBulkArchive, isBlockedLifecycleState, isCodingAgentCategory, isRepoMatching, isSignalActivityItem, normalizeProjectName, normalizeRepoKey, parseTranscriptToActivityItems, repoCoordinates, repoMatches, resolveAgentLifecycleState, resolveCanonicalRepo, sortAgents, sortQueues };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map
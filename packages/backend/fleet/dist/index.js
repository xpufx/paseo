import { z } from 'zod';
import { execFile, execFileSync as execFileSync$1 } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { existsSync as existsSync$1, readFileSync } from 'fs';
import { resolve, basename as basename$1, join as join$1 } from 'path';
import { homedir } from 'os';

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

// src/shared/classify.ts
function categorizeAgent(name) {
  const lower = (name || "").toLowerCase();
  if (lower.includes("front desk") || lower === "frontdesk") {
    return "front-desk";
  }
  if (lower.includes("orchestrator")) {
    return "orchestrator";
  }
  return CODING_AGENT_CATEGORY;
}
var categorize = categorizeAgent;
function extractAttributedWork(raw) {
  const textSources = [
    raw.name || "",
    raw.title || "",
    raw.cwd || "",
    raw.labels?.["work"] || "",
    raw.labels?.["task"] || "",
    raw.labels?.["issue"] || "",
    raw.labels?.["branch"] || "",
    raw.labels?.["worktree"] || ""
  ];
  let issueNum;
  let slug;
  let branch;
  for (const text of textSources) {
    if (!text) continue;
    if (!issueNum) {
      const issueMatch = text.match(/(?:issue|task|pr)[/ -]?#?(\d+)/i) || text.match(/#(\d+)/);
      if (issueMatch && issueMatch[1]) {
        issueNum = parseInt(issueMatch[1], 10);
      }
    }
    if (!slug) {
      const slugMatch = text.match(/refactor-(\d+-[a-z0-9-]+)/i) || text.match(/issue-(\d+-[a-z0-9-]+)/i);
      if (slugMatch && slugMatch[1]) {
        slug = slugMatch[1];
      }
    }
    if (!branch) {
      const branchMatch = text.match(/(?:feat|fix|refactor|chore)\/[a-z0-9._-]+/i);
      if (branchMatch) {
        branch = branchMatch[0];
      }
    }
  }
  if (issueNum !== void 0 || slug !== void 0 || branch !== void 0) {
    return {
      issue: issueNum,
      slug,
      branch
    };
  }
  return null;
}
var attributedWork = extractAttributedWork;
function extractAgentWorktree(agent) {
  if (agent.worktree && agent.worktree.trim()) return agent.worktree.trim();
  if (agent.labels?.["worktree"] && agent.labels["worktree"].trim()) return agent.labels["worktree"].trim();
  if (agent.labels?.["branch"] && agent.labels["branch"].trim()) return agent.labels["branch"].trim();
  if (agent.cwd) {
    const cwd = agent.cwd.trim();
    const wtMatch = cwd.match(/worktrees\/[^/]+\/([^/]+)/);
    if (wtMatch && wtMatch[1]) {
      return wtMatch[1];
    }
    const codeMatch = cwd.match(/\/code\/([^/]+)/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1];
    }
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  if (agent.attributedWork?.slug) return agent.attributedWork.slug;
  if (agent.attributedWork?.branch) return agent.attributedWork.branch;
  if (agent.workspaceId) {
    return agent.workspaceId.length > 12 ? agent.workspaceId.slice(0, 12) : agent.workspaceId;
  }
  return void 0;
}
function extractAgentProject(agent, parentProject, workspaceProjectMap) {
  if (agent.project && agent.project.trim() && agent.project.trim() !== DEFAULT_PROJECT) {
    return normalizeProjectName(agent.project);
  }
  if (agent.labels?.["repo"] && agent.labels["repo"].trim()) return normalizeProjectName(agent.labels["repo"]);
  if (agent.labels?.["project"] && agent.labels["project"].trim()) return normalizeProjectName(agent.labels["project"]);
  if (agent.attributedWork?.repo && String(agent.attributedWork.repo).trim()) {
    return normalizeProjectName(String(agent.attributedWork.repo));
  }
  if (agent.workspaceId && workspaceProjectMap) {
    const mapped = workspaceProjectMap[agent.workspaceId];
    if (mapped && mapped.trim()) return normalizeProjectName(mapped);
  }
  if (parentProject && parentProject.trim() && parentProject.trim() !== DEFAULT_PROJECT) {
    return normalizeProjectName(parentProject);
  }
  return DEFAULT_PROJECT;
}
function deriveDeterministicState(raw, attributedWork2, quotaAlertAgentIds = /* @__PURE__ */ new Set()) {
  const status = (raw.status || "idle").toLowerCase();
  const error = (raw.lastError || "").toLowerCase();
  const quotaAlert = raw.id ? quotaAlertAgentIds.has(raw.id) : false;
  const permissions = raw.pendingPermissions || [];
  const reason = raw.attentionReason;
  if (permissions.length > 0 || reason === "permission") {
    const first = permissions[0];
    const action = first ? first.title?.trim() || first.tool?.trim() || first.name?.trim() || first.kind?.trim() || "tool permission" : "tool permission";
    const scope = first ? extractPermissionScope(first) : void 0;
    return {
      state: "permission-prompt",
      detail: scope ? `${action} (${scope})` : action
    };
  }
  const explicitError = status === "error" || Boolean(raw.requiresAttention && reason === "error") || status !== "running" && status !== "idle" && error.length > 0;
  if (explicitError) {
    if (quotaAlert || /quota|rate limit|429|credit|exhausted|usage limit/.test(error)) {
      return {
        state: "failed:quota-exhausted",
        detail: raw.lastError || "Usage limit reached"
      };
    }
    if (/spawn|enoent|failed to start|connection refused/.test(error)) {
      return {
        state: "failed:spawn",
        detail: raw.lastError || "Spawn error"
      };
    }
    if (/timeout|timed out|etimedout/.test(error)) {
      return {
        state: "failed:timeout",
        detail: raw.lastError || "Execution timeout"
      };
    }
    return {
      state: "failed:error",
      detail: raw.lastError || "Agent error"
    };
  }
  if (raw.requiresAttention === true && reason && reason !== "finished" && reason !== "error") {
    return {
      state: "attention-required",
      detail: reason
    };
  }
  if (status === "running") {
    if (attributedWork2 && attributedWork2.issue !== void 0) {
      const issueStr = `#${attributedWork2.issue}`;
      const slugStr = attributedWork2.slug ? ` (${attributedWork2.slug})` : "";
      return {
        state: "working",
        detail: `${issueStr}${slugStr}`
      };
    }
    return {
      state: "running",
      detail: "Active turn"
    };
  }
  if (status === "idle") {
    if (quotaAlert) {
      return {
        state: "idle:quota-exhausted",
        detail: "Quota cooldown"
      };
    }
    const category = categorizeAgent(raw.name || raw.title || "");
    const lastActivity = raw.lastActivityAt || raw.updatedAt;
    if ((category === "orchestrator" || category === "front-desk") && lastActivity) {
      const idleMs = Date.now() - Date.parse(lastActivity);
      if (!Number.isNaN(idleMs) && idleMs > 15 * 60 * 1e3) {
        return {
          state: "sleeping",
          detail: "Standby"
        };
      }
    }
    return {
      state: "idle:waiting",
      detail: "Waiting for turn"
    };
  }
  return {
    state: "unknown",
    detail: raw.status || void 0
  };
}
var deriveState = deriveDeterministicState;
function inheritProjectFromParents(agents) {
  const byId = /* @__PURE__ */ new Map();
  for (const agent of agents) byId.set(agent.id, agent);
  for (const agent of agents) {
    if (agent.project && agent.project !== DEFAULT_PROJECT) continue;
    let current = agent;
    const visited = /* @__PURE__ */ new Set();
    while (current.parentId && byId.has(current.parentId) && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (parent.project && parent.project !== DEFAULT_PROJECT) {
        agent.project = parent.project;
        break;
      }
      current = parent;
    }
  }
}

// src/shared/tree.ts
function buildAgentTree(agents) {
  const agentMap = /* @__PURE__ */ new Map();
  const childrenMap = /* @__PURE__ */ new Map();
  for (const agent of agents) {
    agentMap.set(agent.id, agent);
  }
  for (const agent of agents) {
    if (agent.parentId && agentMap.has(agent.parentId)) {
      const parent = agentMap.get(agent.parentId);
      agent.parentName = parent.name;
      agent.parentCategory = parent.category;
    }
  }
  const rootAgents = [];
  for (const agent of agents) {
    const parentId = agent.parentId;
    if (parentId && agentMap.has(parentId) && parentId !== agent.id) {
      const list = childrenMap.get(parentId) || [];
      list.push(agent);
      childrenMap.set(parentId, list);
    } else {
      rootAgents.push(agent);
    }
  }
  function buildNode(agent, depth, visited2) {
    visited2.add(agent.id);
    const rawChildren = childrenMap.get(agent.id) || [];
    const children = [];
    for (const child of rawChildren) {
      if (!visited2.has(child.id)) {
        children.push(buildNode(child, depth + 1, visited2));
      }
    }
    return {
      agent,
      depth,
      children
    };
  }
  const visited = /* @__PURE__ */ new Set();
  const tree = [];
  for (const root of rootAgents) {
    if (!visited.has(root.id)) {
      tree.push(buildNode(root, 0, visited));
    }
  }
  return tree;
}

// src/shared/watchdog.ts
var WATCHDOG_TAXONOMY = [
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "IDLE_POST_ERROR_AMNESIA",
  "ZOMBIE_HUNG_TURN",
  "STALE_ERROR_GHOSTING",
  "PROVIDER_QUOTA_EXHAUSTION",
  "REPETITIVE_TOOL_LOOP"
];
var DEFAULT_RUNNING_STALE_SECONDS = 1800;
var DEFAULT_CANCELLATION_RECENCY_SECONDS = 86400;
var DEFAULT_WATCHDOG_STEER_MESSAGE = "Health check: your previous turn ended without resuming work. Sweep the board for triage and continue dispatching pending work.";
var DEFAULT_WATCHDOG_BUSY_THRESHOLD = 5;
var DEFAULT_WATCHDOG_ALERT_COOLDOWN_MS = 2 * 60 * 1e3;
var DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD = 15;
var WATCHDOG_SEVERITIES = {
  TURN_CONCURRENCY_LOCK: "high",
  TURN_CANCELLATION_TIMEOUT: "high",
  ZOMBIE_HUNG_TURN: "high",
  PROVIDER_QUOTA_EXHAUSTION: "high",
  STALE_ERROR_GHOSTING: "medium",
  IDLE_POST_ERROR_AMNESIA: "medium",
  REPETITIVE_TOOL_LOOP: "high"
};
var STOP_TRIGGERS = /* @__PURE__ */ new Set([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
  "REPETITIVE_TOOL_LOOP"
]);
var STEER_TRIGGERS = /* @__PURE__ */ new Set([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
  "IDLE_POST_ERROR_AMNESIA",
  "REPETITIVE_TOOL_LOOP"
]);
var TURN_LOCK_MARKERS = [
  "foreground turn is already active",
  "a turn is already active",
  "concurrent turn",
  "turn concurrency"
];
var QUOTA_MARKERS = [
  "quota",
  "rate limit",
  "rate_limit",
  "429",
  "too many requests",
  "resource exhausted",
  "insufficient credit",
  "out of credits",
  "model unavailable",
  "usage limit",
  "upgrade to pro",
  "usage exceeded",
  "free usage",
  "subscribe to"
];
var TRANSIENT_MARKERS = [
  "fetch failed",
  "econnreset",
  "etimedout",
  "connection refused",
  "socket hang up",
  "temporarily unavailable"
];
var ATTENTION_STALL_REASONS = ["error", "stalled", "interrupted", "failed"];
function hasMarker(text, markers) {
  const lowered = String(text ?? "").toLowerCase();
  return markers.some((marker) => lowered.includes(marker));
}
function parseIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
function coerceEpochMs(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 1e11 ? Math.round(value * 1e3) : Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return num < 1e11 ? Math.round(num * 1e3) : Math.round(num);
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}
function detectTurnConcurrencyLock(liveStatus, lastError) {
  if (String(liveStatus ?? "").toLowerCase() !== "error") return false;
  return hasMarker(lastError, TURN_LOCK_MARKERS);
}
function detectCancellationTimeout(agentId, cancellations, liveStatus, nowEpochMs, recencySeconds, lastError, lastActivityAt, lastHandledCancellationAt) {
  const status = String(liveStatus ?? "").toLowerCase();
  if (status !== "error" && status !== "idle") return false;
  if (!cancellations || !cancellations.has(agentId)) return false;
  const rawCanceledAt = cancellations.get(agentId);
  const canceledAt = rawCanceledAt != null ? coerceEpochMs(rawCanceledAt) : null;
  if (recencySeconds !== void 0 && nowEpochMs !== void 0 && canceledAt !== null) {
    if ((nowEpochMs - canceledAt) / 1e3 > recencySeconds) {
      return false;
    }
  }
  if (lastHandledCancellationAt != null) {
    const handledMs = coerceEpochMs(lastHandledCancellationAt);
    if (handledMs != null && (canceledAt == null || handledMs >= canceledAt)) {
      return false;
    }
  }
  const hasError = Boolean(String(lastError ?? "").trim());
  if (status === "idle" && !hasError) {
    if (lastActivityAt != null && canceledAt != null) {
      const activityMs = coerceEpochMs(lastActivityAt);
      if (activityMs != null && activityMs > canceledAt) {
        return false;
      }
    }
  }
  return true;
}
function detectStaleErrorGhosting(liveStatus, lastError) {
  if (!["idle", "running"].includes(String(liveStatus ?? "").toLowerCase())) return false;
  return Boolean(String(lastError ?? "").trim());
}
function findProviderRetryQuotaError(recentTimeline, options) {
  if (!recentTimeline) return null;
  const entries = [];
  if (typeof recentTimeline === "string") {
    for (const line of recentTimeline.split("\n")) {
      entries.push({ text: line });
    }
  } else if (Array.isArray(recentTimeline)) {
    for (const item of recentTimeline) {
      if (typeof item === "string") {
        entries.push({ text: item });
      } else if (item && typeof item === "object") {
        const text = item.message ?? item.msg ?? item.text ?? item.detail ?? item.error ?? "";
        if (typeof text === "string" && text) {
          const rawTime = item.timestamp ?? item.time ?? item.createdAt ?? item.date ?? null;
          entries.push({ text, timestamp: coerceEpochMs(rawTime) });
        }
      }
    }
  }
  for (const entry of entries) {
    const raw = String(entry.text ?? "").trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const isRetryOrError = lower.includes("provider-retry") || lower.includes("provider retry") || lower.includes("[error]") || lower.includes("error:");
    if (!isRetryOrError) continue;
    if (hasMarker(lower, TRANSIENT_MARKERS)) continue;
    if (hasMarker(lower, QUOTA_MARKERS)) {
      if (options) {
        const { now, recencySeconds, lastActivityAt } = options;
        if (entry.timestamp != null) {
          if (now !== void 0 && recencySeconds !== void 0) {
            if ((now - entry.timestamp) / 1e3 > recencySeconds) {
              continue;
            }
          }
          if (lastActivityAt != null) {
            const activityMs = coerceEpochMs(lastActivityAt);
            if (activityMs != null && activityMs > entry.timestamp) {
              continue;
            }
          }
        }
      }
      return raw;
    }
  }
  return null;
}
function detectProviderQuotaExhaustion(lastError, recentTimeline, options) {
  const text = String(lastError ?? "").toLowerCase();
  if (text && !hasMarker(text, TRANSIENT_MARKERS) && hasMarker(text, QUOTA_MARKERS)) {
    return true;
  }
  if (recentTimeline) {
    if (options?.liveStatus) {
      const status = String(options.liveStatus).toLowerCase();
      if (status === "running" && !text.trim()) {
        return false;
      }
    }
    return Boolean(findProviderRetryQuotaError(recentTimeline, options));
  }
  return false;
}
function detectIdlePostErrorAmnesia(liveStatus, lastError, requiresAttention, attentionReason, activeWorkers, assumePendingWork = false) {
  if (String(liveStatus ?? "").toLowerCase() !== "idle") return false;
  if (activeWorkers > 0) return false;
  const reason = String(attentionReason ?? "").toLowerCase();
  const stalled = ATTENTION_STALL_REASONS.includes(reason) || Boolean(String(lastError ?? "").trim());
  if (stalled) return true;
  return Boolean(assumePendingWork && requiresAttention);
}
function detectZombieHungTurn(liveStatus, lastActivityAt, now, staleSeconds) {
  if (String(liveStatus ?? "").toLowerCase() !== "running") return false;
  const activity = parseIsoTimestamp(lastActivityAt);
  if (activity === null) return false;
  return (now - activity) / 1e3 >= staleSeconds;
}
var TOOL_CALL_INPUT_KEYS = {
  shell: ["command", "cwd"],
  read: ["filePath", "offset", "limit"],
  edit: ["filePath", "oldString", "newString"],
  write: ["filePath", "content"],
  search: ["query", "toolName", "mode"],
  fetch: ["url", "prompt"],
  plain_text: ["label", "text"],
  plan: ["text"]
};
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
function toolCallSignature(item) {
  if (!item || typeof item !== "object") return null;
  const raw = item;
  if (raw.type !== "tool_call" && raw.type !== "tool_use") return null;
  const nested = raw.toolCall && typeof raw.toolCall === "object" ? raw.toolCall : null;
  const name = String(raw.name ?? raw.toolName ?? nested?.name ?? "").trim();
  if (!name) return null;
  const detail = raw.detail ?? raw.input ?? nested?.input ?? null;
  let args = detail;
  if (detail && typeof detail === "object") {
    const d = detail;
    const inputKeys = typeof d.type === "string" ? TOOL_CALL_INPUT_KEYS[d.type] : void 0;
    if (inputKeys) {
      args = Object.fromEntries(inputKeys.filter((key) => key in d).map((key) => [key, d[key]]));
    } else if (d.type === "unknown") {
      args = d.input ?? null;
    }
  }
  return `${name}:${stableStringify(args)}`;
}
function detectRepetitiveToolLoop(timeline, threshold = DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD) {
  const items = normalizeTimelineItems(timeline);
  if (threshold <= 1 || items.length === 0) return 0;
  let best = 0;
  let run = 0;
  let last = null;
  for (const item of items) {
    const signature = toolCallSignature(item);
    if (signature === null) continue;
    run = signature === last ? run + 1 : 1;
    last = signature;
    if (run > best) best = run;
  }
  return best >= threshold ? best : 0;
}
function normalizeTimelineItems(timeline) {
  if (!timeline) return [];
  if (Array.isArray(timeline)) return timeline;
  if (typeof timeline === "string") {
    const trimmed = timeline.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
    }
  }
  return [];
}
function assessAgentHealth(agentId, live, disk, now, options = {}) {
  const liveStatus = String(live?.status ?? disk?.lastStatus ?? "").toLowerCase();
  const rawLastError = live?.lastError ?? disk?.lastError ?? "";
  const requiresAttention = Boolean(live?.requiresAttention ?? disk?.requiresAttention);
  const attentionReason = live?.attentionReason ?? disk?.attentionReason ?? null;
  const lastActivityAt = disk?.lastActivityAt ?? live?.lastActivityAt ?? disk?.updatedAt ?? live?.updatedAt ?? null;
  const lastHandledCancellationAt = disk?.lastHandledCancellationAt ?? disk?.cancellationHandledAt ?? null;
  const archived = Boolean(live?.archivedAt ?? disk?.archivedAt);
  const activeWorkers = options.activeWorkers ?? 0;
  const staleSeconds = options.runningStaleSeconds ?? DEFAULT_RUNNING_STALE_SECONDS;
  const recencySeconds = options.cancellationRecencySeconds ?? DEFAULT_CANCELLATION_RECENCY_SECONDS;
  const agentTimeline = options.recentTimeline ?? live?.recentTimeline ?? live?.timeline ?? disk?.recentTimeline ?? disk?.timeline ?? null;
  const quotaOpts = {
    now,
    recencySeconds,
    lastActivityAt,
    liveStatus
  };
  const repetitiveRun = liveStatus === "running" || liveStatus === "working" ? detectRepetitiveToolLoop(agentTimeline, options.repetitiveToolLoopThreshold) : 0;
  const quotaDetected = detectProviderQuotaExhaustion(rawLastError, agentTimeline, quotaOpts);
  const timelineQuotaError = quotaDetected && !String(rawLastError ?? "").trim() ? findProviderRetryQuotaError(agentTimeline, quotaOpts) : null;
  const lastError = timelineQuotaError ?? rawLastError;
  const turnLock = detectTurnConcurrencyLock(liveStatus, rawLastError) || !String(rawLastError ?? "").trim() && requiresAttention && attentionReason === "error";
  const cancellationTimeout = detectCancellationTimeout(
    agentId,
    options.cancellations,
    liveStatus,
    now,
    recencySeconds,
    rawLastError,
    lastActivityAt,
    lastHandledCancellationAt
  );
  const rawCancellation = options.cancellations?.get(agentId);
  let cancellationTime = rawCancellation != null ? coerceEpochMs(rawCancellation) : null;
  if (cancellationTime == null && cancellationTimeout) {
    cancellationTime = now;
  }
  const checks = {
    TURN_CONCURRENCY_LOCK: turnLock,
    TURN_CANCELLATION_TIMEOUT: cancellationTimeout,
    IDLE_POST_ERROR_AMNESIA: detectIdlePostErrorAmnesia(
      liveStatus,
      rawLastError,
      requiresAttention,
      attentionReason,
      activeWorkers,
      options.assumePendingWork ?? false
    ),
    ZOMBIE_HUNG_TURN: detectZombieHungTurn(liveStatus, lastActivityAt, now, staleSeconds),
    STALE_ERROR_GHOSTING: detectStaleErrorGhosting(liveStatus, rawLastError),
    PROVIDER_QUOTA_EXHAUSTION: quotaDetected,
    REPETITIVE_TOOL_LOOP: repetitiveRun > 0
  };
  const taxonomy = archived ? [] : WATCHDOG_TAXONOMY.filter((name) => checks[name]);
  const severities = {};
  const details = {};
  for (const name of taxonomy) {
    severities[name] = WATCHDOG_SEVERITIES[name];
    const detail = name === "TURN_CANCELLATION_TIMEOUT" ? "acknowledged turn still active after timeout" : name === "IDLE_POST_ERROR_AMNESIA" ? attentionReason ?? void 0 : name === "ZOMBIE_HUNG_TURN" ? lastActivityAt ?? void 0 : name === "REPETITIVE_TOOL_LOOP" ? `${repetitiveRun} identical consecutive tool calls` : String(lastError || "").trim() || void 0;
    if (detail) details[name] = detail;
  }
  return {
    agentId,
    name: live?.name ?? live?.title ?? null,
    liveStatus,
    taxonomy,
    severities,
    details,
    archived,
    lastError: String(lastError ?? ""),
    requiresAttention,
    attentionReason,
    lastActivityAt,
    lastHandledCancellationAt,
    cancellationTime,
    diskPath: disk?.path ?? null,
    healthy: taxonomy.length === 0
  };
}
function planWatchdogRecovery(taxonomy, steerMessage = DEFAULT_WATCHDOG_STEER_MESSAGE) {
  const set = new Set(taxonomy);
  const stop = [...set].some((type) => STOP_TRIGGERS.has(type));
  const steer = [...set].some((type) => STEER_TRIGGERS.has(type)) && !set.has("PROVIDER_QUOTA_EXHAUSTION");
  return {
    stop,
    clearError: set.has("STALE_ERROR_GHOSTING") || stop,
    clearAttention: set.has("IDLE_POST_ERROR_AMNESIA") || stop,
    recordCancellationHandled: set.has("TURN_CANCELLATION_TIMEOUT"),
    steer,
    steerMessage,
    blockedReason: set.has("PROVIDER_QUOTA_EXHAUSTION") && !stop ? "provider/quota exhaustion requires operator circuit-break" : null
  };
}
function defineContract(options) {
  return options;
}
var FleetRosterInputSchema = z.object({
  repo: z.string().optional(),
  project: z.string().optional(),
  enrolledRepos: z.array(z.string()).optional(),
  mutedRepos: z.array(z.string()).optional(),
  pausedRepos: z.array(z.string()).optional(),
  kanbanOnlyRepos: z.array(z.string()).optional()
}).optional().default({});
var fleetRosterContract = defineContract({
  name: "fleet.roster",
  description: "Read canonical fleet agent roster, state machine, worktree graph, and health summary",
  input: FleetRosterInputSchema,
  output: FleetOutputSchema
});
var ArchiveAgentInputSchema = z.object({
  agentId: z.string().min(1),
  notify: z.boolean().optional()
});
var ArchiveAgentOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional()
});
var archiveAgentContract = defineContract({
  name: "fleet.archive-agent",
  description: "Archive a specific fleet agent by ID",
  input: ArchiveAgentInputSchema,
  output: ArchiveAgentOutputSchema
});
var ArchiveInactiveAgentsInputSchema = z.object({
  beforeHours: z.number().int().positive().optional()
}).optional().default({});
var ArchiveInactiveAgentsOutputSchema = z.object({
  ok: z.boolean(),
  archivedCount: z.number().default(0),
  error: z.string().optional()
});
var archiveInactiveAgentsContract = defineContract({
  name: "fleet.archive-inactive",
  description: "Archive all inactive or completed workers across the fleet",
  input: ArchiveInactiveAgentsInputSchema,
  output: ArchiveInactiveAgentsOutputSchema
});
var CreateFrontDeskInputSchema = z.object({
  model: z.string().optional()
}).optional().default({});
var CreateFrontDeskOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string().optional(),
  error: z.string().optional()
});
var createFrontDeskContract = defineContract({
  name: "fleet.create-front-desk",
  description: "Spawn or ensure the singleton Front Desk liaison agent",
  input: CreateFrontDeskInputSchema,
  output: CreateFrontDeskOutputSchema
});
var replaceFrontDeskContract = defineContract({
  name: "fleet.replace-front-desk",
  description: "Archive the active Front Desk liaison and spawn a fresh replacement",
  input: CreateFrontDeskInputSchema,
  output: CreateFrontDeskOutputSchema
});
var AddOrchestratorInputSchema = z.object({
  repo: z.string().min(1),
  model: z.string().optional()
});
var AddOrchestratorOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string().optional(),
  error: z.string().optional()
});
var addOrchestratorContract = defineContract({
  name: "fleet.add-orchestrator",
  description: "Spawn or ensure a supervisor orchestrator for an enrolled repository",
  input: AddOrchestratorInputSchema,
  output: AddOrchestratorOutputSchema
});
var replaceOrchestratorContract = defineContract({
  name: "fleet.replace-orchestrator",
  description: "Archive the active orchestrator for an enrolled repository and spawn a fresh replacement",
  input: AddOrchestratorInputSchema,
  output: AddOrchestratorOutputSchema
});
var ToggleRepoPauseInputSchema = z.object({
  repo: z.string().min(1),
  paused: z.boolean().optional()
});
var ToggleRepoPauseOutputSchema = z.object({
  ok: z.boolean(),
  paused: z.boolean(),
  repo: z.string(),
  error: z.string().optional()
});
var toggleRepoPauseContract = defineContract({
  name: "fleet.toggle-repo-pause",
  description: "Pause or unpause hook processing for a repository",
  input: ToggleRepoPauseInputSchema,
  output: ToggleRepoPauseOutputSchema
});
var FleetHaltInputSchema = z.object({
  reason: z.string().optional()
}).optional().default({});
var FleetHaltOutputSchema = z.object({
  ok: z.boolean(),
  halted: z.boolean(),
  error: z.string().optional()
});
var fleetHaltContract = defineContract({
  name: "fleet.halt",
  description: "Halt all fleet turns and suspend active queues",
  input: FleetHaltInputSchema,
  output: FleetHaltOutputSchema
});
var fleetResumeContract = defineContract({
  name: "fleet.resume",
  description: "Resume fleet operations and reactivate paused queues",
  input: FleetHaltInputSchema,
  output: FleetHaltOutputSchema
});
var FleetTeardownInputSchema = z.object({
  force: z.boolean().optional()
}).optional().default({});
var FleetTeardownOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional()
});
var fleetTeardownContract = defineContract({
  name: "fleet.teardown",
  description: "Teardown and archive all non-essential workers across the fleet",
  input: FleetTeardownInputSchema,
  output: FleetTeardownOutputSchema
});
var execFileAsync = promisify(execFile);
var gitRootCommitCache = /* @__PURE__ */ new Map();
async function resolveGitRootCommit(cwd) {
  if (!cwd || typeof cwd !== "string") return null;
  const trimmed = cwd.trim();
  if (gitRootCommitCache.has(trimmed)) {
    return gitRootCommitCache.get(trimmed);
  }
  if (!existsSync$1(trimmed)) {
    gitRootCommitCache.set(trimmed, null);
    return null;
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: trimmed,
      encoding: "utf8"
    });
    const lines = stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
    const result = lines.length > 0 ? lines.sort()[0] : null;
    gitRootCommitCache.set(trimmed, result);
    return result;
  } catch {
    gitRootCommitCache.set(trimmed, null);
    return null;
  }
}
function resolveGitRootCommitSync(cwd) {
  if (!cwd || typeof cwd !== "string") return null;
  const trimmed = cwd.trim();
  if (gitRootCommitCache.has(trimmed)) {
    return gitRootCommitCache.get(trimmed);
  }
  if (!existsSync$1(trimmed)) {
    gitRootCommitCache.set(trimmed, null);
    return null;
  }
  try {
    const stdout = execFileSync$1("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: trimmed,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const lines = stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
    const result = lines.length > 0 ? lines.sort()[0] : null;
    gitRootCommitCache.set(trimmed, result);
    return result;
  } catch {
    gitRootCommitCache.set(trimmed, null);
    return null;
  }
}
function canonicalProjectKey(cwd) {
  if (!cwd || typeof cwd !== "string") return "";
  const trimmed = cwd.trim();
  if (trimmed.startsWith("git-root:") || trimmed.startsWith("non-git:")) {
    return trimmed;
  }
  const rootCommit = resolveGitRootCommitSync(trimmed);
  if (rootCommit) {
    return `git-root:${rootCommit}`;
  }
  const resolvedPath = resolve(trimmed);
  const hash = createHash("sha256").update(resolvedPath).digest("hex").slice(0, 16);
  return `non-git:${hash}`;
}
async function resolveCanonicalProjectKey(cwd) {
  if (!cwd || typeof cwd !== "string") return "";
  const trimmed = cwd.trim();
  if (trimmed.startsWith("git-root:") || trimmed.startsWith("non-git:")) {
    return trimmed;
  }
  const rootCommit = await resolveGitRootCommit(trimmed);
  if (rootCommit) {
    return `git-root:${rootCommit}`;
  }
  const resolvedPath = resolve(trimmed);
  const hash = createHash("sha256").update(resolvedPath).digest("hex").slice(0, 16);
  return `non-git:${hash}`;
}
var WorkspaceResolutionError = class extends Error {
  repo;
  constructor(repo, message, options) {
    super(message, options);
    this.name = "WorkspaceResolutionError";
    this.repo = repo;
  }
};
var WORKSPACE_NOT_FOUND_REMEDIATION = "open/register the repository in Paseo (e.g. `paseo workspace create` for an isolated worktree, or `paseo workspace open --cwd <repo_dir>`), then retry";
function workspaceNotFoundError(repo) {
  return new WorkspaceResolutionError(
    repo,
    `No workspace found for repository "${repo}": the daemon has no matching workspace. ${WORKSPACE_NOT_FOUND_REMEDIATION}.`
  );
}
function canonicalDescriptorsToRegistry(entries) {
  const workspaces = [];
  const projectsById = /* @__PURE__ */ new Map();
  for (const entry of entries ?? []) {
    if (!entry) continue;
    const workspaceId = entry.id ?? entry.workspaceId;
    const cwd = entry.workspaceDirectory ?? entry.cwd ?? entry.projectRootPath;
    if (!workspaceId || !cwd) continue;
    const projectId = entry.projectId ?? void 0;
    const isWorktree = entry.gitRuntime?.isPaseoOwnedWorktree === true;
    workspaces.push({
      workspaceId,
      projectId,
      cwd,
      mainRepoRoot: isWorktree ? entry.projectRootPath ?? null : null,
      worktreeRoot: isWorktree ? cwd : null,
      displayName: entry.title ?? entry.name ?? entry.project?.workspaceName ?? null,
      archivedAt: entry.archivingAt ?? entry.archivedAt ?? null,
      kind: entry.workspaceKind ?? entry.kind ?? void 0,
      isPaseoOwnedWorktree: entry.gitRuntime?.isPaseoOwnedWorktree ?? void 0
    });
    if (projectId && !projectsById.has(projectId)) {
      projectsById.set(projectId, {
        projectId,
        displayName: entry.projectDisplayName ?? entry.project?.projectName ?? void 0,
        projectKey: entry.project?.projectKey ?? void 0,
        rootPath: entry.projectRootPath ?? void 0,
        archivedAt: null
      });
    }
  }
  return { workspaces, projects: [...projectsById.values()] };
}
function isWorktreeRecord(workspace) {
  return Boolean(
    workspace.isPaseoOwnedWorktree || workspace.mainRepoRoot || workspace.isolation === "worktree" || workspace.kind === "worktree" || workspace.cwd.includes("/.paseo/worktrees/")
  );
}
function workspaceCandidateKeys(workspace, project) {
  const keys = /* @__PURE__ */ new Set();
  const add = (value) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    keys.add(trimmed.toLowerCase());
    const normalized = normalizeRepoKey(trimmed);
    if (normalized) keys.add(normalized.toLowerCase());
    const canonical = canonicalRepoKey(trimmed);
    if (canonical) keys.add(canonical.toLowerCase());
  };
  add(workspace.projectId);
  add(workspace.projectKey);
  add(workspace.repo);
  add(project?.projectId);
  add(project?.projectKey);
  add(workspace.mainRepoRoot);
  add(project?.rootPath);
  add(workspace.cwd);
  add(project?.displayName);
  const candidateDirs = [
    workspace.mainRepoRoot,
    workspace.worktreeRoot,
    project?.rootPath,
    workspace.cwd
  ];
  for (const dir of candidateDirs) {
    if (dir && typeof dir === "string" && existsSync$1(dir)) {
      const pKey = canonicalProjectKey(dir);
      if (pKey) keys.add(pKey.toLowerCase());
    }
  }
  if (workspace.mainRepoRoot) add(basename$1(workspace.mainRepoRoot));
  if (project?.rootPath) add(basename$1(project.rootPath));
  if (!isWorktreeRecord(workspace) && workspace.cwd) add(basename$1(workspace.cwd));
  return [...keys];
}
function resolveWorkspaceForRepo(rawRepo, options) {
  if (!rawRepo || typeof rawRepo !== "string" || !rawRepo.trim()) {
    return null;
  }
  const repo = rawRepo.trim();
  const workspaces = Array.isArray(options?.workspacesData) ? options.workspacesData : [];
  if (workspaces.length === 0) {
    return null;
  }
  const projects = Array.isArray(options?.projectsData) ? options.projectsData : [];
  const projectsById = /* @__PURE__ */ new Map();
  for (const project of projects) {
    if (project?.projectId) projectsById.set(project.projectId, project);
  }
  const targetKeys = /* @__PURE__ */ new Set();
  targetKeys.add(repo.toLowerCase());
  if (repo.startsWith("git-root:") || repo.startsWith("non-git:")) ; else {
    for (const candidate of candidateRepoKeys(repo)) {
      const normalized = normalizeRepoKey(candidate);
      if (normalized) targetKeys.add(normalized.toLowerCase());
      const canonical = canonicalRepoKey(candidate);
      if (canonical) targetKeys.add(canonical.toLowerCase());
    }
    if (existsSync$1(repo)) {
      const pKey = canonicalProjectKey(repo);
      if (pKey) targetKeys.add(pKey.toLowerCase());
    }
  }
  const matches = [];
  for (const workspace of workspaces) {
    if (!workspace?.workspaceId || !workspace.cwd) continue;
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : void 0;
    const keys = workspaceCandidateKeys(workspace, project);
    const hit = keys.some((key) => targetKeys.has(key));
    if (hit) matches.push({ workspace, project });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const archivedDelta = Number(Boolean(a.workspace.archivedAt)) - Number(Boolean(b.workspace.archivedAt));
    if (archivedDelta !== 0) return archivedDelta;
    const worktreeDelta = Number(isWorktreeRecord(a.workspace)) - Number(isWorktreeRecord(b.workspace));
    if (worktreeDelta !== 0) return worktreeDelta;
    const timeA = String(a.workspace.updatedAt ?? a.workspace.createdAt ?? "");
    const timeB = String(b.workspace.updatedAt ?? b.workspace.createdAt ?? "");
    if (timeA !== timeB) return timeB.localeCompare(timeA);
    return a.workspace.workspaceId.localeCompare(b.workspace.workspaceId);
  });
  const best = matches[0];
  return {
    workspaceId: best.workspace.workspaceId,
    cwd: best.workspace.cwd,
    projectId: best.workspace.projectId,
    displayName: best.workspace.displayName ?? best.project?.displayName ?? void 0,
    repo: canonicalRepoKey(repo) ?? repo
  };
}
function candidateHostCheckoutDir(repo, hostHome) {
  const repoBasename = basename$1(repo.replace(/\.git$/, "")).trim();
  if (!repoBasename) return void 0;
  const home = hostHome || process.env.HOME;
  if (!home) return void 0;
  return join$1(home, "code", repoBasename);
}
async function resolveWorkspaceForRepoViaDaemon(rawRepo, paseo, options) {
  if (!rawRepo || typeof rawRepo !== "string" || !rawRepo.trim()) {
    return null;
  }
  const repo = rawRepo.trim();
  const list = paseo?.workspaces?.list;
  if (typeof list !== "function") {
    return null;
  }
  let entries = [];
  try {
    const listed = await list.call(paseo.workspaces, {});
    entries = Array.isArray(listed?.entries) ? listed.entries : [];
  } catch (err) {
    throw new WorkspaceResolutionError(
      repo,
      `Failed to read workspaces from the Paseo daemon for "${repo}": ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  const { workspaces, projects } = canonicalDescriptorsToRegistry(entries);
  const matched = resolveWorkspaceForRepo(repo, { workspacesData: workspaces, projectsData: projects });
  if (matched) return matched;
  const candidateDir = options?.candidateDir?.(repo);
  if (!candidateDir || !existsSync$1(candidateDir)) {
    return null;
  }
  const open = paseo.workspaces.open;
  if (typeof open !== "function") {
    return null;
  }
  const handle = await open.call(paseo.workspaces, { cwd: candidateDir });
  const workspaceId = handle?.id ?? handle?.workspaceId;
  if (!workspaceId) {
    throw new WorkspaceResolutionError(
      repo,
      `The Paseo daemon opened ${candidateDir} but returned no workspace id for "${repo}".`
    );
  }
  return {
    workspaceId,
    cwd: handle.directory ?? candidateDir,
    projectId: handle.projectId ?? void 0,
    repo: canonicalRepoKey(repo) ?? repo
  };
}
function resolvePaseoHome(overrideHome) {
  if (overrideHome && overrideHome.trim()) {
    const trimmed = overrideHome.trim();
    if (trimmed.endsWith(".paseo")) return trimmed;
    return join$1(trimmed, ".paseo");
  }
  if (process.env.PASEO_HOME && process.env.PASEO_HOME.trim()) {
    return process.env.PASEO_HOME.trim();
  }
  return join$1(homedir(), ".paseo");
}
var workspaceProjectCache = null;
function resetWorkspaceProjectCache() {
  workspaceProjectCache = null;
}
function parseProjectKey(key) {
  const cleaned = key?.trim().replace(/\.git$/, "");
  if (!cleaned) return void 0;
  let body = cleaned;
  if (body.startsWith("remote:")) {
    body = body.slice("remote:".length);
  }
  const slash = body.indexOf("/");
  if (slash === -1) return void 0;
  const segments = body.slice(slash + 1).split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return segments[0];
}
function buildWorkspaceProjectMapFromRegistry(workspaces, projects) {
  const map = {};
  if (!workspaces || !Array.isArray(workspaces)) return map;
  const projectsById = /* @__PURE__ */ new Map();
  if (projects && Array.isArray(projects)) {
    for (const project of projects) {
      if (project?.projectId) projectsById.set(project.projectId, project);
    }
  }
  for (const workspace of workspaces) {
    if (!workspace?.workspaceId || workspace.archivedAt) continue;
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : void 0;
    let key = null;
    const candidateKeys = [project?.projectKey, project?.projectId, workspace.projectId];
    for (const cand of candidateKeys) {
      if (typeof cand === "string" && (cand.startsWith("git-root:") || cand.startsWith("non-git:"))) {
        key = cand.trim();
        break;
      }
    }
    if (!key) {
      const targetDir = workspace.mainRepoRoot || workspace.worktreeRoot || project?.rootPath || workspace.cwd;
      if (targetDir && typeof targetDir === "string") {
        const rootCommit = resolveGitRootCommitSync(targetDir.trim());
        if (rootCommit) {
          key = `git-root:${rootCommit}`;
        }
      }
    }
    if (key) {
      map[workspace.workspaceId] = key;
    }
  }
  return map;
}
function readWorkspaceProjectMap(options) {
  if (options?.workspacesData) {
    return buildWorkspaceProjectMapFromRegistry(options.workspacesData, options.projectsData);
  }
  const now = Date.now();
  if (!options?.forceRefresh && workspaceProjectCache && now - workspaceProjectCache.cachedAt < 5e3) {
    return workspaceProjectCache.map;
  }
  let map = {};
  const baseDir = resolvePaseoHome(options?.home);
  try {
    const projectsPath = existsSync$1(join$1(baseDir, "projects", "projects.json")) ? join$1(baseDir, "projects", "projects.json") : join$1(baseDir, "projects.json");
    let parsedProjects = [];
    if (existsSync$1(projectsPath)) {
      const parsed = JSON.parse(readFileSync(projectsPath, "utf-8"));
      if (Array.isArray(parsed)) {
        parsedProjects = parsed;
      }
    }
    const workspacesPath = existsSync$1(join$1(baseDir, "projects", "workspaces.json")) ? join$1(baseDir, "projects", "workspaces.json") : join$1(baseDir, "workspaces.json");
    if (existsSync$1(workspacesPath)) {
      const parsed = JSON.parse(readFileSync(workspacesPath, "utf-8"));
      if (Array.isArray(parsed)) {
        map = buildWorkspaceProjectMapFromRegistry(parsed, parsedProjects);
      }
    }
  } catch {
  }
  workspaceProjectCache = { map, cachedAt: now };
  return map;
}
function readQuotaAlertAgentIds(options) {
  const ids = /* @__PURE__ */ new Set();
  const baseDir = resolvePaseoHome(options?.home);
  try {
    const path = join$1(baseDir, "limit-alerts.json");
    if (!existsSync$1(path)) return ids;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(parsed?.alerts)) {
      for (const alert of parsed.alerts) {
        if (alert?.agentId && alert.status === "open") ids.add(alert.agentId);
      }
    }
  } catch {
  }
  return ids;
}

// src/server/normalize.ts
function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function textOrUndefined(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function normalizePendingPermissions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || entry.requestId || "").trim();
    if (!id) continue;
    const permission = { id };
    for (const key of ["requestId", "name", "title", "tool", "kind", "description"]) {
      const value = textOrUndefined(entry[key]);
      if (value) permission[key] = value;
    }
    const input = entry.input && typeof entry.input === "object" ? entry.input : entry.metadata;
    if (input && typeof input === "object") {
      permission.input = input;
    }
    const scope = extractPermissionScope(permission);
    if (scope) permission.scope = scope;
    out.push(permission);
  }
  return out;
}
function normalizeAttentionReason(raw) {
  return raw === "finished" || raw === "error" || raw === "permission" || raw === "input" ? raw : null;
}
function normalizeAgentMetrics(raw) {
  const usage = raw.lastUsage ?? null;
  const metrics = {};
  const used = numberOrUndefined(usage?.contextWindowUsedTokens);
  const max = numberOrUndefined(usage?.contextWindowMaxTokens);
  const cached = numberOrUndefined(usage?.cachedInputTokens);
  const input = numberOrUndefined(usage?.inputTokens);
  const output = numberOrUndefined(usage?.outputTokens);
  const cost = numberOrUndefined(usage?.totalCostUsd);
  const turnStart = textOrUndefined(raw.activeTurn?.startedAt);
  const attention = textOrUndefined(raw.attentionTimestamp);
  if (used !== void 0) metrics.contextUsedTokens = used;
  if (max !== void 0) metrics.contextMaxTokens = max;
  if (cached !== void 0) metrics.cachedTokens = cached;
  if (input !== void 0) metrics.inputTokens = input;
  if (output !== void 0) metrics.outputTokens = output;
  if (cost !== void 0) metrics.costUsd = cost;
  if (turnStart !== void 0) metrics.activeTurnStartedAt = turnStart;
  if (attention !== void 0) metrics.attentionTimestamp = attention;
  return Object.keys(metrics).length > 0 ? metrics : null;
}
function normalizeRawAgent(raw, options) {
  const id = raw.id || "";
  const shortId = raw.shortId || id.slice(0, 7);
  const name = raw.name || raw.title || `Agent ${shortId}`;
  const category = categorizeAgent(name);
  const status = raw.status || "idle";
  const parentId = raw.parentId !== void 0 ? raw.parentId : raw.ParentAgentId !== void 0 ? raw.ParentAgentId : raw.labels?.["paseo.parent-agent-id"] || null;
  const attributedWork2 = extractAttributedWork(raw);
  const pendingPermissions = normalizePendingPermissions(raw.pendingPermissions);
  const attentionReason = normalizeAttentionReason(raw.attentionReason);
  const requiresAttention = pendingPermissions.length > 0 || raw.requiresAttention === true && attentionReason !== "finished";
  const quotaIds = options?.quotaAlertAgentIds ?? readQuotaAlertAgentIds({ home: options?.home });
  const projectMap = options?.workspaceProjectMap ?? readWorkspaceProjectMap({ home: options?.home });
  const { state: deterministicState, detail: stateDetail } = deriveDeterministicState(
    raw,
    attributedWork2,
    quotaIds
  );
  const lifecycleState = deriveLifecycleState(deterministicState);
  const blockDetail = lifecycleState === "waiting_for_input" ? buildAgentBlockDetail(id, pendingPermissions) : void 0;
  const metrics = normalizeAgentMetrics(raw);
  const project = extractAgentProject(
    { ...raw, attributedWork: attributedWork2 },
    void 0,
    projectMap
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
    attributedWork: attributedWork2,
    usage: raw.lastUsage || null,
    metrics,
    lastError: raw.lastError || null,
    url: raw.url || (id ? `paseo://agent/${id}` : void 0),
    worktree: extractAgentWorktree(raw),
    project,
    labels: raw.labels,
    pendingPermissions,
    requiresAttention,
    attentionReason
  };
}
var defaultExecFileAsync = promisify(execFile);
async function readRawRoster(context, options) {
  const execFn = options?.execFileAsync || defaultExecFileAsync;
  if (context?.paseo?.agents?.list) {
    try {
      const list = await context.paseo.agents.list();
      const entries = Array.isArray(list?.entries) ? list.entries : [];
      const roster = [];
      for (const entry of entries) {
        const agent = entry?.agent ?? entry;
        const id = String(agent?.id ?? "");
        if (!id) continue;
        roster.push({
          id,
          name: agent.name || agent.title || "",
          title: agent.title || agent.name || "",
          status: agent.status || "idle",
          provider: agent.provider || "",
          model: agent.model ?? null,
          cwd: agent.cwd || "",
          workspaceId: agent.workspaceId || void 0,
          created: agent.created || agent.createdAt || void 0,
          updatedAt: agent.updatedAt || void 0,
          lastActivityAt: agent.lastActivityAt ?? void 0,
          labels: agent.labels || {},
          parentId: agent.labels?.["paseo.parent-agent-id"] || agent.parentId || null,
          lastError: agent.lastError || void 0,
          requiresAttention: agent.requiresAttention ?? void 0,
          attentionReason: agent.attentionReason || void 0,
          attentionTimestamp: agent.attentionTimestamp || void 0,
          pendingPermissions: agent.pendingPermissions ?? void 0,
          activeTurn: agent.activeTurn || void 0,
          lastUsage: agent.lastUsage || void 0
        });
      }
      return { roster, source: "sdk" };
    } catch (err) {
      return { roster: [], source: "none", error: err?.message || String(err) };
    }
  }
  try {
    const { stdout } = await execFn("paseo", ["ls", "--json"], { timeout: 5e3, encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const roster = [];
      for (const item of parsed) {
        const id = String(item?.id ?? "");
        if (!id) continue;
        const provider = item.provider || "";
        roster.push({
          id,
          name: item.name || item.title || "",
          title: item.title || item.name || "",
          status: item.status || "idle",
          provider,
          model: (provider?.includes("/") ? provider.split("/")[1] : void 0) ?? null,
          cwd: item.cwd || "",
          created: item.created || void 0,
          updatedAt: item.updatedAt || void 0,
          lastActivityAt: item.lastActivityAt || void 0,
          workspaceId: item.workspaceId || void 0,
          labels: item.labels || {},
          parentId: item.parentId || null,
          lastError: item.lastError,
          requiresAttention: item.requiresAttention,
          attentionReason: item.attentionReason,
          attentionTimestamp: item.attentionTimestamp,
          pendingPermissions: item.pendingPermissions,
          activeTurn: item.activeTurn,
          lastUsage: item.lastUsage
        });
      }
      return { roster, source: "cli" };
    }
  } catch (err) {
    return { roster: [], source: "none", error: err?.message || String(err) };
  }
  return { roster: [], source: "none" };
}
function buildFleetOutput(agents, options) {
  const frontDesk = [];
  const orchestrators = [];
  const workers = [];
  let runningCount = 0;
  let idleCount = 0;
  let errorCount = 0;
  const enrolledRepos = options?.enrolledRepos || [];
  const mutedRepos = options?.mutedRepos || [];
  const pausedRepos = options?.pausedRepos || [];
  const kanbanOnlyRepos = options?.kanbanOnlyRepos || [];
  const repoQueuedHooks = options?.repoQueuedHooks || {};
  for (const agent of agents) {
    if (agent.status === "running") runningCount += 1;
    else if (agent.status === "idle") idleCount += 1;
    else if (agent.status === "error") errorCount += 1;
    if (agent.category === "front-desk") frontDesk.push(agent);
    else if (agent.category === "orchestrator") orchestrators.push(agent);
    else workers.push(agent);
    const project = agent.project || DEFAULT_PROJECT;
    agent.isEnrolled = enrolledRepos.some((r) => repoMatches(r, project));
    agent.isDetached = !agent.isEnrolled;
    agent.isMuted = mutedRepos.some((m) => repoMatches(m, project));
    agent.isPaused = pausedRepos.some((p) => repoMatches(p, project));
    agent.hasOrchestrator = orchestrators.some((o) => repoMatches(o.project || DEFAULT_PROJECT, project));
    agent.queuedHooksCount = repoQueuedHooks[project] || 0;
  }
  const tree = buildAgentTree(agents);
  return {
    ok: true,
    registryAuthoritative: false,
    roleDivergences: [],
    frontDesk,
    orchestrators,
    workers,
    tree,
    enrolledRepos,
    pausedRepos,
    kanbanOnlyRepos,
    mutedRepos,
    repoQueuedHooks,
    totalCount: agents.length,
    runningCount,
    idleCount,
    errorCount
  };
}
async function readFleetRoster(context, options) {
  const { roster } = await readRawRoster(context, options);
  const quota = readQuotaAlertAgentIds({ home: options?.home });
  let map = options?.workspaceProjectMap;
  if (!map) {
    if (options?.workspacesData) {
      map = buildWorkspaceProjectMapFromRegistry(options.workspacesData, options.projectsData);
    } else if (context?.paseo?.workspaces?.list) {
      try {
        const listed = await context.paseo.workspaces.list({});
        const entries = Array.isArray(listed?.entries) ? listed.entries : [];
        const { workspaces, projects } = canonicalDescriptorsToRegistry(entries);
        map = buildWorkspaceProjectMapFromRegistry(workspaces, projects);
      } catch {
        map = readWorkspaceProjectMap({ home: options?.home, forceRefresh: true });
      }
    } else {
      map = readWorkspaceProjectMap({ home: options?.home, forceRefresh: true });
    }
  }
  const agents = roster.map(
    (raw) => normalizeRawAgent(raw, {
      quotaAlertAgentIds: quota,
      workspaceProjectMap: map,
      home: options?.home
    })
  );
  inheritProjectFromParents(agents);
  return buildFleetOutput(agents, options);
}

// src/server/handlers.ts
var defaultLogger = {
  info: () => {
  },
  warn: (msg, ctx) => console.warn(`[fleet:warn] ${msg}`, ctx ?? ""),
  debug: () => {
  }
};
function createFleetHandlers(options) {
  const log = options?.log || defaultLogger;
  return {
    async handleFleetRoster(input, context) {
      try {
        const mergedOptions = {
          ...options,
          enrolledRepos: input?.enrolledRepos ?? options?.enrolledRepos,
          mutedRepos: input?.mutedRepos ?? options?.mutedRepos,
          pausedRepos: input?.pausedRepos ?? options?.pausedRepos,
          kanbanOnlyRepos: input?.kanbanOnlyRepos ?? options?.kanbanOnlyRepos
        };
        return await readFleetRoster(context, mergedOptions);
      } catch (err) {
        log.warn("handleFleetRoster failed", { error: String(err) });
        return {
          ok: false,
          registryAuthoritative: false,
          roleDivergences: [],
          frontDesk: [],
          orchestrators: [],
          workers: [],
          tree: [],
          enrolledRepos: [],
          pausedRepos: [],
          kanbanOnlyRepos: [],
          mutedRepos: [],
          repoQueuedHooks: {},
          totalCount: 0,
          runningCount: 0,
          idleCount: 0,
          errorCount: 0,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    },
    async handleArchiveAgent(input, context) {
      if (options?.onArchiveAgent) return options.onArchiveAgent(input, context);
      return { ok: false, error: "archive-agent handler not implemented" };
    },
    async handleArchiveInactive(input = {}, context) {
      if (options?.onArchiveInactive) return options.onArchiveInactive(input, context);
      return { ok: false, archivedCount: 0, error: "archive-inactive handler not implemented" };
    },
    async handleCreateFrontDesk(input = {}, context) {
      if (options?.onCreateFrontDesk) return options.onCreateFrontDesk(input, context);
      return { ok: false, error: "create-front-desk handler not implemented" };
    },
    async handleReplaceFrontDesk(input = {}, context) {
      if (options?.onReplaceFrontDesk) return options.onReplaceFrontDesk(input, context);
      return { ok: false, error: "replace-front-desk handler not implemented" };
    },
    async handleAddOrchestrator(input, context) {
      if (options?.onAddOrchestrator) return options.onAddOrchestrator(input, context);
      return { ok: false, error: "add-orchestrator handler not implemented" };
    },
    async handleReplaceOrchestrator(input, context) {
      if (options?.onReplaceOrchestrator) return options.onReplaceOrchestrator(input, context);
      return { ok: false, error: "replace-orchestrator handler not implemented" };
    },
    async handleToggleRepoPause(input, context) {
      if (options?.onToggleRepoPause) return options.onToggleRepoPause(input, context);
      return { ok: false, paused: false, repo: input.repo, error: "toggle-repo-pause handler not implemented" };
    },
    async handleFleetHalt(input = {}, context) {
      if (options?.onFleetHalt) return options.onFleetHalt(input, context);
      return { ok: false, halted: false, error: "fleet-halt handler not implemented" };
    },
    async handleFleetResume(input = {}, context) {
      if (options?.onFleetResume) return options.onFleetResume(input, context);
      return { ok: false, resumed: false, error: "fleet-resume handler not implemented" };
    },
    async handleFleetTeardown(input = {}, context) {
      if (options?.onFleetTeardown) return options.onFleetTeardown(input, context);
      return { ok: false, error: "fleet-teardown handler not implemented" };
    }
  };
}
function registerFleetHandlers(server, options) {
  const handlers = createFleetHandlers(options);
  server.handle(fleetRosterContract, (input, ctx) => handlers.handleFleetRoster(input, ctx || server));
  server.handle(archiveAgentContract, (input, ctx) => handlers.handleArchiveAgent(input, ctx || server));
  server.handle(archiveInactiveAgentsContract, (input, ctx) => handlers.handleArchiveInactive(input, ctx || server));
  server.handle(createFrontDeskContract, (input, ctx) => handlers.handleCreateFrontDesk(input, ctx || server));
  server.handle(replaceFrontDeskContract, (input, ctx) => handlers.handleReplaceFrontDesk(input, ctx || server));
  server.handle(addOrchestratorContract, (input, ctx) => handlers.handleAddOrchestrator(input, ctx || server));
  server.handle(replaceOrchestratorContract, (input, ctx) => handlers.handleReplaceOrchestrator(input, ctx || server));
  server.handle(toggleRepoPauseContract, (input, ctx) => handlers.handleToggleRepoPause(input, ctx || server));
  server.handle(fleetHaltContract, (input, ctx) => handlers.handleFleetHalt(input, ctx || server));
  server.handle(fleetResumeContract, (input, ctx) => handlers.handleFleetResume(input, ctx || server));
  server.handle(fleetTeardownContract, (input, ctx) => handlers.handleFleetTeardown(input, ctx || server));
  return handlers;
}

export { AddOrchestratorInputSchema, AddOrchestratorOutputSchema, AgentAttentionReasonSchema, AgentBlockDetailSchema, AgentCategorySchema, AgentLifecycleStateSchema, AgentRoleDivergenceSchema, ArchiveAgentInputSchema, ArchiveAgentOutputSchema, ArchiveInactiveAgentsInputSchema, ArchiveInactiveAgentsOutputSchema, CODING_AGENT_CATEGORY, CreateFrontDeskInputSchema, CreateFrontDeskOutputSchema, DEFAULT_CANCELLATION_RECENCY_SECONDS, DEFAULT_FORGEJO_HOST, DEFAULT_PROJECT, DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD, DEFAULT_RUNNING_STALE_SECONDS, DEFAULT_WATCHDOG_ALERT_COOLDOWN_MS, DEFAULT_WATCHDOG_BUSY_THRESHOLD, DEFAULT_WATCHDOG_STEER_MESSAGE, DISPATCH_COMMAND_PATTERNS, DeterministicAgentStateSchema, FleetAgentMetricsSchema, FleetAgentSchema, FleetAgentTreeNodeSchema, FleetAgentUsageSchema, FleetAgentWorkSchema, FleetHaltInputSchema, FleetHaltOutputSchema, FleetOutputSchema, FleetRosterInputSchema, FleetTeardownInputSchema, FleetTeardownOutputSchema, FrontDeskActivityItemSchema, FrontDeskActivityTypeSchema, HookQueueItemSchema, HookQueueMessageSchema, HookStatusOutputSchema, NOISE_TOOL_NAMES, PendingPermissionSchema, QUOTA_MARKERS, STEER_TRIGGERS, STOP_TRIGGERS, ToggleRepoPauseInputSchema, ToggleRepoPauseOutputSchema, WATCHDOG_SEVERITIES, WATCHDOG_TAXONOMY, WORKSPACE_NOT_FOUND_REMEDIATION, WorkspaceResolutionError, addOrchestratorContract, agentRequiresAttention, archiveAgentContract, archiveInactiveAgentsContract, assessAgentHealth, attributedWork, buildAgentBlockDetail, buildAgentTree, buildFleetOutput, buildWorkspaceProjectMapFromRegistry, candidateHostCheckoutDir, candidateRepoKeys, canonicalDescriptorsToRegistry, canonicalProjectKey, canonicalRepoKey, canonicalRepoName, categorize, categorizeAgent, coerceEpochMs, compactRepoName, computeHealthGauge, createFleetHandlers, createFrontDeskContract, defineContract, deriveDeterministicState, deriveLifecycleState, deriveState, detectCancellationTimeout, detectIdlePostErrorAmnesia, detectProviderQuotaExhaustion, detectRepetitiveToolLoop, detectStaleErrorGhosting, detectTurnConcurrencyLock, detectZombieHungTurn, extractAgentProject, extractAgentWorktree, extractAttributedWork, extractPermissionScope, filterAgents, filterQueues, findProviderRetryQuotaError, fleetHaltContract, fleetResumeContract, fleetRosterContract, fleetTeardownContract, formatProjectDisplay, formatProjectOptionLabel, getAgentAttentionReason, getAgentCategoryIcon, getDeterministicStateConfig, getPendingPermissionAction, getPermissionAdjudicationCommand, getStatusLightTone, hasMarker, inheritProjectFromParents, isAgentEligibleForBulkArchive, isBlockedLifecycleState, isCodingAgentCategory, isRepoMatching, isSignalActivityItem, normalizeAgentMetrics, normalizeAttentionReason, normalizePendingPermissions, normalizeProjectName, normalizeRawAgent, normalizeRepoKey, parseIsoTimestamp, parseProjectKey, parseTranscriptToActivityItems, planWatchdogRecovery, readFleetRoster, readQuotaAlertAgentIds, readRawRoster, readWorkspaceProjectMap, registerFleetHandlers, replaceFrontDeskContract, replaceOrchestratorContract, repoCoordinates, repoMatches, resetWorkspaceProjectCache, resolveAgentLifecycleState, resolveCanonicalProjectKey, resolveCanonicalRepo, resolveGitRootCommit, resolveGitRootCommitSync, resolvePaseoHome, resolveWorkspaceForRepo, resolveWorkspaceForRepoViaDaemon, sortAgents, sortQueues, toggleRepoPauseContract, toolCallSignature, workspaceNotFoundError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map
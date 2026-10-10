import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, renameSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];
export type PaseoAgentHandle = ReturnType<PaseoApi["agents"]["ref"]>;
export type PaseoAgentSendOptions = NonNullable<Parameters<PaseoAgentHandle["send"]>[1]>;
import type {
  HookServiceStatusOutput,
  HookServiceActionOutput,
  HookLogTailOutput,
  HookServiceConfigInput,
  HookServiceConfigOutput,
  HookInfoOutput,
  FleetModelAlert,
  DroppedModelCandidate,
  UppidiFleetAlertsOutput,
  RotationPolicy,
  RotationRolePolicy,
  UppidiRotateRoleInput,
  UppidiRotateRoleOutput,
  UppidiRotationStatusInput,
  UppidiRotationStatusOutput,
  UppidiSetRotationPolicyInput,
  UppidiSetRotationPolicyOutput,
  UppidiAuditSummaryInput,
  MergeEventHook,
} from "../shared/contracts.js";
import { UppidiAuditRecordInputSchema } from "../shared/contracts.js";
import { extractPermissionScope } from "../shared/contracts.js";
import {
  candidateRepoKeys,
  canonicalRepoKey,
  normalizeRepoKey,
  resolveCanonicalRepo,
} from "../shared/repo-identity.js";
import { getUppidiFleetSettingsStorage } from "./settings.js";
import { forgejoApiGet, forgejoApiRequest, forgejoToken, resolveForgejoHost } from "./forgejo-api.js";
import { appendRollupReceipt } from "./metrics.js";
import {
  createDefaultIssuesCheckIo,
  runIssuesCheck,
  ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS,
  type IssuesCheckIo,
  type StaleWipResult,
} from "./issues-check.js";
import {
  resolveWorkspaceForRepo,
  resolveWorkspaceForRepoViaDaemon,
  type ResolvedWorkspace,
  type WorkspaceLookupOptions,
} from "./workspace-lookup.js";
import { adjudicatePermission } from "./permission-adjudication.js";
import { isRepoMatching } from "../shared/sort-filter.js";
import {
  DEFAULT_ROLE_MODELS,
  listEnabledProviders,
  loadSavedRoleModels,
  resolveHostHome,
} from "./role-models.js";
import { getEffectiveSkillContent, getEffectiveSkillPath, renderSkillDirective } from "./skills.js";
import {
  DEFAULT_ROTATION_POLICY,
  RotationLock,
  buildRotationBrief,
  evaluateRotationTrigger,
  isRotationRole,
  resolveRotationPolicy,
  ROTATION_ROLES,
  type RotationBriefInput,
  type RotationBriefTicket,
  type RotationObservation,
  type RotationTriggerReason,
} from "./rotation.js";
import { DiskLogger } from "./disk-logger.js";
import {
  appendAuditReceipt,
  appendAuditReconciliation,
  findAuditReceipt,
  projectAuditSummary,
  auditCheck,
  type AuditMergeReconciliation,
} from "./audit-receipts.js";

const defaultExecFileAsync = promisify(execFile);
let execFileAsync = defaultExecFileAsync;

export type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: unknown,
) => Promise<{ stdout: string; stderr?: string }>;

// Test seam: the suite stubs the CLI through this instead of shelling out to the
// real `paseo` binary (mirrors agents.ts and role-models.ts).
export function setExecFileAsyncForTest(fn: ExecFileAsyncFn | null): void {
  execFileAsync = (fn || defaultExecFileAsync) as typeof execFileAsync;
}

export interface RouterConfig {
  host?: string;
  port?: number;
  pausedRepos?: string[];
  enrolledRepos?: string[];
  /** Opt-in repo -> checkout/plugin bindings for the merge-event hook (#1076). */
  mergeEventHooks?: Record<string, MergeEventHook>;
}

export function getAvailableNetworkInterfaces(): string[] {
  const interfaces = os.networkInterfaces();
  const result = new Set<string>();
  result.add("127.0.0.1");
  result.add("0.0.0.0");

  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const item of netList as Array<{ family?: string | number; address?: string }>) {
      const family = typeof item.family === "string" ? item.family : String(item.family ?? "");
      if (family === "IPv4" || family === "4") {
        if (item.address && typeof item.address === "string") {
          result.add(item.address);
        }
      }
    }
  }

  return Array.from(result);
}

export function loadRouterConfig(): RouterConfig {
  try {
    const settings = getUppidiFleetSettingsStorage().read();
    return {
      host: settings.hookHost,
      port: settings.hookPort,
      pausedRepos: mergePausedRepos(settings.pausedRepos, settings.mutedRepos),
      enrolledRepos: settings.enrolledRepos,
      mergeEventHooks: settings.mergeEventHooks,
    };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `uppidi-fleet canonical plugin settings are unavailable; refusing to fall back to the legacy ` +
        `~/.config/uppidi-fleet/router-config.json mirror. Expected settings at ` +
        `~/.paseo/plugin-data/xpufx/uppidi-fleet/settings.json. Restore plugin settings storage and ` +
        `retry. Cause: ${cause}`,
    );
  }
}

/**
 * Unions the current `pausedRepos` with the pre-#984 `mutedRepos` key so an
 * existing install keeps its circuit-breaker state across the rename.
 */
function mergePausedRepos(
  paused: string[] | undefined,
  legacyPaused: string[] | undefined,
): string[] {
  const out: string[] = [];
  for (const repo of [...(paused ?? []), ...(legacyPaused ?? [])]) {
    if (repo && !out.includes(repo)) out.push(repo);
  }
  return out;
}

export function saveRouterConfig(config: RouterConfig): void {
  try {
    const storage = getUppidiFleetSettingsStorage();
    const updateData: Record<string, any> = {};
    if (config.host !== undefined) updateData.hookHost = config.host;
    if (config.port !== undefined) updateData.hookPort = config.port;
    if (config.enrolledRepos !== undefined) updateData.enrolledRepos = config.enrolledRepos;
    if (config.pausedRepos !== undefined) {
      updateData.pausedRepos = config.pausedRepos;
      // Clearing the pre-#984 key keeps a stale entry from resurrecting a repo
      // the operator just unpaused via the merged read above.
      updateData.mutedRepos = undefined;
    }
    if (config.mergeEventHooks !== undefined) {
      updateData.mergeEventHooks = config.mergeEventHooks;
    }
    if (Object.keys(updateData).length > 0) {
      storage.update((prev) => ({ ...prev, ...updateData }));
    }
  } catch {
    // ignore when storage not accessible or in isolated testing
  }
}

export interface HookRouterOptions {
  port?: number;
  host?: string;
  queueDir?: string;
  stateDir?: string;
  metricsFilePath?: string;
  secret?: string;
  paseo?: PaseoApi;
  debounceMs?: number;
  coalesceDisable?: boolean;
  watchdogIntervalMs?: number;
  watchdogBusyThreshold?: number;
  watchdogAlertCooldownMs?: number;
  boardSweepIntervalMs?: number;
  frontDeskThrottleMs?: number;
  workspacesData?: any[];
  projectsData?: any[];
  workspacesPath?: string;
  projectsPath?: string;
  paseoDir?: string;
  isTestMode?: boolean;
  allowCliSpawn?: boolean;
  /** Enable in-process label triage (#847). Defaults off in test mode. */
  labelTriageEnabled?: boolean;
  /** Enable the in-process issue close guard (#847). Defaults off in test mode. */
  closeGuardEnabled?: boolean;
  /** Enable the CI failure issue creator (#865). Defaults off in test mode. */
  ciFailureEnabled?: boolean;
  /** Enable the repository.created onboarding handler (#847). Defaults off in test mode. */
  repoOnboardingEnabled?: boolean;
  /** Enable the in-router stale-WIP sweep (#920). Defaults off in test mode. */
  staleWipSweepEnabled?: boolean;
  /** Hours with no update before a `state/1-wip` ticket returns to triage (#920). */
  staleWipHours?: number;
  /** Actor(s) whose issue closures are intercepted. Defaults to `xpufx`. */
  closeGuardTargetActors?: string[];
  /** Terminal labels that permit closure without reopening. */
  closeGuardAcceptedLabels?: string[];
  /** Shared agent account treated as automated. Defaults to `xpufx`. */
  sharedActor?: string;
  /** Explicit circuit breaker cache path; defaults to ~/.paseo/model-health.json */
  circuitBreakerPath?: string;
  modelHealthPath?: string;
  /** Persistent model-alert banner path; defaults to the scoped plugin data dir (#1011). */
  modelAlertsPath?: string;
  /** Explicit merge-event log path; defaults to the scoped plugin data dir (#1076). */
  mergeEventLogPath?: string;
  /** Explicit audit receipt store path (audits.jsonl, platform#348). */
  auditsFilePath?: string;
  /** Explicit audit merge-reconciliation log path (platform#348). */
  auditReconciliationsFilePath?: string;
  /** Explicit log directory path for hook router disk logging (#1115). */
  logDir?: string;
  /** Explicit hook log file path (#1115). */
  logFilePath?: string;
  /** Maximum bytes before rotating the hook log file. Defaults to 5MB (#1115). */
  logMaxBytes?: number;
  /** Maximum number of rotated hook log files to retain. Defaults to 3 (#1115). */
  logMaxFiles?: number;
  /** Opt-in repo -> checkout/plugin bindings for the merge-event hook (#1076). */
  mergeEventHooks?: Record<string, MergeEventHook>;
  /**
   * Best-effort board notification for total model-chain exhaustion (#1011).
   * Defaults to a Forgejo issue/comment on the affected repo; tests inject a
   * stub so no network is touched.
   */
  postModelExhaustionAlert?: (repo: string, alert: FleetModelAlert) => Promise<void>;
  /** Ordered model fallback list for orchestrator provision (#890). */
  orchestratorModelFallback?: string[];
  modelFallbackList?: string[];
  /** Overrides provider mode discovery for orchestrator spawns (#894). */
  providerModeResolver?: (provider: string) => Promise<ProviderModeInfo | null>;
  /**
   * Enabled host provider ids used to skip disabled providers in the
   * orchestrator model fallback chain (#973). Omit to probe `paseo provider ls`.
   */
  availableProvidersData?: string[];
  spawnAgent?: (opts: {
    title: string;
    prompt: string;
    cwd?: string;
    workspaceId?: string;
    mode?: string;
    provider?: string;
    model?: string;
    labels?: Record<string, string>;
  }) => Promise<{ id: string } | null>;
  /**
   * Scoped pre-grant applied after a CLI-spawned orchestrator (#974). Defaults
   * to `agents.autoAllowScopedPermission` (SDK `respondToPermission`, falling
   * back to `paseo permit allow`); tests inject a stub to observe the declared
   * workspace scope without touching the daemon.
   */
  spawnAutoAllow?: (
    agentId: string,
    scopePrefixes: readonly string[],
  ) => Promise<{ allowed: boolean; permissionId?: string; scope?: string; reason?: string }>;
  /**
   * Injected agent archiver used by deduplication, prune, and tests (#973/#993).
   */
  archiveAgent?: (agentId: string) => Promise<boolean>;
  /**
   * Injected Front Desk spawner for rotation tests (#1019). Production falls
   * back to `handleUppidiCreateFrontDesk`, the existing Front Desk primitive.
   */
  spawnFrontDesk?: (input: { title: string; prompt: string }) => Promise<{ id: string; error?: string } | null>;
  /**
   * Enable automatic rotation evaluation during board sweeps (#1019).
   * Defaults off in test mode, matching the other direct-action guards.
   */
  rotationAutoEnabled?: boolean;
}

export interface EnsureOrchestratorInput {
  repo: string;
  provider?: string;
  model?: string;
  mode?: string;
  force?: boolean;
  /**
   * Spawn a replacement without adopting or archiving the incumbent. Used by
   * the rotation protocol's spawn-before-archive ordering (#1019).
   */
  rotation?: boolean;
}

export interface EnsureOrchestratorResult {
  ok: boolean;
  agentId?: string;
  status?: "existing" | "provisioned";
  repo?: string;
  workspaceId?: string;
  cwd?: string;
  /** Machine-readable failure kind so callers can pick an HTTP status (#973). */
  errorCode?: "workspace_not_found" | "spawn_failed" | "cli_disabled" | "model_exhausted";
  /** Model the spawn resolved to, surfaced so intent and reality can be compared (#1011). */
  resolvedModelKey?: string;
  /** Configured entries skipped as dead before the resolved model (#1011). */
  droppedModels?: DroppedModelCandidate[];
  /** Banner record raised on total exhaustion (#1011). */
  modelAlert?: FleetModelAlert;
  /** Whether the SDK create payload carried `featureValues.auto_accept` (#974). */
  autoAcceptApplied?: boolean;
  /**
   * Best-effort scoped pre-grant result for a CLI-spawned orchestrator (#974).
   * `undefined` when no workspace root was known or the grant did not run.
   */
  autoAllow?: { allowed: boolean; permissionId?: string; scope?: string; reason?: string };
  error?: string;
}

export interface QueueEntry {
  id: string;
  key: string;
  msg: string;
  ts: number;
  isSos?: boolean;
}

export interface OrchestratorRecord {
  key: string;
  agentId: string;
  updatedAt?: string | null;
  by?: string | null;
  /** Consecutive board sweeps where the agent was absent from `paseo ls` (#889). */
  missCount?: number;
  /** ISO timestamp of the first absence in the current streak (#889). */
  firstMissAt?: string | null;
  /** Last sweep where the agent was observed alive (#889). */
  lastSeenAt?: string | null;
  /** True once the registration is presumed stale but not yet eligible for pruning (#889). */
  stale?: boolean;
  /** ISO timestamp when the record was first marked stale (#889). */
  staleSince?: string | null;
  /** Human-readable reason for the stale marker (#889). */
  staleReason?: string | null;
  /** Consecutive board sweeps where a complete roster reported the session closed (#1077). */
  closedSweeps?: number;
  /** ISO timestamp of the first closed observation in the current streak (#1077). */
  firstClosedAt?: string | null;
}

/**
 * A destructive fleet-state mutation. Every registration unlink and every
 * front-desk clear appends one of these to a durable JSONL log so the actor
 * can be identified after the fact (#1077).
 */
export type StateMutationAction = "deleteOrchestrator" | "clearAllOrchestrators" | "clearFrontDesk";

export interface StateMutationRecord {
  version: 1;
  /** ISO timestamp the mutation was applied. */
  ts: string;
  action: StateMutationAction;
  /** Explicit call-site label supplied by the caller. */
  source: string;
  /** Agent id attributed to the mutation when known. */
  actor: string | null;
  reason: string | null;
  /** Repo/key targeted, or null for a bulk clear. */
  key: string | null;
  /** Value(s) removed by the mutation, captured before unlink. */
  priorValue: unknown;
  /** Captured call stack; identifies the caller when no explicit actor exists. */
  stack: string | null;
}

/** Options describing who triggered a destructive state mutation (#1077). */
export interface StateMutationOptions {
  source?: string;
  actor?: string | null;
  reason?: string;
}

/**
 * A bounded call-site stack for the audit log. The first two frames are the
 * capture helper and the mutation method itself, so they are dropped.
 */
function captureMutationStack(): string | null {
  const raw = new Error("state-mutation").stack;
  if (!raw) return null;
  const frames = raw.split("\n").slice(2, 8).join("\n").trim();
  return frames || null;
}

export interface FrontDeskRecord {
  version?: number;
  agentId: string;
  updatedAt?: string | null;
  by?: string | null;
}

export function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export { candidateRepoKeys, canonicalRepoKey, normalizeRepoKey };

export function repositoryFromPayload(body: any): any {
  return body?.repository ?? body?.run?.repository ?? {};
}

export function senderFromPayload(body: any): any {
  return body?.sender ?? body?.run?.sender ?? body?.run?.trigger_user ?? {};
}

export function keyFromPayload(body: any): string | null {
  const repo = body?.repository ?? body?.run?.repository;
  if (!repo) return null;
  return (
    normalizeRepoKey(repo.html_url) ||
    normalizeRepoKey(repo.clone_url) ||
    normalizeRepoKey(repo.ssh_url) ||
    (repo.full_name ? `forge.mrs.uppidi.com/${repo.full_name}` : null)
  );
}

export function issueNumberOf(body: any): number | null {
  return body?.issue?.number ?? body?.pull_request?.number ?? null;
}

export function labelNamesOf(body: any): string[] {
  const names: string[] = [];
  if (body?.label?.name) names.push(String(body.label.name));
  for (const l of body?.issue?.labels ?? body?.pull_request?.labels ?? []) {
    if (typeof l === "string") names.push(l);
    else if (l?.name) names.push(String(l.name));
  }
  return names;
}

export function isPingEvent(body: any): boolean {
  return labelNamesOf(body).some((n) => n.toLowerCase().startsWith("ping/"));
}

// Forgejo agents share an account, so sender.login cannot distinguish the
// orchestrator from workers. The standard envelope carries the short Paseo
// agent id, which can be matched to this repository's registered orchestrator.
const AGENT_ENVELOPE_ID_RE = /<sub>\s*🤖[\s\S]*?\(`([^`]+)`\)[\s\S]*?<\/sub>/i;

export function envelopeAgentId(body: any): string | null {
  const comment = body?.comment?.body ?? body?.review?.body;
  if (typeof comment !== "string") return null;
  return AGENT_ENVELOPE_ID_RE.exec(comment)?.[1] ?? null;
}

/**
 * Operator attention is strictly signaled by user attention labels. The
 * canonical scoped form is `attention/2-user`; legacy `attention/user` and
 * `attention:user` spellings are accepted case-insensitively.
 */
export const USER_ATTENTION_LABELS = new Set([
  "attention/2-user",
  "attention/user",
  "attention:user",
]);

export function isUserAttentionLabel(label: string): boolean {
  return USER_ATTENTION_LABELS.has((label ?? "").trim().toLowerCase());
}

export function isFrontDeskEvent(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const label = body.label?.name ?? "";
  if (label === "attention/frontdesk" || isUserAttentionLabel(label)) return true;
  const comment = body.comment?.body ?? body.review?.body;
  if (typeof comment === "string" && /(?:^|\s)\/frontdesk\b/i.test(comment)) return true;
  return false;
}

const SLASH_BYPASS_RE = /(?:^|\s)\/(?:orchestrator|hold|rework|approve|verify|done|close|instruction|agent|sos|stop)\b/i;
const BYPASS_LABELS = new Set(["priority/sos", "priority/0-sos", "flag/stop-work", "attention/frontdesk", "ping/req"]);
const SOS_STATE_LABELS = new Set(["priority/sos", "priority/0-sos", "flag/stop-work"]);

export function isBypassEvent(event: string, body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const label = body.label?.name ?? "";
  const lowerLabel = label.toLowerCase();
  if (
    lowerLabel.startsWith("attention/") ||
    isUserAttentionLabel(lowerLabel) ||
    BYPASS_LABELS.has(lowerLabel) ||
    lowerLabel.startsWith("ping/")
  ) {
    return true;
  }
  const comment = body.comment?.body ?? body.review?.body;
  if (typeof comment === "string" && SLASH_BYPASS_RE.test(comment)) return true;
  return false;
}

/**
 * A label transition can produce several webhook deliveries (e.g. an edit or
 * comment after the label was applied). SOS and stop-work must still bypass the
 * debounce, but only the first delivery for each resulting SOS state should
 * interrupt. Slash commands deliberately remain outside this guard.
 */
export function sosStateOf(event: string, body: any): string | null {
  if (event !== "issues") return null;
  const command = body?.comment?.body ?? body?.review?.body ?? "";
  if (typeof command === "string" && /^\s*\/hold\b/im.test(command)) return null;

  const action = String(body?.action ?? "").toLowerCase();
  const changed = String(body?.label?.name ?? "").toLowerCase();
  const subject = body?.issue ?? body?.pull_request ?? {};
  const labels = new Set(
    (subject?.labels ?? [])
      .map((label: any) => (typeof label === "string" ? label : label?.name))
      .filter(Boolean)
      .map((label: any) => String(label).toLowerCase())
      .filter((label: string) => SOS_STATE_LABELS.has(label)),
  );
  if (SOS_STATE_LABELS.has(changed)) {
    if (action === "unlabeled") labels.delete(changed);
    else if (action === "labeled") labels.add(changed);
  }
  return labels.size > 0 || SOS_STATE_LABELS.has(changed) ? [...labels].sort().join(",") : null;
}

// ---------------------------------------------------------------------------
// Direct-action handlers (#847): in-process label triage and issue close guard.
//
// Ported from the platform reusable workflows
// (.forgejo/workflows/reusable/label-triage.yml and issue-close-guard.yml). The
// hook router already receives the triggering webhook, so these act on the
// Forgejo API directly instead of waiting for a CI runner to pick up the event.
// The pure decision functions below are the single source of truth for the skip
// logic; the async handlers only perform I/O around them.
// ---------------------------------------------------------------------------

/** Shared Forgejo account every autonomous agent acts as. */
export const SHARED_AGENT_ACTOR = "xpufx";

/** The exclusive orchestrator attention signal (canonical numberless, platform#247). */
export const ORCHESTRATOR_ATTENTION_LABEL = "attention/orchestrator";

/** `flag/stop-work` is a hard circuit breaker, including for SOS. */
export const LABEL_TRIAGE_STOP_WORK_LABEL = "flag/stop-work";

/** SOS breaks through completed/ignored terminal states. */
export const SOS_LABEL = "priority/sos";

/**
 * Terminal labels that suppress triage: the ticket is done, deliberately
 * abandoned, or explicitly ignored. `priority/0-SOS` overrides all but
 * `flag/stop-work`, matching the board's emergency precedence.
 */
export const LABEL_TRIAGE_TERMINAL_LABELS: readonly string[] = [
  "flag/wont-do",
  "state/done",
  "state/4-done",
  "attention/ignore",
  "attention/3-ignore",
  "attention/2-ignore",
  "confirmed-done",
];

/** Terminal acceptance labels that permit closure without reopening. */
export const CLOSE_GUARD_ACCEPTED_LABELS: readonly string[] = [
  "state/done",
  "state/4-done",
  "confirmed-done",
];

/** Default close-guard target actor list. */
export const DEFAULT_CLOSE_GUARD_TARGET_ACTORS: readonly string[] = ["xpufx"];

/**
 * The mandatory policy comment posted when the close guard reopens an issue.
 * Kept byte-for-byte in sync with the reusable workflow so operators see the
 * same directive regardless of which path enforced it.
 */
export const CLOSE_GUARD_POLICY_COMMENT = [
  "> [!WARNING]",
  "> **Automated Reopen**: Issue was closed by a targeted autonomous actor and has been reopened per repository governance policy.",
  "",
  "**Policy Directive**:",
  "Autonomous agents and orchestrators must **never** close issues directly. Upon completing implementation and local verification, agents must transition tickets to `state/2-review` or `state/3-verify` with an envelope report and await operator verification. Only the human operator closes issues upon final review (`state/4-done` / `confirmed-done`).",
].join("\n");

/** Labels applied to auto-created CI failure issues (#865). */
export const CI_FAILURE_LABELS: readonly string[] = ["kind/bug", "priority/high", "attention/orchestrator"];

export interface DirectActionDecision {
  act: boolean;
  reason: string;
}

export function normalizeLabelName(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

// Legacy numeric -> canonical numberless, lowercased (platform#247 dual-read).
const LABEL_ALIASES: Readonly<Record<string, string>> = {
  "state/0-triage": "state/triage",
  "state/1-wip": "state/wip",
  "state/2-review": "state/review",
  "state/3-verify": "state/verify",
  "state/4-done": "state/done",
  "attention/0-orchestrator": "attention/orchestrator",
  "attention/1-agent": "attention/agent",
  "attention/2-user": "attention/user",
  "attention/3-ignore": "attention/ignore",
  "priority/0-sos": "priority/sos",
  "priority/1-high": "priority/high",
  "priority/2-normal": "priority/normal",
  "priority/3-low": "priority/low",
  "priority/4-backburner": "priority/backburner",
};

/** Lowercased canonical spelling; legacy numeric folds into numberless. */
export function canonicalLabelName(raw: unknown): string {
  const normalized = normalizeLabelName(raw);
  return LABEL_ALIASES[normalized] ?? normalized;
}

/** Label names from an issue/pull_request payload or a fetched issue body. */
export function labelNamesFromIssue(issue: any): string[] {
  const labels = issue?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l: any) => (typeof l === "string" ? l : l?.name))
    .filter((n: unknown): n is string => typeof n === "string" && n.length > 0);
}

/**
 * Forgejo omits `pull_request` entirely for real issues, so its presence as an
 * object (or non-false value) is authoritative.
 */
export function isPullRequestSubject(subject: any): boolean {
  return subject?.pull_request != null && subject.pull_request !== false;
}

/**
 * Label triage decision (#847). Mirrors the reusable workflow order exactly:
 * shared-actor skip, pull-request skip, stop-work circuit breaker, terminal
 * state skip (unless SOS), then the already-orchestrator no-op.
 */
export function labelTriageDecision(input: {
  actor: string;
  labels: string[];
  isPullRequest: boolean;
  sharedActor?: string;
}): DirectActionDecision {
  const sharedActor = input.sharedActor ?? SHARED_AGENT_ACTOR;
  if (input.actor === sharedActor) {
    return { act: false, reason: `shared actor '${sharedActor}'` };
  }
  if (input.isPullRequest) {
    return { act: false, reason: "pull request activity" };
  }
  const labels = new Set(input.labels.map(canonicalLabelName));
  if (labels.has(canonicalLabelName(LABEL_TRIAGE_STOP_WORK_LABEL))) {
    return { act: false, reason: `${LABEL_TRIAGE_STOP_WORK_LABEL} is set` };
  }
  if (!labels.has(canonicalLabelName(SOS_LABEL))) {
    const terminal = LABEL_TRIAGE_TERMINAL_LABELS.find((l) => labels.has(canonicalLabelName(l)));
    if (terminal) {
      return { act: false, reason: `terminal label ${terminal} is set` };
    }
  }
  if (labels.has(canonicalLabelName(ORCHESTRATOR_ATTENTION_LABEL))) {
    return { act: false, reason: "already assigned to orchestrator" };
  }
  return { act: true, reason: "human activity requires orchestrator attention" };
}

/** Parse a comma-separated or array actor/label list into trimmed entries. */
export function parseTargetActors(
  raw: string | string[] | undefined,
  fallback: readonly string[] = DEFAULT_CLOSE_GUARD_TARGET_ACTORS,
): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const entries = parts.map((p) => p.trim()).filter(Boolean);
  return entries.length > 0 ? entries : [...fallback];
}

/**
 * Close guard decision (#847, #996). A targeted autonomous actor closing an issue
 * is always intercepted and reopened; terminal acceptance labels do not bypass the guard.
 */
export function closeGuardDecision(input: {
  actor: string;
  labels: string[];
  isPullRequest: boolean;
  targetActors?: string[];
  acceptedLabels?: string[];
}): DirectActionDecision {
  const targetActors =
    input.targetActors && input.targetActors.length > 0
      ? input.targetActors
      : [...DEFAULT_CLOSE_GUARD_TARGET_ACTORS];
  if (!targetActors.includes(input.actor)) {
    return { act: false, reason: `actor '${input.actor}' is not a target actor` };
  }
  if (input.isPullRequest) {
    return { act: false, reason: "pull request activity" };
  }
  return { act: true, reason: "targeted actor closed an issue" };
}

// ---------------------------------------------------------------------------
// CI failure issue creation (#865)
//
// The `action_run_failure` webhook carries an ActionPayload whose `run` is the
// completed ActionRun. The pure helpers below extract the failure details and
// build the issue title/body; the async handler only performs I/O around them.
// ---------------------------------------------------------------------------

/** Issue title for an auto-created CI failure ticket (#865). */
export function ciFailureIssueTitle(workflowName: string, repo: string): string {
  return `ci: ${workflowName} failed (${repo})`;
}

export interface CiFailureDetails {
  workflowName: string;
  repo: string;
  runUrl: string;
  conclusion: string;
  failedStep: string | null;
  title: string;
}

/**
 * Extract CI failure details from an `action_run_failure` webhook payload.
 * Returns null when the payload carries no usable run or repository.
 */
export function ciFailureDetailsFromPayload(body: any): CiFailureDetails | null {
  const run = body?.run;
  if (!run || typeof run !== "object") return null;
  const repository = run.repository ?? {};
  const repo =
    typeof repository.full_name === "string" && repository.full_name.trim()
      ? repository.full_name.trim()
      : null;
  if (!repo) return null;
  const workflowName =
    typeof run.title === "string" && run.title.trim()
      ? run.title.trim()
      : run.workflow_id != null && String(run.workflow_id).trim()
        ? String(run.workflow_id).trim()
        : "unknown workflow";
  const runUrl = typeof run.html_url === "string" ? run.html_url.trim() : "";
  const conclusion =
    typeof run.status === "string" && run.status.trim()
      ? run.status.trim()
      : typeof body?.action === "string" && body.action.trim()
        ? body.action.trim()
        : "failure";
  // The ActionPayload does not carry job/step info today; surface a failed
  // step when a future payload revision provides one.
  const failedStep =
    typeof run.failed_step === "string" && run.failed_step.trim() ? run.failed_step.trim() : null;
  return { workflowName, repo, runUrl, conclusion, failedStep, title: ciFailureIssueTitle(workflowName, repo) };
}

/** Issue body for an auto-created CI failure ticket (#865). */
export function formatCiFailureBody(details: CiFailureDetails): string {
  const lines = [
    `CI workflow **${details.workflowName}** failed on \`${details.repo}\`.`,
    "",
    `- Workflow: ${details.workflowName}`,
    `- Repo: ${details.repo}`,
    `- Conclusion: ${details.conclusion}`,
  ];
  if (details.runUrl) lines.push(`- Run: ${details.runUrl}`);
  if (details.failedStep) lines.push(`- Failed step: ${details.failedStep}`);
  lines.push("", "---", "_Created automatically by the fleet hook router (#865)._");
  return lines.join("\n");
}

export interface DirectActionResult {
  acted: boolean;
  reason: string;
  appliedLabel?: string;
  reopened?: boolean;
  commented?: boolean;
  notified?: boolean;
  /** Issue number created by the handler, when it creates one (#865). */
  createdIssue?: number | null;
}

// ---------------------------------------------------------------------------
// Merge-event hook (#1076)
//
// Merges land on `origin/main` only; the primary checkout does not track the
// remote, so a merged plugin fix stays inert until the checkout advances and
// the directory-installed plugin reloads. On a merged `pull_request.closed`
// event the router fast-forwards the mapped checkout, reloads its plugin, and
// announces what changed to Front Desk, the repo orchestrator and a durable log.
// ---------------------------------------------------------------------------

/** Rolling cap on stored merge-event records. */
export const MERGE_EVENT_LOG_MAX = 200;

export interface MergeEventRecord {
  repo: string;
  checkoutPath: string;
  pluginId: string | null;
  timestamp: string;
  fromSha: string;
  toSha: string;
  /** Commit subjects applied across `from..to` (PR/squash titles). */
  titles: string[];
  fastForwarded: boolean;
  alreadyCurrent: boolean;
  reloaded: boolean;
  reloadReason: string;
  newRevision: string;
  status: "fast-forwarded" | "already-current" | "skipped";
  reason: string;
}

export interface MergeEventResult extends DirectActionResult {
  repo?: string;
  checkoutPath?: string;
  status?: MergeEventRecord["status"];
  fromSha?: string;
  toSha?: string;
  titles?: string[];
  fastForwarded?: boolean;
  alreadyCurrent?: boolean;
  reloaded?: boolean;
  record?: MergeEventRecord;
}

/** Read the durable merge-event log; missing or corrupt reads as empty. */
export function readMergeEventRecords(path: string): MergeEventRecord[] {
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8") || "[]");
    return Array.isArray(parsed) ? (parsed as MergeEventRecord[]) : [];
  } catch {
    return [];
  }
}

/** Append one record to the durable merge-event log, capped oldest-first. */
export function appendMergeEventRecord(record: MergeEventRecord, path: string): MergeEventRecord[] {
  const records = readMergeEventRecords(path);
  records.push(record);
  const capped = records.slice(-MERGE_EVENT_LOG_MAX);
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(capped, null, 2), "utf8");
    try {
      renameSync(tempPath, path);
    } catch {
      writeFileSync(path, JSON.stringify(capped, null, 2), "utf8");
      try {
        unlinkSync(tempPath);
      } catch {}
    }
  } catch {
    // A merge-event write must never fail the fast-forward it records.
  }
  return capped;
}

/**
 * Resolve the opt-in binding for a payload repo. Both the payload and the
 * configured keys accept `host/owner/repo`, `owner/repo`, URLs and `.git`.
 */
export function resolveMergeEventHook(
  repo: string | null | undefined,
  hooks: Record<string, MergeEventHook> | null | undefined,
): MergeEventHook | null {
  if (!repo || !hooks) return null;
  const wanted = new Set(candidateRepoKeys(repo).map((k) => k.toLowerCase()));
  if (wanted.size === 0) return null;
  for (const [key, hook] of Object.entries(hooks)) {
    if (!hook || typeof hook.checkoutPath !== "string" || !hook.checkoutPath.trim()) continue;
    for (const candidate of candidateRepoKeys(key)) {
      if (wanted.has(candidate.toLowerCase())) return hook;
    }
  }
  return null;
}

/** Fleet-envelope body announcing one merge-event outcome. Pure. */
export function formatMergeEventNotice(record: MergeEventRecord): string {
  const plugin = record.pluginId ? `plugin \`${record.pluginId}\`` : "no plugin bound";
  const lines: string[] = [];
  if (record.status === "already-current") {
    lines.push(`[Merge Event] ${record.repo} already current`);
    lines.push(`- Checkout: \`${record.checkoutPath}\` (${plugin})`);
    lines.push(`- Time: ${record.timestamp}`);
    lines.push(`- Revision: \`${record.fromSha}\` (nothing new to pull)`);
    return lines.join("\n");
  }
  if (record.status === "skipped") {
    lines.push(`[Merge Event] ${record.repo} checkout not updated`);
    lines.push(`- Checkout: \`${record.checkoutPath}\` (${plugin})`);
    lines.push(`- Time: ${record.timestamp}`);
    lines.push(`- Revision: \`${record.fromSha}\``);
    lines.push(`- Skipped: ${record.reason}`);
    return lines.join("\n");
  }
  const count = record.titles.length;
  lines.push(`[Merge Event] ${record.repo} fast-forwarded`);
  lines.push(`- Checkout: \`${record.checkoutPath}\` (${plugin})`);
  lines.push(`- Time: ${record.timestamp}`);
  lines.push(
    `- Revision: \`${record.fromSha}\` -> \`${record.toSha}\` (${count} commit${count === 1 ? "" : "s"})`,
  );
  lines.push(`- Fast-forward: ${record.fastForwarded ? "ok" : "failed"}`);
  lines.push(`- Plugin reload: ${record.reloaded ? "ok" : record.reloadReason}`);
  if (count > 0) {
    lines.push("- Applied:");
    for (const title of record.titles) lines.push(`  - ${title}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Repository onboarding (#847)
//
// On `repository.created`, seed the new repository with the canonical label
// catalogue from the platform repo and open the standard fleet onboarding
// issue. Label reconciliation is ported from the platform synchronizer
// (scripts/forgejo-label-sync): it creates missing labels and updates changed
// fields, and never deletes labels.
// ---------------------------------------------------------------------------

/** Raw-API path of the canonical label catalogue in the platform repo. */
export const REPO_ONBOARDING_CATALOGUE_PATH =
  "/api/v1/repos/xpufx-org/platform/raw/forgejo/labels/base-v1.json?ref=main";

/** Title of the auto-created onboarding issue. */
export const REPO_ONBOARDING_ISSUE_TITLE =
  "chore: repository fleet onboarding & standard workflow seeding";

/** Labels applied to the onboarding issue. */
export const REPO_ONBOARDING_ISSUE_LABELS: readonly string[] = [
  ORCHESTRATOR_ATTENTION_LABEL,
  "priority/high",
];

/** Body of the auto-created onboarding issue. */
export const REPO_ONBOARDING_ISSUE_BODY = [
  "This repository was created and has been onboarded to the Paseo engineering fleet.",
  "",
  "- The canonical label catalogue (`forgejo/labels/base-v1.json`) has been synchronized from `xpufx-org/platform`.",
  "- Fleet governance is active: label triage, the issue close guard, and watchdog health checks now apply.",
  "",
  "Close this issue once the standard repository workflows have been seeded.",
].join("\n");

export interface RepoOnboardingResult {
  acted: boolean;
  reason: string;
  labelsCreated?: number;
  labelsUpdated?: number;
  issueCreated?: boolean;
  issueNumber?: number;
  issueUrl?: string;
}

export function eventKind(event: string, body: any): string {
  const action = String(body?.action ?? "");
  if (event === "issues" && ["labeled", "unlabeled", "edited", "label_updated"].includes(action)) {
    const names = labelNamesOf(body).map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith("state/") || n.startsWith("priority/") || n.startsWith("flag/"))) {
      return "state-transition";
    }
  }
  return `${event}:${action || "event"}`;
}

// ---------------------------------------------------------------------------
// Declarative wakeup classifier (#1181)
//
// A dormant fleet must not be woken by passive webhook noise: a self-authored
// comment, a close, an unlabel, or a cosmetic re-tag on `format/*`, `size/*`,
// `target/*`. Only genuine operator intent -- a slash command, an action-token
// transfer, or a lifecycle advance -- should break quiescence. WAKEUP_RULES is
// the single declarative table of those signals; `isActionableWakeupEvent` is
// the first-match projection over it, so the router never re-implements the
// policy inline.
// ---------------------------------------------------------------------------

/** Slash-command verbs a human operator types to direct the fleet. */
export const SLASH_COMMAND_RE =
  /(?:^|\s)\/(?:orchestrator|frontdesk|hold|rework|approve|verify|done|close|instruction|agent|sos|stop|sweep|triage|assign|unblock|block)\b/i;

/** The explicit board-sweep request (`/sweep`), which always delivers (#1181). */
export const SLASH_SWEEP_RE = /(?:^|\s)\/sweep\b/i;

/** Action tokens whose transfer wakes the fleet (canonical, lowercased). */
export const WAKEUP_ACTION_LABELS: ReadonlySet<string> = new Set([
  "attention/orchestrator",
  "attention/frontdesk",
  "priority/sos",
  "state/review",
  "review/needed",
  "flag/stop-work",
]);

/** Label namespaces that are cosmetic metadata, never a wakeup. */
export const PASSIVE_LABEL_PREFIXES: readonly string[] = ["format/", "size/", "target/"];

/** `event:action` lifecycle advances that always wake the fleet. */
export const WAKEUP_LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  "issues:opened",
  "issues:reopened",
  "pull_request:opened",
  "pull_request:ready_for_review",
]);

export interface WakeupRule {
  /** Stable rule id, surfaced in logs and tests. */
  id: string;
  /** One-line description of the signal. */
  description: string;
  /** True when a match warrants waking a dormant fleet. */
  actionable: boolean;
  /** Pure predicate over the lowercased event and the raw webhook body. */
  matches: (event: string, body: any) => boolean;
}

/** Comment/review text carried by a webhook body, if any. */
function wakeupCommentText(body: any): string {
  const bodyText = body?.comment?.body ?? body?.review?.body;
  return typeof bodyText === "string" ? bodyText : "";
}

/** `event:action` key, lowercased, against {@link WAKEUP_LIFECYCLE_EVENTS}. */
function wakeupEventAction(event: string, body: any): string {
  return `${event}:${String(body?.action ?? "").toLowerCase()}`;
}

/**
 * Declarative wakeup rules, first match wins. Actionable signals come first so
 * a directive still wakes the fleet even inside an envelope-decorated comment;
 * the passive rules below make the negative space explicit rather than relying
 * on an implicit default.
 */
export const WAKEUP_RULES: readonly WakeupRule[] = [
  {
    id: "operator-slash-command",
    description: "direct operator slash command in a comment or review body",
    actionable: true,
    matches: (_event, body) => SLASH_COMMAND_RE.test(wakeupCommentText(body)),
  },
  {
    id: "action-token-transfer",
    description:
      "labeled with attention/orchestrator, attention/frontdesk, priority/sos, state/review, review/needed or flag/stop-work",
    actionable: true,
    matches: (_event, body) => {
      if (String(body?.action ?? "").toLowerCase() !== "labeled") return false;
      return WAKEUP_ACTION_LABELS.has(canonicalLabelName(body?.label?.name));
    },
  },
  {
    id: "lifecycle-advance",
    description: "ticket lifecycle advance (issues opened/reopened, pull_request opened/ready_for_review)",
    actionable: true,
    matches: (event, body) => WAKEUP_LIFECYCLE_EVENTS.has(wakeupEventAction(event, body)),
  },
  {
    id: "passive-self-stamped-comment",
    description: "fleet-originated (self-stamped) comment",
    actionable: false,
    matches: (event, body) => event === "issue_comment" && envelopeAgentId(body) !== null,
  },
  {
    id: "passive-issue-closed",
    description: "issue closed",
    actionable: false,
    matches: (event, body) =>
      event === "issues" && String(body?.action ?? "").toLowerCase() === "closed",
  },
  {
    id: "passive-unlabeled",
    description: "label removed",
    actionable: false,
    matches: (_event, body) => String(body?.action ?? "").toLowerCase() === "unlabeled",
  },
  {
    id: "passive-metadata-label",
    description: "cosmetic format/*, size/* or target/* relabel",
    actionable: false,
    matches: (_event, body) =>
      PASSIVE_LABEL_PREFIXES.some((prefix) => canonicalLabelName(body?.label?.name).startsWith(prefix)),
  },
  {
    id: "passive-cosmetic-edit",
    description: "body/description edit or other cosmetic mutation",
    actionable: false,
    matches: (_event, body) =>
      ["edited", "label_updated", "synchronize", "synchronized"].includes(
        String(body?.action ?? "").toLowerCase(),
      ),
  },
];

/**
 * Pure wakeup classifier: true when `event`/`body` is an actionable signal that
 * should break fleet dormancy. Unknown events are non-actionable by default, so
 * an unmodelled event never wakes a dormant fleet on its own.
 */
export function isActionableWakeupEvent(event: string, body: any): boolean {
  const ev = String(event ?? "").toLowerCase();
  for (const rule of WAKEUP_RULES) {
    if (rule.matches(ev, body)) return rule.actionable;
  }
  return false;
}

export function eventHash(repoKey: string, issue: number | null, kind: string, actor: string, bodyText?: string): string {
  return `${repoKey}#${issue}|${kind}|${actor}|${bodyText ?? ""}`;
}

export const FORGEJO_DIGEST_PREFIX = "🔔 Forgejo digest";

// Issue #283/#985: fleet-originated prompts carry a JSON signature so models can
// route machine turns. #1003 delivers it as a `fleet_envelope` text attachment
// (the operator sees a subtle pill, the daemon folds it back into the provider
// prompt); the legacy HTML-comment grammar stays for the queue and CLI fallback.
// Process-originated messages (router, watchdog) have no agent id, so `sender`
// carries the process identity.
export const FLEET_ENVELOPE_VERSION = 1;
/** Attachment context kind the client renders as a fleet-provenance pill (#1003). */
export const FLEET_ENVELOPE_CONTEXT_KIND = "fleet_envelope";
/** Pill title shown by the client for {@link FLEET_ENVELOPE_CONTEXT_KIND}. */
export const FLEET_ENVELOPE_TITLE = "Fleet context";
export const ROUTER_SENDER = "forgejo-hook";
export const WATCHDOG_SENDER = "fleet-watchdog";
export const FRONT_DESK_REPO = "frontdesk";
export const FLEET_REPO = "fleet";

export interface FleetEnvelopeFields {
  origin: string;
  sender: string;
  repo: string;
  kind: string;
  ref?: number | string | null;
}

export interface FleetEnvelope {
  fleet: {
    v: number;
    origin: string;
    sender: string;
    repo: string;
    kind: string;
    ref: number | string | null;
  };
}

export function fleetEnvelope({ origin, sender, repo, kind, ref = null }: FleetEnvelopeFields): FleetEnvelope {
  return {
    fleet: {
      v: FLEET_ENVELOPE_VERSION,
      origin,
      sender,
      repo,
      kind,
      ref,
    },
  };
}

export function formatFleetEnvelope(fields: FleetEnvelopeFields): string {
  return `<!-- ${JSON.stringify(fleetEnvelope(fields))} -->`;
}

/** Prepend the fleet signature to an agent/router prompt body. */
export function withFleetEnvelope(fields: FleetEnvelopeFields, message: string): string {
  if (typeof message === "string" && message.startsWith('<!-- {"fleet"')) return message;
  return `${formatFleetEnvelope(fields)}\n${message}`;
}

/**
 * The attachment arm the Paseo client renders as a subtle pill and the daemon
 * folds back into the provider prompt ({@link renderPromptAttachmentAsText}).
 * Derived from the installed send options so a protocol drift fails typecheck.
 */
export type FleetEnvelopeAttachment = Extract<
  NonNullable<PaseoAgentSendOptions["attachments"]>[number],
  { type: "text" }
>;

function fleetEnvelopeAttachmentFromJson(json: string): FleetEnvelopeAttachment {
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: FLEET_ENVELOPE_CONTEXT_KIND,
    title: FLEET_ENVELOPE_TITLE,
    text: json,
  };
}

/**
 * Build the out-of-band form of the fleet envelope (#1003). The envelope stays
 * model-visible via the daemon's prompt-attachment fold, but reaches the
 * operator as an attachment pill instead of raw JSON in the composer bubble.
 */
export function fleetEnvelopeAttachment(fields: FleetEnvelopeFields): FleetEnvelopeAttachment {
  return fleetEnvelopeAttachmentFromJson(JSON.stringify(fleetEnvelope(fields)));
}

const FLEET_ENVELOPE_COMMENT_RE = /<!-- ({"fleet":.*?}) -->\n?/g;

/**
 * Move any legacy in-band `<!-- {"fleet": ...} -->` comments out of a delivered
 * prompt into structured attachments. Kept at the delivery boundary so queued
 * strings (including ones persisted before this change) still parse, while no
 * new fleet turn ships raw JSON in the message text.
 */
export function extractFleetEnvelopeAttachments(message: string): {
  text: string;
  attachments: FleetEnvelopeAttachment[];
} {
  const attachments: FleetEnvelopeAttachment[] = [];
  const text = message.replace(FLEET_ENVELOPE_COMMENT_RE, (match, json: string) => {
    try {
      if (JSON.parse(json)?.fleet) {
        attachments.push(fleetEnvelopeAttachmentFromJson(json));
        return "";
      }
    } catch {
      // Malformed comment: leave it in the body rather than drop a message.
    }
    return match;
  });
  return { text, attachments };
}

/** Re-inline attachments for the CLI fallback, which has no attachment channel. */
function inlineFleetEnvelopeAttachments(text: string, attachments: readonly FleetEnvelopeAttachment[]): string {
  const comments = attachments.map((a) => `<!-- ${a.text} -->`).join("\n");
  return text.length > 0 ? `${comments}\n${text}` : comments;
}

export function routerEnvelope({
  repo,
  kind,
  ref = null,
}: {
  repo: string;
  kind: string;
  ref?: number | string | null;
}): FleetEnvelopeFields {
  return { origin: "router", sender: ROUTER_SENDER, repo, kind, ref };
}

export function watchdogEnvelope({
  repo = FLEET_REPO,
  ref = null,
}: { repo?: string; ref?: number | string | null } = {}): FleetEnvelopeFields {
  return { origin: "watchdog", sender: WATCHDOG_SENDER, repo, kind: "alert", ref };
}

/** Alert repo context for a daemon agent, when resolvable (mirrors the standalone router) (#999). */
export function agentRepoKey(
  agent: (Pick<WatchdogAgent, "id" | "labels"> & { title?: string | null; name?: string | null }) | null | undefined,
  orchRecords: ReadonlyArray<Pick<OrchestratorRecord, "agentId" | "key">>,
): string {
  const record = orchRecords.find((r) => r.agentId === agent?.id);
  if (record?.key) return record.key;

  // Extract repo from Orchestrator title / name (#999)
  for (const raw of [agent?.title, agent?.name]) {
    if (!raw || typeof raw !== "string") continue;
    const match = raw.trim().match(/^Orchestrator\s*[·\-\:\.]\s*(.+)$/i);
    if (match) {
      const cand = match[1].trim();
      const canonical = canonicalRepoKey(cand);
      if (canonical) return canonical;
      const firstWord = cand.split(/\s+/)[0];
      if (firstWord) {
        const firstCanonical = canonicalRepoKey(firstWord);
        if (firstCanonical) return firstCanonical;
        return firstWord;
      }
      return cand;
    }
  }

  return agent?.labels?.repo ?? FLEET_REPO;
}

export interface CoalesceEvent {
  hash: string;
  kind: string;
  msg: string;
  commentBody?: string;
  title?: string;
  stateLabels?: string[];
  url?: string;
}

export interface CoalesceEntry {
  repoKey: string;
  issue: number | null;
  events: CoalesceEvent[];
  firstAt: number;
  timer: NodeJS.Timeout | null;
}

export type CoalesceResult =
  | "direct"
  | "disabled"
  | "bypass"
  | "buffered"
  | "capped"
  | "window-capped"
  | "deduped"
  | "sos-deduped"
  | "suppressed";

export interface CoalesceInput {
  repoKey: string;
  issue: number | null;
  kind: string;
  actor: string;
  commentBody?: string;
  title?: string;
  stateLabels?: string[];
  url?: string;
  msg: string;
  bypass: boolean;
  sosState?: string | null;
}

function latestCommentBody(buffered: CoalesceEvent[]): string {
  for (let i = buffered.length - 1; i >= 0; i--) {
    if (buffered[i].commentBody) return buffered[i].commentBody as string;
  }
  return "";
}

export function formatDigest(repoKey: string, issue: number | null, buffered: CoalesceEvent[]): string {
  const counts: Record<string, number> = {};
  for (const e of buffered) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} x${n}` : k));
  const last = buffered[buffered.length - 1];
  const line = `#${issue} ${last?.title ?? ""} [${(last?.stateLabels ?? []).join(", ")}]`.trim();
  const head = `${FORGEJO_DIGEST_PREFIX} ${repoKey}${line} (${buffered.length} events: ${parts.join(", ")})`;
  const bodyText = latestCommentBody(buffered);
  const withBody = bodyText ? `${head}\nLatest comment: ${bodyText.slice(0, 2000)}` : head;
  const digest = last?.url && !withBody.includes(last.url) ? `${withBody} ${last.url}` : withBody;
  return withFleetEnvelope(
    routerEnvelope({ repo: repoKey, kind: "webhook", ref: issue ?? null }),
    digest,
  );
}

export function bufferKey(repoKey: string, issue: number | null): string {
  return `${repoKey}#${issue ?? "?"}`;
}

export interface WatchdogPermission {
  id?: string;
  requestId?: string;
  title?: string;
  tool?: string;
  name?: string;
  kind?: string;
  description?: string;
  input?: Record<string, unknown>;
}

export interface WatchdogAgent {
  id: string;
  title?: string | null;
  name?: string | null;
  cwd?: string | null;
  status?: string | null;
  role?: string | null;
  provider?: string | null;
  model?: string | null;
  deterministicState?: string | null;
  lastUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalCostUsd?: number;
    contextWindowUsedTokens?: number;
    contextWindowMaxTokens?: number;
  } | null;
  metrics?: {
    contextUsedTokens?: number;
    contextMaxTokens?: number;
    cachedTokens?: number;
    inputTokens?: number;
    costUsd?: number;
    activeTurnStartedAt?: string;
  } | null;
  activeTurn?: { startedAt?: string | null } | null;
  lastError?: string | null;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string | null;
  labels?: Record<string, string> | null;
  pendingPermissions?: WatchdogPermission[] | null;
  archivedAt?: string | null;
  config?: { provider?: string | null; model?: string | null; [key: string]: unknown } | null;
  recentTimeline?: string[] | string | null;
  timeline?: unknown;
}

export interface WatchdogAnomaly {
  type: WatchdogAnomalyType;
  agentId?: string;
  key?: string;
  title?: string | null;
  reason?: string | null;
  error?: string;
  permissions?: WatchdogPermission[];
  attempts?: number;
  queueDepth?: number;
  /** Severity and per-signal details for taxonomy findings (#529). */
  severity?: WatchdogSeverity;
  taxonomy?: WatchdogTaxonomyType[];
  details?: Partial<Record<WatchdogTaxonomyType, string>>;
  recovered?: boolean;
  recoveryActions?: string[];
  /** Parent agent woken by a reactive child-lifecycle pulse (#537). */
  parentAgentId?: string;
  /** Event name of the wake pulse (#537). */
  event?: string;
  /** Required permission request id surfaced in a child wakeup (#537). */
  permissionId?: string;
  /** Target scope/path surfaced in a child wakeup (#537). */
  scope?: string;
}

/** Fleet-level delivery options. `deliverMessage` translates `steer` into the
 * SDK's `activeTurnBehavior`; callers must not pass SDK-only keys here. */
export interface DeliverOptions {
  noWait?: boolean;
  steer?: boolean;
  /** Extra structured prompt attachments; legacy envelope comments are merged in. */
  attachments?: FleetEnvelopeAttachment[];
}

export interface WatchdogAuditOptions {
  now?: number;
  agentMap?: Map<string, WatchdogAgent> | null;
  orchestratorRecords?: OrchestratorRecord[];
  frontDeskId?: string | null;
  deliver?: (targetAgentId: string, msg: string, options?: DeliverOptions) => Promise<boolean>;
  reloadAgent?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Stop a wedged agent (`paseo agent stop <id>`); injectable for tests. */
  stopAgent?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Persisted metadata directory (`~/.paseo/agents`); defaults to the home dir. */
  agentsDir?: string;
  /** Daemon log directory scanned for cancellation timeouts; defaults to `~/.paseo`. */
  daemonLogDir?: string;
  /** Pre-loaded disk metadata; skipped when `agentMap` is injected without it. */
  diskMetadata?: Map<string, WatchdogAgentDisk> | null;
  /** Cancellation-timeout markers keyed by agent id; loaded from logs when omitted. */
  cancellations?: Map<string, number | null> | null;
  /** Recent timeline provider-retry errors keyed by agent id (#890). */
  timelineErrors?: Map<string, string[] | string> | null;
  /** Explicit circuit breaker cache path; defaults to ~/.paseo/model-health.json */
  circuitBreakerPath?: string;
  modelHealthPath?: string;
  /** Perform the 4-step active recovery pipeline (default: true). */
  recover?: boolean;
  steerMessage?: string;
  runningStaleSeconds?: number;
  cancellationRecencySeconds?: number;
  /** Also treat a plain finished idle agent as stalled (aggressive amnesia detection). */
  assumePendingWork?: boolean;
  /**
   * Enable the reactive child-lifecycle wakeup watcher (#537). Defaults to
   * `true` in production; tests inject `false` when exercising unrelated paths.
   */
  childWakeups?: boolean;
  /**
   * Injected allow seam for fleet permission auto-adjudication (#1084).
   * Defaults to `agents.allowPermission` (SDK `respondToPermission`, falling
   * back to `paseo permit allow`); tests inject a stub so no real permit is run.
   */
  allowFleetPermission?: (agentId: string, permissionId: string) => Promise<boolean>;
  /** Durable auto-adjudication JSONL path; defaults to `<stateDir>/permission-decisions.jsonl`. */
  adjudicationLogPath?: string;
  /**
   * Persist per-provider/model rollup receipts on this tick (#560). Defaults to
   * `true` in production and `false` for injected fixtures, so unit tests never
   * touch scoped storage (`~/.paseo/plugin-data/xpufx/uppidi-fleet/metrics.json`).
   */
  metricsRollup?: boolean;
}

export interface WatchdogAuditResult {
  ok: boolean;
  timestamp: number;
  audited: { orchestrators: number; agents: number; queues: number };
  anomalies: WatchdogAnomaly[];
}

// ---------------------------------------------------------------------------
// Fleet agent health taxonomy (#529)
//
// Deterministic, zero-token classifiers ported from
// platform `scripts/agent-health-check`. The pure functions below classify a
// single fused live/disk/log signal set; `runWatchdogAudit` fuses daemon state
// with persisted metadata and applies the conservative recovery plan.
// ---------------------------------------------------------------------------

export const WATCHDOG_TAXONOMY = [
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "IDLE_POST_ERROR_AMNESIA",
  "ZOMBIE_HUNG_TURN",
  "STALE_ERROR_GHOSTING",
  "PROVIDER_QUOTA_EXHAUSTION",
] as const;
export type WatchdogTaxonomyType = (typeof WATCHDOG_TAXONOMY)[number];

export type WatchdogSeverity = "high" | "medium";

export type WatchdogAnomalyType =
  | "AGENT_PERMISSION_REQUIRED"
  | "AGENT_PERMISSION_AUTO_ALLOWED"
  | "AGENT_ATTENTION_REQUIRED"
  | "AGENT_ERROR"
  | "ORCHESTRATOR_MISSING"
  | "ORCHESTRATOR_PROVISIONED"
  | "QUEUE_WEDGED"
  | "QUEUE_UNORCHESTRATED"
  | "CHILD_WAKEUP"
  | WatchdogTaxonomyType;

export const DEFAULT_RUNNING_STALE_SECONDS = 1800;
export const DEFAULT_CANCELLATION_RECENCY_SECONDS = 86400;
export const DEFAULT_WATCHDOG_STEER_MESSAGE =
  "Health check: your previous turn ended without resuming work. " +
  "Sweep the board for triage and continue dispatching pending work.";

export const CANCELLATION_TIMEOUT_MARKER = "cancelagentrun: acknowledged turn still active after timeout";

const TURN_LOCK_MARKERS = [
  "foreground turn is already active",
  "a turn is already active",
  "concurrent turn",
  "turn concurrency",
];
export const QUOTA_MARKERS = [
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
  "subscribe to",
];
const TRANSIENT_MARKERS = [
  "fetch failed",
  "econnreset",
  "etimedout",
  "connection refused",
  "socket hang up",
  "temporarily unavailable",
];
const ATTENTION_STALL_REASONS = ["error", "stalled", "interrupted", "failed"];

export const WATCHDOG_SEVERITIES: Record<WatchdogTaxonomyType, WatchdogSeverity> = {
  TURN_CONCURRENCY_LOCK: "high",
  TURN_CANCELLATION_TIMEOUT: "high",
  ZOMBIE_HUNG_TURN: "high",
  PROVIDER_QUOTA_EXHAUSTION: "high",
  STALE_ERROR_GHOSTING: "medium",
  IDLE_POST_ERROR_AMNESIA: "medium",
};

const STOP_TRIGGERS: ReadonlySet<WatchdogTaxonomyType> = new Set([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
]);
const STEER_TRIGGERS: ReadonlySet<WatchdogTaxonomyType> = new Set([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
  "IDLE_POST_ERROR_AMNESIA",
]);

export function hasMarker(text: unknown, markers: readonly string[]): boolean {
  const lowered = String(text ?? "").toLowerCase();
  return markers.some((marker) => lowered.includes(marker));
}

export function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Taxonomy 1: errored lifecycle carrying a turn-concurrency failure. */
export function detectTurnConcurrencyLock(liveStatus: unknown, lastError: unknown): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "error") return false;
  return hasMarker(lastError, TURN_LOCK_MARKERS);
}

/**
 * Convert an epoch-ms number, epoch-second number, ISO-8601 string, or Date to epoch-ms.
 */
export function coerceEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return num < 100_000_000_000 ? Math.round(num * 1000) : Math.round(num);
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

/**
 * Taxonomy 2: an acknowledged turn was force-canceled after the timeout.
 * The log marker is historical, so it only counts while the lifecycle is not a
 * fresh healthy run (error still wedged, or idle never resumed) and only within
 * the recency upper bound. Recovery is idempotent: a given
 * (agent, cancellation-timestamp) pair yields at most one recovery action.
 *
 * An agent that is idle, has no lastError, and has had activity since the
 * cancellation is treated as recovered, not wedged.
 */
export function detectCancellationTimeout(
  agentId: string,
  cancellations: ReadonlyMap<string, number | string | null> | null | undefined,
  liveStatus: unknown,
  nowEpochMs?: number,
  recencySeconds?: number,
  lastError?: unknown,
  lastActivityAt?: unknown,
  lastHandledCancellationAt?: unknown,
): boolean {
  const status = String(liveStatus ?? "").toLowerCase();
  if (status !== "error" && status !== "idle") return false;
  if (!cancellations || !cancellations.has(agentId)) return false;

  const rawCanceledAt = cancellations.get(agentId);
  const canceledAt = rawCanceledAt != null ? coerceEpochMs(rawCanceledAt) : null;

  if (recencySeconds !== undefined && nowEpochMs !== undefined && canceledAt !== null) {
    if ((nowEpochMs - canceledAt) / 1000 > recencySeconds) {
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

/** Taxonomy 5: healthy/idle lifecycle still carrying a disk lastError. */
export function detectStaleErrorGhosting(liveStatus: unknown, lastError: unknown): boolean {
  if (!["idle", "running"].includes(String(liveStatus ?? "").toLowerCase())) return false;
  return Boolean(String(lastError ?? "").trim());
}

/**
 * Scan recent timeline text or entries for provider retry errors indicating quota exhaustion (#890).
 * Specifically handles lines like: `[Error] provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go`.
 */
export function findProviderRetryQuotaError(recentTimeline: unknown): string | null {
  if (!recentTimeline) return null;
  const lines: string[] = [];
  if (typeof recentTimeline === "string") {
    lines.push(...recentTimeline.split("\n"));
  } else if (Array.isArray(recentTimeline)) {
    for (const item of recentTimeline) {
      if (typeof item === "string") {
        lines.push(item);
      } else if (item && typeof item === "object") {
        const text =
          (item as any).message ??
          (item as any).text ??
          (item as any).detail ??
          (item as any).error ??
          "";
        if (typeof text === "string" && text) {
          lines.push(text);
        }
      }
    }
  }

  for (const line of lines) {
    const raw = String(line ?? "").trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const isRetryOrError =
      lower.includes("provider-retry") ||
      lower.includes("provider retry") ||
      lower.includes("[error]") ||
      lower.includes("error:");
    if (!isRetryOrError) continue;
    if (hasMarker(lower, TRANSIENT_MARKERS)) continue;
    if (hasMarker(lower, QUOTA_MARKERS)) {
      return raw;
    }
  }
  return null;
}

/** Taxonomy 6: fatal provider/quota error (not a recoverable transient). Checks lastError and recent timeline (#890). */
export function detectProviderQuotaExhaustion(lastError: unknown, recentTimeline?: unknown): boolean {
  const text = String(lastError ?? "").toLowerCase();
  if (text && !hasMarker(text, TRANSIENT_MARKERS) && hasMarker(text, QUOTA_MARKERS)) {
    return true;
  }
  if (recentTimeline) {
    return Boolean(findProviderRetryQuotaError(recentTimeline));
  }
  return false;
}

/**
 * Taxonomy 3: idle with a stall signal, no active workers, and pending work.
 * A plain `attentionReason="finished"` is normal completion, so it is not
 * flagged on its own; `assumePendingWork` is the explicit opt-in that also
 * treats a finished idle agent as stalled.
 */
export function detectIdlePostErrorAmnesia(
  liveStatus: unknown,
  lastError: unknown,
  requiresAttention: unknown,
  attentionReason: unknown,
  activeWorkers: number,
  assumePendingWork = false,
): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "idle") return false;
  if (activeWorkers > 0) return false;
  const reason = String(attentionReason ?? "").toLowerCase();
  const stalled =
    ATTENTION_STALL_REASONS.includes(reason) || Boolean(String(lastError ?? "").trim());
  if (stalled) return true;
  return Boolean(assumePendingWork && requiresAttention);
}

/** Taxonomy 4: running lifecycle with no activity inside the stale window. */
export function detectZombieHungTurn(
  liveStatus: unknown,
  lastActivityAt: unknown,
  now: number,
  staleSeconds: number,
): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "running") return false;
  const activity = parseIsoTimestamp(lastActivityAt);
  if (activity === null) return false;
  return (now - activity) / 1000 >= staleSeconds;
}

// ---------------------------------------------------------------------------
// Reactive child-lifecycle wakeups (#537)
//
// The watchdog tick also acts as the bounded, dedup-guarded watcher that wakes
// a parent agent (`paseo send --steer --no-wait <parent>`) when one of its
// labelled children becomes blocked, errors, or finishes. Pure assessment
// helpers live here so tests can exercise the transition rules directly.
// ---------------------------------------------------------------------------

/** Wakeup event names emitted to a parent when its child changes lifecycle (#537). */
export const CHILD_WAKEUP_EVENTS = {
  waiting: "agent.child_waiting_for_input",
  completed: "agent.child_completed",
  errored: "agent.child_errored",
} as const;
export type ChildWakeupKind = keyof typeof CHILD_WAKEUP_EVENTS;

export interface ChildWakeupAssessment {
  kind: ChildWakeupKind;
  event: string;
  /** Per-(agent,event) dedup key consumed by `canWatchdogAlert`. */
  alertKey: string;
  detail?: string;
  permissionId?: string;
  scope?: string;
}

/** Explicit label keys a health canary may carry instead of a probe title (#895). */
const PROBE_AGENT_LABEL_KEYS = ["paseo.probe", "paseo.canary", "probe", "canary"] as const;

/** Titles `paseo run <ping>` derives for the model health canaries (#891/#895). */
const PROBE_AGENT_TITLES = new Set([
  "ping",
  "probe",
  "health probe",
  "health canary",
  "model probe",
]);

/**
 * True when the agent is an orchestrator peer rather than a delegated worker
 * (#895/#999). Two-tier spawn authority means orchestrators are Front Desk's peers
 * even when the daemon stamps a `paseo.parent-agent-id` on them.
 * Standardized on agent title/name matching `/^Orchestrator\s*[·\-\:\.]/i`, `/^Orchestrator\b/i`,
 * or title `"orchestrator"`, with fallback to role/labels.
 */
export function isOrchestratorAgent(
  agent: Pick<WatchdogAgent, "role" | "labels"> & { title?: string | null; name?: string | null },
): boolean {
  if (!agent) return false;
  const title = String(agent.title ?? agent.name ?? "").trim();
  if (
    /^Orchestrator\s*[·\-\:\.]/i.test(title) ||
    /^Orchestrator\b/i.test(title) ||
    title.toLowerCase() === "orchestrator"
  ) {
    return true;
  }
  const labels = agent.labels ?? {};
  const role = String(agent.role ?? labels.role ?? "").trim().toLowerCase();
  if (role === "orchestrator") return true;
  if (String(labels.category ?? "").trim().toLowerCase() === "orchestrator") return true;
  return false;
}

/**
 * True when the agent is a Front Desk agent (#999).
 * Standardized on agent title/name matching `/^Front Desk\b/i`, with fallback to role/labels.
 */
export function isFrontDeskAgent(
  agent: Pick<WatchdogAgent, "role" | "labels"> & { title?: string | null; name?: string | null },
): boolean {
  if (!agent) return false;
  const title = String(agent.title ?? agent.name ?? "").trim();
  if (/^Front Desk\b/i.test(title) || title.toLowerCase() === "frontdesk") {
    return true;
  }
  const labels = agent.labels ?? {};
  const role = String(agent.role ?? labels.role ?? "").trim().toLowerCase();
  if (role === "front-desk" || role === "frontdesk") return true;
  if (String(labels.category ?? "").trim().toLowerCase() === "front-desk") return true;
  return false;
}

/**
 * Tests whether an agent matches an orchestrator identity for the given repository (#987/#993/#999).
 * Matches by title/name matching 'Orchestrator · <repo>' (including forge-qualified repo names),
 * or matching agent cwd against the repo workspace checkout, with fallback to labels.repo.
 */
export function isOrchestratorMatchingRepo(
  agent: Pick<WatchdogAgent, "role" | "labels" | "title" | "name" | "cwd">,
  repo: string,
  workspaceCwd?: string | null,
): boolean {
  if (!agent) return false;
  const target = String(repo ?? "").trim();
  if (!target) return false;
  const canonical = canonicalRepoKey(target) ?? target;

  const candidateMatchesRepo = (cand: string): boolean => {
    const c = String(cand ?? "").trim();
    if (!c) return false;
    if (isRepoMatching(c, target) || isRepoMatching(c, canonical)) return true;
    const cCanonical = canonicalRepoKey(c);
    if (cCanonical) {
      if (
        cCanonical === canonical ||
        isRepoMatching(cCanonical, canonical) ||
        isRepoMatching(cCanonical, target)
      ) {
        return true;
      }
    }
    return false;
  };

  // 1. Check title / name matching 'Orchestrator · <repo>' or 'Orchestrator · <forge>/<repo>'
  for (const raw of [agent.title, agent.name]) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    const match = trimmed.match(/^Orchestrator\s*[·\-\:\.]\s*(.+)$/i);
    if (match) {
      const rest = match[1].trim();
      if (candidateMatchesRepo(rest)) return true;
      const firstWord = rest.split(/\s+/)[0];
      if (firstWord && candidateMatchesRepo(firstWord)) return true;
    }
  }

  // 2. Check workspace cwd matching if available
  const agentCwd = String(agent.cwd ?? "").trim();
  if (agentCwd) {
    const normalizedAgentCwd = resolve(agentCwd).toLowerCase();
    // Compare against explicit workspaceCwd if provided
    if (workspaceCwd) {
      const normalizedTargetCwd = resolve(workspaceCwd).toLowerCase();
      if (normalizedAgentCwd === normalizedTargetCwd) return true;
    } else {
      // Resolve workspace deterministically for target repo
      try {
        const resolved = resolveWorkspaceForRepo(target);
        if (resolved?.cwd) {
          const normalizedTargetCwd = resolve(resolved.cwd).toLowerCase();
          if (normalizedAgentCwd === normalizedTargetCwd) return true;
        }
      } catch {
        // ignore workspace lookup failures
      }
    }
  }

  // 3. Fallback: check labels.repo if it is an orchestrator
  if (isOrchestratorAgent(agent)) {
    const agentRepo = String(agent.labels?.repo ?? "").trim();
    if (agentRepo && candidateMatchesRepo(agentRepo)) {
      return true;
    }
  }

  return false;
}

/**
 * Find all live orchestrator agents running for `repo` (#987/#993/#999).
 * Matches by title/name matching 'Orchestrator · <repo>' or agent cwd matching the repo checkout.
 * Enforces singleton invariant by sorting the newest/authoritative agent first.
 */
export function findLiveOrchestratorAgents(
  repo: string,
  agentMap: ReadonlyMap<string, WatchdogAgent> | null | undefined,
  registeredAgentId?: string | null,
  workspaceCwd?: string | null,
): WatchdogAgent[] {
  if (!agentMap || agentMap.size === 0) return [];
  const target = String(repo ?? "").trim();
  if (!target) return [];

  let targetCwd = workspaceCwd;
  if (!targetCwd) {
    try {
      const resolved = resolveWorkspaceForRepo(target);
      targetCwd = resolved?.cwd ?? null;
    } catch {
      targetCwd = null;
    }
  }

  const matched: WatchdogAgent[] = [];
  const matchedIds = new Set<string>();

  const isLive = (agent: WatchdogAgent | undefined): agent is WatchdogAgent => {
    if (!agent || Boolean(agent.archivedAt)) return false;
    const status = String(agent.status ?? "").toLowerCase();
    return (
      status !== "closed" &&
      status !== "archived" &&
      status !== "terminated" &&
      status !== "error"
    );
  };

  for (const [id, agent] of agentMap) {
    if (!isLive(agent)) continue;

    if (isOrchestratorMatchingRepo(agent, target, targetCwd)) {
      matched.push(agent);
      matchedIds.add(id);
    }
  }

  // If a registered agent id is provided and live, include it if not already matched
  if (registeredAgentId && !matchedIds.has(registeredAgentId)) {
    const regAgent = agentMap.get(registeredAgentId);
    if (isLive(regAgent)) {
      matched.push(regAgent);
      matchedIds.add(registeredAgentId);
    }
  }

  if (matched.length <= 1) return matched;

  // Enforce singleton invariant: sort newest/authoritative first.
  const getTime = (a: WatchdogAgent): number => {
    const ts = a.updatedAt || a.lastActivityAt || a.activeTurn?.startedAt;
    if (!ts) return 0;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  matched.sort((a, b) => {
    const timeDiff = getTime(b) - getTime(a);
    if (timeDiff !== 0) return timeDiff;
    // Prefer registered agent if timestamps tie
    if (registeredAgentId) {
      if (a.id === registeredAgentId) return -1;
      if (b.id === registeredAgentId) return 1;
    }
    // Tie-breaker: stable sort by ID descending (newer IDs / deterministic)
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });

  return matched;
}

/**
 * Find a live orchestrator agent already running for `repo` (#987/#993/#999).
 * Returns the newest/authoritative agent id, or null when no matching live agent exists.
 */
export function findLiveOrchestratorAgent(
  repo: string,
  agentMap: ReadonlyMap<string, WatchdogAgent> | null | undefined,
  registeredAgentId?: string | null,
  workspaceCwd?: string | null,
): string | null {
  const matching = findLiveOrchestratorAgents(repo, agentMap, registeredAgentId, workspaceCwd);
  return matching[0]?.id ?? null;
}

/** Find active Front Desk agents, newest first, for registry recovery. */
export function findLiveFrontDeskAgents(
  agentMap: ReadonlyMap<string, WatchdogAgent> | null | undefined,
): WatchdogAgent[] {
  if (!agentMap || agentMap.size === 0) return [];
  const isLive = (agent: WatchdogAgent): boolean => {
    if (agent.archivedAt) return false;
    const status = String(agent.status ?? "").toLowerCase();
    return !["closed", "archived", "terminated", "error", "failed"].includes(status);
  };
  const matches = Array.from(agentMap.values()).filter((agent) => isLive(agent) && isFrontDeskAgent(agent));
  const getTime = (agent: WatchdogAgent): number => {
    const ts = agent.updatedAt || agent.lastActivityAt || agent.activeTurn?.startedAt;
    if (!ts) return 0;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return matches.sort((a, b) => {
    const timeDiff = getTime(b) - getTime(a);
    return timeDiff !== 0 ? timeDiff : String(b.id).localeCompare(String(a.id));
  });
}

/**
 * True when the agent is a model health canary rather than a worker (#891).
 * Probes run `paseo run ... ping` with no labels, so the derived `ping` title
 * is the convention; an explicit probe label also matches.
 */
export function isProbeAgent(
  agent: Pick<WatchdogAgent, "title" | "name" | "labels">,
): boolean {
  const labels = agent.labels ?? {};
  for (const key of PROBE_AGENT_LABEL_KEYS) {
    const value = labels[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim().toLowerCase();
    if (normalized && normalized !== "false") return true;
  }
  const title = String(agent.title ?? agent.name ?? "").trim().toLowerCase();
  if (!title) return false;
  return PROBE_AGENT_TITLES.has(title) || /^ping\s*[:(]/.test(title);
}

export interface ChildWakeupContext {
  /** Registered Front Desk agent id; the desk is a liaison, never a worker parent (#895). */
  frontDeskId?: string | null;
}

/**
 * True when a parent-labelled agent is a worker whose lifecycle may wake its
 * parent (#537). Orchestrator peers, Front Desk's own children, and health
 * canaries never produce a wake pulse, so the desk is never steered as if it
 * were a worker parent (#895).
 */
export function isChildWakeupCandidate(
  child: WatchdogAgent,
  context: ChildWakeupContext = {},
): boolean {
  if (!child || child.archivedAt) return false;
  const parentId = child.labels?.["paseo.parent-agent-id"]?.trim();
  if (!parentId) return false;
  if (isOrchestratorAgent(child)) return false;
  if (isFrontDeskAgent(child)) return false;
  if (isProbeAgent(child)) return false;
  if (context.frontDeskId && parentId === context.frontDeskId) return false;
  return true;
}

/**
 * Classifies a single child agent into at most one wakeup transition (#537).
 * Blocked (permission / input) wins over error over completion. Benign idle
 * children carrying no attention flag are treated as completed, matching the
 * "child completed" contract. Orchestrator peers, Front Desk's children, and
 * health canaries are excluded (#895).
 */
export function assessChildWakeup(
  agentId: string,
  agent: WatchdogAgent,
  context: ChildWakeupContext = {},
): ChildWakeupAssessment | null {
  if (!agent || agent.archivedAt) return null;
  if (isOrchestratorAgent(agent)) return null;
  if (isFrontDeskAgent(agent)) return null;
  if (isProbeAgent(agent)) return null;
  const parentId = agent.labels?.["paseo.parent-agent-id"]?.trim();
  if (context.frontDeskId && parentId === context.frontDeskId) return null;
  const status = String(agent.status ?? "").toLowerCase();
  const permissions = agent.pendingPermissions ?? [];
  const reason = agent.attentionReason ?? null;
  const requiresAttention = agent.requiresAttention === true;

  // Explicit error status/reason wins, mirroring `deriveDeterministicState`.
  const blocked =
    status !== "error" &&
    reason !== "error" &&
    (permissions.length > 0 ||
      reason === "permission" ||
      (requiresAttention && reason !== "finished"));
  if (blocked) {
    const permission = permissions[0];
    const permissionId = permission?.id || permission?.requestId;
    const scope = permission ? extractPermissionScope(permission) : undefined;
    return {
      kind: "waiting",
      event: CHILD_WAKEUP_EVENTS.waiting,
      alertKey: `child_waiting:${agentId}:${permissionId || reason || "input"}`,
      detail: reason ?? undefined,
      permissionId,
      scope,
    };
  }

  if (status === "error" || reason === "error") {
    return {
      kind: "errored",
      event: CHILD_WAKEUP_EVENTS.errored,
      alertKey: `child_errored:${agentId}`,
    };
  }

  const completedSignal = reason === "finished" || status === "closed" || status === "completed";
  const finishedIdle =
    status === "idle" && !requiresAttention && reason === null && permissions.length === 0;
  if (completedSignal || finishedIdle) {
    return {
      kind: "completed",
      event: CHILD_WAKEUP_EVENTS.completed,
      alertKey: `child_completed:${agentId}`,
    };
  }

  return null;
}

/** Formats the parent-facing wake pulse for one child transition (#537). */
export function formatChildWakeupMessage(
  child: { id: string; title?: string | null; name?: string | null; lastError?: string | null },
  assessment: ChildWakeupAssessment,
): string {
  const label = child.title || child.name || child.id.slice(0, 7);
  const id7 = child.id.slice(0, 7);
  switch (assessment.kind) {
    case "waiting": {
      const action = assessment.detail || "permission request";
      const scope = assessment.scope ? ` scope=${assessment.scope}` : "";
      const cmd = assessment.permissionId
        ? `paseo permit allow ${child.id} ${assessment.permissionId}`
        : `paseo permit allow ${child.id}`;
      return `[Fleet Watchdog] Subagent ${label} (${id7}) is waiting for input: ${action}${scope}. Adjudicate: ${cmd}`;
    }
    case "errored": {
      const err = child.lastError?.trim();
      return `[Fleet Watchdog] Subagent ${label} (${id7}) errored${err ? `: "${err}"` : ""}. Triage or replace it.`;
    }
    case "completed":
    default:
      return `[Fleet Watchdog] Subagent ${label} (${id7}) completed and is idle. Collect its result and dispatch next work.`;
  }
}

/** Persisted agent metadata from `~/.paseo/agents` subdirectories (fusion input). */
export interface WatchdogAgentDisk {
  path?: string;
  cwd?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  attentionTimestamp?: string | null;
  lastActivityAt?: string | null;
  lastHandledCancellationAt?: number | string | null;
  cancellationHandledAt?: number | string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  labels?: Record<string, string> | null;
  provider?: string | null;
  model?: string | null;
  recentTimeline?: string[] | string | null;
}

export function defaultAgentsDir(): string {
  return join(resolveHostHome(), ".paseo", "agents");
}

/** Map agent id -> persisted metadata path under the agents directory subfolders. */
export function discoverAgentMetadataFiles(agentsDir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!agentsDir || !existsSync(agentsDir)) return files;
  try {
    for (const dirent of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const fullDir = join(agentsDir, dirent.name);
      let names: string[];
      try {
        names = readdirSync(fullDir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        if (!files.has(id)) files.set(id, join(fullDir, name));
      }
    }
  } catch {
    // best-effort: an unreadable directory yields no metadata
  }
  return files;
}

export function loadAgentDiskMetadata(agentsDir: string): Map<string, WatchdogAgentDisk> {
  const result = new Map<string, WatchdogAgentDisk>();
  const files = discoverAgentMetadataFiles(agentsDir);
  for (const [id, path] of files) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (!parsed || typeof parsed !== "object") continue;
      result.set(id, {
        path,
        lastStatus: parsed.lastStatus ?? parsed.status ?? null,
        lastError: parsed.lastError ?? null,
        requiresAttention: Boolean(parsed.requiresAttention),
        attentionReason: parsed.attentionReason ?? null,
        attentionTimestamp: parsed.attentionTimestamp ?? null,
        lastActivityAt: parsed.lastActivityAt ?? parsed.updatedAt ?? null,
        lastHandledCancellationAt: parsed.lastHandledCancellationAt ?? parsed.cancellationHandledAt ?? null,
        updatedAt: parsed.updatedAt ?? null,
        labels: parsed.labels && typeof parsed.labels === "object" ? parsed.labels : null,
        archivedAt: parsed.archivedAt ?? null,
        provider: parsed.provider ?? parsed.config?.provider ?? null,
        model: parsed.model ?? parsed.config?.model ?? null,
        recentTimeline: parsed.recentTimeline ?? parsed.timeline ?? null,
      });
    } catch {
      // ignore corrupt metadata files
    }
  }
  return result;
}

/**
 * Atomically remove metadata keys from an agent's persisted JSON file. Missing
 * files and no-op writes return false.
 */
export function clearAgentDiskFields(path: string | null | undefined, keys: readonly string[]): boolean {
  if (!path || !existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (!state || typeof state !== "object") return false;
    let changed = false;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        delete state[key];
        changed = true;
      }
    }
    if (!changed) return false;
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically merge keys into persisted agent metadata. Missing or corrupt
 * files return false; no-op writes return true.
 */
export function setAgentDiskFields(
  path: string | null | undefined,
  fields: Record<string, unknown>,
): boolean {
  if (!path || !existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    let changed = false;
    for (const [key, value] of Object.entries(fields)) {
      if (state[key] !== value) {
        state[key] = value;
        changed = true;
      }
    }
    if (!changed) return true;
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/** Daemon log paths to scan for cancellation timeouts, de-duplicated. */
export function defaultDaemonLogPaths(logDir: string): string[] {
  const candidates = [join(logDir, "daemon.log")];
  try {
    for (const name of readdirSync(logDir)) {
      if (name.endsWith(".log")) candidates.push(join(logDir, name));
    }
  } catch {
    // ignore unreadable log directories
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (existsSync(path)) ordered.push(path);
  }
  return ordered;
}

/**
 * Return agent id -> newest force-cancel epoch-ms found in the daemon logs.
 * A marker with no parseable timestamp maps to `null`.
 */
export function scanCancellationTimeouts(
  logPaths: readonly string[],
  marker: string = CANCELLATION_TIMEOUT_MARKER,
): Map<string, number | null> {
  const latest = new Map<string, number | null>();
  const needle = marker.toLowerCase();
  for (const path of logPaths) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.toLowerCase().includes(needle)) continue;
      let agentId: string | null = null;
      let timestamp: number | null = null;
      try {
        const payload = JSON.parse(line);
        if (payload && typeof payload === "object") {
          agentId = typeof payload.agentId === "string" ? payload.agentId : null;
          if (typeof payload.time === "number") timestamp = payload.time;
        }
      } catch {
        // fall back to a regex extraction for non-JSON log lines
      }
      if (!agentId) {
        const match = /"agentId"\s*:\s*"([0-9a-fA-F-]{8,})"/.exec(line);
        agentId = match?.[1] ?? null;
      }
      if (!agentId) continue;
      const previous = latest.get(agentId);
      if (!latest.has(agentId) || (timestamp !== null && (previous ?? 0) < timestamp)) {
        latest.set(agentId, timestamp);
      }
    }
  }
  return latest;
}

/**
 * Scan daemon log paths for provider retry quota exhaustion lines keyed by agentId (#890).
 */
export function scanTimelineRetryErrors(
  logPaths: readonly string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const path of logPaths) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const lower = line.toLowerCase();
      if (!lower.includes("provider-retry") && !lower.includes("provider retry") && !lower.includes("[error]")) {
        continue;
      }
      if (hasMarker(lower, TRANSIENT_MARKERS) || !hasMarker(lower, QUOTA_MARKERS)) {
        continue;
      }
      let agentId: string | null = null;
      try {
        const payload = JSON.parse(line);
        if (payload && typeof payload === "object") {
          agentId = typeof payload.agentId === "string" ? payload.agentId : null;
        }
      } catch {
        // non-JSON log line
      }
      if (!agentId) {
        const match = /"agentId"\s*:\s*"([^"]+)"/.exec(line);
        agentId = match?.[1] ?? null;
      }
      if (!agentId) continue;
      const list = result.get(agentId) ?? [];
      list.push(line.trim());
      result.set(agentId, list);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Model Health Circuit Breaker & Fallback Chain (#890)
//
// Maintains the shared ~/.paseo/model-health.json circuit breaker cache
// compatible with paseo-probe, and resolves fallback model chains.
// ---------------------------------------------------------------------------

export function defaultCircuitBreakerPath(): string {
  if (process.env.NODE_ENV === "test" && !process.env.MODEL_HEALTH_PATH) {
    return join(os.tmpdir(), `paseo-model-health-test-${process.pid}.json`);
  }
  return process.env.MODEL_HEALTH_PATH || join(resolveHostHome(), ".paseo", "model-health.json");
}

export interface ModelHealthEntry {
  key: string;
  provider: string;
  model: string;
  status: "healthy" | "quota_exhausted" | "rate_limited" | "transient_degradation" | "unconfigured" | "unknown_error";
  error: string | null;
  cooldown_until: number;
  last_checked: number;
  source?: string;
  remaining_cooldown_sec?: number;
  cached?: boolean;
}

export function modelKey(provider: string, model?: string | null): string {
  const p = String(provider ?? "").trim();
  const m = String(model ?? "").trim();
  if (!m) return p;
  if (p && m.startsWith(`${p}/`)) return m;
  return `${p}/${m}`;
}

export function parseModelKey(input: string): { provider: string; model: string } {
  const str = String(input ?? "").trim();
  const slashIdx = str.indexOf("/");
  if (slashIdx === -1) {
    return { provider: str, model: "" };
  }
  return {
    provider: str.slice(0, slashIdx),
    model: str.slice(slashIdx + 1),
  };
}

export function readModelHealthCache(
  cachePath: string = defaultCircuitBreakerPath(),
): Record<string, ModelHealthEntry> {
  try {
    if (!existsSync(cachePath)) return {};
    const content = readFileSync(cachePath, "utf8");
    return JSON.parse(content || "{}");
  } catch {
    return {};
  }
}

export function writeModelHealthCache(
  data: Record<string, ModelHealthEntry>,
  cachePath: string = defaultCircuitBreakerPath(),
): void {
  try {
    const dir = dirname(cachePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${cachePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    try {
      renameSync(tempPath, cachePath);
    } catch {
      writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
      try {
        unlinkSync(tempPath);
      } catch {}
    }
  } catch {
    // Ignore cache write errors
  }
}

export function getCachedModelHealth(
  key: string,
  cachePath: string = defaultCircuitBreakerPath(),
  nowSec: number = Math.floor(Date.now() / 1000),
): ModelHealthEntry | null {
  const cache = readModelHealthCache(cachePath);
  const entry = cache[key];
  if (!entry) return null;
  if (entry.cooldown_until && entry.cooldown_until > nowSec) {
    return {
      ...entry,
      key,
      cached: true,
      remaining_cooldown_sec: entry.cooldown_until - nowSec,
    };
  }
  return null;
}

export function recordModelQuotaFailure(
  provider: string,
  model: string,
  errorText: string,
  cachePath: string = defaultCircuitBreakerPath(),
  cooldownSec: number = 3600,
  nowSec: number = Math.floor(Date.now() / 1000),
): ModelHealthEntry {
  let p = provider?.trim() || "";
  let m = model?.trim() || "";
  if (!p && m.includes("/")) {
    const parsed = parseModelKey(m);
    p = parsed.provider;
    m = parsed.model;
  }
  const key = modelKey(p, m);
  const entry: ModelHealthEntry = {
    key,
    provider: p,
    model: m,
    status: "quota_exhausted",
    error: errorText,
    cooldown_until: nowSec + cooldownSec,
    last_checked: nowSec,
    source: "watchdog_quota_circuit_breaker",
  };
  const cache = readModelHealthCache(cachePath);
  cache[key] = entry;
  writeModelHealthCache(cache, cachePath);
  return entry;
}

/**
 * Build the ordered, de-duplicated orchestrator model candidate list from the
 * explicit request and the configured role fallback chain (#890/#973).
 */
export function orchestratorModelCandidates(
  options: {
    requestedProvider?: string;
    requestedModel?: string;
    fallbackList?: readonly string[];
  } = {},
): string[] {
  let configuredFallbacks: string[] = [];
  if (options.fallbackList && options.fallbackList.length > 0) {
    configuredFallbacks = [...options.fallbackList];
  } else {
    const orchRole = loadSavedRoleModels()?.orchestrator ?? DEFAULT_ROLE_MODELS.orchestrator;
    configuredFallbacks = [orchRole.primaryModel, ...(orchRole.fallbackGroup ?? [])];
  }

  const rawCandidates: string[] = [];
  if (options.requestedModel?.trim()) {
    const reqM = options.requestedModel.trim();
    const reqP = options.requestedProvider?.trim() || "";
    rawCandidates.push(reqP ? modelKey(reqP, reqM) : reqM);
  }
  rawCandidates.push(...configuredFallbacks);

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const c of rawCandidates) {
    const trimmed = c.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      candidates.push(trimmed);
    }
  }
  return candidates;
}

/**
 * Resolve the orchestrator model from explicit inputs or the configured fallback chain,
 * skipping any candidate currently cooling down in the circuit breaker cache (#890) and
 * any candidate whose provider is disabled on the host (#973).
 */
export interface ResolvedOrchestratorModel {
  provider: string;
  model: string;
  key: string;
  /** True when no configured candidate is enabled and healthy (#1011). */
  exhausted?: boolean;
  /** Human-readable reason when `exhausted` is set. */
  error?: string;
  /** The operator-configured chain that was evaluated, in order. */
  configuredChain?: string[];
  /** Configured entries skipped as dead, with the reason (#1011). */
  dropped?: DroppedModelCandidate[];
  /** Live enabled provider ids when the host reported them, else null. */
  availableProviders?: string[] | null;
}

function formatModelResolutionFailure(
  configuredChain: readonly string[],
  dropped: readonly DroppedModelCandidate[],
  availableProviders: ReadonlySet<string> | null | undefined,
): string {
  const dead = dropped.map((d) => `${d.key} (${d.reason})`).join(", ") || "none";
  const live = availableProviders
    ? [...availableProviders].sort().join(", ") || "none"
    : "unknown";
  return (
    "No orchestrator model is satisfiable. " +
    `Configured chain: [${configuredChain.join(", ") || "empty"}]. ` +
    `Dead entries: ${dead}. ` +
    `Live enabled providers: ${live}. ` +
    "Fix the provider set or the configured fallback group; the fleet will not substitute a hidden default (#1011)."
  );
}

export function resolveOrchestratorModel(
  options: {
    requestedProvider?: string;
    requestedModel?: string;
    fallbackList?: readonly string[];
    circuitBreakerPath?: string;
    nowSec?: number;
    /** When provided, candidates whose provider is absent are skipped (#973). */
    availableProviders?: ReadonlySet<string> | null;
  } = {},
): ResolvedOrchestratorModel {
  const circuitBreakerPath =
    options.circuitBreakerPath !== undefined
      ? options.circuitBreakerPath
      : process.env.NODE_ENV === "test" && !process.env.MODEL_HEALTH_PATH
        ? null
        : defaultCircuitBreakerPath();
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);

  const candidates = orchestratorModelCandidates(options);
  const isAvailable = (provider: string): boolean =>
    !options.availableProviders || options.availableProviders.has(provider);
  const availableProviders = options.availableProviders
    ? [...options.availableProviders].sort()
    : null;
  const dropped: DroppedModelCandidate[] = [];

  // #1011: walk the configured primary + fallbackGroup in order and skip every
  // entry that is dead on this host (provider disabled, or circuit-broken by
  // the shared model-health cache). The skipped entries are returned so the
  // spawn path can drop them *visibly*. A hidden default is never appended.
  for (const candidate of candidates) {
    const parsed = parseModelKey(candidate);
    if (!isAvailable(parsed.provider)) {
      dropped.push({
        key: candidate,
        provider: parsed.provider,
        model: parsed.model,
        reason: "provider_disabled",
      });
      continue;
    }
    const health = circuitBreakerPath
      ? getCachedModelHealth(candidate, circuitBreakerPath, nowSec)
      : null;
    if (health && health.status === "quota_exhausted") {
      dropped.push({
        key: candidate,
        provider: parsed.provider,
        model: parsed.model,
        reason: "quota_exhausted",
      });
      continue;
    }
    return {
      key: candidate,
      provider: parsed.provider,
      model: parsed.model,
      configuredChain: candidates,
      dropped,
      availableProviders,
    };
  }

  // Total exhaustion: fail loud. Appending DEFAULT_ROLE_MODELS here was the
  // silent substitution #1011 is fixing, so the resolver returns an explicit
  // failure the spawn path must handle.
  return {
    provider: "",
    model: "",
    key: "",
    exhausted: true,
    error: formatModelResolutionFailure(candidates, dropped, options.availableProviders),
    configuredChain: candidates,
    dropped,
    availableProviders,
  };
}

// ---------------------------------------------------------------------------
// Fleet model-resolution alerts (#1011)
//
// Total chain exhaustion is an operator decision, not a silent fallback: the
// spawn fails loud and the resolver's failure is persisted here as a banner the
// cockpit reads, plus a board issue/comment on the affected repository.
// ---------------------------------------------------------------------------

/** Title of the per-repo issue raised when orchestrator model resolution is stuck (#1011). */
export const MODEL_EXHAUSTION_ALERT_TITLE = "[Fleet Alert] No orchestrator model available";

/** Labels carried by the model-exhaustion issue (#1011). */
export const MODEL_EXHAUSTION_ALERT_LABELS: readonly string[] = [
  ORCHESTRATOR_ATTENTION_LABEL,
  "priority/high",
];

/** Scoped path of the persistent model-alert banner store (#1011). */
export function defaultModelAlertsPath(home: string = resolveHostHome()): string {
  const override = process.env.UPPIDI_FLEET_ALERTS_PATH?.trim();
  if (override) return override;
  return join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "model-alerts.json");
}

export function readModelAlerts(
  path: string = defaultModelAlertsPath(),
): Record<string, FleetModelAlert> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, FleetModelAlert>;
    }
  } catch {
    // Ignore unreadable/corrupt banner state.
  }
  return {};
}

export function writeModelAlerts(
  data: Record<string, FleetModelAlert>,
  path: string = defaultModelAlertsPath(),
): void {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tempPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    try {
      renameSync(tempPath, path);
    } catch {
      writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
      try {
        unlinkSync(tempPath);
      } catch {}
    }
  } catch {
    // A banner write must never fail a spawn.
  }
}

/** Upsert the persistent banner record for `repo` (#1011). */
export function recordModelAlert(
  alert: FleetModelAlert,
  path: string = defaultModelAlertsPath(),
): FleetModelAlert {
  const alerts = readModelAlerts(path);
  alerts[alert.repo] = alert;
  writeModelAlerts(alerts, path);
  return alert;
}

/** Clear the banner for `repo` once its chain resolves again (#1011). */
export function clearModelAlert(
  repo: string,
  path: string = defaultModelAlertsPath(),
): boolean {
  const alerts = readModelAlerts(path);
  const key = canonicalRepoKey(repo) ?? repo;
  if (!alerts[key]) return false;
  delete alerts[key];
  writeModelAlerts(alerts, path);
  return true;
}

/** Render the issue/comment body naming chain, dead entries and live providers (#1011). */
export function formatModelExhaustionAlertBody(alert: FleetModelAlert): string {
  const dead =
    alert.dropped.length > 0
      ? alert.dropped.map((d) => `- \`${d.key}\` — ${d.reason}`).join("\n")
      : "- (none recorded)";
  const live =
    alert.availableProviders && alert.availableProviders.length > 0
      ? alert.availableProviders.map((p) => `\`${p}\``).join(", ")
      : "unknown";
  return [
    "The fleet could not provision an orchestrator because **no configured model is satisfiable**.",
    "",
    `Repository: \`${alert.repo}\``,
    `Role: \`${alert.role}\``,
    `Detected: ${alert.createdAt}`,
    "",
    "**Configured chain (in order):**",
    ...(alert.configuredChain.length > 0
      ? alert.configuredChain.map((c) => `- \`${c}\``)
      : ["- (empty)"]),
    "",
    "**Dead entries:**",
    dead,
    "",
    `**Live enabled providers:** ${live}`,
    "",
    `> ${alert.message}`,
    "",
    "The fleet will not substitute a hidden default. Fix the provider set or the configured fallback group, then the next spawn will re-check the primary.",
    "",
    "---",
    "_Raised automatically by the fleet hook router (#1011)._ ",
  ].join("\n");
}

/** RPC handler for the persistent model-alert banner (#1011). */
export async function handleUppidiFleetAlerts(): Promise<UppidiFleetAlertsOutput> {
  try {
    return { ok: true, alerts: Object.values(readModelAlerts()) };
  } catch (err) {
    return {
      ok: false,
      alerts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** RPC: manually rotate a long-lived role (dashboard/RPC/MCP surface, #1019). */
export async function handleUppidiRotateRole(input: UppidiRotateRoleInput): Promise<UppidiRotateRoleOutput> {
  try {
    const router = getActiveHookRouter();
    if (!router) {
      return { ok: false, role: input.role, triggers: [], errorCode: "not_found", error: "hook router is not running" };
    }
    return await router.rotateRole({
      role: input.role,
      repo: input.repo,
      reason: input.reason,
      force: input.force ?? true,
    });
  } catch (err) {
    return { ok: false, role: input.role, triggers: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** RPC: rotation policy and guardrail state per role. */
export async function handleUppidiRotationStatus(
  input: UppidiRotationStatusInput,
): Promise<UppidiRotationStatusOutput> {
  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    return router.rotationStatus(input);
  } catch (err) {
    return { ok: false, statuses: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** RPC: hot-apply a global or per-repo rotation policy for one role. */
export async function handleUppidiSetRotationPolicy(
  input: UppidiSetRotationPolicyInput,
): Promise<UppidiSetRotationPolicyOutput> {
  try {
    const router = getActiveHookRouter();
    const policy = router
      ? router.setRotationPolicyRole(input.role, input.repo, input.policy)
      : persistRotationPolicyWithoutRouter(input.role, input.repo, input.policy);
    return {
      ok: true,
      policy,
      message: `Updated rotation policy for ${input.role}${input.repo ? ` in ${input.repo}` : ""}`,
    };
  } catch (err) {
    return {
      ok: false,
      policy: DEFAULT_ROTATION_POLICY,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function persistRotationPolicyWithoutRouter(
  role: string,
  repo: string | undefined,
  patch: RotationRolePolicy,
): RotationPolicy {
  const storage = getUppidiFleetSettingsStorage();
  const current = (storage.read() as { rotationPolicy?: RotationPolicy }).rotationPolicy ?? DEFAULT_ROTATION_POLICY;
  const next: RotationPolicy = { roles: { ...(current.roles ?? {}) }, byRepo: { ...(current.byRepo ?? {}) } };
  if (repo) {
    const repoKey = canonicalRepoKey(repo) ?? repo;
    next.byRepo[repoKey] = { ...(next.byRepo[repoKey] ?? {}), [role]: { ...(next.byRepo[repoKey]?.[role] ?? {}), ...patch } };
  } else {
    next.roles[role] = { ...(next.roles[role] ?? {}), ...patch };
  }
  storage.update((prev) => ({ ...prev, rotationPolicy: next }));
  return next;
}

export interface ProviderModeInfo {
  modes: Array<{ id: string; label?: string }>;
  defaultModeId?: string | null;
}

/**
 * Picks the mode to request when creating an agent.
 *
 * Mode-less providers reject any explicit mode (`Invalid mode 'yolo' ...
 * Available modes: (none)`), so an unresolved mode must stay undefined instead
 * of falling back to a hard-coded autonomous default. When the requested mode
 * is not advertised, the provider's default mode is used if it is addressable.
 */
export function resolveProviderSpawnMode(
  info: ProviderModeInfo | null | undefined,
  requestedMode?: string,
): string | undefined {
  const modes = info?.modes ?? [];
  if (modes.length === 0) return undefined;

  const findBy = (value: string) => {
    const needle = value.toLowerCase();
    return (
      modes.find((mode) => mode.id === value) ??
      modes.find((mode) => mode.id.toLowerCase() === needle) ??
      modes.find((mode) => (mode.label ?? "").toLowerCase() === needle)
    );
  };

  const requested = requestedMode?.trim() || "yolo";
  const requestedMatch = findBy(requested);
  if (requestedMatch) return requestedMatch.id;

  const defaultMode = info?.defaultModeId?.trim();
  if (defaultMode) {
    const defaultMatch = findBy(defaultMode);
    if (defaultMatch) return defaultMatch.id;
  }

  return undefined;
}

export interface WatchdogAssessment {
  agentId: string;
  name: string | null;
  liveStatus: string;
  taxonomy: WatchdogTaxonomyType[];
  severities: Partial<Record<WatchdogTaxonomyType, WatchdogSeverity>>;
  details: Partial<Record<WatchdogTaxonomyType, string>>;
  archived: boolean;
  lastError: string;
  requiresAttention: boolean;
  attentionReason: string | null;
  lastActivityAt: string | null;
  lastHandledCancellationAt?: number | string | null;
  cancellationTime?: number | null;
  diskPath: string | null;
  healthy: boolean;
}

/** Fuse live, disk and log signals into a single deterministic assessment. */
export function assessAgentHealth(
  agentId: string,
  live: WatchdogAgent | null | undefined,
  disk: WatchdogAgentDisk | null | undefined,
  now: number,
  options: {
    cancellations?: Map<string, number | null> | null;
    cancellationRecencySeconds?: number;
    activeWorkers?: number;
    assumePendingWork?: boolean;
    runningStaleSeconds?: number;
    recentTimeline?: string | unknown[] | null;
    timelineErrors?: Map<string, string[] | string> | null;
  } = {},
): WatchdogAssessment {
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

  const agentTimeline =
    options.recentTimeline ??
    options.timelineErrors?.get(agentId) ??
    (live as any)?.recentTimeline ??
    (live as any)?.timeline ??
    (disk as any)?.recentTimeline ??
    (disk as any)?.timeline ??
    null;

  const quotaDetected = detectProviderQuotaExhaustion(rawLastError, agentTimeline);
  const timelineQuotaError =
    quotaDetected && !String(rawLastError ?? "").trim()
      ? findProviderRetryQuotaError(agentTimeline)
      : null;
  const lastError = timelineQuotaError ?? rawLastError;

  // An ACP attention error with no disk error is the legacy spelling of a turn
  // lock; keep recovering it even though the status is not literally "error".
  const turnLock =
    detectTurnConcurrencyLock(liveStatus, rawLastError) ||
    (!String(rawLastError ?? "").trim() && requiresAttention && attentionReason === "error");

  const cancellationTimeout = detectCancellationTimeout(
    agentId,
    options.cancellations,
    liveStatus,
    now,
    recencySeconds,
    rawLastError,
    lastActivityAt,
    lastHandledCancellationAt,
  );

  const rawCancellation = options.cancellations?.get(agentId);
  let cancellationTime: number | null = rawCancellation != null ? coerceEpochMs(rawCancellation) : null;
  if (cancellationTime == null && cancellationTimeout) {
    cancellationTime = now;
  }

  const checks: Record<WatchdogTaxonomyType, boolean> = {
    TURN_CONCURRENCY_LOCK: turnLock,
    TURN_CANCELLATION_TIMEOUT: cancellationTimeout,
    IDLE_POST_ERROR_AMNESIA: detectIdlePostErrorAmnesia(
      liveStatus,
      rawLastError,
      requiresAttention,
      attentionReason,
      activeWorkers,
      options.assumePendingWork ?? false,
    ),
    ZOMBIE_HUNG_TURN: detectZombieHungTurn(liveStatus, lastActivityAt, now, staleSeconds),
    STALE_ERROR_GHOSTING: detectStaleErrorGhosting(liveStatus, rawLastError),
    PROVIDER_QUOTA_EXHAUSTION: quotaDetected,
  };

  const taxonomy = archived ? [] : WATCHDOG_TAXONOMY.filter((name) => checks[name]);
  const severities: Partial<Record<WatchdogTaxonomyType, WatchdogSeverity>> = {};
  const details: Partial<Record<WatchdogTaxonomyType, string>> = {};
  for (const name of taxonomy) {
    severities[name] = WATCHDOG_SEVERITIES[name];
    const detail =
      name === "TURN_CANCELLATION_TIMEOUT"
        ? "acknowledged turn still active after timeout"
        : name === "IDLE_POST_ERROR_AMNESIA"
          ? attentionReason ?? undefined
          : name === "ZOMBIE_HUNG_TURN"
            ? lastActivityAt ?? undefined
            : String(lastError || "").trim() || undefined;
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
    healthy: taxonomy.length === 0,
  };
}

export interface WatchdogRecoveryPlan {
  stop: boolean;
  clearError: boolean;
  clearAttention: boolean;
  recordCancellationHandled: boolean;
  steer: boolean;
  steerMessage: string;
  blockedReason: string | null;
}

/**
 * Map detected taxonomy to an ordered, conservative recovery plan.
 * Provider/quota exhaustion is a circuit-breaker condition: the agent is left
 * untouched for an operator because steering a dead/quota-blocked turn only
 * burns more of an exhausted budget.
 */
export function planWatchdogRecovery(
  taxonomy: readonly WatchdogTaxonomyType[],
  steerMessage: string = DEFAULT_WATCHDOG_STEER_MESSAGE,
): WatchdogRecoveryPlan {
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
    blockedReason:
      set.has("PROVIDER_QUOTA_EXHAUSTION") && !stop
        ? "provider/quota exhaustion requires operator circuit-break"
        : null,
  };
}

export const WATCHDOG_ATTENTION_CLEAR_KEYS = ["requiresAttention", "attentionReason", "attentionTimestamp"] as const;

/** Count live running children declaring `agentId` as their parent. */
export function countActiveWorkers(
  agentMap: Map<string, WatchdogAgent>,
  agentId: string,
  diskMetadata?: Map<string, WatchdogAgentDisk> | null,
): number {
  let count = 0;
  for (const [id, agent] of agentMap) {
    if (id === agentId) continue;
    const status = String(agent.status ?? "").toLowerCase();
    if (status !== "running" && status !== "working") continue;
    const labels = agent.labels ?? diskMetadata?.get(id)?.labels ?? null;
    if (labels?.["paseo.parent-agent-id"] === agentId) count += 1;
  }
  return count;
}

/** Consecutive sweeps an absent orchestrator must stay missing before pruning (#889). */
export const ORCHESTRATOR_PRUNE_GRACE_SWEEPS = 3;

/**
 * Rosters assembled without the global `paseo ls --global` source are marked
 * partial: they can omit live agents in other workspaces, so destructive
 * callers must not treat a missing entry as proof of absence (#1068).
 */
const partialAgentMaps = new WeakSet<Map<string, WatchdogAgent>>();

export function isPartialAgentMap(map: Map<string, WatchdogAgent> | null | undefined): boolean {
  return Boolean(map && partialAgentMaps.has(map));
}

export interface StaleOrchestratorMark {
  key: string;
  agentId: string;
  missCount: number;
  reason: string;
}

export interface PruneResult {
  ok: boolean;
  prunedCount: number;
  pruned: Array<{ key: string; agentId: string; reason: string }>;
  /** Closed orchestrator sessions archived and unlinked during this sweep (#973). */
  archived?: Array<{ key: string; agentId: string; reason: string }>;
  /** Registrations kept but flagged stale because the agent was absent (#889). */
  markedStale?: StaleOrchestratorMark[];
  /** Registrations whose agent reappeared and whose stale markers were cleared (#889). */
  recovered?: string[];
  dryRun?: boolean;
  error?: string;
}

export interface HandoffStatus {
  agentId: string | null;
  updatedAt: string | null;
  handoffPath: string;
  summary: string;
}

export interface HandoffResult extends HandoffStatus {
  orchestratorsNotified: number;
}

export interface BoardCandidate {
  number: number;
  title: string;
  labels: string[];
  category: string;
  is_dispatchable: boolean;
  reason: string;
}

export interface BoardCheckResult {
  repo: string;
  ok: boolean;
  candidates: BoardCandidate[];
  staleWipRecovery?: StaleWipResult[];
  error?: string;
}

export interface BoardSweepResult {
  ok: boolean;
  swept: number;
  actionable: Array<{
    repo: string;
    count: number;
    dispatchable: number;
  }>;
  staleWipRecovered?: StaleWipResult[];
  prunedCount: number;
  notified: number;
  /** Repos whose board check failed; surfaced to the caller and Front Desk. */
  errors?: Array<{ repo: string; error: string }>;
  /** Enrolled repos auto-staffed by this sweep because they were unstaffed with pending work (#889). */
  autoEnsured?: Array<{ repo: string; agentId?: string; status?: string; error?: string }>;
  error?: string;
}

/** Append a bare URL so chat linkifiers can pick it up. */
function withUrl(text: string, url: unknown): string {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value || text.includes(value)) return text;
  return `${text} ${value}`;
}

export function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function issueCommentUrl(issue: any, comment: any): string {
  const issueUrl = typeof issue?.html_url === "string" ? issue.html_url.trim() : "";
  return (
    (typeof comment?.html_url === "string" && comment.html_url.trim()) ||
    (issueUrl && comment?.id != null ? `${issueUrl}#issuecomment-${comment.id}` : issueUrl)
  );
}

export function forgejoEnvelope(event: string, body: any): Record<string, unknown> {
  const repository = repositoryFromPayload(body);
  const sender = senderFromPayload(body);
  const name = repository.full_name ?? repository.name ?? "unknown repo";
  const envelope: any = {
    forgejo: {
      version: 1,
      event: String(event ?? "unknown"),
      action: String(body?.action ?? ""),
      repo: name,
      repoUrl: typeof repository.html_url === "string" ? repository.html_url : "",
      sender: sender.login ?? sender.username ?? "unknown",
      subject: { kind: "unknown" },
    },
  };

  if (event === "issues") {
    const issue = body?.issue ?? {};
    envelope.forgejo.subject = {
      kind: "issue",
      number: issue.number ?? null,
      title: issue.title ?? "",
      url: typeof issue.html_url === "string" ? issue.html_url : "",
    };
  } else if (event === "issue_comment") {
    const issue = body?.issue ?? {};
    const comment = body?.comment ?? {};
    envelope.forgejo.subject = {
      kind: "issue_comment",
      number: issue.number ?? null,
      title: issue.title ?? "",
      url: issueCommentUrl(issue, comment),
      commentId: comment.id ?? null,
    };
  } else if (event === "pull_request") {
    const pr = body?.pull_request ?? {};
    envelope.forgejo.subject = {
      kind: "pull_request",
      number: pr.number ?? null,
      title: pr.title ?? "",
      url: typeof pr.html_url === "string" ? pr.html_url : "",
    };
  } else if (event === "push") {
    envelope.forgejo.subject = {
      kind: "push",
      ref: body?.ref ?? "",
      commits: Array.isArray(body?.commits) ? body.commits.length : 0,
    };
  }

  return envelope;
}

export function summarize(event: string, body: any): string {
  const repository = repositoryFromPayload(body);
  const actor = senderFromPayload(body);
  const repo = repository?.full_name ?? "unknown repo";
  const sender = actor?.login ?? actor?.username ?? "unknown";
  const isPing = isPingEvent(body);
  const pingLabel = labelNamesOf(body).find((n) => n.toLowerCase().startsWith("ping/"));
  const head = isPing ? `🔔 Operator Ping [${pingLabel ?? "ping"}]` : "🔔 Forgejo webhook incoming";
  if (event === "ping") return `${head} (ping test) ${repo} (by ${sender})`;
  if (event === "issues") {
    const issue = body?.issue ?? {};
    const action = body?.action ?? "";
    const prefix = isPing ? head : `${head} [issues:${action}]`;
    return withUrl(
      `${prefix} ${repo}#${issue.number ?? "?"} ${issue.title ?? ""} (by ${sender})`.trim(),
      issue.html_url,
    );
  }
  if (event === "issue_comment") {
    const issue = body?.issue ?? {};
    const comment = body?.comment ?? {};
    const action = body?.action ?? "";
    const commentUrl = issueCommentUrl(issue, comment);
    return withUrl(
      `${head} [issue_comment:${action}] ${repo}#${issue.number ?? "?"} ${issue.title ?? ""} (by ${sender})`.trim(),
      commentUrl,
    );
  }
  if (event === "push") {
    const commits = (body?.commits ?? []).length;
    return withUrl(
      `${head} [push] ${repo} ${body?.ref ?? ""} ${commits} commit(s) by ${sender}`,
      repository?.html_url,
    );
  }
  if (event === "pull_request") {
    const pr = body?.pull_request ?? {};
    return withUrl(
      `${head} [pull_request:${body?.action ?? ""}] ${repo}#${pr.number ?? "?"} ${pr.title ?? ""} (by ${sender})`,
      pr.html_url,
    );
  }
  return withUrl(`${head} [${event}] ${repo} (by ${sender})`, repository?.html_url);
}

export function formatWebhookMessage(event: string, body: any): string {
  const env = forgejoEnvelope(event, body);
  const repo = keyFromPayload(body) ?? repositoryFromPayload(body)?.full_name ?? "unknown";
  // The `[forgejo-hook]` machine line stays first and byte-identical so legacy
  // parsers keep working; the fleet signature is prepended to the prompt body.
  const message = withFleetEnvelope(
    routerEnvelope({ repo, kind: "webhook", ref: issueNumberOf(body) }),
    summarize(event, body),
  );
  return `[forgejo-hook] ${JSON.stringify(env)}\n\n${message}`;
}

export function stableId(key: string, msg: string): string {
  const h = createHash("sha256");
  h.update(`${key}:${msg}`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Deterministic fleet-teardown broadcast payload (#872). Pure so tests can
 * assert notify-before-cull ordering without touching I/O. Delivered via the
 * hook-router queue so it survives the subsequent archive/cull.
 */
export function formatFleetTeardownNotice(
  targets: string[],
  counts?: { workers?: number; orchestrators?: number; frontdesk?: number },
): string {
  const sorted = [...targets].sort();
  const scope = sorted.length > 0 ? sorted.join(", ") : "fleet";
  const detail =
    counts !== undefined
      ? ` (${counts.workers ?? 0} workers, ${counts.orchestrators ?? 0} orchestrators, ${counts.frontdesk ?? 0} frontdesk targeted)`
      : "";
  return (
    `[Fleet Teardown] TEARDOWN initiated for ${scope}${detail}. ` +
    `Remaining Front Desk and orchestrator groups: finish in-flight handoffs, ` +
    `do not rely on culled agents, and refresh fleet state. ` +
    `This notice was queued before archiving so it survives teardown.`
  );
}

const MAX_LOG_LINES = 1000;
const logBuffer: string[] = [];

let activeDiskLogger: DiskLogger | null = null;

export function getActiveDiskLogger(): DiskLogger | null {
  return activeDiskLogger;
}

export function setActiveDiskLogger(logger: DiskLogger | null): void {
  activeDiskLogger = logger;
}

export function appendHookLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES);
  }
  if (activeDiskLogger) {
    activeDiskLogger.log(line);
  }
}

export function getHookLogs(lines = 50): string[] {
  const count = Math.max(1, Math.min(lines, MAX_LOG_LINES));
  return logBuffer.slice(-count);
}

export function clearHookLogs(): void {
  logBuffer.length = 0;
}

export class HookRouter {
  public configuredPort: number;
  public configuredHost: string;
  public boundPort = 0;
  public boundHost = "";
  public readonly queueDir: string;
  public readonly stateDir: string;
  public readonly secret?: string;

  private server: PluginServerContext | null;
  private httpServer: HttpServer | null = null;
  private activePaseo: PaseoApi | null = null;
  private queues = new Map<string, QueueEntry[]>();
  private pausedQueues = new Set<string>();
  /** Global pause-all flag (#877): set by `pause('all')`, consulted by `isPaused`. */
  private allQueuesPaused = false;
  private busyQueues = new Set<string>();
  public busyAttempts = new Map<string, number>();
  private droppedCount = new Map<string, number>();
  private draining = new Set<string>();
  private backoffTimers = new Map<string, NodeJS.Timeout>();
  private unsubscribeLifecycle?: () => void;
  private isClosed = false;
  private isHaltedState = false;
  private teardownInProgress = false;
  private startedAt: number | null = null;
  private pausedRepos = new Set<string>();
  private enrolledRepos = new Set<string>();

  public readonly coalesceBuffers = new Map<string, CoalesceEntry>();
  public readonly sosStates = new Map<string, { state: string; transition: number }>();
  public readonly watchdogAlerts = new Map<string, number>();
  public readonly coalesceDisable: boolean;
  public readonly debounceMs: number;
  public readonly coalesceMaxEvents: number;
  public readonly coalesceWindowMaxMs: number;
  public readonly watchdogIntervalMs: number;
  public readonly watchdogBusyThreshold: number;
  public readonly watchdogAlertCooldownMs: number;
  public readonly boardSweepIntervalMs: number;
  public readonly frontDeskThrottleMs: number;
  private lastDeliveryTimes = new Map<string, number>();
  public latestAgentMap: Map<string, WatchdogAgent> | null = null;
  /** Teardown reconciliation state (#872): last teardown stamp + suppressed ids. */
  public lastTeardownAt: number | null = null;
  public lastTeardownTargets: string[] = [];
  private tornDownAgentIds = new Set<string>();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private boardSweepTimer: NodeJS.Timeout | null = null;
  public readonly options?: HookRouterOptions;
  public readonly isTestMode: boolean;
  private inFlightEnsure = new Map<string, Promise<EnsureOrchestratorResult>>();
  /**
   * Per-repo coalescing for auto-ensure (#987): overlapping watchdog, webhook,
   * and board-sweep passes must not each observe "unstaffed" and spawn one.
   */
  private inFlightUnstaffed = new Map<string, Promise<EnsureOrchestratorResult | null>>();
  /** Guard runBoardSweep against overlapping concurrent sweeps (#993). */
  private inFlightBoardSweep = new Map<string, Promise<BoardSweepResult>>();
  /** One rotation per role (per repo for orchestrators) + cooldown clock (#1019). */
  private readonly rotationLock = new RotationLock();
  private readonly lastRotationAt = new Map<string, number>();
  private readonly lastSweepDigests = new Map<string, string>();
  /**
   * Quiescent/dormant mode (#1181): true when no queue backlog, no unstaffed
   * enrolled queue, and no live running turn are observed. Passive webhook
   * noise is dropped while quiescent; an actionable wakeup clears it.
   */
  private quiescent = false;
  /** Last transition in or out of quiescence (#1181). */
  public lastQuiescenceChangeAt: number | null = null;
  /** Per-repo SHA256 digest of the last actionable sweep set (#1181). */
  private readonly lastSweepActionDigests = new Map<string, string>();
  /** Failure signature of the last sweep, for error-state change detection (#1181). */
  private lastSweepErrorSignature = "";
  private rotationAutoEnabled: boolean;
  /** Direct-action guards (#847). */
  public readonly labelTriageEnabled: boolean;
  public readonly closeGuardEnabled: boolean;
  /** CI failure issue creator (#865). */
  public readonly ciFailureEnabled: boolean;
  public readonly repoOnboardingEnabled: boolean;
  public readonly staleWipSweepEnabled: boolean;
  public readonly staleWipHours: number;
  private readonly closeGuardTargetActors: string[];
  private readonly closeGuardAcceptedLabels: string[];
  private readonly sharedAgentActor: string;
  /** Opt-in repo -> checkout/plugin bindings for the merge-event hook (#1076). */
  private mergeEventHooks: Record<string, MergeEventHook>;
  /** Durable append-only merge-event log path (#1076). */
  private readonly mergeEventLogPath: string;
  /** One fast-forward per checkout at a time; guards the primary checkout (#1076). */
  private readonly mergeEventLocks = new Set<string>();
  /** Durable append-only audit receipt store (audits.jsonl, platform#348). */
  public readonly auditsFilePath: string;
  /** Durable append-only audit merge-reconciliation log (platform#348). */
  public readonly auditReconciliationsFilePath: string;
  /** Scoped rotating disk logger (#1115). */
  public readonly diskLogger: DiskLogger;
  public readonly logDir: string;
  public readonly logFilePath: string;

  constructor(server?: PluginServerContext | null, options?: HookRouterOptions) {
    this.server = server ?? null;
    this.options = options;
    const persisted = loadRouterConfig();
    const settings = (() => {
      try {
        return getUppidiFleetSettingsStorage().read();
      } catch {
        return null;
      }
    })();

    const envPort = process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT;
    const isTestMode =
      options?.isTestMode !== undefined
        ? options.isTestMode
        : process.env.NODE_ENV === "test";
    this.isTestMode = Boolean(options?.isTestMode ?? (process.env.NODE_ENV === "test" || isTestMode));

    // Direct-action guards (#847) are opt-in under test so existing webhook
    // fixtures never touch the network; production enables them by default.
    this.labelTriageEnabled = options?.labelTriageEnabled ?? !this.isTestMode;
    this.closeGuardEnabled = options?.closeGuardEnabled ?? !this.isTestMode;
    this.ciFailureEnabled = options?.ciFailureEnabled ?? !this.isTestMode;
    this.repoOnboardingEnabled = options?.repoOnboardingEnabled ?? !this.isTestMode;
    this.staleWipSweepEnabled = options?.staleWipSweepEnabled ?? !this.isTestMode;
    this.rotationAutoEnabled = options?.rotationAutoEnabled ?? !this.isTestMode;
    this.staleWipHours =
      options?.staleWipHours ??
      Number(process.env.STALE_WIP_HOURS ?? ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS);
    this.closeGuardTargetActors = parseTargetActors(options?.closeGuardTargetActors);
    this.closeGuardAcceptedLabels =
      options?.closeGuardAcceptedLabels && options.closeGuardAcceptedLabels.length > 0
        ? options.closeGuardAcceptedLabels.map(normalizeLabelName)
        : [...CLOSE_GUARD_ACCEPTED_LABELS];
    this.sharedAgentActor = options?.sharedActor ?? SHARED_AGENT_ACTOR;
    this.mergeEventHooks = options?.mergeEventHooks ?? persisted.mergeEventHooks ?? {};

    this.configuredPort =
      options?.port !== undefined
        ? options.port
        : isTestMode && envPort !== undefined
          ? Number(envPort)
          : settings?.hookPort !== undefined
            ? settings.hookPort
            : persisted.port !== undefined
              ? persisted.port
              : Number(envPort ?? 8099);
    this.configuredHost =
      options?.host !== undefined
        ? options.host
        : isTestMode
          ? (process.env.FORGE_HOOK_HOST ?? "127.0.0.1")
          : settings?.hookHost !== undefined
            ? settings.hookHost
            : persisted.host !== undefined
              ? persisted.host
              : process.env.FORGE_HOOK_HOST ?? "127.0.0.1";
    this.secret = options?.secret ?? process.env.FORGE_HOOK_SECRET;
    this.activePaseo = options?.paseo ?? (server as any)?.paseo ?? null;

    if (persisted.pausedRepos) {
      for (const r of persisted.pausedRepos) {
        if (r) this.pausedRepos.add(r);
      }
    }
    if (persisted.enrolledRepos) {
      for (const r of persisted.enrolledRepos) {
        if (r) this.enrolledRepos.add(r);
      }
    }

    const home = resolveHostHome();
    const scopedRoot = this.isTestMode
      ? join(os.tmpdir(), `paseo-test-hook-router-${process.pid}`)
      : join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
    this.queueDir = options?.queueDir ?? process.env.HOOK_QUEUE_DIR ?? join(scopedRoot, "queues");
    this.stateDir =
      options?.stateDir ?? process.env.HOOK_STATE_DIR ?? join(scopedRoot, "orchestrators");
    this.mergeEventLogPath =
      options?.mergeEventLogPath ??
      process.env.HOOK_MERGE_EVENT_LOG ??
      join(scopedRoot, "merge-events.json");
    this.auditsFilePath = options?.auditsFilePath ?? process.env.UPPIDI_FLEET_AUDITS_FILE ?? join(dirname(this.stateDir), "audits.jsonl");
    this.auditReconciliationsFilePath =
      options?.auditReconciliationsFilePath ??
      process.env.UPPIDI_FLEET_AUDIT_RECONCILIATIONS_FILE ??
      join(dirname(this.stateDir), "audit-reconciliations.jsonl");

    const explicitLogDir = options?.logDir;
    const explicitLogFilePath = options?.logFilePath;
    this.diskLogger = new DiskLogger({
      ...(explicitLogDir ? { logDir: explicitLogDir } : {}),
      ...(explicitLogFilePath ? { filePath: explicitLogFilePath } : {}),
      maxBytes: options?.logMaxBytes,
      maxFiles: options?.logMaxFiles,
      echoToConsole: true,
      ...(!explicitLogDir && !explicitLogFilePath && this.isTestMode
        ? { storageBaseDir: scopedRoot }
        : {}),
    });
    this.logDir = this.diskLogger.logDir;
    this.logFilePath = this.diskLogger.logFilePath;
    if (!getActiveDiskLogger()) {
      setActiveDiskLogger(this.diskLogger);
    }

    this.coalesceDisable =
      options?.coalesceDisable ??
      (isTestMode ? true : (process.env.HOOK_COALESCE_DISABLE ?? "") === "1");
    this.debounceMs = options?.debounceMs ?? Number(process.env.HOOK_DEBOUNCE_MS ?? 7000);
    this.coalesceMaxEvents = Number(process.env.HOOK_COALESCE_MAX ?? 20);
    this.coalesceWindowMaxMs = Number(process.env.HOOK_COALESCE_WINDOW_MAX_MS ?? 30000);
    this.watchdogIntervalMs =
      options?.watchdogIntervalMs ?? (isTestMode ? 0 : Number(process.env.WATCHDOG_INTERVAL_MS ?? 60000));
    this.watchdogBusyThreshold =
      options?.watchdogBusyThreshold ?? Number(process.env.WATCHDOG_BUSY_THRESHOLD ?? 10);
    this.watchdogAlertCooldownMs =
      options?.watchdogAlertCooldownMs ?? Number(process.env.WATCHDOG_ALERT_COOLDOWN_MS ?? 15 * 60 * 1000);
    this.boardSweepIntervalMs =
      options?.boardSweepIntervalMs ?? (isTestMode ? 0 : Number(process.env.BOARD_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000));
    this.frontDeskThrottleMs =
      options?.frontDeskThrottleMs !== undefined
        ? options.frontDeskThrottleMs
        : isTestMode
          ? 0
          : Number(process.env.HOOK_FRONTDESK_THROTTLE_MS ?? 2000);
    mkdirSync(this.queueDir, { recursive: true });
    mkdirSync(this.stateDir, { recursive: true });
    mkdirSync(this.logDir, { recursive: true });

    this.loadPersistedQueues();
    this.bindLifecycleEvents();
  }

  // -------------------------------------------------------------------------
  // Event coalescing & digest
  // -------------------------------------------------------------------------

  public flushCoalesced(bkey: string): void {
    const entry = this.coalesceBuffers.get(bkey);
    if (!entry || entry.events.length === 0) {
      this.coalesceBuffers.delete(bkey);
      return;
    }
    this.coalesceBuffers.delete(bkey);
    if (entry.timer) clearTimeout(entry.timer);
    const { repoKey, issue, events } = entry;
    if (events.length === 1) {
      this.handleMessage(repoKey, events[0].msg);
      return;
    }
    this.handleMessage(repoKey, formatDigest(repoKey, issue, events));
  }

  public coalesceOrSend(input: CoalesceInput): CoalesceResult {
    const {
      repoKey,
      issue,
      kind,
      actor,
      commentBody,
      title,
      stateLabels,
      url,
      msg,
      bypass,
      sosState = null,
    } = input;

    let directOpts: { id: string } | undefined;
    if (bypass && sosState !== null && issue != null) {
      const key = bufferKey(repoKey, issue);
      const previous = this.sosStates.get(key);
      if (previous?.state === sosState) return "sos-deduped";
      const transition = (previous?.transition ?? 0) + 1;
      this.sosStates.set(key, { state: sosState, transition });
      directOpts = { id: stableId(repoKey, `${msg}\nSOS transition ${transition}`) };
    }

    const isSosEvent = sosState !== null || (typeof commentBody === "string" && /(?:^|\s)\/(?:sos|stop)\b/i.test(commentBody));

    if (this.coalesceDisable || bypass || issue == null) {
      if (!this.coalesceDisable && bypass && issue != null) {
        const bkey = bufferKey(repoKey, issue);
        const entry = this.coalesceBuffers.get(bkey);
        this.handleMessage(repoKey, msg, directOpts?.id, isSosEvent);
        if (entry && entry.events.length > 0) this.flushCoalesced(bkey);
        return "bypass";
      }
      this.handleMessage(repoKey, msg, directOpts?.id, isSosEvent);
      return this.coalesceDisable ? "disabled" : "direct";
    }

    const bkey = bufferKey(repoKey, issue);
    let entry = this.coalesceBuffers.get(bkey);
    if (!entry) {
      entry = { repoKey, issue, events: [], firstAt: Date.now(), timer: null };
      this.coalesceBuffers.set(bkey, entry);
    }
    const hash = eventHash(repoKey, issue, kind, actor, commentBody ?? kind);
    const last = entry.events[entry.events.length - 1];
    if (last && last.hash === hash) return "deduped";
    entry.events.push({ hash, kind, msg, commentBody, title, stateLabels, url });
    if (entry.events.length >= this.coalesceMaxEvents) {
      this.flushCoalesced(bkey);
      return "capped";
    }
    if (Date.now() - entry.firstAt >= this.coalesceWindowMaxMs) {
      this.flushCoalesced(bkey);
      return "window-capped";
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.flushCoalesced(bkey), this.debounceMs);
    entry.timer.unref?.();
    return "buffered";
  }

  private handleMessage(key: string, msg: string, stableIdOverride?: string, isSos = false): QueueEntry {
    return this.enqueue(key, msg, isSos, stableIdOverride);
  }

  public async ingestWebhook(event: string, body: any): Promise<{
    key: string;
    result: CoalesceResult;
    frontDesk: boolean;
    bypass: boolean;
  }> {
    const repoKey = keyFromPayload(body);
    if (!repoKey) {
      throw new Error("Could not derive repository key from payload");
    }
    const isFd = isFrontDeskEvent(body);
    const targetKey = isFd ? "frontdesk" : repoKey;
    if (this.isHaltedState) {
      this.log(`[info] Webhook ingress suppressed for ${targetKey} (hook router halted)`);
      return { key: targetKey, result: "suppressed", frontDesk: isFd, bypass: false };
    }
    const ev = String(event ?? "unknown");
    // Quiescence (#1181): an actionable wakeup clears dormancy immediately; a
    // passive event while quiescent must not wake the fleet at all.
    if (isActionableWakeupEvent(ev, body)) {
      this.exitQuiescence(`actionable webhook ${ev}`);
    } else if (this.quiescent && !isFd) {
      this.log(`[info] Suppressing passive webhook ${ev} for ${targetKey} while fleet is dormant (#1181)`);
      return { key: targetKey, result: "suppressed", frontDesk: false, bypass: false };
    }
    const issue = issueNumberOf(body);
    const actor = senderFromPayload(body)?.login ?? "unknown";
    const kind = eventKind(ev, body);
    const bypass = isFd || isBypassEvent(ev, body);
    const sosState = sosStateOf(ev, body);
    const commentBody = typeof body?.comment?.body === "string" ? body.comment.body : "";
    const subj = body?.issue ?? body?.pull_request ?? {};
    const stateLabels = (subj?.labels ?? [])
      .map((l: any) => (typeof l === "string" ? l : l?.name))
      .filter(Boolean);
    const msg = formatWebhookMessage(ev, body);

    // Direct-action guards (#847) run off the critical path: the delivery is
    // acknowledged immediately and the guard acts asynchronously. Both are
    // disabled by default under test so fixtures never touch the network.
    void this.runDirectActions(ev, body);

    // Explicit operator board sweep (`/sweep`) always delivers, bypassing the
    // delta gate that suppresses unchanged sweeps (#1181).
    if (SLASH_SWEEP_RE.test(commentBody)) {
      void this.runBoardSweep(undefined, undefined, { explicit: true }).catch((err) =>
        this.log(`[warn] Explicit /sweep failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    const orch = isFd ? null : this.readOrchestrator(repoKey);
    if (!isFd && !bypass && ev === "issue_comment") {
      const stampedId = envelopeAgentId(body);
      if (orch && stampedId && stampedId === orch.agentId.slice(0, 7)) {
        this.log(`[info] Suppressing routine self-authored orchestrator comment for ${repoKey}#${issue ?? "?"}`);
        return { key: repoKey, result: "suppressed", frontDesk: false, bypass: false };
      }
    }

    if (isFd) {
      const isSos =
        sosState !== null ||
        (typeof commentBody === "string" && /(?:^|\s)\/(?:sos|stop)\b/i.test(commentBody));
      this.enqueue("frontdesk", msg, isSos);
      return { key: "frontdesk", result: bypass ? "bypass" : "direct", frontDesk: true, bypass };
    }

    const result = this.coalesceOrSend({
      repoKey,
      issue,
      kind,
      actor,
      commentBody: commentBody || kind,
      title: subj?.title ?? "",
      stateLabels,
      url: subj?.html_url ?? "",
      msg,
      bypass,
      sosState,
    });

    // Queue ingress self-heal (#889): an enrolled repo receiving work with no
    // registered orchestrator is staffed without blocking webhook ack.
    if (!orch && !bypass) {
      void this.ensureUnstaffedEnrolledRepo(repoKey, { reason: "webhook ingress" }).catch((err) =>
        this.log(`[warn] Auto-ensure failed for ${repoKey}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    return { key: repoKey, result, frontDesk: false, bypass };
  }

  // -------------------------------------------------------------------------
  // Direct-action guards (#847)
  // -------------------------------------------------------------------------

  /**
   * Dispatch a webhook to the in-process guards. Never rejects: a guard failure
   * must not affect webhook acknowledgement or queue routing.
   */
  public async runDirectActions(event: string, body: any): Promise<void> {
    const ev = String(event ?? "").toLowerCase();
    const action = String(body?.action ?? "").toLowerCase();
    try {
      if (ev === "issues" && action === "opened") {
        await this.runLabelTriage(body);
      } else if (ev === "issue_comment" && action === "created") {
        await this.runLabelTriage(body);
      } else if (ev === "issues" && action === "closed") {
        await this.runCloseGuard(body);
      } else if (ev === "action_run_failure") {
        await this.runCiFailure(body);
      } else if (ev === "repository" && action === "created") {
        await this.runRepoOnboarding(body);
      } else if (ev === "pull_request" && action === "closed" && body?.pull_request?.merged === true) {
        this.reconcileMergeAudit(body);
        await this.runMergeEvent(body);
      }
    } catch (err) {
      this.log(
        `[warn] direct-action handler failed for ${ev}:${action || "event"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Bare `owner/repo` from a webhook payload (API path form). */
  private bareRepoFromPayload(body: any): string | null {
    const repository = repositoryFromPayload(body);
    const fullName = typeof repository?.full_name === "string" ? repository.full_name.trim() : "";
    if (fullName.includes("/")) return fullName;
    const key = keyFromPayload(body);
    if (!key) return null;
    const parts = key.split("/").filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join("/") : null;
  }

  private actorFromPayload(body: any): string {
    const sender = senderFromPayload(body);
    const login = sender?.login ?? sender?.username;
    return typeof login === "string" ? login : "";
  }

  // -------------------------------------------------------------------------
  // Merge-event hook (#1076)
  // -------------------------------------------------------------------------

  /** Configured merge-event bindings (copy). Empty means disabled. */
  public getMergeEventHooks(): Record<string, MergeEventHook> {
    return { ...this.mergeEventHooks };
  }

  /** Persist an opt-in checkout/plugin binding for `repo`. */
  public setMergeEventHook(repo: string, hook: MergeEventHook): Record<string, MergeEventHook> {
    const key = canonicalRepoKey(repo) ?? repo.trim();
    this.mergeEventHooks = { ...this.mergeEventHooks, [key]: hook };
    saveRouterConfig({ mergeEventHooks: this.mergeEventHooks });
    return this.getMergeEventHooks();
  }

  /** Remove any binding that resolves to `repo`. */
  public removeMergeEventHook(repo: string): Record<string, MergeEventHook> {
    const wanted = new Set(candidateRepoKeys(repo).map((k) => k.toLowerCase()));
    const next: Record<string, MergeEventHook> = {};
    for (const [key, hook] of Object.entries(this.mergeEventHooks)) {
      const matches = candidateRepoKeys(key).some((candidate) => wanted.has(candidate.toLowerCase()));
      if (!matches) next[key] = hook;
    }
    this.mergeEventHooks = next;
    saveRouterConfig({ mergeEventHooks: this.mergeEventHooks });
    return this.getMergeEventHooks();
  }

  /** Expand `~` and resolve a configured checkout path. */
  private resolveCheckoutPath(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === "~") return resolveHostHome();
    if (trimmed.startsWith("~/")) return join(resolveHostHome(), trimmed.slice(2));
    return resolve(trimmed);
  }

  private async gitExec(
    args: string[],
    cwd: string,
  ): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
    try {
      const res = await execFileAsync("git", args, { cwd, timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
      return { ok: true, code: 0, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
    } catch (err: any) {
      return {
        ok: false,
        code: typeof err?.code === "number" ? err.code : 1,
        stdout: String(err?.stdout ?? ""),
        stderr: String(err?.stderr ?? err?.message ?? err),
      };
    }
  }

  private async gitIsAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean | null> {
    const res = await this.gitExec(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    if (res.ok) return true;
    if (res.code === 1) return false;
    return null;
  }

  private async reloadMergeEventPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await execFileAsync("paseo", ["plugin", "reload", pluginId], { timeout: 30000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Fleet-envelope notice to Front Desk and the repo orchestrator, plus queue durability. */
  private async announceMergeEvent(repo: string, record: MergeEventRecord): Promise<void> {
    const message = withFleetEnvelope(
      routerEnvelope({ repo, kind: "merge-event" }),
      formatMergeEventNotice(record),
    );
    const targets: Array<{ key: string; agentId: string | null }> = [
      { key: "frontdesk", agentId: this.readFrontDesk()?.agentId ?? null },
    ];
    const orch = this.readOrchestrator(repo);
    targets.push(
      orch?.agentId
        ? { key: orch.key ?? repo, agentId: orch.agentId }
        : { key: canonicalRepoKey(repo) ?? repo, agentId: null },
    );
    for (const target of targets) {
      try {
        this.enqueue(target.key, message, false);
      } catch (err) {
        this.log(
          `[warn] merge-event notice enqueue failed for ${target.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (target.agentId) {
        try {
          await this.deliverMessage(target.agentId, message, { noWait: true, steer: true });
        } catch (err) {
          this.log(
            `[warn] merge-event notice delivery failed for ${target.agentId.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private skipMergeEventRecord(
    repo: string,
    checkoutPath: string,
    pluginId: string | null,
    timestamp: string,
    fromSha: string,
    reason: string,
  ): MergeEventRecord {
    return {
      repo,
      checkoutPath,
      pluginId,
      timestamp,
      fromSha,
      toSha: fromSha,
      titles: [],
      fastForwarded: false,
      alreadyCurrent: false,
      reloaded: false,
      reloadReason: reason,
      newRevision: fromSha,
      status: "skipped",
      reason,
    };
  }

  // -------------------------------------------------------------------------
  // Audit merge reconciliation (platform#348 Phase A / #1172)
  // -------------------------------------------------------------------------

  /**
   * Tags an observed `pull_request.closed` merge as `audited` or
   * `direct_or_adhoc` by matching the merged commit SHA against stored audit
   * receipts, and appends the reconciliation to the durable log. Never blocks
   * the merge (advisory by design) and never throws: a failed append must not
   * take the webhook ack down with it.
   */
  public reconcileMergeAudit(body: any): AuditMergeReconciliation {
    const now = new Date().toISOString();
    const repo = keyFromPayload(body) ?? this.bareRepoFromPayload(body);
    const pr = body?.pull_request?.number;
    const headCommit =
      body?.pull_request?.merge_commit_sha ||
      body?.pull_request?.head?.sha ||
      body?.pull_request?.target_commitish?.sha ||
      body?.pull_request?.sha;

    if (!repo || typeof pr !== "number" || typeof headCommit !== "string" || !headCommit) {
      return {
        v: 1,
        repo: repo ? canonicalRepoKey(repo) ?? repo : "",
        pr: typeof pr === "number" ? pr : 0,
        headCommit: typeof headCommit === "string" ? headCommit : "",
        mergedAt: now,
        status: "direct_or_adhoc" as const,
      };
    }

    let receipt: Awaited<ReturnType<typeof findAuditReceipt>>;
    try {
      receipt = findAuditReceipt(
        { repo, pr, commit: headCommit },
        { filePath: this.auditsFilePath },
      );
    } catch (err) {
      // An unreadable store must not take the webhook ack down: fall through
      // and record the merge as direct_or_adhoc.
      this.log(`[warn] audit receipt lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      receipt = undefined;
    }
    const status = receipt ? ("audited" as const) : ("direct_or_adhoc" as const);
    const record: AuditMergeReconciliation = {
      v: 1,
      repo: canonicalRepoKey(repo) ?? repo,
      pr,
      headCommit,
      mergedAt: now,
      status,
      ...(receipt ? { auditId: receipt.auditId, verdict: receipt.verdict } : {}),
    };
    const outcome = appendAuditReconciliation(record, {
      reconciliationsPath: this.auditReconciliationsFilePath,
    });
    this.log(
      `[info] audit reconciliation ${status} for ${record.repo}#${record.pr} (${headCommit.slice(0, 7)})${
        outcome.ok ? "" : `, append failed: ${outcome.error}`
      }`,
    );
    return record;
  }

  /**
   * Fast-forward a mapped checkout on a merged pull request, reload its plugin,
   * and announce the result. Skips (and reports) a dirty, divergent or
   * unreachable checkout; never rewrites history (`--ff-only`).
   */
  public async runMergeEvent(body: any): Promise<MergeEventResult> {
    const repo = keyFromPayload(body) ?? this.bareRepoFromPayload(body);
    if (!repo) return { acted: false, reason: "missing repository in payload" };
    const hook = resolveMergeEventHook(repo, this.mergeEventHooks);
    if (!hook) return { acted: false, reason: `no merge-event mapping for ${repo}` };
    const checkoutPath = this.resolveCheckoutPath(hook.checkoutPath);
    if (this.mergeEventLocks.has(checkoutPath)) {
      return { acted: false, reason: `merge event already in progress for ${checkoutPath}` };
    }
    this.mergeEventLocks.add(checkoutPath);
    try {
      return await this.executeMergeEvent(repo, checkoutPath, hook);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log(`[warn] merge event failed for ${repo} (${checkoutPath}): ${reason}`);
      return { acted: false, reason: `merge event failed: ${reason}` };
    } finally {
      this.mergeEventLocks.delete(checkoutPath);
    }
  }

  private async executeMergeEvent(
    repo: string,
    checkoutPath: string,
    hook: MergeEventHook,
  ): Promise<MergeEventResult> {
    const pluginId = hook.pluginId?.trim() || null;
    const timestamp = new Date().toISOString();
    const repoKey = canonicalRepoKey(repo) ?? repo;

    const finish = async (record: MergeEventRecord, acted: boolean): Promise<MergeEventResult> => {
      appendMergeEventRecord(record, this.mergeEventLogPath);
      await this.announceMergeEvent(repoKey, record);
      this.log(
        `[info] merge event ${record.status} for ${repoKey}: ${record.fromSha} -> ${record.toSha} (${record.reason})`,
      );
      return {
        acted,
        reason: record.reason,
        repo: repoKey,
        checkoutPath,
        status: record.status,
        fromSha: record.fromSha,
        toSha: record.toSha,
        titles: record.titles,
        fastForwarded: record.fastForwarded,
        alreadyCurrent: record.alreadyCurrent,
        reloaded: record.reloaded,
        record,
      };
    };

    const head = await this.gitExec(["rev-parse", "HEAD"], checkoutPath);
    if (!head.ok || !head.stdout.trim()) {
      const detail = head.stderr.trim() || `exit ${head.code}`;
      return finish(
        this.skipMergeEventRecord(repoKey, checkoutPath, pluginId, timestamp, "", `git rev-parse HEAD failed: ${detail}`),
        false,
      );
    }
    const fromFull = head.stdout.trim();
    const shortFrom = fromFull.slice(0, 7);

    const status = await this.gitExec(["status", "--porcelain"], checkoutPath);
    if (!status.ok) {
      const detail = status.stderr.trim() || `exit ${status.code}`;
      return finish(
        this.skipMergeEventRecord(repoKey, checkoutPath, pluginId, timestamp, shortFrom, `git status failed: ${detail}`),
        false,
      );
    }
    if (status.stdout.trim()) {
      const files = status.stdout.trim().split("\n").slice(0, 5).join(", ");
      return finish(
        this.skipMergeEventRecord(
          repoKey,
          checkoutPath,
          pluginId,
          timestamp,
          shortFrom,
          `working tree dirty; refusing to fast-forward (${files})`,
        ),
        false,
      );
    }

    const fetch = await this.gitExec(["fetch", "origin"], checkoutPath);
    if (!fetch.ok) {
      const detail = fetch.stderr.trim() || `exit ${fetch.code}`;
      return finish(
        this.skipMergeEventRecord(
          repoKey,
          checkoutPath,
          pluginId,
          timestamp,
          shortFrom,
          `git fetch failed: ${detail}`,
        ),
        false,
      );
    }

    const canFastForward = await this.gitIsAncestor("HEAD", "origin/main", checkoutPath);
    const remoteAncestor = await this.gitIsAncestor("origin/main", "HEAD", checkoutPath);
    if (canFastForward === null || remoteAncestor === null) {
      return finish(
        this.skipMergeEventRecord(
          repoKey,
          checkoutPath,
          pluginId,
          timestamp,
          shortFrom,
          "could not compare HEAD with origin/main",
        ),
        false,
      );
    }
    if (!canFastForward && remoteAncestor) {
      const record: MergeEventRecord = {
        repo: repoKey,
        checkoutPath,
        pluginId,
        timestamp,
        fromSha: shortFrom,
        toSha: shortFrom,
        titles: [],
        fastForwarded: false,
        alreadyCurrent: true,
        reloaded: false,
        reloadReason: "already current",
        newRevision: shortFrom,
        status: "already-current",
        reason: "already current",
      };
      return finish(record, false);
    }
    if (!canFastForward && !remoteAncestor) {
      return finish(
        this.skipMergeEventRecord(
          repoKey,
          checkoutPath,
          pluginId,
          timestamp,
          shortFrom,
          "checkout has diverged from origin/main; refusing to merge",
        ),
        false,
      );
    }

    const merge = await this.gitExec(["merge", "--ff-only", "origin/main"], checkoutPath);
    if (!merge.ok) {
      const detail = merge.stderr.trim() || `exit ${merge.code}`;
      return finish(
        this.skipMergeEventRecord(
          repoKey,
          checkoutPath,
          pluginId,
          timestamp,
          shortFrom,
          `git merge --ff-only failed: ${detail}`,
        ),
        false,
      );
    }

    const newHead = await this.gitExec(["rev-parse", "HEAD"], checkoutPath);
    const toFull = newHead.ok && newHead.stdout.trim() ? newHead.stdout.trim() : fromFull;
    const shortTo = toFull.slice(0, 7);
    const alreadyCurrent = fromFull === toFull;

    let titles: string[] = [];
    if (!alreadyCurrent) {
      const log = await this.gitExec(["log", "--reverse", "--format=%s", `${fromFull}..${toFull}`], checkoutPath);
      titles = log.ok
        ? log.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        : [];
    }

    let reloaded = false;
    let reloadReason = pluginId ? "not run" : "no plugin bound";
    if (alreadyCurrent) {
      reloadReason = "already current";
    } else if (pluginId) {
      const reload = await this.reloadMergeEventPlugin(pluginId);
      reloaded = reload.ok;
      reloadReason = reload.ok ? "ok" : `failed: ${reload.error}`;
    }

    const record: MergeEventRecord = {
      repo: repoKey,
      checkoutPath,
      pluginId,
      timestamp,
      fromSha: shortFrom,
      toSha: shortTo,
      titles,
      fastForwarded: !alreadyCurrent,
      alreadyCurrent,
      reloaded,
      reloadReason,
      newRevision: shortTo,
      status: alreadyCurrent ? "already-current" : "fast-forwarded",
      reason: alreadyCurrent
        ? "already current"
        : `${titles.length} commit(s) applied; reload ${reloadReason}`,
    };
    return finish(record, true);
  }

  /**
   * In-process port of the reusable label-triage workflow: ensure human issue
   * activity is routed to `attention/0-orchestrator`.
   */
  public async runLabelTriage(body: any): Promise<DirectActionResult> {
    if (!this.labelTriageEnabled) {
      return { acted: false, reason: "label triage disabled" };
    }
    const actor = this.actorFromPayload(body);
    if (actor === this.sharedAgentActor) {
      return { acted: false, reason: `shared actor '${this.sharedAgentActor}'` };
    }
    const repo = this.bareRepoFromPayload(body);
    const issueNumber = issueNumberOf(body);
    if (!repo || issueNumber == null) {
      return { acted: false, reason: "missing repo or issue number" };
    }

    const host = resolveForgejoHost();
    const token = await this.resolveApiToken(host);
    const issueRes = await forgejoApiGet<any>(`/api/v1/repos/${repo}/issues/${issueNumber}`, { host, token });
    if (issueRes.outcome !== "ok") {
      const detail = issueRes.error;
      this.log(`[warn] label triage: could not read ${repo}#${issueNumber}: ${detail}`);
      return { acted: false, reason: `issue fetch failed: ${detail}` };
    }
    const issue = issueRes.data;
    const decision = labelTriageDecision({
      actor,
      labels: labelNamesFromIssue(issue),
      isPullRequest: isPullRequestSubject(issue),
      sharedActor: this.sharedAgentActor,
    });
    if (!decision.act) {
      return { acted: false, reason: decision.reason };
    }

    const write = await forgejoApiRequest<any>(
      "POST",
      `/api/v1/repos/${repo}/issues/${issueNumber}/labels`,
      { labels: [ORCHESTRATOR_ATTENTION_LABEL] },
      { host, token },
    );
    if (write.outcome !== "ok") {
      const detail = write.error;
      this.log(`[warn] label triage: failed to apply ${ORCHESTRATOR_ATTENTION_LABEL} to ${repo}#${issueNumber}: ${detail}`);
      return { acted: false, reason: `label apply failed: ${detail}` };
    }
    this.log(
      `[info] label triage: applied ${ORCHESTRATOR_ATTENTION_LABEL} to ${repo}#${issueNumber} (actor '${actor}')`,
    );
    return { acted: true, reason: decision.reason, appliedLabel: ORCHESTRATOR_ATTENTION_LABEL };
  }

  /**
   * In-process port of the reusable issue-close-guard workflow: reopen an issue
   * closed by a targeted autonomous actor, post the policy comment, and notify
   * the fleet through the normal hook-router queue.
   */
  public async runCloseGuard(body: any): Promise<DirectActionResult> {
    if (!this.closeGuardEnabled) {
      return { acted: false, reason: "close guard disabled" };
    }
    const actor = this.actorFromPayload(body);
    if (!this.closeGuardTargetActors.includes(actor)) {
      return { acted: false, reason: `actor '${actor}' is not a target actor` };
    }
    const repo = this.bareRepoFromPayload(body);
    const issueNumber = issueNumberOf(body);
    if (!repo || issueNumber == null) {
      return { acted: false, reason: "missing repo or issue number" };
    }

    const host = resolveForgejoHost();
    const token = await this.resolveApiToken(host);
    const issueRes = await forgejoApiGet<any>(`/api/v1/repos/${repo}/issues/${issueNumber}`, { host, token });
    if (issueRes.outcome !== "ok") {
      const detail = issueRes.error;
      this.log(`[warn] close guard: could not read ${repo}#${issueNumber}: ${detail}`);
      return { acted: false, reason: `issue fetch failed: ${detail}` };
    }
    const issue = issueRes.data;
    const decision = closeGuardDecision({
      actor,
      labels: labelNamesFromIssue(issue),
      isPullRequest: isPullRequestSubject(issue),
      targetActors: this.closeGuardTargetActors,
      acceptedLabels: this.closeGuardAcceptedLabels,
    });
    if (!decision.act) {
      return { acted: false, reason: decision.reason };
    }

    const reopen = await forgejoApiRequest<any>(
      "PATCH",
      `/api/v1/repos/${repo}/issues/${issueNumber}`,
      { state: "open" },
      { host, token },
    );
    if (reopen.outcome !== "ok") {
      const detail = reopen.error;
      this.log(`[warn] close guard: failed to reopen ${repo}#${issueNumber}: ${detail}`);
      return { acted: false, reason: `reopen failed: ${detail}` };
    }

    const comment = await forgejoApiRequest<any>(
      "POST",
      `/api/v1/repos/${repo}/issues/${issueNumber}/comments`,
      { body: CLOSE_GUARD_POLICY_COMMENT },
      { host, token },
    );
    const commented = comment.outcome === "ok";
    if (!commented) {
      this.log(`[warn] close guard: policy comment failed for ${repo}#${issueNumber}: ${comment.error}`);
    }

    // Notification is strictly optional: a failure here must never fail the guard.
    let notified = false;
    try {
      notified = await this.notifyReopened(repo, body, issue, actor);
    } catch (err) {
      this.log(
        `[warn] close guard: notify failed for ${repo}#${issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.log(`[info] close guard: reopened ${repo}#${issueNumber} closed by targeted actor '${actor}'`);
    return { acted: true, reason: decision.reason, reopened: true, commented, notified };
  }

  /**
   * CI failure handler (#865): create an issue for a failed workflow run,
   * deduplicated by an existing open issue with the same title.
   */
  public async runCiFailure(body: any): Promise<DirectActionResult> {
    if (!this.ciFailureEnabled) {
      return { acted: false, reason: "ci failure handler disabled" };
    }
    const details = ciFailureDetailsFromPayload(body);
    if (!details) {
      return { acted: false, reason: "missing run or repository in payload" };
    }

    const host = resolveForgejoHost();
    const token = await this.resolveApiToken(host);

    const existing = await this.findOpenCiFailureIssue(details.repo, details.title, host, token);
    if (existing != null) {
      this.log(`[info] ci failure: open issue already exists for ${details.title} (${details.repo}#${existing})`);
      return { acted: false, reason: `open issue already exists: ${details.repo}#${existing}`, createdIssue: null };
    }

    const create = await forgejoApiRequest<any>(
      "POST",
      `/api/v1/repos/${details.repo}/issues`,
      {
        title: details.title,
        body: formatCiFailureBody(details),
        labels: [...CI_FAILURE_LABELS],
      },
      { host, token },
    );
    if (create.outcome !== "ok") {
      const detail = create.error;
      this.log(`[warn] ci failure: failed to create issue in ${details.repo}: ${detail}`);
      return { acted: false, reason: `issue create failed: ${detail}` };
    }
    const createdIssue = typeof create.data?.number === "number" ? create.data.number : null;
    this.log(`[info] ci failure: created issue ${details.repo}#${createdIssue} for ${details.title}`);
    return { acted: true, reason: "ci run failed", createdIssue };
  }

  /**
   * Dedup lookup (#865): find an open issue in `repo` whose title exactly
   * matches the CI failure title. Returns the issue number, or null.
   */
  private async findOpenCiFailureIssue(
    repo: string,
    title: string,
    host: string,
    token: string | null,
  ): Promise<number | null> {
    const res = await forgejoApiGet<Array<{ number: number; title: string }>>(
      `/api/v1/repos/${repo}/issues?state=open&limit=50`,
      { host, token },
    );
    if (res.outcome !== "ok") {
      const detail = res.error;
      this.log(`[warn] ci failure: could not list open issues in ${repo}: ${detail}`);
      return null;
    }
    const match = (res.data ?? []).find((issue) => issue.title === title);
    return match?.number ?? null;
  }

  /**
   * Seed a newly created repository with the canonical label catalogue and the
   * standard fleet onboarding issue. Idempotent: an existing Issue #1 short-
   * circuits creation, and label reconciliation only creates or updates.
   */
  public async runRepoOnboarding(body: any): Promise<RepoOnboardingResult> {
    if (!this.repoOnboardingEnabled) {
      return { acted: false, reason: "repository onboarding disabled" };
    }
    const repo = this.bareRepoFromPayload(body);
    if (!repo) {
      return { acted: false, reason: "missing repository in payload" };
    }

    const host = resolveForgejoHost();
    const token = await this.resolveApiToken(host);

    const catalogueRes = await forgejoApiGet<{ manifest_version?: number; labels?: any[] }>(
      REPO_ONBOARDING_CATALOGUE_PATH,
      { host, token },
    );
    if (catalogueRes.outcome !== "ok") {
      const detail = catalogueRes.error;
      this.log(`[warn] repo onboarding: could not read label catalogue: ${detail}`);
      return { acted: false, reason: `label catalogue fetch failed: ${detail}` };
    }
    const catalogue = Array.isArray(catalogueRes.data?.labels) ? catalogueRes.data.labels : [];
    if (catalogue.length === 0) {
      return { acted: false, reason: "label catalogue is empty" };
    }

    const existing = await this.fetchAllLabels(repo, host, token);
    const { created, updated } = await this.reconcileLabels(repo, host, token, catalogue, existing);

    const issueNumber = 1;
    const issueRes = await forgejoApiGet<any>(`/api/v1/repos/${repo}/issues/${issueNumber}`, { host, token });
    if (issueRes.outcome === "ok") {
      this.log(`[info] repo onboarding: ${repo}#${issueNumber} already exists; skipping issue creation`);
      return {
        acted: true,
        reason: "onboarding issue already exists",
        labelsCreated: created,
        labelsUpdated: updated,
        issueCreated: false,
        issueNumber,
        issueUrl: typeof issueRes.data?.html_url === "string" ? issueRes.data.html_url : undefined,
      };
    }

    const labelIds = await this.resolveLabelIds(repo, host, token, REPO_ONBOARDING_ISSUE_LABELS);
    if (labelIds.length === 0) {
      return {
        acted: false,
        reason: "onboarding labels missing after reconciliation",
        labelsCreated: created,
        labelsUpdated: updated,
      };
    }

    const create = await forgejoApiRequest<any>(
      "POST",
      `/api/v1/repos/${repo}/issues`,
      {
        title: REPO_ONBOARDING_ISSUE_TITLE,
        body: REPO_ONBOARDING_ISSUE_BODY,
        labels: labelIds,
      },
      { host, token },
    );
    if (create.outcome !== "ok") {
      const detail = create.error;
      this.log(`[warn] repo onboarding: failed to create ${repo}#${issueNumber}: ${detail}`);
      return {
        acted: false,
        reason: `issue create failed: ${detail}`,
        labelsCreated: created,
        labelsUpdated: updated,
      };
    }
    this.log(
      `[info] repo onboarding: seeded ${repo} with ${created} label(s) and onboarding issue #${issueNumber}`,
    );
    return {
      acted: true,
      reason: "repository onboarded",
      labelsCreated: created,
      labelsUpdated: updated,
      issueCreated: true,
      issueNumber,
      issueUrl: typeof create.data?.html_url === "string" ? create.data.html_url : undefined,
    };
  }

  /** List every label in a repository, following the 50-per-page pagination. */
  private async fetchAllLabels(repo: string, host: string, token: string | null): Promise<any[]> {
    const labels: any[] = [];
    let page = 1;
    for (;;) {
      const res = await forgejoApiGet<any[]>(`/api/v1/repos/${repo}/labels?limit=50&page=${page}`, {
        host,
        token,
      });
      if (res.outcome !== "ok") {
        const detail = res.error;
        this.log(`[warn] repo onboarding: could not list labels for ${repo}: ${detail}`);
        return labels;
      }
      const batch = Array.isArray(res.data) ? res.data : [];
      labels.push(...batch);
      if (batch.length < 50) return labels;
      page += 1;
    }
  }

  /**
   * Create missing catalogue labels and update changed managed fields
   * (color, description, exclusive). Never deletes labels.
   */
  private async reconcileLabels(
    repo: string,
    host: string,
    token: string | null,
    catalogue: any[],
    existing: any[],
  ): Promise<{ created: number; updated: number }> {
    const existingByName = new Map<string, any>();
    for (const label of existing) {
      const name = typeof label?.name === "string" ? label.name : "";
      if (name) existingByName.set(name, label);
    }
    let created = 0;
    let updated = 0;
    for (const desired of catalogue) {
      const name = typeof desired?.name === "string" ? desired.name.trim() : "";
      if (!name) continue;
      const current = existingByName.get(name);
      if (!current) {
        const payload: Record<string, unknown> = { name };
        if (typeof desired.color === "string" && desired.color) payload.color = desired.color;
        if (typeof desired.description === "string" && desired.description) {
          payload.description = desired.description;
        }
        if (typeof desired.exclusive === "boolean") payload.exclusive = desired.exclusive;
        const res = await forgejoApiRequest<any>("POST", `/api/v1/repos/${repo}/labels`, payload, {
          host,
          token,
        });
        if (res.outcome !== "ok") {
          this.log(`[warn] repo onboarding: failed to create label ${name} in ${repo}: ${res.error}`);
          continue;
        }
        created += 1;
        continue;
      }
      const changes: Record<string, unknown> = {};
      for (const field of ["color", "description", "exclusive"] as const) {
        if (field in desired && desired[field] !== current[field]) changes[field] = desired[field];
      }
      if (Object.keys(changes).length === 0) continue;
      const res = await forgejoApiRequest<any>(
        "PATCH",
        `/api/v1/repos/${repo}/labels/${current.id}`,
        { name, ...changes },
        { host, token },
      );
      if (res.outcome !== "ok") {
        this.log(`[warn] repo onboarding: failed to update label ${name} in ${repo}: ${res.error}`);
        continue;
      }
      updated += 1;
    }
    return { created, updated };
  }

  /** Resolve label names to their Forgejo ids for issue creation. */
  private async resolveLabelIds(
    repo: string,
    host: string,
    token: string | null,
    names: readonly string[],
  ): Promise<number[]> {
    const existing = await this.fetchAllLabels(repo, host, token);
    const byName = new Map<string, number>();
    for (const label of existing) {
      const name = typeof label?.name === "string" ? label.name : "";
      const id = typeof label?.id === "number" ? label.id : null;
      if (name && id != null) byName.set(name, id);
    }
    const ids: number[] = [];
    for (const name of names) {
      const id = byName.get(name);
      if (id != null) ids.push(id);
    }
    return ids;
  }

  private async resolveApiToken(host: string): Promise<string | null> {
    try {
      return await forgejoToken(host);
    } catch {
      return null;
    }
  }

  /**
   * Route a synthesized `issues:reopened` event through the normal coalescing
   * queue so the repo's orchestrator is notified. Best-effort only.
   */
  private async notifyReopened(repo: string, body: any, issue: any, actor: string): Promise<boolean> {
    const repoKey = keyFromPayload(body);
    if (!repoKey) return false;
    const repository = repositoryFromPayload(body);
    const issueNumber = issueNumberOf(body);
    const htmlUrl =
      (typeof issue?.html_url === "string" && issue.html_url.trim()) ||
      (typeof body?.issue?.html_url === "string" ? body.issue.html_url : "");
    const synthesized = {
      action: "reopened",
      repository: {
        full_name: repo,
        html_url: typeof repository?.html_url === "string" ? repository.html_url : "",
        clone_url: typeof repository?.clone_url === "string" ? repository.clone_url : "",
      },
      issue: {
        number: issueNumber,
        title: typeof issue?.title === "string" ? issue.title : "",
        html_url: htmlUrl,
        state: "open",
        labels: Array.isArray(issue?.labels) ? issue.labels : [],
      },
      sender: { login: actor },
    };
    const result = this.coalesceOrSend({
      repoKey,
      issue: issueNumber,
      kind: "issues:reopened",
      actor,
      commentBody: "issues:reopened",
      title: typeof issue?.title === "string" ? issue.title : "",
      stateLabels: labelNamesFromIssue(issue),
      url: htmlUrl,
      msg: formatWebhookMessage("issues", synthesized),
      bypass: false,
      sosState: null,
    });
    return result !== "deduped" && result !== "sos-deduped";
  }

  public isRepoPaused(repoKey: string): boolean {
    if (!repoKey) return false;
    if (this.pausedRepos.has(repoKey)) return true;
    for (const m of this.pausedRepos) {
      if (m.toLowerCase() === repoKey.toLowerCase()) return true;
      const cleanM = m.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
      const cleanK = repoKey.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
      if (cleanM === cleanK || cleanK.endsWith(`/${cleanM}`) || cleanM.endsWith(`/${cleanK}`)) {
        return true;
      }
    }
    return false;
  }

  public pauseRepo(repoKey: string): string[] {
    this.pausedRepos.add(repoKey);
    this.saveConfigState();
    this.log(`[info] Repository ${repoKey} paused (circuit breaker engaged)`);
    return Array.from(this.pausedRepos);
  }

  public unpauseRepo(repoKey: string): string[] {
    for (const m of Array.from(this.pausedRepos)) {
      if (m === repoKey || this.isRepoPausedMatch(m, repoKey)) {
        this.pausedRepos.delete(m);
      }
    }
    this.saveConfigState();
    this.log(`[info] Repository ${repoKey} unpaused; resuming processing`);
    void this.drain(repoKey);
    return Array.from(this.pausedRepos);
  }

  public toggleRepoPause(repoKey: string, forcePause?: boolean): { isPaused: boolean; pausedRepos: string[] } {
    const current = this.isRepoPaused(repoKey);
    const shouldPause = forcePause !== undefined ? forcePause : !current;
    if (shouldPause) {
      this.pauseRepo(repoKey);
    } else {
      this.unpauseRepo(repoKey);
    }
    return {
      isPaused: shouldPause,
      pausedRepos: Array.from(this.pausedRepos),
    };
  }

  public getPausedRepos(): string[] {
    return Array.from(this.pausedRepos);
  }

  public enrollRepo(repoKey: string): string[] {
    this.enrolledRepos.add(repoKey);
    this.saveConfigState();
    return Array.from(this.enrolledRepos);
  }

  public unenrollRepo(repoKey: string): string[] {
    for (const enrolled of Array.from(this.enrolledRepos)) {
      if (enrolled === repoKey || isRepoMatching(enrolled, repoKey)) {
        this.enrolledRepos.delete(enrolled);
      }
    }
    this.saveConfigState();
    return Array.from(this.enrolledRepos);
  }


  /**
   * Declared enrollment only. Runtime artifacts (queues, orchestrator state
   * records) are surfaced through {@link getQueuesOverview} and
   * {@link listOrchestratorRecords} instead of being folded into the allowlist,
   * so an UNENROLL in settings.json is authoritative (#1165, #1154).
   */
  public getEnrolledRepos(): string[] {
    return Array.from(this.enrolledRepos);
  }

  /** Enrolled repository keys in canonical `host/owner/repo` form (#911). */
  public getCanonicalEnrolledRepos(): string[] {
    const keys = new Set<string>();
    for (const enrolled of this.getEnrolledRepos()) {
      const trimmed = enrolled?.trim();
      if (!trimmed) continue;
      keys.add(canonicalRepoKey(trimmed) ?? trimmed);
    }
    return Array.from(keys);
  }

  /** True when `repo` is enrolled in the fleet under any known key form (#889). */
  public isEnrolledRepo(repo: string): boolean {
    const candidate = String(repo ?? "").trim();
    if (!candidate) return false;
    const canonical = canonicalRepoKey(candidate) ?? candidate;
    for (const enrolled of this.getEnrolledRepos()) {
      if (enrolled === candidate || isRepoMatching(enrolled, candidate)) return true;
      if ((canonicalRepoKey(enrolled) ?? enrolled) === canonical) return true;
    }
    return false;
  }

  /**
   * Self-heal staffing for an enrolled repo with pending work (#889). When no
   * active orchestrator is registered, provision one through
   * `ensureOrchestrator` without hardcoding a model, so `resolveOrchestratorModel`
   * (#890) skips any cooling-down/quota-exhausted candidate. Returns the ensure
   * result, or `null` when the repo is ineligible or already staffed.
   */
  public async ensureUnstaffedEnrolledRepo(
    repo: string,
    opts: { reason?: string; agentMap?: Map<string, WatchdogAgent> | null } = {},
  ): Promise<EnsureOrchestratorResult | null> {
    if (this.isHaltedState) return null;
    const canonical = canonicalRepoKey(repo) ?? String(repo ?? "").trim();
    if (!canonical) return null;
    if (this.isRepoPaused(canonical) || this.isPaused(canonical)) return null;
    if (!this.isEnrolledRepo(canonical)) return null;

    // #987: coalesce overlapping auto-ensure calls per repo. Without this, two
    // passes that each observe "no active orchestrator" both provision one and
    // the registry flips between duplicates. The in-flight entry is installed
    // synchronously, before the first await yields.
    const inFlight = this.inFlightUnstaffed.get(canonical);
    if (inFlight) return await inFlight;

    const promise = (async (): Promise<EnsureOrchestratorResult | null> => {
      try {
        const active = await this.getActiveOrchestrator(canonical, opts.agentMap);
        if (active) return null;
      } catch {
        // Liveness unknown: skip rather than spawn a duplicate.
        return null;
      }

      this.log(
        `[info] Auto-ensure: unstaffed enrolled repo ${canonical}${opts.reason ? ` (${opts.reason})` : ""}; provisioning orchestrator`,
      );
      return await this.ensureOrchestrator({ repo: canonical });
    })();

    this.inFlightUnstaffed.set(canonical, promise);
    try {
      return await promise;
    } finally {
      this.inFlightUnstaffed.delete(canonical);
    }
  }

  private isRepoPausedMatch(a: string, b: string): boolean {
    if (a.toLowerCase() === b.toLowerCase()) return true;
    const cleanA = a.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
    const cleanB = b.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
    return cleanA === cleanB || cleanA.endsWith(`/${cleanB}`) || cleanB.endsWith(`/${cleanA}`);
  }

  private saveConfigState(): void {
    saveRouterConfig({
      pausedRepos: Array.from(this.pausedRepos),
      enrolledRepos: Array.from(this.enrolledRepos),
    });
  }

  public get port(): number {
    return this.boundPort || this.configuredPort;
  }

  public get host(): string {
    return (this.isListening() && this.boundHost) ? this.boundHost : this.configuredHost;
  }

  public getHttpServer(): HttpServer | null {
    return this.httpServer;
  }

  public isListening(): boolean {
    return this.httpServer !== null && Boolean(this.httpServer.listening);
  }

  public getUptime(): number {
    return this.isListening() && this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  public getTotalQueued(): number {
    let total = 0;
    for (const entries of this.queues.values()) {
      total += entries.length;
    }
    return total;
  }

  public getQueueCount(): number {
    return this.queues.size;
  }

  public getLifecycleStatus(): {
    listening: boolean;
    host: string;
    configuredHost: string;
    port: number;
    configuredPort: number;
    uptime: number;
    totalQueued: number;
    repoCount: number;
  } {
    return {
      listening: this.isListening(),
      host: this.host,
      configuredHost: this.configuredHost,
      port: this.port,
      configuredPort: this.configuredPort,
      uptime: this.getUptime(),
      totalQueued: this.getTotalQueued(),
      repoCount: this.queues.size,
    };
  }

  public getInfo(): HookInfoOutput {
    const registeredRepoKeys = this.getEnrolledRepos();
    return {
      ok: true,
      running: true,
      hookHost: this.configuredHost,
      hookPort: this.configuredPort,
      url: formatHookInfoUrl(this.configuredHost, this.configuredPort),
      isListening: this.isListening(),
      frontDeskAgentId: this.readFrontDesk()?.agentId ?? null,
      registeredRepoKeys,
      registeredRepoCount: registeredRepoKeys.length,
      uptime: this.getUptime(),
    };
  }

  private log(message: string): void {
    appendHookLog(message);
  }

  public setActivePaseo(paseo: PaseoApi | null): void {
    this.activePaseo = paseo;
  }

  public static setActivePaseo(paseo: PaseoApi | null): void {
    setActivePaseo(paseo);
  }

  public getPaseo(): PaseoApi | null {
    return this.activePaseo ?? (this.server as any)?.paseo ?? null;
  }

  /**
   * Every path a `frontdesk.json` may live at, writer targets first. `writeFrontDesk`
   * writes `dirname(stateDir)/frontdesk.json`, while `writePersistedFrontDesk`
   * (agents.ts) uses the persisted hook state dir, which can differ from this
   * router's dirs in another process. Reading both keeps a written file visible (#1068).
   */
  private frontDeskCandidatePaths(): string[] {
    const parentDir = dirname(this.stateDir);
    const custom = process.env.HOOK_STATE_DIR;
    const persistedDir =
      custom && custom.trim().length > 0
        ? custom.trim()
        : process.env.NODE_ENV === "test"
          ? join(os.tmpdir(), `paseo-uppidi-fleet-state-${process.pid}`)
          : join(process.env.HOME ?? os.homedir(), ".paseo", "forgejo-hook");
    const preferred = custom && custom.trim().length > 0 ? [join(persistedDir, "frontdesk.json")] : [join(parentDir, "frontdesk.json")];
    return [
      ...new Set([
        ...preferred,
        join(persistedDir, "frontdesk.json"),
        join(parentDir, "frontdesk.json"),
        join(this.stateDir, "frontdesk.json"),
        join(this.queueDir, "frontdesk.json"),
        join(persistedDir, "frontdesk.json"),
        join(persistedDir, "orchestrators", "frontdesk.json"),
        join(dirname(persistedDir), "frontdesk.json"),
      ]),
    ];
  }

  public readFrontDesk(): FrontDeskRecord | null {
    const candidates = this.frontDeskCandidatePaths();

    for (const path of candidates) {
      if (existsSync(path)) {
        try {
          const raw = readFileSync(path, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
            return {
              version: parsed.version ?? 1,
              agentId: parsed.agentId.trim(),
              updatedAt: parsed.updatedAt ?? null,
              by: parsed.by ?? null,
            };
          }
        } catch {
          // ignore corrupted file
        }
      }
    }
    return null;
  }

  public readOrchestrator(key: string): OrchestratorRecord | null {
    const candidates = candidateRepoKeys(key);
    for (const cand of candidates) {
      const sanitized = sanitizeKey(cand);
      const filePath = join(this.stateDir, `${sanitized}.json`);
      if (existsSync(filePath)) {
        try {
          const raw = readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
            return {
              key: parsed.key ?? cand,
              agentId: parsed.agentId.trim(),
              updatedAt: parsed.updatedAt ?? null,
              by: parsed.by ?? null,
              missCount: typeof parsed.missCount === "number" ? parsed.missCount : 0,
              firstMissAt: parsed.firstMissAt ?? null,
              lastSeenAt: parsed.lastSeenAt ?? null,
              stale: Boolean(parsed.stale),
              staleSince: parsed.staleSince ?? null,
              staleReason: parsed.staleReason ?? null,
              closedSweeps: typeof parsed.closedSweeps === "number" ? parsed.closedSweeps : 0,
              firstClosedAt: parsed.firstClosedAt ?? null,
            };
          }
        } catch {
          // ignore corrupted file
        }
      }
    }
    return null;
  }

  public writeOrchestrator(key: string, agentId: string, by = "orchestrator"): void {
    const nowIso = new Date().toISOString();
    this.persistOrchestratorRecord({
      key: canonicalRepoKey(key) ?? key,
      agentId,
      updatedAt: nowIso,
      by,
      missCount: 0,
      firstMissAt: null,
      lastSeenAt: nowIso,
      stale: false,
      staleSince: null,
      staleReason: null,
    });
  }

  /**
   * Persist a full orchestrator record under every candidate key. Unlike
   * `writeOrchestrator`, this preserves grace/stale bookkeeping fields so a
   * prune sweep can update a registration in place (#889).
   */
  private persistOrchestratorRecord(record: OrchestratorRecord): void {
    mkdirSync(this.stateDir, { recursive: true });
    const candidates = candidateRepoKeys(record.key);
    const primaryKey = canonicalRepoKey(record.key) ?? record.key;
    const targets = new Set<string>();
    targets.add(primaryKey);
    targets.add(record.key);
    for (const cand of candidates) {
      if (cand.includes("/")) targets.add(cand);
    }
    for (const targetKey of targets) {
      const sanitized = sanitizeKey(targetKey);
      const target = join(this.stateDir, `${sanitized}.json`);
      const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ...record, key: targetKey }, null, 2), "utf8");
      renameSync(tmp, target);
    }
  }

  public writeFrontDesk(agentId: string, by = "frontdesk"): void {
    const parentDir = dirname(this.stateDir);
    mkdirSync(parentDir, { recursive: true });
    const record: FrontDeskRecord = {
      version: 1,
      agentId,
      updatedAt: new Date().toISOString(),
      by,
    };
    const targets = new Set<string>([join(parentDir, "frontdesk.json")]);
    if (process.env.HOOK_STATE_DIR?.trim()) {
      targets.add(join(process.env.HOOK_STATE_DIR.trim(), "frontdesk.json"));
    }
    for (const target of targets) {
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
      renameSync(tmp, target);
    }
  }

  public async deliverMessage(
    targetAgentId: string,
    msg: string,
    options?: DeliverOptions,
  ): Promise<boolean> {
    const paseo = this.getPaseo();
    const shouldSteer = options?.steer ?? false;
    // Fleet provenance rides on `attachments`; extract any legacy in-band
    // comment so the SDK send carries the body as `text` (#1003).
    const extracted = extractFleetEnvelopeAttachments(msg);
    const attachments = [...(options?.attachments ?? []), ...extracted.attachments];
    if (paseo?.agents?.ref) {
      try {
        const agentRef = paseo.agents.ref(targetAgentId);
        // The public handle type has lagged the protocol; type the payload
        // structurally so the SDK-only key stays visible and the old dead
        // `steer` key cannot slip through as `any`.
        type AgentSendOptions = NonNullable<Parameters<typeof agentRef.send>[1]> & {
          activeTurnBehavior: "interrupt" | "steer";
        };
        const sendOptions: AgentSendOptions = {
          activeTurnBehavior: shouldSteer ? "steer" : "interrupt",
        };
        if (attachments.length > 0) {
          sendOptions.attachments = attachments;
        }
        await agentRef.send(extracted.text, sendOptions);
        return true;
      } catch (err) {
        this.log(`[warn] SDK send failed for ${targetAgentId}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const args = ["send"];
      if (options?.noWait !== false) {
        args.push("--no-wait");
      }
      if (shouldSteer) {
        args.push("--steer");
      }
      // The CLI has no attachment channel; re-inline the envelope so the
      // fallback path still carries provenance to the model (legacy grammar).
      const cliMsg =
        attachments.length > 0 ? inlineFleetEnvelopeAttachments(extracted.text, attachments) : msg;
      args.push(targetAgentId, cliMsg);
      await execFileAsync("paseo", args, { timeout: options?.noWait ? 5000 : 15000 });
      return true;
    } catch (err) {
      this.log(`[error] CLI send failed for ${targetAgentId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Stand-down steer for a demoted Front Desk or orchestrator (#283/#985).
   * Fire-and-forget: a failed steer must never fail the promotion it follows.
   */
  public async deliverStandDown(
    agentId: string,
    kind: "frontdesk" | "orchestrator",
    key: string,
    newAgentId: string,
  ): Promise<boolean> {
    const head =
      kind === "frontdesk"
        ? "You are no longer Front Desk"
        : `You are no longer the orchestrator of ${key}`;
    const body =
      `${head}; registry authority is now ${newAgentId}. ` +
      "Stand down: stop sweeping, stop dispatching workers, stop adjudicating permissions for this repo.";
    const repo = kind === "frontdesk" ? FRONT_DESK_REPO : key;
    const message = withFleetEnvelope(routerEnvelope({ repo, kind: "handoff" }), body);
    try {
      const ok = await this.deliverMessage(agentId, message, { noWait: true, steer: true });
      if (!ok) throw new Error("paseo send failed (stand-down steer)");
      return true;
    } catch (err) {
      this.log(`[warn] stand-down steer failed for ${agentId.slice(0, 7)} (${key}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  public isAgentBusy(agentId: string, agentMap?: Map<string, WatchdogAgent> | null): boolean {
    if (!agentId) return false;

    const frontDesk = this.readFrontDesk();
    const isFd = agentId === frontDesk?.agentId;
    if (isFd && this.busyQueues.has("frontdesk")) {
      return true;
    }

    const paseo = this.getPaseo();
    let currentFromRef: any = null;
    if (paseo?.agents?.ref) {
      try {
        const ref = paseo.agents.ref(agentId);
        currentFromRef = ref?.current ? ref.current() : null;
      } catch {
        // Proceed if status check fails
      }
    }

    if (currentFromRef) {
      const isRefBusy = Boolean(
        currentFromRef.status === "running" ||
          (currentFromRef.status as string) === "working" ||
          (currentFromRef.status as string) === "busy" ||
          Boolean(currentFromRef.activeTurn)
      );
      if (isRefBusy) return true;
      // If live ref is explicitly idle and no explicit agentMap was passed,
      // update cached map so stale watchdog cache doesn't mask it (#795)
      if (!agentMap && this.latestAgentMap?.has(agentId)) {
        const cached = this.latestAgentMap.get(agentId)!;
        cached.status = currentFromRef.status ?? "idle";
        cached.activeTurn = null;
      }
      if (!agentMap) {
        if (isFd && this.frontDeskThrottleMs > 0) {
          const last = this.lastDeliveryTimes.get(agentId) ?? 0;
          if (Date.now() - last < this.frontDeskThrottleMs) {
            return true;
          }
        }
        return false;
      }
    }

    const map = agentMap ?? this.latestAgentMap;
    if (map?.has(agentId)) {
      const agent = map.get(agentId);
      if (
        agent &&
        (agent.status === "running" ||
          agent.status === "working" ||
          agent.status === "busy" ||
          Boolean(agent.activeTurn))
      ) {
        return true;
      }
    }

    if (isFd && this.frontDeskThrottleMs > 0) {
      const last = this.lastDeliveryTimes.get(agentId) ?? 0;
      if (Date.now() - last < this.frontDeskThrottleMs) {
        return true;
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Fleet dormancy and quiescence recognition (#1181)
  //
  // The fleet is dormant when there is nothing to do: no queued messages, no
  // enrolled queue left unstaffed, and no live agent mid-turn. A dormant fleet
  // enters quiescent mode and stops reacting to passive webhook noise on rigid
  // intervals; only an actionable wakeup leaves it.
  // -------------------------------------------------------------------------

  /**
   * True when the fleet is fully dormant: empty queues, no unstaffed enrolled
   * queue, and no live running turn. A null/absent roster cannot prove a turn is
   * running, so it counts as no live turns -- the conservative direction for not
   * waking. A halted router is never "dormant" (it is deliberately offline).
   */
  public isDormant(agentMap?: Map<string, WatchdogAgent> | null): boolean {
    if (this.isHaltedState) return false;
    if (this.getTotalQueued() !== 0) return false;
    if (this.countUnstaffedEnrolledQueues() > 0) return false;
    if (this.hasLiveRunningTurns(agentMap)) return false;
    return true;
  }

  /** Enrolled repos with a queued backlog but no registered orchestrator (#1181). */
  public countUnstaffedEnrolledQueues(): number {
    let count = 0;
    for (const repo of this.getEnrolledRepos()) {
      const depth = candidateRepoKeys(repo).reduce(
        (n, key) => n + (this.queues.get(key)?.length ?? 0),
        0,
      );
      if (depth === 0) continue;
      if (!this.readOrchestrator(repo)?.agentId) count += 1;
    }
    return count;
  }

  /** True when any live agent reports a running/active turn (#1181). */
  public hasLiveRunningTurns(agentMap?: Map<string, WatchdogAgent> | null): boolean {
    const map = agentMap ?? this.latestAgentMap;
    if (!map) return false;
    for (const agent of map.values()) {
      const status = String(agent?.status ?? "").toLowerCase();
      if (
        status === "running" ||
        status === "working" ||
        status === "busy" ||
        Boolean(agent?.activeTurn)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Recompute dormancy and transition quiescent mode on change. Returns the
   * current quiescent state. Called from the board sweep, and available to any
   * other periodic observer holding a fresh roster.
   */
  public refreshDormancy(agentMap?: Map<string, WatchdogAgent> | null): boolean {
    const dormant = this.isDormant(agentMap);
    if (dormant !== this.quiescent) {
      this.quiescent = dormant;
      this.lastQuiescenceChangeAt = Date.now();
      this.log(
        dormant
          ? "[info] Fleet dormant (empty queues, no live turns); entering quiescent mode (#1181)"
          : "[info] Fleet activity detected; exiting quiescent mode (#1181)",
      );
    }
    return this.quiescent;
  }

  /** Current quiescent mode (#1181). */
  public get isQuiescent(): boolean {
    return this.quiescent;
  }

  /**
   * Leave quiescent mode immediately for an actionable wakeup, so the very next
   * delivery is dispatched rather than suppressed (#1181).
   */
  public exitQuiescence(reason = "actionable wakeup"): void {
    if (!this.quiescent) return;
    this.quiescent = false;
    this.lastQuiescenceChangeAt = Date.now();
    this.log(`[info] Fleet exited quiescence on ${reason}; active dispatch restored (#1181)`);
  }

  private deliverWatchdogAlert(
    frontDeskId: string,
    alert: string,
    opts: {
      deliverFn: (id: string, msg: string, o?: DeliverOptions) => Promise<boolean> | void;
      agentMap?: Map<string, WatchdogAgent> | null;
      isSos?: boolean;
      /** Repo context for the fleet envelope; defaults to the fleet-wide pseudo repo. */
      repo?: string;
    },
  ): void {
    const isSos = Boolean(opts.isSos);
    const message = withFleetEnvelope(watchdogEnvelope({ repo: opts.repo ?? FLEET_REPO }), alert);
    const isBusy = !isSos && this.isAgentBusy(frontDeskId, opts.agentMap);
    if (isBusy) {
      this.log(`[info] Front Desk ${frontDeskId} is busy; queueing watchdog alert instead of interrupting active turn`);
      this.enqueue("frontdesk", message, false);
      return;
    }
    this.lastDeliveryTimes.set(frontDeskId, Date.now());
    void opts.deliverFn(frontDeskId, message, { noWait: true, steer: isSos });
  }

  public async updateAgentMetadata(
    agentId: string,
    name: string,
    labels: Record<string, string>,
  ): Promise<boolean> {
    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const ref = typeof paseo.agents.ref === "function" ? paseo.agents.ref(agentId) : null;
        if (typeof (ref as any)?.update === "function") {
          await (ref as any).update({ name, labels });
          return true;
        } else if (typeof (paseo.agents as any)?.update === "function") {
          await (paseo.agents as any).update(agentId, { name, labels });
          return true;
        }
      } catch (err) {
        this.log(`[warn] SDK updateAgent failed for ${agentId}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return false;
    }

    try {
      const args = ["agent", "update", agentId, "--name", name];
      for (const [k, v] of Object.entries(labels)) {
        args.push("--label", `${k}=${v}`);
      }
      await execFileAsync("paseo", args, { timeout: 10000 });
      return true;
    } catch (err) {
      this.log(`[error] CLI updateAgent failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  public async setAgentMode(agentId: string, mode: string = "yolo"): Promise<boolean> {
    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const ref = typeof paseo.agents.ref === "function" ? paseo.agents.ref(agentId) : null;
        if (typeof (ref as any)?.setMode === "function") {
          await (ref as any).setMode(mode);
          return true;
        } else if (typeof (paseo.agents as any)?.setMode === "function") {
          await (paseo.agents as any).setMode(agentId, mode);
          return true;
        }
      } catch (err) {
        this.log(
          `[warn] SDK setAgentMode failed for ${agentId}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return false;
    }

    try {
      await execFileAsync("paseo", ["agent", "mode", agentId, mode], { timeout: 10000 });
      return true;
    } catch (err) {
      this.log(
        `[warn] CLI agent mode failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Whether an agent still carries a `paseo.parent-agent-id` label. Returns
   * `null` when the daemon state cannot be determined, so the caller keeps the
   * conservative detach behavior (#889).
   */
  public async hasParentAgentLabel(agentId: string): Promise<boolean | null> {
    const paseo = this.getPaseo();
    if (paseo?.agents?.ref) {
      try {
        const ref = paseo.agents.ref(agentId);
        const current: any = typeof (ref as any)?.current === "function" ? (ref as any).current() : null;
        const labels = current?.labels ?? current?.agent?.labels;
        if (labels && typeof labels === "object") {
          return Boolean(labels["paseo.parent-agent-id"]);
        }
        if (typeof (ref as any)?.refresh === "function") {
          const refreshed: any = await (ref as any).refresh().catch(() => null);
          const refreshedAgent = refreshed?.agent ?? refreshed;
          const refreshedLabels = refreshedAgent?.labels;
          if (refreshedLabels && typeof refreshedLabels === "object") {
            return Boolean(refreshedLabels["paseo.parent-agent-id"]);
          }
        }
      } catch {
        // fall through to the CLI probe
      }
    }

    // Stay hermetic under test: the mock spawn seam has no daemon to inspect.
    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return null;
    }

    try {
      const { stdout } = await execFileAsync("paseo", ["agent", "inspect", agentId, "--json"], { timeout: 5000 });
      const parsed: any = JSON.parse(stdout);
      const resolved = parsed?.agent ?? parsed;
      const parent = resolved?.ParentAgentId ?? resolved?.parentAgentId;
      if (parent !== undefined) return Boolean(parent);
      const labels = resolved?.labels;
      if (labels && typeof labels === "object") return Boolean(labels["paseo.parent-agent-id"]);
    } catch {
      return null;
    }
    return null;
  }

  public async detachAgent(agentId: string): Promise<boolean> {
    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const ref = typeof paseo.agents.ref === "function" ? paseo.agents.ref(agentId) : null;
        if (typeof (ref as any)?.detach === "function") {
          await (ref as any).detach();
          return true;
        } else if (typeof (paseo.agents as any)?.detach === "function") {
          await (paseo.agents as any).detach(agentId);
          return true;
        }
      } catch (err) {
        this.log(
          `[warn] SDK detachAgent failed for ${agentId}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return false;
    }

    try {
      await execFileAsync("paseo", ["agent", "detach", agentId], { timeout: 10000 });
      return true;
    } catch (err) {
      this.log(
        `[warn] CLI agent detach failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** Archive a dead session so it stops accumulating in `paseo ls` (#973). */
  public async archiveAgent(agentId: string): Promise<boolean> {
    const id = String(agentId ?? "").trim();
    if (!id) return false;

    if (typeof this.options?.archiveAgent === "function") {
      try {
        return await this.options.archiveAgent(id);
      } catch (err) {
        this.log(
          `[warn] Custom archiveAgent failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    }

    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const ref = typeof paseo.agents.ref === "function" ? paseo.agents.ref(id) : null;
        if (typeof (ref as any)?.archive === "function") {
          await (ref as any).archive();
          return true;
        } else if (typeof (paseo.agents as any)?.archive === "function") {
          await (paseo.agents as any).archive(id);
          return true;
        }
      } catch (err) {
        this.log(
          `[warn] SDK archiveAgent failed for ${id}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return false;
    }

    try {
      await execFileAsync("paseo", ["archive", id], { timeout: 10000 });
      return true;
    } catch (err) {
      this.log(
        `[warn] CLI agent archive failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  public async getActiveOrchestrator(
    repo: string,
    cachedAgentMap?: Map<string, WatchdogAgent> | null,
  ): Promise<{ agentId: string; record: OrchestratorRecord } | null> {
    const existing = this.readOrchestrator(repo);
    const hadCachedMap = cachedAgentMap !== undefined;

    let agentMap: Map<string, WatchdogAgent> | null | undefined = cachedAgentMap;
    if (agentMap === undefined) {
      try {
        agentMap = await this.fetchAgentMap();
      } catch {
        agentMap = null;
      }
    }

    const adoptAndDeduplicate = async (
      matches: WatchdogAgent[],
    ): Promise<{ agentId: string; record: OrchestratorRecord }> => {
      const authoritative = matches[0];
      const extras = matches.slice(1);
      for (const extra of extras) {
        try {
          await this.archiveAgent(extra.id);
          this.log(`[info] Deduplication: archived extra orchestrator ${extra.id} for ${repo}`);
        } catch (err) {
          this.log(
            `[warn] Failed to archive duplicate orchestrator ${extra.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (!existing?.agentId || existing.agentId !== authoritative.id) {
        this.writeOrchestrator(
          repo,
          authoritative.id,
          existing?.agentId ? "authoritative" : "recovered",
        );
        this.log(
          `[info] ${existing?.agentId ? "Updated authoritative" : "Recovered lost"} orchestrator registration for ${repo}: ${authoritative.id}`,
        );
      }
      const record = this.readOrchestrator(repo);
      return {
        agentId: authoritative.id,
        record: record ?? { key: repo, agentId: authoritative.id },
      };
    };

    let repoWorkspaceCwd: string | null = null;
    try {
      repoWorkspaceCwd = (await this.resolveWorkspaceCanonical(repo))?.cwd ?? null;
    } catch {
      repoWorkspaceCwd = null;
    }

    if (agentMap) {
      const matching = findLiveOrchestratorAgents(repo, agentMap, existing?.agentId, repoWorkspaceCwd);
      if (matching.length > 0) {
        return await adoptAndDeduplicate(matching);
      }
    }

    // #987: a cached snapshot can be stale. When a registration exists but the
    // snapshot omits it, or no match was found in the cache, refresh once from
    // the daemon before concluding the repo is unstaffed.
    if (hadCachedMap) {
      let fresh: Map<string, WatchdogAgent> | null = null;
      try {
        fresh = await this.fetchAgentMap();
      } catch {
        fresh = null;
      }
      if (fresh) {
        agentMap = fresh;
        const matching = findLiveOrchestratorAgents(repo, agentMap, existing?.agentId, repoWorkspaceCwd);
        if (matching.length > 0) {
          return await adoptAndDeduplicate(matching);
        }
      }
    }

    // No roster could be read at all: fall back to the id-only live list.
    if (!agentMap && existing?.agentId) {
      try {
        const activeIds = await this.getActiveAgentIds();
        if (activeIds.has(existing.agentId)) {
          return { agentId: existing.agentId, record: existing };
        }
      } catch {
        // ignore error in liveness check
      }
    }

    return null;
  }

  private workspaceLookupOptions(): WorkspaceLookupOptions {
    return {
      workspacesData: this.options?.workspacesData,
      projectsData: this.options?.projectsData,
    };
  }

  public resolveWorkspace(repo: string): ResolvedWorkspace | null {
    return resolveWorkspaceForRepo(repo, this.workspaceLookupOptions());
  }

  /**
   * Canonical resolver used by daemon-aware async paths: injected records first
   * (tests), then the daemon RPC (`workspaces.list` / `workspaces.open`).
   */
  private async resolveWorkspaceCanonical(repo: string): Promise<ResolvedWorkspace | null> {
    const injected = this.resolveWorkspace(repo);
    if (injected) return injected;
    const paseo = this.getPaseo();
    if (typeof paseo?.workspaces?.list === "function") {
      const canonical = await resolveWorkspaceForRepoViaDaemon(repo, paseo);
      if (canonical) return canonical;
    }
    return null;
  }

  private async getProviderModeInfo(provider: string): Promise<ProviderModeInfo | null> {
    if (!provider) return null;

    if (this.options?.providerModeResolver) {
      try {
        return await this.options.providerModeResolver(provider);
      } catch (err) {
        this.log(
          `[warn] provider mode resolver failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }

    const snapshot = await this.readPaseoProviderModes(provider);
    if (snapshot) return snapshot;

    if (this.isTestMode || process.env.NODE_ENV === "test") return null;

    try {
      const { stdout } = await execFileAsync("paseo", ["provider", "ls", "--json"], {
        timeout: 5000,
        encoding: "utf-8",
      });
      const parsed: unknown = JSON.parse(stdout);
      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { providers?: unknown })?.providers)
          ? (parsed as { providers: unknown[] }).providers
          : [];
      const entry = entries.find(
        (candidate) =>
          (candidate as { provider?: unknown })?.provider === provider ||
          (candidate as { id?: unknown })?.id === provider,
      ) as { modes?: unknown; defaultMode?: unknown } | undefined;
      if (!entry) return null;

      // `provider ls` only exposes mode labels, not ids. The lead/default mode
      // is reported as an id, so treat it as addressable when it is not the
      // `"default"` sentinel the CLI emits for a provider with no default.
      const labels =
        typeof entry.modes === "string"
          ? entry.modes
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean)
          : [];
      const modes = labels.map((label) => ({ id: label, label }));
      const defaultMode =
        typeof entry.defaultMode === "string" && entry.defaultMode.trim()
          ? entry.defaultMode.trim()
          : null;
      if (
        defaultMode &&
        defaultMode !== "default" &&
        !modes.some((mode) => mode.id === defaultMode)
      ) {
        modes.push({ id: defaultMode, label: defaultMode });
      }
      return { modes, defaultModeId: defaultMode };
    } catch (err) {
      this.log(
        `[warn] provider mode lookup failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async readPaseoProviderModes(provider: string): Promise<ProviderModeInfo | null> {
    const providers = (this.getPaseo() as unknown as { providers?: unknown })?.providers as
      | { snapshot?: () => Promise<unknown> }
      | undefined;
    if (!providers || typeof providers.snapshot !== "function") return null;
    try {
      const snapshot = (await providers.snapshot()) as
        | { entries?: unknown; payload?: { entries?: unknown } }
        | null;
      const entries = Array.isArray(snapshot?.entries)
        ? (snapshot.entries as unknown[])
        : Array.isArray(snapshot?.payload?.entries)
          ? (snapshot.payload.entries as unknown[])
          : [];
      const entry = entries.find(
        (candidate) => (candidate as { provider?: unknown })?.provider === provider,
      ) as { modes?: unknown; defaultModeId?: unknown } | undefined;
      if (!entry) return null;

      const modes = Array.isArray(entry.modes)
        ? (entry.modes as unknown[])
            .map((mode) => ({
              id: typeof (mode as { id?: unknown })?.id === "string" ? (mode as { id: string }).id : "",
              label:
                typeof (mode as { label?: unknown })?.label === "string"
                  ? (mode as { label: string }).label
                  : undefined,
            }))
            .filter((mode) => mode.id.length > 0)
        : [];
      const defaultModeId = typeof entry.defaultModeId === "string" ? entry.defaultModeId : null;
      return { modes, defaultModeId };
    } catch (err) {
      this.log(
        `[warn] provider snapshot lookup failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * The set of provider ids the host reports as enabled, or null when the
   * question cannot be answered (test, CLI unavailable). A null result disables
   * availability filtering so an unknown host never blocks a spawn (#973).
   */
  private async getAvailableProviderSet(): Promise<Set<string> | null> {
    if (Array.isArray(this.options?.availableProvidersData)) {
      return new Set(this.options.availableProvidersData);
    }
    if (this.isTestMode || process.env.NODE_ENV === "test") {
      return null;
    }
    try {
      return new Set(await listEnabledProviders());
    } catch (err) {
      this.log(
        `[warn] provider availability lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Best-effort board notification for total chain exhaustion (#1011): comment
   * on the repo's open fleet-alert issue, or open one. Any failure is logged
   * and never blocks the spawn failure from propagating.
   */
  private async postModelExhaustionBoardComment(
    repo: string,
    alert: FleetModelAlert,
  ): Promise<void> {
    const compact = resolveCanonicalRepo(repo)?.compact;
    if (!compact) {
      this.log(`[warn] model alert: cannot resolve ${repo} to owner/repo for board notification`);
      return;
    }
    const host = resolveForgejoHost();
    const token = await this.resolveApiToken(host);
    const body = formatModelExhaustionAlertBody(alert);

    const existing = await forgejoApiGet<Array<{ number: number; title: string }>>(
      `/api/v1/repos/${compact}/issues?state=open&limit=50`,
      { host, token },
    );
    const open = existing.outcome === "ok" ? existing.data ?? [] : [];
    const match = open.find((issue) => issue.title === MODEL_EXHAUSTION_ALERT_TITLE);
    if (match) {
      const comment = await forgejoApiRequest<any>(
        "POST",
        `/api/v1/repos/${compact}/issues/${match.number}/comments`,
        { body },
        { host, token },
      );
      if (comment.outcome !== "ok") {
        this.log(`[warn] model alert: comment on ${compact}#${match.number} failed: ${comment.error}`);
      }
      return;
    }
    const created = await forgejoApiRequest<any>(
      "POST",
      `/api/v1/repos/${compact}/issues`,
      { title: MODEL_EXHAUSTION_ALERT_TITLE, body, labels: [...MODEL_EXHAUSTION_ALERT_LABELS] },
      { host, token },
    );
    if (created.outcome !== "ok") {
      this.log(`[warn] model alert: issue create in ${compact} failed: ${created.error}`);
    }
  }

  /**
   * Persist the model-exhaustion banner and post the board alert (#1011). The
   * spawn path calls this instead of falling back to a hidden default.
   */
  public async raiseModelExhaustionAlert(
    repo: string,
    resolution: ResolvedOrchestratorModel,
  ): Promise<FleetModelAlert> {
    const key = canonicalRepoKey(repo) ?? repo;
    const alert: FleetModelAlert = {
      repo: key,
      role: "orchestrator",
      message: resolution.error ?? `No orchestrator model is satisfiable for ${key}`,
      configuredChain: resolution.configuredChain ?? [],
      dropped: resolution.dropped ?? [],
      availableProviders: resolution.availableProviders ?? null,
      createdAt: new Date().toISOString(),
    };
    recordModelAlert(alert, this.options?.modelAlertsPath ?? defaultModelAlertsPath());
    this.log(`[error] model exhaustion for ${key}: ${alert.message}`);
    try {
      if (this.options?.postModelExhaustionAlert) {
        await this.options.postModelExhaustionAlert(key, alert);
      } else if (!this.isTestMode) {
        await this.postModelExhaustionBoardComment(key, alert);
      }
    } catch (err) {
      this.log(
        `[warn] model alert: board notification failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return alert;
  }

  public async ensureOrchestrator(
    input: EnsureOrchestratorInput,
  ): Promise<EnsureOrchestratorResult> {
    if (this.isHaltedState) {
      return { ok: false, error: "Hook router is halted; orchestrator provisioning is disabled", errorCode: "spawn_failed" };
    }
    const rawRepo = input?.repo;
    if (!rawRepo || typeof rawRepo !== "string" || !rawRepo.trim()) {
      return { ok: false, error: "repo is required" };
    }
    const repo = rawRepo.trim();
    const canonicalKey = canonicalRepoKey(repo) ?? repo;

    // 1. Existing live agent check (idempotency). Rotation skips adoption so a
    // replacement can be spawned while the incumbent is still registered.
    if (!input.force && !input.rotation) {
      const active = await this.getActiveOrchestrator(repo);
      if (active) {
        this.log(`[info] Active orchestrator already exists for ${repo}: ${active.agentId}`);
        return {
          ok: true,
          agentId: active.agentId,
          status: "existing",
          repo: active.record.key ?? repo,
        };
      }
    }

    // 2. Coalesce concurrent ensure requests for the same repo
    const inFlight = this.inFlightEnsure.get(canonicalKey);
    if (inFlight) {
      return await inFlight;
    }

    const promise = this.provisionOrchestrator(repo, input);
    this.inFlightEnsure.set(canonicalKey, promise);
    try {
      const res = await promise;
      return res;
    } catch (err) {
      throw err;
    } finally {
      this.inFlightEnsure.delete(canonicalKey);
    }
  }

  private async provisionOrchestrator(
    repo: string,
    input: EnsureOrchestratorInput,
  ): Promise<EnsureOrchestratorResult> {
    const canonicalKey = canonicalRepoKey(repo) ?? repo;

    // A. Resolve workspace canonically: daemon RPC is the sole authority.
    let resolved: ResolvedWorkspace | null = null;
    try {
      resolved = await this.resolveWorkspaceCanonical(repo);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log(`[warn] ${error}`);
      return { ok: false, errorCode: "workspace_not_found", error, repo };
    }
    if (!resolved || (!resolved.cwd && !resolved.workspaceId)) {
      const error =
        `No workspace found for repository "${repo}". Remediation: open/register the repository in Paseo ` +
        `(e.g. \`paseo workspace open --cwd <repo_dir>\`), then retry.`;
      this.log(`[warn] ${error}`);
      return {
        ok: false,
        errorCode: "workspace_not_found",
        error,
        repo,
      };
    }

    const circuitBreakerPath = this.options?.circuitBreakerPath ?? this.options?.modelHealthPath;
    const fallbackList = this.options?.orchestratorModelFallback ?? this.options?.modelFallbackList;
    const availableProviders = await this.getAvailableProviderSet();
    const resolvedModel = resolveOrchestratorModel({
      requestedProvider: input.provider,
      requestedModel: input.model,
      fallbackList,
      circuitBreakerPath,
      availableProviders,
    });
    if (resolvedModel.exhausted) {
      const alert = await this.raiseModelExhaustionAlert(repo, resolvedModel);
      return {
        ok: false,
        errorCode: "model_exhausted",
        error: resolvedModel.error ?? `No orchestrator model is satisfiable for ${repo}`,
        repo,
        droppedModels: resolvedModel.dropped ?? [],
        modelAlert: alert,
      };
    }
    if (resolvedModel.dropped && resolvedModel.dropped.length > 0) {
      this.log(
        `[warn] dropping dead orchestrator model entries for ${repo}: ` +
          resolvedModel.dropped.map((d) => `${d.key} (${d.reason})`).join(", "),
      );
    }
    const targetProvider = resolvedModel.provider;
    const targetModel = resolvedModel.model || undefined;
    const requestedMode = input.mode?.trim() || "yolo";
    const providerModeInfo = await this.getProviderModeInfo(targetProvider);
    const targetMode = resolveProviderSpawnMode(providerModeInfo, requestedMode);
    const title = `Orchestrator · ${canonicalKey}`;
    const prompt = `You are the project orchestrator for ${repo}. Coordinate tasks, supervise worker agents, and manage pull requests and issues.\n\n${renderSkillDirective("orchestrator")}`;
    const labels: Record<string, string> = {
      role: "orchestrator",
      category: "orchestrator",
      repo,
    };

    let agentId: string | null = null;
    let autoAcceptApplied: boolean | undefined;
    let autoAllow:
      | { allowed: boolean; permissionId?: string; scope?: string; reason?: string }
      | undefined;

    // Pre-spawn check against latest live agent roster (#993)
    let preSpawnAgentMap: Map<string, WatchdogAgent> | null = null;
    try {
      preSpawnAgentMap = await this.fetchAgentMap();
    } catch {
      preSpawnAgentMap = null;
    }

    if (preSpawnAgentMap && !input.rotation) {
      const existing = this.readOrchestrator(repo);
      const matchingLive = findLiveOrchestratorAgents(
        repo,
        preSpawnAgentMap,
        existing?.agentId,
        resolved?.cwd ?? null,
      );
      if (!input.force) {
        if (matchingLive.length > 0) {
          const authoritative = matchingLive[0];
          const extras = matchingLive.slice(1);
          for (const extra of extras) {
            try {
              await this.archiveAgent(extra.id);
              this.log(`[info] Pre-spawn deduplication: archived extra orchestrator ${extra.id} for ${repo}`);
            } catch (err) {
              this.log(`[warn] Failed to archive duplicate orchestrator ${extra.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          this.writeOrchestrator(repo, authoritative.id, existing?.agentId ? "authoritative" : "recovered");
          this.log(`[info] Pre-spawn check adopted live orchestrator for ${repo}: ${authoritative.id}`);
          return {
            ok: true,
            agentId: authoritative.id,
            status: "existing",
            repo: canonicalKey,
          };
        }
      } else {
        // If force is set, archive all existing matching live orchestrators before spawning
        for (const existingAgent of matchingLive) {
          try {
            await this.archiveAgent(existingAgent.id);
            this.log(`[info] Force provision: archived existing orchestrator ${existingAgent.id} for ${repo}`);
          } catch (err) {
            this.log(`[warn] Failed to archive existing orchestrator ${existingAgent.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    // Custom test / injection hook
    if (typeof this.options?.spawnAgent === "function") {
      try {
        const spawned = await this.options.spawnAgent({
          title,
          prompt,
          cwd: resolved.cwd,
          workspaceId: resolved.workspaceId,
          mode: targetMode,
          provider: targetProvider,
          model: targetModel,
          labels,
        });
        agentId = spawned?.id ?? null;
      } catch (err: any) {
        return { ok: false, errorCode: "spawn_failed", error: err?.message ?? String(err), repo };
      }
    } else {
      let spawnedViaCli = false;

      // Try SDK first
      const sdkPaseo = this.getPaseo();
      if (sdkPaseo?.agents && typeof (sdkPaseo.agents as any).create === "function") {
        try {
          const createPayload: Record<string, any> = {
            title,
            prompt,
            role: "orchestrator",
            cwd: resolved.cwd,
            labels,
          };
          if (targetMode) createPayload.mode = targetMode;
          if (targetModel) {
            createPayload.provider = `${targetProvider}/${targetModel}`;
            createPayload.model = targetModel;
          } else {
            createPayload.provider = targetProvider;
          }
          const sdkConfig: Record<string, any> = {
            provider: createPayload.provider,
            featureValues: { auto_accept: true },
          };
          if (targetMode) sdkConfig.modeId = targetMode;
          if (resolved.cwd) sdkConfig.cwd = resolved.cwd;
          createPayload.config = sdkConfig;
          if (resolved.workspaceId) {
            createPayload.workspaceId = resolved.workspaceId;
            createPayload.workspace = resolved.workspaceId;
          }
          const created = await (sdkPaseo.agents as any).create(createPayload);
          agentId = created?.id ?? (typeof created === "string" ? created : null);
          if (agentId) autoAcceptApplied = true;
        } catch (err) {
          this.log(
            `[warn] SDK agent creation failed for ${repo}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // CLI fallback
      if (!agentId) {
        if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
          this.log(`[warn] CLI agent spawning is disabled in test mode for repository "${repo}"`);
          return {
            ok: false,
            errorCode: "cli_disabled",
            error: `CLI agent spawning is disabled in test mode for repository "${repo}"`,
            repo,
          };
        }
        try {
          spawnedViaCli = true;
          // `paseo run` exposes no auto-accept/feature flag (verified against
          // `paseo run --help`), so the SDK create payload is the only true
          // pre-grant surface. The CLI fallback pre-grants best-effort after
          // spawn below by allowing one workspace-scoped pending permission
          // (#974).
          const args = ["run", "-d", "--title", title];
          if (targetProvider) args.push("--provider", targetProvider);
          if (targetModel) args.push("--model", targetModel);
          if (targetMode) args.push("--mode", targetMode);
          // `--cwd` is the canonical placement: it lets the daemon attach or
          // create the ambient workspace and avoids stale `--workspace` ids.
          if (resolved.cwd) args.push("--cwd", resolved.cwd);
          else if (resolved.workspaceId) args.push("--workspace", resolved.workspaceId);
          for (const [k, v] of Object.entries(labels)) {
            args.push("--label", `${k}=${v}`);
          }
          args.push("--json", prompt);

          // Spawn as a top-level peer: dropping the inherited PASEO_AGENT_ID
          // stops `paseo run` persisting `paseo.parent-agent-id` at creation
          // time, before the watchdog can observe a Front Desk parent (#895).
          const spawnEnv = { ...process.env };
          delete spawnEnv.PASEO_AGENT_ID;
          const { stdout } = await execFileAsync("paseo", args, { timeout: 15000, env: spawnEnv });
          try {
            const parsed = JSON.parse(stdout);
            agentId = parsed?.id ?? parsed?.agentId ?? (typeof parsed === "string" ? parsed : null);
          } catch {
            const match = stdout.match(/(?:agent[-_]?[a-zA-Z0-9]+|[a-f0-9]{8,})/);
            if (match) agentId = match[0];
          }
        } catch (err: any) {
          this.log(`[error] CLI agent run failed for ${repo}: ${err?.message ?? String(err)}`);
          return { ok: false, errorCode: "spawn_failed", error: err?.message ?? String(err), repo };
        }
      }

      if (spawnedViaCli && agentId) {
        autoAcceptApplied = false;
        autoAllow = await this.autoAllowOrchestratorScope(agentId, resolved.cwd);
      }
    }

    if (!agentId) {
      return { ok: false, errorCode: "spawn_failed", error: "Failed to spawn orchestrator agent", repo };
    }

    // Explicitly configure autonomous execution mode when the provider exposes one
    if (targetMode) {
      await this.setAgentMode(agentId, targetMode);
    }

    // Detach an orchestrator only when it actually inherited a parent. #895
    // already strips the parent label at spawn for the CLI path; detaching a
    // peer makes the daemon archive it instead of promoting it, which fed the
    // prune cascade (#889).
    const hasParent = await this.hasParentAgentLabel(agentId).catch(() => null);
    if (hasParent === false) {
      this.log(`[info] Skipping detach for ${agentId.slice(0, 7)}: spawned as a top-level peer (#889)`);
    } else {
      await this.detachAgent(agentId).catch(() => {});
    }

    // Update metadata
    const metadata: Record<string, string> = {
      role: "orchestrator",
      category: "orchestrator",
      repo,
    };
    if (targetMode) metadata.mode = targetMode;
    await this.updateAgentMetadata(agentId, title, metadata).catch(() => {});

    // Register in authoritative registry & enrolled repos
    this.writeOrchestrator(repo, agentId, "spawn");
    this.enrollRepo(repo);

    // Drain pending queues for repository
    for (const cand of candidateRepoKeys(repo)) {
      await this.drain(cand).catch(() => {});
    }

    this.log(
      `[info] Orchestrator provisioned for ${repo}: ${agentId} (workspace=${resolved.workspaceId ?? resolved.cwd}, mode=${targetMode ?? "none"}, model=${resolvedModel.key})`,
    );

    // A successful spawn on the configured chain clears any stale exhaustion
    // banner for this repo (#1011).
    clearModelAlert(repo, this.options?.modelAlertsPath ?? defaultModelAlertsPath());

    return {
      ok: true,
      agentId,
      status: "provisioned",
      repo,
      workspaceId: resolved.workspaceId,
      cwd: resolved.cwd,
      autoAcceptApplied,
      autoAllow,
      resolvedModelKey: resolvedModel.key,
      droppedModels: resolvedModel.dropped ?? [],
    };
  }

  /**
   * Best-effort workspace-scoped pre-grant for a CLI-spawned orchestrator (#974).
   *
   * `paseo run` exposes no auto-accept/feature flag, so the SDK create payload
   * (`config.featureValues.auto_accept`) is the only true pre-grant surface. The
   * CLI fallback can only allow the first pending permission whose scope falls
   * under the workspace root, mirroring `spawnPaseoAgent`'s `allowPaths` grant.
   * Tests stay hermetic: without an injected `spawnAutoAllow`, the grant is a
   * no-op under test.
   */
  private async autoAllowOrchestratorScope(
    agentId: string,
    workspaceRoot: string | undefined,
  ): Promise<{ allowed: boolean; permissionId?: string; scope?: string; reason?: string } | undefined> {
    const scope = workspaceRoot?.trim();
    if (!agentId || !scope) return undefined;

    const isTest = this.isTestMode || process.env.NODE_ENV === "test";
    const injected = this.options?.spawnAutoAllow;
    if (!injected && isTest) return undefined;
    try {
      if (injected) return await injected(agentId, [scope]);
      const { autoAllowScopedPermission } = await import("./agents.js");
      const paseo = this.getPaseo();
      return await autoAllowScopedPermission(agentId, [scope], paseo ? { paseo } : undefined);
    } catch (err) {
      this.log(
        `[warn] scoped auto-allow failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { allowed: false, reason: "auto-allow failed" };
    }
  }

  public async getActiveAgentIds(): Promise<Set<string>> {
    const active = new Set<string>();
    try {
      const { stdout } = await execFileAsync("paseo", ["ls", "--json", "--global"], { timeout: 5000 });
      const list = JSON.parse(stdout);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id && item?.status !== "closed" && item?.status !== "archived") {
            active.add(item.id);
          }
        }
      }
    } catch (err) {
      this.log(`[warn] state read/parse failed (hook-router.ts:2960): ${err}`);
    }
    return active;
  }

  public listOrchestratorAgentIds(): string[] {
    const ids = new Set<string>();
    try {
      if (existsSync(this.stateDir)) {
        const files = readdirSync(this.stateDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "frontdesk.json") continue;
          try {
            const raw = readFileSync(join(this.stateDir, file), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
              ids.add(parsed.agentId.trim());
            }
          } catch (err) {
            this.log(`[warn] state read/parse failed (hook-router.ts:2977): ${err}`);
          }
        }
      }
    } catch (err) {
      this.log(`[warn] state read/parse failed (hook-router.ts:2980): ${err}`);
    }
    return Array.from(ids);
  }

  /**
   * One delivery target per orchestrator agent. A single registration is
   * persisted under every candidate key (bare + forge-qualified), so records
   * must be collapsed by agent id before notifying.
   */
  private listOrchestratorTargets(): Array<{ agentId: string; key: string }> {
    const seen = new Set<string>();
    const targets: Array<{ agentId: string; key: string }> = [];
    for (const record of this.listOrchestratorRecords()) {
      if (seen.has(record.agentId)) continue;
      seen.add(record.agentId);
      targets.push({ agentId: record.agentId, key: record.key });
    }
    return targets;
  }

  public listOrchestratorRecords(): OrchestratorRecord[] {
    const recordsMap = new Map<string, OrchestratorRecord>();
    try {
      if (existsSync(this.stateDir)) {
        const files = readdirSync(this.stateDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "frontdesk.json") continue;
          try {
            const raw = readFileSync(join(this.stateDir, file), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.key === "string" && typeof parsed.agentId === "string" && parsed.agentId) {
              const rec: OrchestratorRecord = {
                key: parsed.key,
                agentId: parsed.agentId,
                updatedAt: parsed.updatedAt ?? null,
                by: parsed.by ?? null,
                missCount: typeof parsed.missCount === "number" ? parsed.missCount : 0,
                firstMissAt: parsed.firstMissAt ?? null,
                lastSeenAt: parsed.lastSeenAt ?? null,
                stale: Boolean(parsed.stale),
                staleSince: parsed.staleSince ?? null,
                staleReason: parsed.staleReason ?? null,
                closedSweeps: typeof parsed.closedSweeps === "number" ? parsed.closedSweeps : 0,
                firstClosedAt: parsed.firstClosedAt ?? null,
              };
              const canonical = canonicalRepoKey(rec.key) ?? rec.key;
              const existing = recordsMap.get(canonical);
              if (!existing || rec.key === canonical) {
                recordsMap.set(canonical, rec);
              }
            }
          } catch (err) {
            this.log(`[warn] defensive failed (hook-router.ts:3007): ${err}`);
          }
        }
      }
    } catch (err) {
      this.log(`[warn] defensive failed (hook-router.ts:3010): ${err}`);
    }
    return Array.from(recordsMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Durable JSONL log for destructive state mutations (#1077). Defaults to a
   * sibling of the router state dir so it lives inside plugin storage and is
   * isolated by the same temp dir in tests. Override with HOOK_STATE_AUDIT_LOG.
   */
  public stateMutationLogPath(): string {
    const override = process.env.HOOK_STATE_AUDIT_LOG?.trim();
    if (override) return override;
    return join(dirname(this.stateDir), "state-mutations.jsonl");
  }

  /** Append one mutation record; never throws, because auditing must not block a clear. */
  private appendStateMutation(
    entry: Omit<StateMutationRecord, "version" | "ts" | "stack"> & { stack?: string | null },
  ): void {
    const record: StateMutationRecord = {
      version: 1,
      ts: new Date().toISOString(),
      stack: entry.stack ?? captureMutationStack(),
      ...entry,
    };
    try {
      const target = this.stateMutationLogPath();
      mkdirSync(dirname(target), { recursive: true });
      appendFileSync(target, `${JSON.stringify(record)}\n`, "utf8");
    } catch (err) {
      this.log(`[warn] state mutation audit append failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.log(
      `[audit] ${record.action} source=${record.source} key=${record.key ?? "-"} actor=${record.actor ?? "-"} reason=${record.reason ?? "-"}`,
    );
  }

  /**
   * Public audit hook for destructive mutations performed outside this class
   * (e.g. the fleet-teardown file cleanup in agents.ts) (#1077).
   */
  public recordStateMutation(
    entry: Omit<StateMutationRecord, "version" | "ts" | "stack"> & { stack?: string | null },
  ): void {
    this.appendStateMutation(entry);
  }

  /** Read back the durable mutation log (most recent last). Best-effort. */
  public readStateMutations(limit = 100): StateMutationRecord[] {
    const target = this.stateMutationLogPath();
    if (!existsSync(target)) return [];
    const out: StateMutationRecord[] = [];
    try {
      const lines = readFileSync(target, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed) as StateMutationRecord);
        } catch {
          // skip a torn write rather than fail the whole audit read
        }
      }
    } catch {
      return [];
    }
    return limit > 0 ? out.slice(-limit) : out;
  }

  public deleteOrchestrator(
    repoOrKey: string,
    opts: StateMutationOptions = {},
  ): { ok: boolean; key?: string; error?: string; path?: string } {
    const candidates = candidateRepoKeys(repoOrKey);
    if (candidates.length === 0) return { ok: false, error: "invalid repo key" };
    let deletedCount = 0;
    let lastPath = "";
    const removed: Array<{ key: string; path: string; record: OrchestratorRecord | null }> = [];
    for (const cand of candidates) {
      const target = join(this.stateDir, `${sanitizeKey(cand)}.json`);
      if (existsSync(target)) {
        let prior: OrchestratorRecord | null = null;
        try {
          prior = JSON.parse(readFileSync(target, "utf8")) as OrchestratorRecord;
        } catch {
          prior = null;
        }
        try {
          unlinkSync(target);
          removed.push({ key: cand, path: target, record: prior });
          deletedCount++;
          lastPath = target;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err), key: repoOrKey };
        }
      }
    }
    if (deletedCount > 0) {
      this.appendStateMutation({
        action: "deleteOrchestrator",
        source: opts.source ?? "unspecified",
        actor: opts.actor ?? null,
        reason: opts.reason ?? null,
        key: repoOrKey,
        priorValue: removed,
      });
      return { ok: true, key: repoOrKey, path: lastPath };
    }
    // Record the attempted unlink too: an actor that repeatedly probes a key is
    // part of the investigation trail even when nothing was present (#1077).
    this.appendStateMutation({
      action: "deleteOrchestrator",
      source: opts.source ?? "unspecified",
      actor: opts.actor ?? null,
      reason: opts.reason ?? "not found",
      key: repoOrKey,
      priorValue: [],
    });
    return { ok: false, error: "not found", key: repoOrKey };
  }

  public async fetchAgentMap(): Promise<Map<string, WatchdogAgent> | null> {
    const map = new Map<string, WatchdogAgent>();
    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const list = await (paseo.agents as any).list();
        const entries = list?.entries ?? list;
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            const a: any = entry?.agent ?? entry;
            if (a?.id) map.set(a.id, a);
          }
        }
      } catch {
        // fall through to CLI
      }
    }
    const isTest = this.isTestMode || process.env.NODE_ENV === "test";
    const hasCliStub =
      execFileAsync !== defaultExecFileAsync ||
      Boolean(process.env.PATH?.split(":")[0]?.includes("paseo-stub"));
    if (!this.options?.allowCliSpawn && isTest && !hasCliStub) {
      // Hermetic tests have no global roster; an SDK-only map is partial.
      if (map.size > 0) partialAgentMaps.add(map);
      return map.size > 0 ? map : null;
    }
    try {
      const { stdout } = await execFileAsync("paseo", ["ls", "--json", "--global"], { timeout: 5000 });
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.id) map.set(item.id, item);
        }
      }
      return map;
    } catch {
      // The global roster is the only completeness guarantee. Without it the
      // SDK-derived entries are partial, so callers must avoid hard pruning.
      if (map.size > 0) {
        partialAgentMaps.add(map);
        return map;
      }
      return null;
    }
  }

  /**
   * Reconcile a missing Front Desk registration from the live daemon roster.
   * This mirrors orchestrator adoption and intentionally does not replace a
   * persisted registration, even when another Front Desk-shaped agent exists.
   */
  public async reconcileFrontDesk(
    agentMap?: Map<string, WatchdogAgent> | null,
  ): Promise<{ ok: boolean; agentId?: string; recovered: boolean; error?: string }> {
    if (this.readFrontDesk()?.agentId) {
      return { ok: true, recovered: false };
    }
    let live = agentMap;
    if (live === undefined) {
      try {
        live = await this.fetchAgentMap();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.log(`[warn] Front Desk live reconciliation failed: ${error}`);
        return { ok: false, recovered: false, error };
      }
    }
    const candidate = findLiveFrontDeskAgents(live)[0];
    if (!candidate?.id) return { ok: true, recovered: false };

    this.writeFrontDesk(candidate.id, "recovered");
    await this.updateAgentMetadata(candidate.id, "Front Desk", {
      role: "front-desk",
      category: "front-desk",
    });
    this.log(`[info] Recovered lost Front Desk registration from live agent roster: ${candidate.id}`);
    return { ok: true, agentId: candidate.id, recovered: true };
  }

  public canWatchdogAlert(alertKey: string, now = Date.now()): boolean {
    const last = this.watchdogAlerts.get(alertKey) ?? 0;
    return now - last >= this.watchdogAlertCooldownMs;
  }

  public reloadAgent(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return Promise.resolve({ ok: false, error: "CLI agent reload is disabled in test mode" });
    }
    return new Promise((resolve) => {
      execFile("paseo", ["agent", "reload", id], { timeout: 10000 }, (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      });
    });
  }

  public stopAgent(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return Promise.resolve({ ok: false, error: "CLI agent stop is disabled in test mode" });
    }
    return new Promise((resolve) => {
      execFile("paseo", ["agent", "stop", id], { timeout: 10000 }, (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      });
    });
  }

  public clearDaemonAttention(agentId: string): Promise<boolean> {
    if (!this.options?.allowCliSpawn && (this.isTestMode || process.env.NODE_ENV === "test")) {
      return Promise.resolve(false);
    }
    const script = `
      import('/usr/lib/node_modules/@getpaseo/cli/dist/utils/client.js').then(async ({ connectToDaemon }) => {
        const home = process.env.HOME ? process.env.HOME + '/.paseo' : undefined;
        const client = await connectToDaemon({ target: { kind: 'home', home } });
        if (typeof client?.clearAgentAttention === 'function') {
          await client.clearAgentAttention(process.argv[1]);
        }
        await client?.close?.();
        process.exit(0);
      }).catch(() => process.exit(1));
    `;
    return new Promise((resolve) => {
      execFile("node", ["-e", script, agentId], { timeout: 10000 }, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Execute the ordered, conservative 4-step recovery pipeline for one
   * assessment: stop -> wipe lastError -> wipe attention flags -> steer wake
   * pulse. Returns the list of actions actually attempted and whether the
   * pipeline reached the wake pulse.
   */
  private async recoverWatchdogAgent(
    assessment: WatchdogAssessment,
    stopFn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    steerFn: (id: string, msg: string) => Promise<boolean>,
    steerMessage: string,
  ): Promise<{ actions: string[]; steered: boolean; blocked: boolean }> {
    const plan = planWatchdogRecovery(assessment.taxonomy, steerMessage);
    if (plan.blockedReason) {
      this.log(`[warn] watchdog: ${plan.blockedReason} for ${assessment.agentId.slice(0, 7)}`);
      return { actions: [], steered: false, blocked: true };
    }

    const actions: string[] = [];
    if (plan.stop) {
      const res = await stopFn(assessment.agentId);
      actions.push(`stop:${res.ok ? "ok" : "failed"}`);
      this.log(`[info] watchdog: stop ${assessment.agentId.slice(0, 7)} -> ${res.ok ? "ok" : res.error}`);
    }
    if (plan.clearError) {
      const ok = clearAgentDiskFields(assessment.diskPath, ["lastError"]);
      actions.push(`clear_error:${ok ? "ok" : "noop"}`);
    }
    if (plan.clearAttention) {
      const ok = clearAgentDiskFields(assessment.diskPath, WATCHDOG_ATTENTION_CLEAR_KEYS);
      void this.clearDaemonAttention(assessment.agentId).catch(() => undefined);
      actions.push(`clear_attention:${ok ? "ok" : "noop"}`);
    }
    if (plan.recordCancellationHandled) {
      const cancellationTime = assessment.cancellationTime ?? Date.now();
      const ok = setAgentDiskFields(assessment.diskPath, {
        lastHandledCancellationAt: cancellationTime,
      });
      actions.push(`record_cancellation_handled:${ok ? "ok" : "noop"}`);
    }
    if (plan.steer) {
      const ok = await steerFn(assessment.agentId, plan.steerMessage);
      actions.push(`steer:${ok ? "ok" : "failed"}`);
      this.log(`[info] watchdog: steer wake pulse ${assessment.agentId.slice(0, 7)} -> ${ok ? "ok" : "failed"}`);
      return { actions, steered: ok, blocked: false };
    }
    return { actions, steered: false, blocked: false };
  }

  /**
   * Zero-token fleet audit: intercepts stuck permission requests, attempts
   * auto-recovery of ACP turn locks, and detects missing/stalled orchestrators
   * and wedged queues. Alerts are throttled per key by the watchdog cooldown.
   *
   * The anomaly taxonomy (#529) fuses daemon state with persisted
   * `~/.paseo/agents` metadata and the daemon log stream, then applies the
   * conservative 4-step recovery pipeline for eligible findings.
   */
  public async runWatchdogAudit(opts: WatchdogAuditOptions = {}): Promise<WatchdogAuditResult> {
    if (this.isHaltedState) {
      return {
        ok: true,
        timestamp: opts.now ?? Date.now(),
        audited: { orchestrators: 0, agents: 0, queues: 0 },
        anomalies: [],
      };
    }
    const now = opts.now ?? Date.now();
    const reloadFn = opts.reloadAgent ?? ((id: string) => this.reloadAgent(id));
    const stopFn = opts.stopAgent ?? ((id: string) => this.stopAgent(id));
    const deliverFn = opts.deliver ?? ((id: string, msg: string, o?: DeliverOptions) => this.deliverMessage(id, msg, o));
    const steerFn = (id: string, msg: string) => deliverFn(id, msg, { noWait: true, steer: true });
    const recover = opts.recover ?? true;
    const steerMessage = opts.steerMessage ?? DEFAULT_WATCHDOG_STEER_MESSAGE;
    const anomalies: WatchdogAnomaly[] = [];

    let agentMap = opts.agentMap ?? null;
    if (!agentMap) {
      agentMap = await this.fetchAgentMap();
    }
    if (agentMap) {
      this.latestAgentMap = agentMap;
    }

    // Fuse persisted metadata and daemon logs. Injected test fixtures skip the
    // filesystem unless the caller points at an explicit directory, which keeps
    // unit tests hermetic while production always reads the real state.
    const readDisk = opts.agentMap === undefined || opts.agentsDir !== undefined;
    const readLogs = opts.agentMap === undefined || opts.daemonLogDir !== undefined;
    const diskMetadata =
      opts.diskMetadata !== undefined
        ? opts.diskMetadata
        : readDisk
          ? loadAgentDiskMetadata(opts.agentsDir ?? defaultAgentsDir())
          : null;
    const cancellations =
      opts.cancellations !== undefined
        ? opts.cancellations
        : readLogs
          ? scanCancellationTimeouts(
              defaultDaemonLogPaths(opts.daemonLogDir ?? join(process.env.HOME ?? os.homedir(), ".paseo")),
            )
          : null;
    const timelineErrors =
      opts.timelineErrors !== undefined
        ? opts.timelineErrors
        : readLogs
          ? scanTimelineRetryErrors(
              defaultDaemonLogPaths(opts.daemonLogDir ?? join(process.env.HOME ?? os.homedir(), ".paseo")),
            )
          : null;

    const frontDeskId = opts.frontDeskId ?? this.readFrontDesk()?.agentId ?? null;
    const orchRecords = opts.orchestratorRecords ?? this.listOrchestratorRecords();

    // Fleet permission auto-adjudication (#1084): only registered fleet agents
    // are eligible, and the default allow seam is skipped under test so the
    // suites never shell out to `paseo permit allow`.
    const isTestEnv = this.isTestMode || process.env.NODE_ENV === "test";
    const fleetAgentIds = new Set(orchRecords.map((r) => r.agentId).filter((id): id is string => Boolean(id)));
    const allowFleetPermission =
      opts.allowFleetPermission ??
      (isTestEnv
        ? undefined
        : async (agentId: string, permissionId: string) => {
            const { allowPermission } = await import("./agents.js");
            const paseo = this.getPaseo();
            return allowPermission(agentId, permissionId, paseo ? { paseo } : undefined);
          });
    const adjudicationLogPath = opts.adjudicationLogPath ?? join(this.stateDir, "permission-decisions.jsonl");

    if (agentMap) {
      for (const agent of agentMap.values()) {
        // Legitimate teardown must not raise amnesia/lock/permission alerts
        // (#872): culled agents are suppressed even if a stale snapshot still
        // lists them.
        if (this.isTeardownSuppressedAgent(agent.id)) continue;
        if (agent.pendingPermissions && agent.pendingPermissions.length > 0) {
          const perm = agent.pendingPermissions[0] || {};
          const reqId = perm.id || perm.requestId;
          const action = perm.title || perm.tool || perm.name || "tool permission";

          // Classify against the conservative allowlist once per permission (the
          // cooldown bounds the durable log). A match is auto-allowed through
          // the narrowest scope the seam supports (this one request); anything
          // else falls through to the Front Desk escalation below with the full
          // command so the prompt is never left invisible.
          const adjudicationKey = `permission-adjudicate:${agent.id}:${reqId || "pending"}`;
          let adjudication: Awaited<ReturnType<typeof adjudicatePermission>> | undefined;
          if (this.canWatchdogAlert(adjudicationKey, now)) {
            this.watchdogAlerts.set(adjudicationKey, now);
            adjudication = await adjudicatePermission({
              agent,
              permission: perm,
              context: { orchestratorAgentIds: fleetAgentIds, frontDeskId },
              allow: allowFleetPermission,
              logPath: adjudicationLogPath,
            });
          }

          if (adjudication?.action === "auto-allow") {
            anomalies.push({
              type: "AGENT_PERMISSION_AUTO_ALLOWED",
              agentId: agent.id,
              title: agent.title || agent.name,
              reason: adjudication.ruleId,
              permissions: agent.pendingPermissions,
            });
            this.log(
              `[info] permission auto-allow: ${agent.id} ${reqId} rule=${adjudication.ruleId} scope=${adjudication.scope ?? "n/a"}`,
            );
          } else {
            anomalies.push({
              type: "AGENT_PERMISSION_REQUIRED",
              agentId: agent.id,
              title: agent.title || agent.name,
              reason: adjudication?.reason,
              permissions: agent.pendingPermissions,
            });
            const alertKey = `permission:${agent.id}:${reqId || "pending"}`;
            if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
              this.watchdogAlerts.set(alertKey, now);
              const cmd = reqId ? `paseo permit allow ${agent.id} ${reqId}` : `paseo permit allow ${agent.id}`;
              const toolText = perm.tool ? ` tool=${perm.tool}` : "";
              const commandText = adjudication?.command ? ` command=${JSON.stringify(adjudication.command)}` : "";
              const alert = `[Fleet Watchdog] Agent ${agent.title || agent.id.slice(0, 7)} (${agent.id.slice(0, 7)}) requires permission: ${action}${toolText}.${commandText} Front Desk adjudication command: ${cmd}`;
              this.deliverWatchdogAlert(frontDeskId, alert, {
                deliverFn,
                agentMap,
                isSos: false,
                repo: agentRepoKey(agent, orchRecords),
              });
            }
          }
        } else if (
          agent.requiresAttention === true &&
          agent.attentionReason !== "error" &&
          agent.attentionReason !== "finished" &&
          (!agent.pendingPermissions || agent.pendingPermissions.length === 0)
        ) {
          anomalies.push({
            type: "AGENT_ATTENTION_REQUIRED",
            agentId: agent.id,
            title: agent.title || agent.name,
            reason: agent.attentionReason,
          });
          const alertKey = `attention:${agent.id}:${agent.attentionReason || "stall"}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = `[Fleet Watchdog] Agent ${agent.title || agent.id.slice(0, 7)} (${agent.id.slice(0, 7)}) requires attention (${agent.attentionReason || "stalled"}). Operator or Front Desk triage required.`;
            this.deliverWatchdogAlert(frontDeskId, alert, {
              deliverFn,
              agentMap,
              isSos: false,
              repo: agentRepoKey(agent, orchRecords),
            });
          }
        }
      }

      // Taxonomy classification over every live agent (#529). Agents handled
      // here are skipped by the legacy orchestrator-error pass below to avoid
      // contradictory double recovery.
      const taxonomyHandled = new Set<string>();
      for (const agent of agentMap.values()) {
        if (agent.archivedAt) continue;
        if (this.isTeardownSuppressedAgent(agent.id)) continue;
        const assessment = assessAgentHealth(agent.id, agent, diskMetadata?.get(agent.id), now, {
          cancellations,
          cancellationRecencySeconds: opts.cancellationRecencySeconds,
          activeWorkers: countActiveWorkers(agentMap, agent.id, diskMetadata),
          assumePendingWork: opts.assumePendingWork,
          runningStaleSeconds: opts.runningStaleSeconds,
          timelineErrors,
        });
        if (assessment.healthy) continue;
        taxonomyHandled.add(agent.id);

        if (assessment.taxonomy.includes("PROVIDER_QUOTA_EXHAUSTION")) {
          let provider =
            (agent as any).provider ??
            (agent as any).config?.provider ??
            diskMetadata?.get(agent.id)?.provider ??
            "";
          let model =
            (agent as any).model ??
            (agent as any).config?.model ??
            diskMetadata?.get(agent.id)?.model ??
            "";
          if (!provider && model.includes("/")) {
            const parsed = parseModelKey(model);
            provider = parsed.provider;
            model = parsed.model;
          }
          if (!provider && !model) {
            const orchRec = orchRecords.find((r) => r.agentId === agent.id);
            if (orchRec) {
              const defaultOrch = loadSavedRoleModels()?.orchestrator ?? DEFAULT_ROLE_MODELS.orchestrator;
              const parsed = parseModelKey(defaultOrch.primaryModel);
              provider = parsed.provider;
              model = parsed.model;
            }
          }
          const explicitCircuitBreakerPath =
            opts.circuitBreakerPath ??
            opts.modelHealthPath ??
            this.options?.circuitBreakerPath ??
            this.options?.modelHealthPath;
          const shouldWriteBreaker =
            explicitCircuitBreakerPath !== undefined ||
            (opts.agentMap === undefined && process.env.NODE_ENV !== "test") ||
            Boolean(process.env.MODEL_HEALTH_PATH);
          if (shouldWriteBreaker && (provider || model)) {
            recordModelQuotaFailure(
              provider,
              model,
              assessment.lastError,
              explicitCircuitBreakerPath ?? defaultCircuitBreakerPath(),
            );
          }
        }

        // Recovery and alerts share the watchdog cooldown so a persistently
        // wedged agent is not stop/steered on every audit tick.
        const actionKey = `taxonomy:${assessment.agentId}`;
        const eligible = this.canWatchdogAlert(actionKey, now);
        if (eligible) this.watchdogAlerts.set(actionKey, now);

        const recovery =
          recover && eligible
            ? await this.recoverWatchdogAgent(assessment, stopFn, steerFn, steerMessage)
            : { actions: [], steered: false, blocked: false };

        const recoveryActions = recovery.actions.length > 0 ? recovery.actions : undefined;
        for (const type of assessment.taxonomy) {
          anomalies.push({
            type,
            agentId: assessment.agentId,
            title: assessment.name,
            severity: assessment.severities[type],
            taxonomy: assessment.taxonomy,
            details: assessment.details,
            error: type === "PROVIDER_QUOTA_EXHAUSTION" ? assessment.lastError : undefined,
            recovered: recovery.steered,
            recoveryActions,
          });
        }

        if (!frontDeskId || !eligible) continue;
        const label = assessment.name || assessment.agentId.slice(0, 7);
        if (assessment.taxonomy.includes("PROVIDER_QUOTA_EXHAUSTION")) {
          const alert = `[Fleet Watchdog] Agent ${label} (${assessment.agentId.slice(0, 7)}) hit provider/quota exhaustion: "${assessment.lastError}". Circuit-break: no auto-steer; operator required.`;
          this.deliverWatchdogAlert(frontDeskId, alert, {
            deliverFn,
            agentMap,
            isSos: false,
            repo: agentRepoKey(agent, orchRecords),
          });
        } else if (recovery.steered) {
          const alert = `[Fleet Watchdog] Auto-recovered agent ${label} (${assessment.agentId.slice(0, 7)}) [${assessment.taxonomy.join(", ")}] via ${recovery.actions.join(" -> ")}.`;
          this.deliverWatchdogAlert(frontDeskId, alert, {
            deliverFn,
            agentMap,
            isSos: false,
            repo: agentRepoKey(agent, orchRecords),
          });
        } else {
          const alert = `[Fleet Watchdog] Agent ${label} (${assessment.agentId.slice(0, 7)}) unhealthy [${assessment.taxonomy.join(", ")}]. Operator attention may be required.`;
          this.deliverWatchdogAlert(frontDeskId, alert, {
            deliverFn,
            agentMap,
            isSos: false,
            repo: agentRepoKey(agent, orchRecords),
          });
        }
      }

      // Reactive child-lifecycle wakeups (#537): reuse this same tick as a
      // bounded, dedup-guarded watcher. A labelled child (paseo.parent-agent-id)
      // that becomes blocked, errors, or completes steers a wake pulse directly
      // into its parent orchestrator's context — no extra polling thread.
      if (opts.childWakeups !== false) {
        for (const child of agentMap.values()) {
          const parentId = child.labels?.["paseo.parent-agent-id"]?.trim();
          if (!parentId) continue;
          // #895: never wake a parent for an orchestrator peer, a health
          // canary, or any child of the Front Desk. The desk is a liaison.
          if (!isChildWakeupCandidate(child, { frontDeskId })) continue;
          const parent = agentMap.get(parentId);
          if (!parent || parent.archivedAt) continue;

          const assessment = assessChildWakeup(child.id, child, { frontDeskId });
          if (!assessment) continue;
          if (!this.canWatchdogAlert(assessment.alertKey, now)) continue;
          this.watchdogAlerts.set(assessment.alertKey, now);

          const message = withFleetEnvelope(
            routerEnvelope({ repo: agentRepoKey(parent, orchRecords), kind: "steer" }),
            formatChildWakeupMessage(child, assessment),
          );
          void deliverFn(parentId, message, { noWait: true, steer: true });
          anomalies.push({
            type: "CHILD_WAKEUP",
            agentId: child.id,
            title: child.title || child.name,
            parentAgentId: parentId,
            event: assessment.event,
            reason: assessment.detail,
            permissionId: assessment.permissionId,
            scope: assessment.scope,
            severity: "high",
          });
        }
      }

      // Empirical metrics aggregation (#560/#373): on this same tick, roll the
      // live per-model signals into minimized receipts. Gated by the watchdog
      // cooldown key `metrics_rollup` so a 60s tick doesn't append every minute;
      // skipped entirely when no live agent carries metrics.
      const metricsRollup =
        opts.metricsRollup ?? (opts.agentMap === undefined && process.env.NODE_ENV !== "test");
      if (metricsRollup) {
        const hasMetrics = [...agentMap.values()].some(
          (agent) =>
            !agent.archivedAt &&
            Boolean(agent.model && (agent.metrics || agent.lastUsage)),
        );
        if (hasMetrics) {
          void appendRollupReceipt(
            now,
            agentMap.values(),
            () => this.canWatchdogAlert("metrics_rollup", now),
            this.options?.metricsFilePath ? { storage: this.options.metricsFilePath } : (this.server as any),
          )
            .then((res) => {
              if (res.ok && !res.skipped) {
                this.watchdogAlerts.set("metrics_rollup", now);
                this.log(
                  `[info] metrics rollup: wrote ${res.receiptsWritten} receipt(s), ${res.receiptCount} retained`,
                );
              } else if (!res.ok) {
                this.log(`[warn] metrics rollup: ${res.error}`);
              }
            })
            .catch((err) => this.log(`[warn] metrics rollup: ${err?.message || err}`));
        }
      }

      for (const record of orchRecords) {
        const { key, agentId } = record;
        if (!agentId) continue;
        // Suppressed when the orchestrator was legitimately culled (#872).
        if (this.isTeardownSuppressedAgent(agentId)) continue;
        const agent = agentMap.get(agentId);
        if (!agent) {
          anomalies.push({ type: "ORCHESTRATOR_MISSING", key, agentId });
          const alertKey = `missing:${agentId}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = `[Fleet Watchdog] Registered orchestrator for ${key} (${agentId.slice(0, 7)}) was not found on daemon.`;
            this.deliverWatchdogAlert(frontDeskId, alert, { deliverFn, agentMap, isSos: false, repo: key });
          }
          continue;
        }

        if (agent.status === "error" || (agent.requiresAttention && agent.attentionReason === "error")) {
          if (taxonomyHandled.has(agentId)) continue;
          const rawErr = agent.lastError ?? "";
          const errMsg = rawErr || "unknown error";
          anomalies.push({ type: "AGENT_ERROR", key, agentId, error: errMsg });

          const isUnrecoverable = /usage limit|quota|upgrade to pro|rate limit|usage exceeded|free usage|subscribe to/i.test(errMsg);
          const isTurnLock =
            /foreground turn is already active/i.test(errMsg) ||
            (!rawErr && agent.requiresAttention && agent.attentionReason === "error");

          if (!isUnrecoverable) {
            this.log(`[info] watchdog: attempting auto-recovery reload for ${agentId.slice(0, 7)} (${key})`);
            const reloadRes = await reloadFn(agentId);
            if (reloadRes.ok) {
              this.log(`[info] watchdog: successfully reloaded ${agentId.slice(0, 7)}`);
              const alertKey = `recovered:${agentId}`;
              if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
                this.watchdogAlerts.set(alertKey, now);
                const reasonDesc = isTurnLock ? "clearing foreground turn lock" : "reloading agent";
                const alert = `[Fleet Watchdog] Auto-recovered orchestrator for ${key} (${agentId.slice(0, 7)}) by ${reasonDesc}.`;
                this.deliverWatchdogAlert(frontDeskId, alert, { deliverFn, agentMap, isSos: false, repo: key });
              }
              continue;
            }
          }

          const alertKey = `error:${agentId}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = `[Fleet Watchdog] Orchestrator for ${key} (${agentId.slice(0, 7)}) is in status error: "${errMsg}". Operator attention may be required.`;
            this.deliverWatchdogAlert(frontDeskId, alert, { deliverFn, agentMap, isSos: false, repo: key });
          }
        }
      }
    }

    for (const [key, q] of this.queues.entries()) {
      if (key === "frontdesk" || q.length === 0) continue;
      if (this.isRepoPaused(key) || this.isPaused(key)) continue;
      let orch = this.readOrchestrator(key);
      if (!orch) {
        // Lost-registration recovery (#987): adopt a live labelled orchestrator
        // before treating this queue as unorchestrated.
        try {
          const active = await this.getActiveOrchestrator(key, agentMap);
          if (active) orch = active.record;
        } catch {
          // Liveness unknown: leave it unorchestrated rather than spawning.
        }
      }
      if (!orch) {
        anomalies.push({ type: "QUEUE_UNORCHESTRATED", key, queueDepth: q.length });
        // Auto-provision an enrolled repo with pending work and no live
        // orchestrator after recovery (#987). Muted/paused repos returned above,
        // and `ensureUnstaffedEnrolledRepo` re-checks both.
        let provisioned: EnsureOrchestratorResult | null = null;
        try {
          provisioned = await this.ensureUnstaffedEnrolledRepo(key, {
            reason: "watchdog queued work",
            agentMap,
          });
        } catch (err) {
          this.log(
            `[warn] watchdog auto-provision failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (provisioned?.ok) {
          anomalies.push({
            type: "ORCHESTRATOR_PROVISIONED",
            key,
            agentId: provisioned.agentId,
            queueDepth: q.length,
          });
        }
        const alertKey = `unorchestrated:${key}`;
        if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
          this.watchdogAlerts.set(alertKey, now);
          const alert = provisioned?.ok
            ? `[Fleet Watchdog] Queue for ${key} has ${q.length} pending message(s); auto-provisioned orchestrator ${provisioned.agentId ?? ""}.`
            : `[Fleet Watchdog] Queue for ${key} has ${q.length} pending message(s) but no orchestrator is registered.`;
          this.deliverWatchdogAlert(frontDeskId, alert, { deliverFn, agentMap, isSos: false, repo: key });
        }
      }
    }

    for (const [key, attempts] of this.busyAttempts.entries()) {
      const q = this.queues.get(key) ?? [];
      // A drained queue is not wedged. Clear the stale attempt counter so it
      // cannot re-accumulate to the threshold and trigger a spurious reload when
      // fresh work arrives (#1072).
      if (q.length === 0) {
        this.busyAttempts.delete(key);
        this.busyQueues.delete(key);
        continue;
      }
      if (attempts >= this.watchdogBusyThreshold) {
        anomalies.push({ type: "QUEUE_WEDGED", key, attempts, queueDepth: q.length });
        const orchId = orchRecords.find((r) => r.key === key)?.agentId;
        let reloaded = false;
        if (orchId && reloadFn) {
          this.log(`[info] watchdog: attempting auto-recovery reload for wedged orchestrator ${orchId.slice(0, 7)} (${key})`);
          const reloadRes = await reloadFn(orchId);
          if (reloadRes.ok) {
            this.busyAttempts.delete(key);
            this.busyQueues.delete(key);
            const timer = this.backoffTimers.get(key);
            if (timer) {
              clearTimeout(timer);
              this.backoffTimers.delete(key);
            }
            reloaded = true;
            void this.drain(key);
          }
        }

        const alertKey = `queue_wedged:${key}`;
        if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
          this.watchdogAlerts.set(alertKey, now);
          const alert = reloaded
            ? `[Fleet Watchdog] Auto-recovered wedged queue for ${key} (${q.length} pending, ${attempts} failed attempts) by reloading orchestrator ${orchId?.slice(0, 7)}.`
            : `[Fleet Watchdog] Queue for ${key} has ${q.length} pending message(s) and has failed delivery ${attempts} times.`;
          this.deliverWatchdogAlert(frontDeskId, alert, { deliverFn, agentMap, isSos: false, repo: key });
        }
      }
    }

    return {
      ok: true,
      timestamp: now,
      audited: {
        orchestrators: orchRecords.length,
        agents: agentMap ? agentMap.size : 0,
        queues: this.busyAttempts.size,
      },
      anomalies,
    };
  }

  /**
   * Conservative pruning (#889). A missing orchestrator is never unlinked on
   * first absence: the registration is kept and flagged stale until it has been
   * absent for `graceSweeps` consecutive sweeps, and only then is a hard delete
   * performed once `verifyAgentAbsent` confirms the agent is really gone. This
   * preserves registrations across transient crashes, restarts, and quota
   * errors, where the agent temporarily drops out of `paseo ls`.
   */
  public async pruneOrchestrators(opts: {
    agentMap?: Map<string, WatchdogAgent> | null;
    orchestratorRecords?: OrchestratorRecord[];
    dryRun?: boolean;
    /** Consecutive absences required before a hard delete (default 3, #889). */
    graceSweeps?: number;
    /** Confirms an absent agent is permanently gone; defaults to inspect + disk state (#889). */
    verifyAgentAbsent?: (agentId: string) => Promise<boolean>;
    /** Persisted metadata directory used by the default verifier (#889). */
    agentsDir?: string;
    /** Archives a closed session before its registration is unlinked (#973). */
    archiveAgent?: (agentId: string) => Promise<boolean>;
    now?: number;
  } = {}): Promise<PruneResult> {
    let agentMap = opts.agentMap ?? null;
    if (!agentMap) {
      agentMap = await this.fetchAgentMap();
    }
    if (!agentMap) {
      return { ok: false, error: "daemon unreachable", prunedCount: 0, pruned: [] };
    }
    const agentMapPartial = isPartialAgentMap(agentMap);

    const graceSweeps = Math.max(1, opts.graceSweeps ?? ORCHESTRATOR_PRUNE_GRACE_SWEEPS);
    const nowIso = new Date(opts.now ?? Date.now()).toISOString();
    const verify = opts.verifyAgentAbsent ?? ((agentId: string) => this.verifyAgentAbsent(agentId, opts.agentsDir));
    const orchRecords = opts.orchestratorRecords ?? this.listOrchestratorRecords();
    const pruned: Array<{ key: string; agentId: string; reason: string }> = [];
    const archived: Array<{ key: string; agentId: string; reason: string }> = [];
    const markedStale: StaleOrchestratorMark[] = [];
    const recovered: string[] = [];
    const seen = new Set<string>();

    for (const record of orchRecords) {
      const { key, agentId } = record;
      if (!key || seen.has(key) || !agentId) continue;
      seen.add(key);

      if (agentMap.has(agentId)) {
        const agent = agentMap.get(agentId)!;
        const status = String(agent.status ?? "").toLowerCase();
        const isClosed = status === "closed" || status === "terminated" || status === "archived";
        const hasArchivedEvidence = Boolean(agent.archivedAt);

        // A closed orchestrator session is dead but still listed by the daemon,
        // so it never reaches the absent-agent path. Archive it and unlink the
        // registration once the closure is sticky or has persisted across the
        // grace window (#973, #1077).
        if (isClosed || hasArchivedEvidence) {
          if (opts.dryRun) {
            pruned.push({ key, agentId, reason: "closed session (dry-run)" });
            continue;
          }

          // A partial roster omits live agents in other workspaces, and a stale
          // workspace-scoped record can misreport one as closed. Never archive
          // or unlink from a partial roster unless disk carries an archivedAt
          // marker (#1068/#1077).
          if (agentMapPartial && !hasArchivedEvidence) {
            const updated: OrchestratorRecord = {
              ...record,
              stale: true,
              staleSince: record.staleSince ?? nowIso,
              staleReason: "session reported closed on a partial daemon roster (verification skipped)",
            };
            this.persistOrchestratorRecord(updated);
            markedStale.push({ key, agentId, missCount: record.missCount ?? 0, reason: updated.staleReason! });
            continue;
          }

          // `archivedAt` is durable evidence on disk: unlink immediately.
          if (hasArchivedEvidence) {
            const res = this.deleteOrchestrator(key, {
              source: "prune:archived-session",
              reason: "archived session unlinked",
              actor: "pruneOrchestrators",
            });
            if (res.ok) {
              const reason = "archived session unlinked";
              archived.push({ key, agentId, reason });
              pruned.push({ key, agentId, reason });
            }
            continue;
          }

          // Ephemeral `closed`/`terminated` status can flap at a turn boundary.
          // Require it to persist across `graceSweeps` sweeps before unlinking.
          const closedSweeps = (record.closedSweeps ?? 0) + 1;
          if (closedSweeps < graceSweeps) {
            const updated: OrchestratorRecord = {
              ...record,
              closedSweeps,
              firstClosedAt: record.firstClosedAt ?? nowIso,
              stale: true,
              staleSince: record.staleSince ?? nowIso,
              staleReason: `session closed (grace ${closedSweeps}/${graceSweeps})`,
            };
            this.persistOrchestratorRecord(updated);
            markedStale.push({ key, agentId, missCount: closedSweeps, reason: updated.staleReason! });
            continue;
          }

          let didArchive = false;
          const archive = opts.archiveAgent ?? ((id: string) => this.archiveAgent(id));
          try {
            didArchive = await archive(agentId);
          } catch (err) {
            this.log(
              `[warn] prune archive failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            didArchive = false;
          }
          if (didArchive) {
            const res = this.deleteOrchestrator(key, {
              source: "prune:closed-session",
              reason: "closed session archived and unlinked",
              actor: "pruneOrchestrators",
            });
            if (res.ok) {
              const reason = "closed session archived and unlinked";
              archived.push({ key, agentId, reason });
              pruned.push({ key, agentId, reason });
            }
          } else {
            // Archival failed: keep the record and retry on a later sweep (#973).
            const updated: OrchestratorRecord = {
              ...record,
              closedSweeps,
              firstClosedAt: record.firstClosedAt ?? nowIso,
              stale: true,
              staleSince: record.staleSince ?? nowIso,
              staleReason: "closed session archival failed (retry pending)",
            };
            this.persistOrchestratorRecord(updated);
            markedStale.push({ key, agentId, missCount: closedSweeps, reason: updated.staleReason! });
          }
          continue;
        }

        // The agent is back: clear the stale/closed bookkeeping so a transient
        // outage or turn-boundary close never accumulates toward a prune
        // (#889/#1077).
        if ((record.missCount ?? 0) > 0 || record.stale || (record.closedSweeps ?? 0) > 0) {
          if (!opts.dryRun) {
            this.persistOrchestratorRecord({
              ...record,
              missCount: 0,
              firstMissAt: null,
              lastSeenAt: nowIso,
              stale: false,
              staleSince: null,
              staleReason: null,
              closedSweeps: 0,
              firstClosedAt: null,
            });
          }
          recovered.push(key);
        }
        continue;
      }

      const missCount = (record.missCount ?? 0) + 1;
      if (opts.dryRun) {
        pruned.push({ key, agentId, reason: "agent not found on daemon (dry-run)" });
        continue;
      }

      if (missCount < graceSweeps) {
        const updated: OrchestratorRecord = {
          ...record,
          missCount,
          firstMissAt: record.firstMissAt ?? nowIso,
          stale: true,
          staleSince: record.staleSince ?? nowIso,
          staleReason: `agent absent from daemon (grace ${missCount}/${graceSweeps})`,
        };
        this.persistOrchestratorRecord(updated);
        markedStale.push({ key, agentId, missCount, reason: updated.staleReason! });
        continue;
      }

      if (agentMapPartial) {
        // The roster lacks the global `paseo ls --global` source, so a missing
        // entry is not proof of absence: an orchestrator in another workspace
        // can be omitted. Never verify or unlink from a partial roster; keep
        // the registration stale until a complete sweep confirms (#1068).
        const updated: OrchestratorRecord = {
          ...record,
          missCount: graceSweeps,
          firstMissAt: record.firstMissAt ?? nowIso,
          stale: true,
          staleSince: record.staleSince ?? nowIso,
          staleReason: "agent absent from partial daemon roster (verification skipped)",
        };
        this.persistOrchestratorRecord(updated);
        markedStale.push({ key, agentId, missCount: graceSweeps, reason: updated.staleReason! });
        continue;
      }

      // Grace exhausted: require positive confirmation before unlinking.
      let absent = false;
      try {
        absent = await verify(agentId);
      } catch (err) {
        this.log(`[warn] prune verification failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
        absent = false;
      }

      if (absent) {
        const res = this.deleteOrchestrator(key, {
          source: "prune:verified-absent",
          reason: "agent verified absent on daemon",
          actor: "pruneOrchestrators",
        });
        if (res.ok) {
          pruned.push({ key, agentId, reason: "agent verified absent on daemon" });
        }
      } else {
        const updated: OrchestratorRecord = {
          ...record,
          missCount: graceSweeps,
          firstMissAt: record.firstMissAt ?? nowIso,
          stale: true,
          staleSince: record.staleSince ?? nowIso,
          staleReason: "agent absent from daemon (verification pending)",
        };
        this.persistOrchestratorRecord(updated);
        markedStale.push({ key, agentId, missCount: graceSweeps, reason: updated.staleReason! });
      }
    }

    return {
      ok: true,
      prunedCount: pruned.length,
      pruned,
      archived,
      markedStale,
      recovered,
      ...(opts.dryRun ? { dryRun: true } : {}),
    };
  }

  /**
   * Confirm an absent orchestrator is permanently gone (#889). Historical
   * disk state is definitive when it marks the agent archived/closed; otherwise
   * `paseo agent inspect` is consulted. An unreachable daemon or unparseable
   * response is treated as "not confirmed" so a transient outage never deletes
   * a live registration.
   */
  public async verifyAgentAbsent(agentId: string, agentsDir?: string): Promise<boolean> {
    const id = String(agentId ?? "").trim();
    if (!id) return false;

    try {
      const disk = loadAgentDiskMetadata(agentsDir ?? defaultAgentsDir());
      const meta = disk.get(id);
      if (meta) {
        const status = String(meta.lastStatus ?? "").toLowerCase();
        if (meta.archivedAt || status === "closed" || status === "archived" || status === "terminated") {
          return true;
        }
      }
    } catch {
      // best-effort: unreadable disk state is not proof of absence
    }

    try {
      const { stdout } = await execFileAsync("paseo", ["agent", "inspect", id, "--json"], { timeout: 5000 });
      const parsed: any = JSON.parse(stdout);
      if (parsed?.error?.code === "AGENT_NOT_FOUND") return true;
      const resolved = parsed?.agent ?? parsed;
      if (resolved?.Id || resolved?.id) return false;
    } catch {
      return false;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Front Desk context handoff
  // -------------------------------------------------------------------------

  public handoffPath(): string {
    return join(dirname(this.stateDir), "latest-handoff.md");
  }

  public readHandoff(): string | null {
    try {
      const text = readFileSync(this.handoffPath(), "utf8");
      return text || null;
    } catch {
      return null;
    }
  }

  public writeHandoff(text: string): string {
    const target = this.handoffPath();
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, String(text ?? ""), "utf8");
    renameSync(tmp, target);
    return target;
  }

  public handoffSummary(text: string | null, maxChars = 500): string {
    if (!text) return "";
    const flat = String(text).replace(/\s+/g, " ").trim();
    return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
  }

  public frontDeskHandoffStatus(): HandoffStatus {
    const current = this.readFrontDesk();
    return {
      agentId: current?.agentId ?? null,
      updatedAt: current?.updatedAt ?? null,
      handoffPath: this.handoffPath(),
      summary: this.handoffSummary(this.readHandoff()),
    };
  }

  public async doFrontDeskHandoff(input: {
    agentId?: string | null;
    handoffText?: string | null;
    handoffFile?: string | null;
  }): Promise<HandoffResult> {
    const id = String(input.agentId ?? "").trim();
    const text = typeof input.handoffText === "string" && input.handoffText.trim() ? input.handoffText : null;
    let snapshot: string | null = text;
    if (!snapshot && typeof input.handoffFile === "string" && input.handoffFile.trim()) {
      try {
        snapshot = readFileSync(input.handoffFile.trim(), "utf8");
      } catch {
        throw httpError(400, `could not read handoffFile: ${input.handoffFile.trim()}`);
      }
      if (!snapshot || !snapshot.trim()) throw httpError(400, "handoffFile is empty");
    }
    if (snapshot) this.writeHandoff(snapshot);
    else snapshot = this.readHandoff();

    if (!id) {
      if (!text && !input.handoffFile?.trim?.()) throw httpError(400, "handoffText or agentId is required");
      return {
        agentId: null,
        updatedAt: new Date().toISOString(),
        handoffPath: this.handoffPath(),
        summary: this.handoffSummary(snapshot),
        orchestratorsNotified: 0,
      };
    }
    if (!snapshot || !String(snapshot).trim()) throw httpError(400, "no handoff snapshot available");

    const previous = this.readFrontDesk()?.agentId ?? null;
    const paseo = this.getPaseo();
    if (paseo?.agents?.ref) {
      try {
        const ref = paseo.agents.ref(id);
        const current = ref.current?.();
        if (!current) {
          const refreshed = await ref.refresh?.().catch(() => null);
          const agent = refreshed?.agent;
          if (!agent?.id) throw httpError(404, `agent not found: ${id}`);
        }
      } catch (err) {
        if ((err as any)?.status) throw err;
      }
    }

    await this.updateAgentMetadata(id, "Front Desk", { role: "front-desk" });
    if (previous && previous !== id) {
      await this.updateAgentMetadata(previous, "Front Desk (retired)", { role: "retired-front-desk" });
      await this.deliverStandDown(previous, "frontdesk", FRONT_DESK_REPO, id);
    }

    const updatedAt = new Date().toISOString();
    this.writeFrontDesk(id, "frontdesk-handoff");
    void this.drain("frontdesk");

    const onboarding = withFleetEnvelope(
      routerEnvelope({ repo: FRONT_DESK_REPO, kind: "handoff" }),
      `You are now the Front Desk agent. Read the active handoff snapshot at ${this.handoffPath()}. ` +
        `Handoff snapshot:\n${String(snapshot).slice(0, 4000)}`,
    );
    await this.deliverMessage(id, onboarding, { noWait: true, steer: true });

    const orchestrators = this.listOrchestratorTargets();
    const notice = `Front Desk handover: ${id} is now Front Desk (handoff at ${this.handoffPath()}). Route operator escalations to it via 'paseo send --no-wait ${id} <msg>'.`;
    let notified = 0;
    for (const target of orchestrators) {
      if (target.agentId !== id) {
        const message = withFleetEnvelope(routerEnvelope({ repo: target.key, kind: "handoff" }), notice);
        const ok = await this.deliverMessage(target.agentId, message, { noWait: true, steer: true });
        if (ok) notified++;
      }
    }

    this.log(`[info] front desk handoff -> ${id.slice(0, 7)}, notified ${notified} orchestrator(s)`);
    return {
      agentId: id,
      updatedAt,
      handoffPath: this.handoffPath(),
      summary: this.handoffSummary(snapshot),
      orchestratorsNotified: notified,
    };
  }

  public async generateHandoff(opts?: {
    io?: IssuesCheckIo;
    agentMap?: Map<string, WatchdogAgent> | null;
  }): Promise<HandoffResult & { report: string; ok: boolean }> {
    const agentMap = opts?.agentMap ?? (await this.fetchAgentMap()) ?? new Map<string, WatchdogAgent>();
    const orchRecords = this.listOrchestratorRecords();
    const enrolledRepos = this.getEnrolledRepos().filter((r) => r && r !== "frontdesk");
    const frontDesk = this.readFrontDesk();

    const activeWorkers: Array<{ id: string; title: string; status: string; parentAgentId?: string }> = [];
    for (const [id, agent] of agentMap.entries()) {
      const role = String(agent.role ?? "").toLowerCase();
      const title = String(agent.title ?? "");
      const isWorker =
        role === "worker" ||
        role === "coding_worker" ||
        title.toLowerCase().startsWith("worker:") ||
        Boolean(agent.labels?.["paseo.parent-agent-id"]);
      if (isWorker) {
        activeWorkers.push({
          id,
          title: title || "(untitled worker)",
          status: String(agent.status ?? "unknown"),
          parentAgentId: agent.labels?.["paseo.parent-agent-id"],
        });
      }
    }

    const repoSummaries: Array<{
      repo: string;
      orchestrator: string | null;
      orchestratorStatus: string | null;
      blocking: Array<{ number: number; title: string; reason: string }>;
      inReview: Array<{ number: number; title: string }>;
      wip: Array<{ number: number; title: string }>;
      dispatchableCount: number;
      error?: string;
    }> = [];

    for (const repo of enrolledRepos) {
      const orch = this.readOrchestrator(repo);
      const orchLive = orch?.agentId ? agentMap.get(orch.agentId) : null;
      const blocking: Array<{ number: number; title: string; reason: string }> = [];
      const inReview: Array<{ number: number; title: string }> = [];
      const wip: Array<{ number: number; title: string }> = [];
      let dispatchableCount = 0;
      let error: string | undefined;

      try {
        const check = await this.runBoardCheck(repo, undefined, opts?.io);
        if (check.ok && Array.isArray(check.candidates)) {
          for (const c of check.candidates) {
            const labels = Array.isArray(c.labels) ? c.labels : [];
            const isBlocking = labels.some(
              (l: string) =>
                l.startsWith("dep/blocked") ||
                l === "priority/0-sos" ||
                l === "flag/stop-work" ||
                l === "attention/2-user" ||
                l === "attention/frontdesk",
            );
            if (isBlocking) {
              blocking.push({ number: c.number, title: c.title, reason: c.reason });
            }
            const isReview = labels.some(
              (l: string) => l.startsWith("review/") || l === "state/2-review" || l === "state/3-verify",
            );
            if (isReview) {
              inReview.push({ number: c.number, title: c.title });
            }
            const isWip = labels.includes("state/1-wip");
            if (isWip) {
              wip.push({ number: c.number, title: c.title });
            }
            if (c.is_dispatchable) {
              dispatchableCount++;
            }
          }
        } else if (check.error) {
          error = check.error;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      repoSummaries.push({
        repo,
        orchestrator: orch?.agentId ?? null,
        orchestratorStatus: orchLive ? String(orchLive.status ?? "alive") : orch?.agentId ? "unreachable" : "none",
        blocking,
        inReview,
        wip,
        dispatchableCount,
        error,
      });
    }

    const lines: string[] = [
      "# Fleet Shift Handoff Report",
      `*Generated at: ${new Date().toISOString()}*`,
      "",
      "## Fleet Overview",
      `- Enrolled Repositories: ${enrolledRepos.length}`,
      `- Registered Orchestrators: ${orchRecords.length}`,
      `- Active Worker Agents: ${activeWorkers.length}`,
      `- Front Desk: ${frontDesk?.agentId ? `${frontDesk.agentId} (${frontDesk.by ?? "unknown"})` : "None"}`,
      "",
      "## Active Worker Assignments",
    ];

    if (activeWorkers.length === 0) {
      lines.push("No active worker agents running.");
    } else {
      for (const w of activeWorkers) {
        lines.push(`- **\`${w.id}\`** [${w.status}] - ${w.title}${w.parentAgentId ? ` (parent: \`${w.parentAgentId}\`)` : ""}`);
      }
    }

    lines.push("", "## Repository Status");
    for (const r of repoSummaries) {
      lines.push(`### \`${r.repo}\``);
      lines.push(`- **Orchestrator**: ${r.orchestrator ? `\`${r.orchestrator}\` (${r.orchestratorStatus})` : "_None registered_"}`);
      if (r.error) {
        lines.push(`- **Triage Error**: ${r.error}`);
      }
      if (r.blocking.length > 0) {
        lines.push(`- **Blocking / Attention Required** (${r.blocking.length}):`);
        for (const b of r.blocking) {
          lines.push(`  - #${b.number}: ${b.title} (${b.reason})`);
        }
      } else {
        lines.push("- **Blocking / Attention Required**: None");
      }
      if (r.inReview.length > 0) {
        lines.push(`- **In Review / PRs** (${r.inReview.length}):`);
        for (const pr of r.inReview) {
          lines.push(`  - #${pr.number}: ${pr.title}`);
        }
      } else {
        lines.push("- **In Review / PRs**: None");
      }
      if (r.wip.length > 0) {
        lines.push(`- **In Progress (WIP)** (${r.wip.length}):`);
        for (const w of r.wip) {
          lines.push(`  - #${w.number}: ${w.title}`);
        }
      }
      lines.push(`- **Dispatchable Candidates**: ${r.dispatchableCount}`);
      lines.push("");
    }

    const report = lines.join("\n").trim();
    const handoffResult = await this.doFrontDeskHandoff({ handoffText: report });
    return {
      ...handoffResult,
      ok: true,
      report,
    };
  }

  // -------------------------------------------------------------------------
  // Long-lived role rotation (#1019)
  // -------------------------------------------------------------------------

  /** Effective rotation policy from fleet settings (hot-applied). */
  public readRotationPolicy(): RotationPolicy {
    try {
      const stored = getUppidiFleetSettingsStorage().read() as { rotationPolicy?: RotationPolicy };
      return stored?.rotationPolicy ?? DEFAULT_ROTATION_POLICY;
    } catch {
      return DEFAULT_ROTATION_POLICY;
    }
  }

  private saveRotationPolicy(policy: RotationPolicy): void {
    const storage = getUppidiFleetSettingsStorage();
    storage.update((prev) => ({ ...prev, rotationPolicy: policy }));
  }

  public getRotationPolicyFor(role: string, repo?: string | null): Required<RotationRolePolicy> {
    return resolveRotationPolicy(this.readRotationPolicy(), role, repo);
  }

  public setRotationPolicyRole(role: string, repo: string | undefined, patch: RotationRolePolicy): RotationPolicy {
    const current = this.readRotationPolicy();
    const next: RotationPolicy = {
      roles: { ...(current.roles ?? {}) },
      byRepo: { ...(current.byRepo ?? {}) },
    };
    if (repo) {
      const repoKey = canonicalRepoKey(repo) ?? repo;
      next.byRepo[repoKey] = { ...(next.byRepo[repoKey] ?? {}), [role]: { ...(next.byRepo[repoKey]?.[role] ?? {}), ...patch } };
    } else {
      next.roles[role] = { ...(next.roles[role] ?? {}), ...patch };
    }
    this.saveRotationPolicy(next);
    return next;
  }

  private rotationBriefPath(role: string, repo?: string | null): string {
    const key = repo ? sanitizeKey(canonicalRepoKey(repo) ?? repo) : role;
    return join(dirname(this.stateDir), `rotation-brief-${key}.md`);
  }

  private writeRotationBriefFile(role: string, repo: string | null | undefined, text: string): string {
    const target = this.rotationBriefPath(role, repo);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, String(text ?? ""), "utf8");
    renameSync(tmp, target);
    return target;
  }

  private observationForRole(role: string, repo: string | null, live: WatchdogAgent | null): RotationObservation {
    const anyLive = live as any;
    return {
      role,
      repo,
      spawnedAtMs: anyLive?.updatedAt ? Date.parse(String(anyLive.updatedAt)) || null : null,
      turns: typeof anyLive?.turns === "number" ? anyLive.turns : typeof anyLive?.turnCount === "number" ? anyLive.turnCount : null,
      contextWindowUsedTokens:
        live?.lastUsage?.contextWindowUsedTokens ?? live?.metrics?.contextUsedTokens ?? null,
      contextWindowMaxTokens:
        live?.lastUsage?.contextWindowMaxTokens ?? live?.metrics?.contextMaxTokens ?? null,
      failureTimestampsMs: [],
    };
  }

  private async buildRotationBriefForRole(
    role: string,
    repo: string | null,
    opts: { reason?: string | null; previousAgentId?: string | null; io?: IssuesCheckIo },
  ): Promise<string> {
    const activeTickets: RotationBriefTicket[] = [];
    const pendingAttention: RotationBriefTicket[] = [];
    if (repo) {
      try {
        const check = await this.runBoardCheck(repo, undefined, opts.io);
        if (check.ok && Array.isArray(check.candidates)) {
          for (const c of check.candidates) {
            const labels = Array.isArray(c.labels) ? c.labels : [];
            const isWip = labels.includes("state/1-wip");
            const isReview = labels.some((l: string) => l.startsWith("review/") || l === "state/2-review");
            const needsAttention = labels.some(
              (l: string) =>
                l.startsWith("dep/blocked") ||
                l === "priority/0-sos" ||
                l === "flag/stop-work" ||
                l === "attention/2-user" ||
                l === "attention/frontdesk",
            );
            if (isWip || isReview) activeTickets.push({ number: c.number, title: c.title, reason: c.reason });
            if (needsAttention) pendingAttention.push({ number: c.number, title: c.title, reason: c.reason });
          }
        }
      } catch {
        // Board is rediscoverable by the replacement; a failed read must not block rotation.
      }
    }
    const queueDepth = repo ? candidateRepoKeys(repo).reduce((n, key) => n + this.getQueue(key).length, 0) : 0;
    const hookTail = repo
      ? candidateRepoKeys(repo)
          .map((key) => this.getQueue(key).at(-1)?.msg)
          .filter(Boolean)
          .join(" | ")
      : "";
    const input: RotationBriefInput = {
      role,
      repo,
      reason: opts.reason ?? null,
      previousAgentId: opts.previousAgentId ?? null,
      generatedAt: new Date().toISOString(),
      skillPath: getEffectiveSkillPath(role === "orchestrator" ? "orchestrator" : role === "front-desk" ? "front-desk" : "coding-agent"),
      skillText: getEffectiveSkillContent(role === "orchestrator" ? "orchestrator" : role === "front-desk" ? "front-desk" : "coding-agent"),
      activeTickets,
      pendingAttention,
      queueDepth,
      lastHookDigest: hookTail ? this.handoffSummary(hookTail, 220) : null,
      lastSweepDigest: this.lastSweepDigests.get(repo ?? FRONT_DESK_REPO) ?? null,
    };
    return buildRotationBrief(input);
  }

  private async spawnRotationReplacement(
    role: string,
    repo: string | null,
    brief: string,
  ): Promise<{ ok: boolean; agentId?: string; error?: string }> {
    if (role === "orchestrator" && repo) {
      const res = await this.ensureOrchestrator({ repo, rotation: true });
      return { ok: res.ok, agentId: res.agentId, error: res.error };
    }
    if (role === "front-desk") {
      const injected = this.options?.spawnFrontDesk;
      if (injected) {
        const spawned = await injected({ title: "Front Desk", prompt: brief });
        if (!spawned?.id) return { ok: false, error: spawned?.error || "Failed to spawn Front Desk replacement" };
        this.writeFrontDesk(spawned.id, "rotation");
        return { ok: true, agentId: spawned.id };
      }
      try {
        const { handleUppidiCreateFrontDesk } = await import("./agents.js");
        const res = await handleUppidiCreateFrontDesk(
          { title: "Front Desk", prompt: brief },
          { paseo: this.getPaseo() } as any,
        );
        return { ok: res.ok, agentId: res.agentId, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { ok: false, error: `role ${role} does not support rotation` };
  }

  private async verifyRotationReplacement(
    role: string,
    repo: string | null,
    agentId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const registered = role === "orchestrator" && repo ? this.readOrchestrator(repo)?.agentId : this.readFrontDesk()?.agentId;
    if (registered !== agentId) {
      return { ok: false, reason: `replacement ${agentId} not registered for ${role}` };
    }
    const map = await this.fetchAgentMap().catch(() => null);
    if (map && map.size > 0) {
      const live = map.get(agentId);
      if (!live) return { ok: false, reason: `replacement ${agentId} missing from live roster` };
      const roleText = `${live.role ?? ""} ${live.title ?? ""} ${live.name ?? ""}`.toLowerCase();
      const expected = role === "front-desk" ? ["front-desk", "front desk"] : [role];
      if (!expected.some((token) => roleText.includes(token))) {
        return { ok: false, reason: `replacement ${agentId} registered without ${role} role/title` };
      }
    }
    return { ok: true };
  }

  /**
   * Rotate one long-lived role. Contract: spawn replacement, verify it
   * registered, deliver the rotation brief, then archive the incumbent. On
   * spawn/verify failure the incumbent is left untouched and the replacement
   * (if any) is archived. Manual triggers bypass policy/cooldown/mid-turn but
   * never overlap an in-flight rotation.
   */
  public async rotateRole(input: {
    role: string;
    repo?: string;
    reason?: string;
    force?: boolean;
    io?: IssuesCheckIo;
  }): Promise<UppidiRotateRoleOutput> {
    const role = String(input.role ?? "").trim();
    if (!isRotationRole(role)) {
      return { ok: false, role, triggers: [], errorCode: "invalid", error: `unknown rotation role: ${role}` };
    }
    const repo = role === "orchestrator" ? (input.repo?.trim() ? canonicalRepoKey(input.repo.trim()) ?? input.repo.trim() : "") : null;
    if (role === "orchestrator" && !repo) {
      return { ok: false, role, triggers: [], errorCode: "invalid", error: "repo is required for orchestrator rotation" };
    }

    const lockKey = RotationLock.key(role, repo);
    if (!this.rotationLock.acquire(role, repo)) {
      return { ok: false, role, repo: repo ?? undefined, triggers: [], errorCode: "in_flight", error: `rotation already in progress for ${role}` };
    }

    try {
      const policy = this.getRotationPolicyFor(role, repo);
      if (!input.force && !policy.enabled) {
        return { ok: false, role, repo: repo ?? undefined, triggers: [], errorCode: "disabled", error: `rotation disabled for ${role}` };
      }

      const oldAgentId = role === "orchestrator" ? this.readOrchestrator(repo!)?.agentId ?? null : this.readFrontDesk()?.agentId ?? null;
      const reasons: RotationTriggerReason[] = input.force ? ["manual"] : [];
      if (!input.force) {
        const map = await this.fetchAgentMap().catch(() => null);
        const live = oldAgentId ? map?.get(oldAgentId) ?? null : null;
        const decision = evaluateRotationTrigger(
          this.observationForRole(role, repo, live),
          {
            nowMs: Date.now(),
            lastRotationAtMs: this.lastRotationAt.get(lockKey) ?? null,
            midTurn: oldAgentId ? this.isAgentBusy(oldAgentId, map) : false,
            inFlight: false,
          },
          this.readRotationPolicy(),
        );
        if (!decision.shouldRotate) {
          return {
            ok: false,
            role,
            repo: repo ?? undefined,
            triggers: [],
            errorCode: decision.blocked === "cooldown" ? "in_flight" : "disabled",
            error: decision.blocked ? `rotation blocked: ${decision.blocked}` : "no rotation trigger fired",
          };
        }
        reasons.push(...decision.triggers);
      }

      const brief = await this.buildRotationBriefForRole(role, repo, {
        reason: input.reason ?? (reasons.length ? reasons.join(", ") : "manual"),
        previousAgentId: oldAgentId,
        io: input.io,
      });

      const spawn = await this.spawnRotationReplacement(role, repo, brief);
      if (!spawn.ok || !spawn.agentId) {
        return { ok: false, role, repo: repo ?? undefined, oldAgentId: oldAgentId ?? undefined, triggers: reasons, errorCode: "spawn_failed", error: spawn.error || "spawn failed" };
      }

      const verify = await this.verifyRotationReplacement(role, repo, spawn.agentId);
      if (!verify.ok) {
        await this.archiveAgent(spawn.agentId).catch(() => {});
        if (oldAgentId) {
          if (role === "orchestrator") this.writeOrchestrator(repo!, oldAgentId, "rotation-abort");
          else this.writeFrontDesk(oldAgentId, "rotation-abort");
        }
        return { ok: false, role, repo: repo ?? undefined, oldAgentId: oldAgentId ?? undefined, agentId: spawn.agentId, triggers: reasons, errorCode: "verify_failed", error: verify.reason || "verification failed" };
      }

      const briefPath = this.writeRotationBriefFile(role, repo, brief);
      const envelope = withFleetEnvelope(routerEnvelope({ repo: repo ?? FRONT_DESK_REPO, kind: "handoff" }), brief);
      await this.deliverMessage(spawn.agentId, envelope, { noWait: true, steer: true }).catch(() => {});

      if (oldAgentId && oldAgentId !== spawn.agentId) {
        await this.archiveAgent(oldAgentId).catch(() => {});
      }
      this.lastRotationAt.set(lockKey, Date.now());
      this.log(`[info] rotated ${role}${repo ? ` for ${repo}` : ""}: ${oldAgentId?.slice(0, 7) ?? "none"} -> ${spawn.agentId.slice(0, 7)} (${reasons.join(", ") || "manual"})`);
      return {
        ok: true,
        role,
        repo: repo ?? undefined,
        oldAgentId: oldAgentId ?? undefined,
        agentId: spawn.agentId,
        reason: reasons.join(", ") || "manual",
        triggers: reasons,
        briefPath,
      };
    } finally {
      this.rotationLock.release(role, repo);
    }
  }

  public rotationStatus(input?: { role?: string; repo?: string }): UppidiRotationStatusOutput {
    const filterRole = input?.role;
    const statuses: UppidiRotationStatusOutput["statuses"] = [];
    const now = Date.now();
    for (const role of ROTATION_ROLES) {
      if (filterRole && role !== filterRole) continue;
      if (role === "orchestrator") {
        const records = this.listOrchestratorRecords();
        const repos = input?.repo ? [canonicalRepoKey(input.repo) ?? input.repo] : records.map((r) => r.key);
        for (const repo of repos.length ? repos : [null]) {
          const key = RotationLock.key(role, repo);
          statuses.push({
            role,
            repo,
            enabled: this.getRotationPolicyFor(role, repo).enabled,
            agentId: repo ? this.readOrchestrator(repo)?.agentId ?? null : null,
            lastRotationAt: this.lastRotationAt.has(key) ? new Date(this.lastRotationAt.get(key)!).toISOString() : null,
            cooldownRemainingMs: this.cooldownRemaining(role, repo, now),
            inProgress: this.rotationLock.isLocked(role, repo),
            policy: this.getRotationPolicyFor(role, repo),
          });
        }
      } else {
        statuses.push({
          role,
          repo: null,
          enabled: this.getRotationPolicyFor(role, null).enabled,
          agentId: role === "front-desk" ? this.readFrontDesk()?.agentId ?? null : null,
          lastRotationAt: this.lastRotationAt.has(role) ? new Date(this.lastRotationAt.get(role)!).toISOString() : null,
          cooldownRemainingMs: this.cooldownRemaining(role, null, now),
          inProgress: this.rotationLock.isLocked(role),
          policy: this.getRotationPolicyFor(role, null),
        });
      }
    }
    return { ok: true, statuses };
  }

  private cooldownRemaining(role: string, repo: string | null, now: number): number {
    const last = this.lastRotationAt.get(RotationLock.key(role, repo));
    if (last == null) return 0;
    return Math.max(0, this.getRotationPolicyFor(role, repo).cooldownMs - (now - last));
  }

  /**
   * Evaluate and apply automatic rotations for every registered live role.
   * Called from the periodic board sweep; a no-op unless `rotationAutoEnabled`.
   */
  public async evaluateAutomaticRotations(): Promise<UppidiRotateRoleOutput[]> {
    if (!this.rotationAutoEnabled || this.isHaltedState) return [];
    const agentMap = await this.fetchAgentMap().catch(() => null);
    const out: UppidiRotateRoleOutput[] = [];
    for (const record of this.listOrchestratorRecords()) {
      const live = agentMap?.get(record.agentId) ?? null;
      out.push(await this.maybeRotateFromObservation("orchestrator", record.key, live, agentMap));
    }
    const frontDeskId = this.readFrontDesk()?.agentId ?? null;
    if (frontDeskId) {
      const live = agentMap?.get(frontDeskId) ?? null;
      out.push(await this.maybeRotateFromObservation("front-desk", null, live, agentMap));
    }
    return out.filter((r) => r.ok || r.errorCode !== "disabled");
  }

  private async maybeRotateFromObservation(
    role: string,
    repo: string | null,
    live: WatchdogAgent | null,
    agentMap: Map<string, WatchdogAgent> | null,
  ): Promise<UppidiRotateRoleOutput> {
    const lockKey = RotationLock.key(role, repo);
    const decision = evaluateRotationTrigger(
      this.observationForRole(role, repo, live),
      {
        nowMs: Date.now(),
        lastRotationAtMs: this.lastRotationAt.get(lockKey) ?? null,
        midTurn: live ? this.isAgentBusy(live.id, agentMap) : false,
        inFlight: this.rotationLock.isLocked(role, repo),
      },
      this.readRotationPolicy(),
    );
    if (!decision.shouldRotate) {
      return { ok: false, role, repo: repo ?? undefined, triggers: [], errorCode: decision.blocked === "disabled" ? "disabled" : "in_flight", error: decision.blocked ? `blocked: ${decision.blocked}` : decision.reasons.join(", ") || "no trigger" };
    }
    return await this.rotateRole({ role, repo: repo ?? undefined, reason: decision.reason ?? "auto" });
  }

  // -------------------------------------------------------------------------
  // Deterministic board sweep
  // -------------------------------------------------------------------------

  /**
   * Parse the external checker's stdout into candidates; null when it is not
   * the checker's JSON report. The checker exits 1 whenever candidates exist,
   * so stdout must be read from the failure object too.
   */
  private parseExternalCheckerStdout(stdout: string): BoardCandidate[] | null {
    try {
      const parsed = JSON.parse(stdout || "{}");
      return Array.isArray(parsed?.ranked_candidates) ? parsed.ranked_candidates : [];
    } catch {
      return null;
    }
  }

  /**
   * Run the deterministic board check for one repo. The checker is the ported
   * in-process module (#733); a failing transport (teax missing or erroring)
   * throws instead of degrading to an empty board — silence here used to hide
   * a missing dependency from Front Desk entirely.
   *
   * `FORGEJO_ISSUES_CHECK` is a debug-only override that execs an external
   * checker instead; it is not the primary path and must not be set in
   * production.
   */
  public async runBoardCheck(
    repo: string,
    hostname = "forge.mrs.uppidi.com",
    io?: IssuesCheckIo,
  ): Promise<BoardCheckResult> {
    // Enrolled keys may be `owner/repo` or the forge-qualified `host/owner/repo`;
    // the checker's `-R` argument always wants the trailing `owner/repo`.
    const parts = String(repo ?? "").split("/").filter(Boolean);
    const ownerRepo = parts.length > 2 ? parts.slice(-2).join("/") : parts.join("/");
    const debugScript = process.env.FORGEJO_ISSUES_CHECK;
    if (debugScript) {
      this.log(`[warn] FORGEJO_ISSUES_CHECK debug override active: exec ${debugScript}`);
      try {
        const { stdout } = await execFileAsync(debugScript, ["--hostname", hostname, "-R", ownerRepo, "--json"], {
          timeout: 30000,
          maxBuffer: 5 * 1024 * 1024,
        });
        return { repo, ok: true, candidates: this.parseExternalCheckerStdout(stdout) ?? [] };
      } catch (err: any) {
        const fromStdout = err?.stdout ? this.parseExternalCheckerStdout(String(err.stdout)) : null;
        if (fromStdout) return { repo, ok: true, candidates: fromStdout };
        return { repo, ok: false, candidates: [], error: err instanceof Error ? err.message : String(err) };
      }
    }
    const outcome = await runIssuesCheck({
      hostname,
      repo: ownerRepo,
      all: true,
      sweepStaleWip: this.staleWipSweepEnabled,
      staleWipHours: this.staleWipHours,
      io: io ?? createDefaultIssuesCheckIo(),
    });
    return {
      repo,
      ok: true,
      candidates: outcome.rankedCandidates,
      staleWipRecovery: outcome.staleWipRecovery,
    };
  }

  /**
   * Deterministic SHA256 digest of a repo's actionable candidate set (#1181).
   * The tuple is sorted and stable so the same board produces the same digest
   * regardless of API ordering.
   */
  private actionableDigest(candidates: readonly BoardCandidate[]): string {
    const parts = candidates
      .map(
        (c) =>
          `${c.number}|${(c.labels ?? []).slice().sort().join(",")}|${c.is_dispatchable ? 1 : 0}|${c.category ?? ""}`,
      )
      .sort();
    return createHash("sha256").update(parts.join("\n")).digest("hex");
  }

  public async runBoardSweep(
    repos?: string[],
    io?: IssuesCheckIo,
    opts: { explicit?: boolean } = {},
  ): Promise<BoardSweepResult> {
    if (this.isHaltedState) {
      return { ok: true, swept: 0, actionable: [], staleWipRecovered: [], errors: [], prunedCount: 0, autoEnsured: [], notified: 0 };
    }
    const liveAgentMap = await this.fetchAgentMap().catch(() => null);
    await this.reconcileFrontDesk(liveAgentMap);
    const rawTargets = (repos ?? this.getEnrolledRepos()).filter((k) => {
      if (!k || k === "frontdesk") return false;
      const parts = k.split("/").filter(Boolean);
      return parts.length >= 2;
    });
    const targets = Array.from(new Set(rawTargets.map((k) => canonicalRepoKey(k) ?? k)));
    const sweepKey = targets.slice().sort().join(",");
    const inFlight = this.inFlightBoardSweep.get(sweepKey);
    if (inFlight) {
      return await inFlight;
    }

    const promise = (async (): Promise<BoardSweepResult> => {
      const actionable: BoardSweepResult["actionable"] = [];
      const staleWipRecovered: StaleWipResult[] = [];
      const errors: Array<{ repo: string; error: string }> = [];
      // Per-repo actionable-set digest for the delta gate (#1181).
      const sweepDigests = new Map<string, string>();
      const pruneResult = await this.pruneOrchestrators();
      const prunedCount = pruneResult.prunedCount;
      if (!pruneResult.ok) {
        this.log(`[warn] Board sweep could not prune orchestrator records: ${pruneResult.error ?? "unknown error"}`);
      }
      for (const repo of targets) {
        let res: BoardCheckResult;
        try {
          res = await this.runBoardCheck(repo, undefined, io);
        } catch (err) {
          // A failed check is loud: logged, returned, and reported to Front
          // Desk, because an unreported failure looks exactly like a clean board.
          const error = err instanceof Error ? err.message : String(err);
          errors.push({ repo, error });
          sweepDigests.set(repo, "#board-check-error");
          this.log(`[error] board check failed for ${repo}: ${error}`);
          continue;
        }
        if (res.staleWipRecovery && res.staleWipRecovery.length > 0) {
          staleWipRecovered.push(...res.staleWipRecovery);
        }
        sweepDigests.set(repo, res.ok ? this.actionableDigest(res.candidates) : "#board-check-error");
        if (!res.ok || res.candidates.length === 0) continue;
        const dispatchable = res.candidates.filter((c) => c.is_dispatchable).length;
        actionable.push({ repo, count: res.candidates.length, dispatchable });
        this.lastSweepDigests.set(
          repo,
          `${res.candidates.length} candidate(s), ${dispatchable} dispatchable at ${new Date().toISOString()}`,
        );
      }

      // Delta gate (#1181): only deliver when the actionable set or the error
      // state actually changed, or an operator asked explicitly. An unchanged
      // board must not wake Front Desk on the rigid sweep interval.
      let actionableChanged = opts.explicit === true;
      for (const repo of targets) {
        const digest = sweepDigests.get(repo) ?? "";
        if (this.lastSweepActionDigests.get(repo) !== digest) actionableChanged = true;
      }
      const errorSignature = errors
        .map((e) => `${e.repo}:${e.error}`)
        .sort()
        .join("|");
      const errorStateChanged = opts.explicit === true || errorSignature !== this.lastSweepErrorSignature;
      for (const repo of targets) {
        this.lastSweepActionDigests.set(repo, sweepDigests.get(repo) ?? "");
      }
      this.lastSweepErrorSignature = errorSignature;
      const hasWork = actionable.length > 0 || errors.length > 0;
      const shouldNotify = hasWork && (actionableChanged || errorStateChanged);


      // Self-heal staffing (#889): an enrolled repo with actionable board work but
      // no active orchestrator gets one provisioned before the notification.
      const autoEnsured: Array<{ repo: string; agentId?: string; status?: string; error?: string }> = [];
      for (const item of actionable) {
        try {
          const ensured = await this.ensureUnstaffedEnrolledRepo(item.repo, { reason: "board sweep actionable" });
          if (ensured) {
            autoEnsured.push({ repo: item.repo, agentId: ensured.agentId, status: ensured.status, error: ensured.error });
          }
        } catch (err) {
          this.log(`[warn] Auto-ensure failed for ${item.repo}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      let notified = 0;
      const frontDeskId = this.readFrontDesk()?.agentId ?? null;
      if (frontDeskId && shouldNotify) {
        const sections: string[] = [];
        if (actionable.length > 0) {
          const lines = actionable.map((a) => {
            return `- ${a.repo}: ${a.count} actionable (${a.dispatchable} dispatchable)`;
          });
          sections.push(`[Fleet Board Sweep] ${actionable.length} repo(s) with actionable tickets:\n${lines.join("\n")}`);
        }
        if (errors.length > 0) {
          const failureLines = errors.map((e) => `- ${e.repo}: check failed (${e.error})`);
          sections.push(
            `[Fleet Board Sweep] ${errors.length} repo(s) FAILED board check - actionable tickets may be missed:\n${failureLines.join("\n")}`,
          );
        }
        const alertMsg = sections.join("\n\n");
        const isBusy = this.isAgentBusy(frontDeskId);
        if (isBusy) {
          this.log(`[info] Front Desk ${frontDeskId} is busy; queueing board sweep notification`);
          this.enqueue("frontdesk", alertMsg, false);
          notified = 1;
        } else {
          const ok = await this.deliverMessage(frontDeskId, alertMsg, { noWait: true, steer: false });
          if (ok) {
            this.lastDeliveryTimes.set(frontDeskId, Date.now());
            notified = 1;
          }
        }
      } else if (frontDeskId && hasWork && !shouldNotify) {
        this.log("Board sweep actionable set unchanged; suppressing Front Desk notification");
      }
      this.log(
        `[info] Board sweep complete: ${targets.length} repo(s) swept, ${actionable.length} actionable, ${prunedCount} orchestrator record(s) pruned, ${autoEnsured.length} auto-staffed, ${errors.length} failed`,
      );
      // Re-evaluate dormancy with this sweep's roster so a quiet fleet enters
      // quiescent mode (and an actionable board re-wakes it) (#1181).
      this.refreshDormancy(liveAgentMap);
      await this.evaluateAutomaticRotations().catch(() => []);
      return {
        ok: true,
        swept: targets.length,
        actionable,
        ...(staleWipRecovered.length > 0 ? { staleWipRecovered } : {}),
        notified,
        prunedCount,
        ...(errors.length > 0 ? { errors } : {}),
        ...(autoEnsured.length > 0 ? { autoEnsured } : {}),
      };
    })();

    this.inFlightBoardSweep.set(sweepKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightBoardSweep.delete(sweepKey);
    }
  }

  public startBackgroundLoops(): void {
    if (this.isHaltedState) return;
    if (this.watchdogIntervalMs > 0 && !this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        void this.runWatchdogAudit().catch(() => {});
      }, this.watchdogIntervalMs);
      this.watchdogTimer.unref?.();
    }
    if (this.boardSweepIntervalMs > 0 && !this.boardSweepTimer) {
      this.boardSweepTimer = setInterval(() => {
        void this.runBoardSweep().catch(() => {});
      }, this.boardSweepIntervalMs);
      this.boardSweepTimer.unref?.();
    }
  }

  public stopBackgroundLoops(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.boardSweepTimer) {
      clearInterval(this.boardSweepTimer);
      this.boardSweepTimer = null;
    }
  }

  private queueFilePath(key: string): string {
    return join(this.queueDir, `${sanitizeKey(key)}.json`);
  }

  private loadPersistedQueues(): void {
    if (!existsSync(this.queueDir)) return;
    try {
      const files = readdirSync(this.queueDir);
      for (const file of files) {
        if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;
        const fullPath = join(this.queueDir, file);
        try {
          const content = readFileSync(fullPath, "utf8").trim();
          if (!content) continue;

          let entries: QueueEntry[] = [];
          if (file.endsWith(".jsonl")) {
            entries = content
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
              .filter((e) => e && typeof e.msg === "string");
          } else {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              entries = parsed.filter((e) => e && typeof e.msg === "string");
            }
          }

          if (entries.length > 0) {
            const queueKey = entries[0].key || file.replace(/\.jsonl?$/, "");
            this.queues.set(queueKey, entries);
          }
        } catch {
          // ignore corrupted queue files
        }
      }
    } catch {
      // ignore read failures
    }
  }

  private persistQueue(key: string): void {
    if (this.isClosed) return;
    const target = this.queueFilePath(key);
    const entries = this.queues.get(key) ?? [];

    if (entries.length === 0) {
      if (existsSync(target)) {
        try {
          unlinkSync(target);
        } catch (err) {
          this.log(`[warn] file purge/delete failed (hook-router.ts:4020): ${err}`);
        }
      }
      return;
    }

    try {
      mkdirSync(this.queueDir, { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
      renameSync(tmp, target);
    } catch (err) {
      console.error(`[uppidi-fleet:hook-router] Failed to persist queue for ${key}:`, err);
    }
  }

  public enqueue(key: string, msg: string, isSos = false, stableIdOverride?: string): QueueEntry {
    const list = this.queues.get(key) ?? [];
    const id = stableIdOverride ?? stableId(key, msg);

    const existingIdx = list.findIndex((item) => item.id === id);
    if (existingIdx !== -1) {
      return list[existingIdx];
    }

    const entry: QueueEntry = {
      id,
      key,
      msg,
      ts: Date.now(),
      isSos,
    };

    if (isSos) {
      list.unshift(entry);
    } else {
      list.push(entry);
    }

    // Prune excessive depth if needed (> 50 entries)
    if (list.length > 50) {
      const dropped = list.splice(0, list.length - 50);
      this.droppedCount.set(key, (this.droppedCount.get(key) ?? 0) + dropped.length);
      this.log(`[warn] Queue ${key} exceeded depth limit; dropped ${dropped.length} messages`);
    }

    this.queues.set(key, list);
    this.persistQueue(key);
    this.log(`[info] Enqueued message ${entry.id} for ${key} (total depth: ${list.length}, sos: ${Boolean(isSos)})`);
    if (!this.isRepoPaused(key)) {
      void this.drain(key);
    } else {
      this.log(`[info] Drain suppressed for paused repository ${key}`);
    }
    return entry;
  }

  public getQueue(key: string): QueueEntry[] {
    return [...(this.queues.get(key) ?? [])];
  }

  /**
   * Remove a specific queue entry by id and persist the updated queue.
   * Returns true if an entry was found and removed (#1118).
   */
  public removeQueueEntry(key: string, entryId: string): boolean {
    const list = this.queues.get(key);
    if (!list || list.length === 0) return false;
    const idx = list.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.persistQueue(key);
    this.log(`[info] Removed message ${entryId} from queue ${key} (remaining depth: ${list.length})`);
    return true;
  }


  public pause(key?: string): string[] {
    if (!key || key === "all") {
      this.allQueuesPaused = true;
      for (const k of this.queues.keys()) {
        this.pausedQueues.add(k);
      }
      for (const k of this.getEnrolledRepos()) {
        this.pausedQueues.add(k);
      }
      if (this.queues.has("frontdesk") || this.readFrontDesk()?.agentId) {
        this.pausedQueues.add("frontdesk");
      }
      this.log("[info] All queues paused");
    } else {
      this.pausedQueues.add(key);
      this.log(`[info] Queue ${key} paused`);
    }
    return Array.from(this.pausedQueues);
  }

  public resume(key?: string): string[] {
    if (this.teardownInProgress) {
      this.log("[warn] resume ignored: fleet teardown in progress");
      return Array.from(this.pausedQueues);
    }
    if (!key || key === "all") {
      this.isHaltedState = false;
      this.allQueuesPaused = false;
      this.pausedQueues.clear();
      this.log("[info] All queues resumed");
      for (const k of this.queues.keys()) {
        if (!this.isRepoPaused(k)) {
          void this.drain(k);
        }
      }
    } else {
      if (this.allQueuesPaused) {
        // Transition a global pause into per-queue pauses so resuming one
        // queue keeps every other queue paused (#877).
        for (const k of this.queues.keys()) {
          this.pausedQueues.add(k);
        }
        for (const k of this.getEnrolledRepos()) {
          this.pausedQueues.add(k);
        }
        this.allQueuesPaused = false;
      }
      this.pausedQueues.delete(key);
      this.log(`[info] Queue ${key} resumed`);
      if (!this.isRepoPaused(key)) {
        void this.drain(key);
      }
    }
    return Array.from(this.pausedQueues);
  }

  public isPaused(key: string): boolean {
    if (this.isHaltedState) return true;
    if (key === "all") return this.allQueuesPaused || this.pausedQueues.has(key);
    return this.allQueuesPaused || this.pausedQueues.has(key);
  }

  /** True while a global `pause('all')` is in effect (#877). */
  public isAllPaused(): boolean {
    return this.isHaltedState || this.allQueuesPaused;
  }

  /**
   * Canonical ALL HALT method (#994): pauses all queue ingress and processing,
   * stops background loops (watchdog and board sweep), and suppresses all
   * auto-provisioning (orchestrators, unstaffed repos, front desk).
   */
  public halt(): void {
    this.isHaltedState = true;
    this.pause("all");
    this.stopBackgroundLoops();
    this.log("[warn] HookRouter canonical ALL HALT engaged: background loops stopped, ingress paused, auto-provisioning disabled");
  }

  /** Returns true when the canonical ALL HALT state is engaged (#994). */
  public isHalted(): boolean {
    return this.isHaltedState;
  }

  /**
   * Marks the start of a fleet teardown window (#1013). While a teardown is
   * mid-flight `resume()`/`resumeAll()` must not clear the halt, otherwise
   * ingress and auto-provisioning would race the archiving work.
   */
  public markTeardownStart(): void {
    this.teardownInProgress = true;
  }

  /** Clears the teardown window once teardown finishes (success or error). */
  public markTeardownEnd(): void {
    this.teardownInProgress = false;
  }

  /** True while a fleet teardown is running (#1013). */
  public isTeardownInProgress(): boolean {
    return this.teardownInProgress;
  }

  /**
   * Thin operator-facing wrapper over `resume("all")` (#1013). Refuses while a
   * teardown is mid-flight and reports whether the halt was actually cleared.
   */
  public resumeAll(): { ok: boolean; resumed: boolean; error?: string } {
    if (this.teardownInProgress) {
      return {
        ok: false,
        resumed: false,
        error: "Fleet teardown in progress; halt cannot be resumed until it completes",
      };
    }
    this.resume("all");
    return { ok: true, resumed: true };
  }

  /**
   * True when every drain target owned by `agentId` is paused (#877).
   * A global pause-all suppresses all drains; an agent with no drain targets
   * is never suppressed so the turn_ended log keeps its existing wording.
   */
  private isAgentDrainSuppressed(agentId: string): boolean {
    let hasTarget = false;
    const frontDesk = this.readFrontDesk();
    if (frontDesk?.agentId === agentId) {
      hasTarget = true;
      if (!this.isPaused("frontdesk")) return false;
    }
    for (const [key] of this.queues.entries()) {
      if (key === "frontdesk") continue;
      const orch = this.readOrchestrator(key);
      if (orch?.agentId === agentId) {
        hasTarget = true;
        if (!this.isPaused(key)) return false;
      }
    }
    for (const key of this.busyAttempts.keys()) {
      if (key === "frontdesk") continue;
      if (this.queues.has(key)) continue;
      const orch = this.readOrchestrator(key);
      if (orch?.agentId === agentId) {
        hasTarget = true;
        if (!this.isPaused(key)) return false;
      }
    }
    return hasTarget;
  }

  public clearQueue(key: string): number {
    let count = 0;
    const target = this.queueFilePath(key);
    try {
      if (existsSync(target)) {
        unlinkSync(target);
        count++;
      }
    } catch (err) {
      this.log(`[warn] file purge/delete failed (hook-router.ts:4124): ${err}`);
    }
    this.queues.delete(key);
    this.busyQueues.delete(key);
    this.busyAttempts.delete(key);
    this.draining.delete(key);
    this.droppedCount.delete(key);
    this.pausedQueues.delete(key);
    const timer = this.backoffTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.backoffTimers.delete(key);
    }
    // Drop coalesced/dedup state so a torn-down scope never retains a stale
    // lock that suppresses future legitimate traffic (#872).
    for (const bkey of Array.from(this.coalesceBuffers.keys())) {
      if (bkey === key || bkey.startsWith(`${key}#`)) {
        const entry = this.coalesceBuffers.get(bkey);
        if (entry?.timer) clearTimeout(entry.timer);
        this.coalesceBuffers.delete(bkey);
      }
    }
    for (const skey of Array.from(this.sosStates.keys())) {
      if (skey === key || skey.startsWith(`${key}#`)) {
        this.sosStates.delete(skey);
      }
    }
    return count;
  }

  public clearFrontDesk(opts: StateMutationOptions = {}): number {
    let count = 0;
    const candidates = this.frontDeskCandidatePaths();
    // Capture the registration before unlinking so the audit log records the
    // prior value and the in-memory delivery state is released (#1077).
    const frontDesk = this.readFrontDesk();
    const removedPaths: string[] = [];

    for (const p of candidates) {
      if (existsSync(p)) {
        try {
          unlinkSync(p);
          removedPaths.push(p);
          count++;
        } catch (err) {
          this.log(`[warn] file purge/delete failed (hook-router.ts:4151): ${err}`);
        }
      }
    }

    if (frontDesk?.agentId) {
      this.lastDeliveryTimes.delete(frontDesk.agentId);
    }
    this.lastDeliveryTimes.delete("frontdesk");
    count += this.clearQueue("frontdesk");
    this.coalesceBuffers.delete("frontdesk");
    this.sosStates.delete("frontdesk");
    if (removedPaths.length > 0 || frontDesk?.agentId) {
      this.appendStateMutation({
        action: "clearFrontDesk",
        source: opts.source ?? "unspecified",
        actor: opts.actor ?? null,
        reason: opts.reason ?? null,
        key: FRONT_DESK_REPO,
        priorValue: { record: frontDesk, paths: removedPaths },
      });
    } else {
      // A deliberate clear attempt with no registration is still an actor event.
      this.appendStateMutation({
        action: "clearFrontDesk",
        source: opts.source ?? "unspecified",
        actor: opts.actor ?? null,
        reason: opts.reason ?? "no registration present",
        key: FRONT_DESK_REPO,
        priorValue: null,
      });
    }
    this.log(`[info] Cleared frontdesk registration and queues (${count} state file(s) removed)`);
    return count;
  }

  public clearAllOrchestrators(opts: StateMutationOptions = {}): number {
    let count = 0;
    // Capture registered records before unlinking so the audit log records the
    // prior values and in-memory locks for those scopes can be released (#872/#1077).
    let registeredKeys: string[] = [];
    let priorRecords: OrchestratorRecord[] = [];
    try {
      priorRecords = this.listOrchestratorRecords();
      registeredKeys = priorRecords.map((r) => r.key);
    } catch {}
    const removedFiles: string[] = [];
    try {
      if (existsSync(this.stateDir)) {
        const files = readdirSync(this.stateDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "frontdesk.json") continue;
          try {
            unlinkSync(join(this.stateDir, file));
            removedFiles.push(file);
            count++;
          } catch (err) {
            this.log(`[warn] file purge/delete failed (hook-router.ts:4177): ${err}`);
          }
        }
      }
    } catch (err) {
      this.log(`[warn] file purge/delete failed (hook-router.ts:4180): ${err}`);
    }
    for (const key of registeredKeys) {
      this.busyQueues.delete(key);
      this.busyAttempts.delete(key);
      this.draining.delete(key);
      this.droppedCount.delete(key);
      this.pausedQueues.delete(key);
      const timer = this.backoffTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.backoffTimers.delete(key);
      }
      for (const bkey of Array.from(this.coalesceBuffers.keys())) {
        if (bkey === key || bkey.startsWith(`${key}#`)) {
          const entry = this.coalesceBuffers.get(bkey);
          if (entry?.timer) clearTimeout(entry.timer);
          this.coalesceBuffers.delete(bkey);
        }
      }
      for (const skey of Array.from(this.sosStates.keys())) {
        if (skey === key || skey.startsWith(`${key}#`)) {
          this.sosStates.delete(skey);
        }
      }
    }
    if (count > 0) {
      this.appendStateMutation({
        action: "clearAllOrchestrators",
        source: opts.source ?? "unspecified",
        actor: opts.actor ?? null,
        reason: opts.reason ?? null,
        key: null,
        priorValue: { records: priorRecords, files: removedFiles },
      });
    }
    this.log(`[info] Purged all orchestrators (${count} file(s) removed)`);
    return count;
  }

  public clearAllQueues(): number {
    let count = 0;
    for (const key of this.queues.keys()) {
      const target = this.queueFilePath(key);
      try {
        if (existsSync(target)) {
          unlinkSync(target);
          count++;
        }
      } catch (err) {
        this.log(`[warn] file purge/delete failed (hook-router.ts:4194): ${err}`);
      }
    }
    try {
      if (existsSync(this.queueDir)) {
        for (const file of readdirSync(this.queueDir)) {
          if (file.endsWith(".json") || file.endsWith(".jsonl")) {
            try {
              unlinkSync(join(this.queueDir, file));
              count++;
            } catch (err) {
              this.log(`[warn] file purge/delete failed (hook-router.ts:4203): ${err}`);
            }
          }
        }
      }
    } catch (err) {
      this.log(`[warn] file purge/delete failed (hook-router.ts:4207): ${err}`);
    }
    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    this.backoffTimers.clear();
    this.busyQueues.clear();
    this.draining.clear();
    this.queues.clear();
    this.busyAttempts.clear();
    this.droppedCount.clear();
    this.pausedQueues.clear();
    this.allQueuesPaused = false;
    for (const entry of this.coalesceBuffers.values()) {
      if (entry?.timer) clearTimeout(entry.timer);
    }
    this.coalesceBuffers.clear();
    this.sosStates.clear();
    this.log(`[info] Purged all queues (${count} file(s) removed)`);
    return count;
  }

  /**
   * Fleet-teardown reconciliation (#872): record the teardown stamp, suppress
   * future false amnesia/lock alerts for the culled agent ids, release any
   * remaining stale locks, and invalidate cached agent state.
   */
  public teardownStatusPath(): string {
    return join(dirname(this.stateDir), "teardown-status.json");
  }

  public markFleetTeardown(targets: string[], tornDownAgentIds: string[] = []): void {
    const now = Date.now();
    this.lastTeardownAt = now;
    this.lastTeardownTargets = [...targets].sort();
    // Persist the teardown stamp so registry + queue status surfaces reflect
    // teardown across restarts (#872).
    try {
      mkdirSync(dirname(this.teardownStatusPath()), { recursive: true });
      const payload = { at: now, iso: new Date(now).toISOString(), targets: this.lastTeardownTargets };
      const tmp = `${this.teardownStatusPath()}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
      renameSync(tmp, this.teardownStatusPath());
    } catch {}
    for (const id of tornDownAgentIds) {
      if (id) this.tornDownAgentIds.add(id);
    }
    // Bound the suppression set so long-lived routers never leak memory.
    if (this.tornDownAgentIds.size > 500) {
      const trimmed = Array.from(this.tornDownAgentIds).slice(-500);
      this.tornDownAgentIds = new Set(trimmed);
    }
    // Drop watchdog cooldown entries for culled agents so a stale alert key
    // can never re-fire after legitimate teardown.
    for (const key of Array.from(this.watchdogAlerts.keys())) {
      for (const id of tornDownAgentIds) {
        if (id && key.includes(id)) {
          this.watchdogAlerts.delete(key);
          break;
        }
      }
    }
    // Invalidate cached live state for culled agents; a full reset when the
    // teardown covered orchestrators/frontdesk avoids ghost busy flags.
    if (this.latestAgentMap) {
      for (const id of tornDownAgentIds) {
        this.latestAgentMap.delete(id);
      }
      if (targets.includes("orchestrators") || targets.includes("frontdesk")) {
        // Keep the map object but drop any entry that no longer resolves to a
        // registered orchestrator/frontdesk — stale running flags are the
        // classic source of false TURN_CONCURRENCY_LOCK after teardown.
        const liveOrchestratorIds = new Set(this.listOrchestratorAgentIds());
        const frontDeskId = this.readFrontDesk()?.agentId ?? null;
        if (frontDeskId) liveOrchestratorIds.add(frontDeskId);
        for (const cachedId of Array.from(this.latestAgentMap.keys())) {
          if (tornDownAgentIds.includes(cachedId)) continue;
          // Only prune orchestrator/frontdesk-scoped entries; workers are
          // ephemeral and already removed above when culled.
          if (!liveOrchestratorIds.has(cachedId)) {
            const entry = this.latestAgentMap.get(cachedId);
            const role = String((entry as any)?.role ?? "").toLowerCase();
            const title = String((entry as any)?.title ?? (entry as any)?.name ?? "").toLowerCase();
            if (role === "orchestrator" || title.includes("orchestrator") || title.includes("front desk")) {
              this.latestAgentMap.delete(cachedId);
            }
          }
        }
      }
    }
    this.log(
      `[info] Fleet teardown reconciled: targets=${this.lastTeardownTargets.join(",") || "none"} ` +
        `tornDown=${tornDownAgentIds.length} agent(s), stale locks released`,
    );
  }

  /** True when an agent id was legitimately culled by fleet teardown (#872). */
  public isTeardownSuppressedAgent(agentId: string): boolean {
    if (!agentId) return false;
    return this.tornDownAgentIds.has(agentId);
  }

  /** Teardown stamp reflected across registry + queue status surfaces (#872). */
  public getTeardownStatus(): { at: number | null; targets: string[] } {
    return { at: this.lastTeardownAt, targets: [...this.lastTeardownTargets] };
  }

  /**
   * Broadcast a teardown notice via the persistent hook-router queue so it
   * survives the subsequent archive/cull (#872). Enqueues to Front Desk and
   * every registered orchestrator scope with SOS priority, then best-effort
   * direct-delivers. Returns the queue keys notified.
   */
  public async broadcastTeardownNotice(
    notice: string,
    opts: { targets?: string[] } = {},
  ): Promise<{ queuedKeys: string[]; delivered: number }> {
    const queuedKeys: string[] = [];
    let delivered = 0;
    const frontDesk = this.readFrontDesk();
    const orchestrators = this.listOrchestratorRecords();
    const targetSet = new Set(opts.targets ?? []);
    // Remaining groups only (#872): skip scopes being culled so we never leave
    // an orphaned queue behind (which would trip QUEUE_UNORCHESTRATED). The
    // caller re-enqueues an audit copy to `frontdesk` after the cull when the
    // teardown covers everything, and `frontdesk` is exempt from that alert.
    const includeFrontDesk = !targetSet.has("frontdesk");
    const includeOrchestrators = !targetSet.has("orchestrators");
    if (includeFrontDesk && frontDesk?.agentId) {
      let entryId: string | null = null;
      try {
        const entry = this.enqueue("frontdesk", notice, true);
        entryId = entry.id;
        if (!queuedKeys.includes("frontdesk")) queuedKeys.push("frontdesk");
      } catch {}
      try {
        const ok = await this.deliverMessage(frontDesk.agentId, notice, { noWait: true, steer: true });
        if (ok) {
          delivered++;
          if (entryId) {
            this.removeQueueEntry("frontdesk", entryId);
          }
        }
      } catch {}
    }
    if (includeOrchestrators) {
      for (const rec of orchestrators) {
        if (!rec.agentId || !rec.key) continue;
        let entryId: string | null = null;
        try {
          const entry = this.enqueue(rec.key, notice, true);
          entryId = entry.id;
          if (!queuedKeys.includes(rec.key)) queuedKeys.push(rec.key);
        } catch {}
        try {
          const ok = await this.deliverMessage(rec.agentId, notice, { noWait: true, steer: true });
          if (ok) {
            delivered++;
            if (entryId) {
              this.removeQueueEntry(rec.key, entryId);
            }
          }
        } catch {}
      }
    }
    this.log(`[info] Fleet teardown broadcast queued for ${queuedKeys.length} scope(s), delivered to ${delivered} agent(s)`);
    return { queuedKeys, delivered };
  }

  public purgeQueue(repo: string): { ok: boolean; repo: string; purgedMessages: number; fileRemoved: boolean; error?: string } {
    const rawKey = String(repo ?? "").trim();
    if (!rawKey) {
      return { ok: false, repo: rawKey, purgedMessages: 0, fileRemoved: false, error: "Repository parameter is required" };
    }

    const canonical = canonicalRepoKey(rawKey) ?? rawKey;
    const matchingKeys = new Set<string>([rawKey, canonical]);
    for (const k of this.queues.keys()) {
      if (k === rawKey || canonicalRepoKey(k) === canonical) {
        matchingKeys.add(k);
      }
    }

    let purgedMessages = 0;
    let fileRemoved = false;

    for (const key of matchingKeys) {
      const entries = this.queues.get(key);
      if (entries) {
        purgedMessages += entries.length;
        this.queues.delete(key);
      }
      const timer = this.backoffTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.backoffTimers.delete(key);
      }
      this.busyQueues.delete(key);
      this.draining.delete(key);
      this.busyAttempts.delete(key);
      this.droppedCount.delete(key);

      const target = this.queueFilePath(key);
      try {
        if (existsSync(target)) {
          unlinkSync(target);
          fileRemoved = true;
        }
      } catch (err) {
        this.log(`[warn] file purge/delete failed (hook-router.ts:4259): ${err}`);
      }

      const jsonlTarget = join(this.queueDir, `${sanitizeKey(key)}.jsonl`);
      try {
        if (existsSync(jsonlTarget)) {
          unlinkSync(jsonlTarget);
          fileRemoved = true;
        }
      } catch (err) {
        this.log(`[warn] file purge/delete failed (hook-router.ts:4267): ${err}`);
      }
    }

    this.log(`[info] Purged queue for ${rawKey}: ${purgedMessages} message(s) purged, fileRemoved=${fileRemoved}`);
    return { ok: true, repo: rawKey, purgedMessages, fileRemoved };
  }

  public getLatestAgentMap(): Map<string, WatchdogAgent> | null {
    return this.latestAgentMap;
  }

  public setLatestAgentMap(map: Map<string, WatchdogAgent> | null): void {
    this.latestAgentMap = map;
  }

  public updateAgentCache(agentId: string, patch: Partial<WatchdogAgent>): void {
    if (!agentId || !this.latestAgentMap) return;
    const existing = this.latestAgentMap.get(agentId);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      this.latestAgentMap.set(agentId, { id: agentId, ...patch });
    }
  }

  public invalidateAgentCache(agentId?: string): void {
    if (!this.latestAgentMap) return;
    if (!agentId) {
      this.latestAgentMap = null;
    } else {
      this.latestAgentMap.delete(agentId);
    }
  }

  public resetBusyForAgent(agentId: string, triggerDrain = false): void {
    const frontDesk = this.readFrontDesk();
    if (frontDesk?.agentId === agentId) {
      this.busyQueues.delete("frontdesk");
      this.busyAttempts.delete("frontdesk");
      this.lastDeliveryTimes.delete(agentId);
      const timer = this.backoffTimers.get("frontdesk");
      if (timer) {
        clearTimeout(timer);
        this.backoffTimers.delete("frontdesk");
      }
      if (triggerDrain && !this.isRepoPaused("frontdesk") && !this.isPaused("frontdesk")) {
        void this.drain("frontdesk");
      }
    }

    for (const [key, items] of this.queues.entries()) {
      if (key === "frontdesk") continue;
      const orch = this.readOrchestrator(key);
      if (orch?.agentId === agentId) {
        this.busyQueues.delete(key);
        this.busyAttempts.delete(key);
        const timer = this.backoffTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.backoffTimers.delete(key);
        }
        if (triggerDrain && items.length > 0 && !this.isRepoPaused(key) && !this.isPaused(key)) {
          void this.drain(key);
        }
      }
    }

    for (const key of Array.from(this.busyAttempts.keys())) {
      if (key === "frontdesk") continue;
      const orch = this.readOrchestrator(key);
      if (orch?.agentId === agentId) {
        this.busyQueues.delete(key);
        this.busyAttempts.delete(key);
        const timer = this.backoffTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.backoffTimers.delete(key);
        }
      }
    }
  }

  public handleLifecycleEvent(name: string, event: any, context?: any): void {
    if (context?.paseo) {
      this.activePaseo = context.paseo;
    }
    const agent = event?.agent ?? event;
    const agentId = agent?.id ?? agent?.agentId;
    if (!agentId) return;

    if (name === "agent.turn_ended") {
      const drainSuppressed = this.isAgentDrainSuppressed(agentId);
      if (drainSuppressed) {
        this.log(`[info] Agent turn ended for agent ${agentId}, queue drain suppressed (paused)`);
      } else {
        this.log(`[info] Agent turn ended for agent ${agentId}, triggering queue drain`);
      }
      if (this.latestAgentMap) {
        const existing = this.latestAgentMap.get(agentId);
        if (existing) {
          existing.status = "idle";
          existing.activeTurn = null;
        } else {
          this.latestAgentMap.set(agentId, { id: agentId, status: "idle", activeTurn: null });
        }
      }
      this.resetBusyForAgent(agentId, !drainSuppressed);
    } else if (name === "agent.turn_started") {
      if (this.latestAgentMap) {
        const existing = this.latestAgentMap.get(agentId);
        if (existing) {
          existing.status = "running";
          existing.activeTurn = { startedAt: new Date().toISOString() };
        } else {
          this.latestAgentMap.set(agentId, {
            id: agentId,
            status: "running",
            activeTurn: { startedAt: new Date().toISOString() },
          });
        }
      }
    } else if (name === "agent.updated" || name === "agent_update" || name === "agent.status") {
      const status = agent.status ?? (agent.activeTurn ? "running" : undefined);
      if (this.latestAgentMap) {
        const existing = this.latestAgentMap.get(agentId);
        if (existing) {
          if (status !== undefined) existing.status = status;
          if (agent.activeTurn !== undefined) existing.activeTurn = agent.activeTurn;
        } else if (status !== undefined) {
          this.latestAgentMap.set(agentId, { id: agentId, status, activeTurn: agent.activeTurn ?? null });
        }
      }
      if (status === "idle" || status === "stopped" || status === "closed") {
        this.resetBusyForAgent(agentId, true);
      }
    }
  }

  private bindLifecycleEvents(): void {
    if (this.unsubscribeLifecycle) return;
    if (this.server && typeof this.server.on === "function") {
      const unsubs: Array<() => void> = [];
      const safeOn = (name: string, handler: (event: any, context?: any) => Promise<void> | void) => {
        try {
          const off = (this.server as any).on(name, handler);
          if (typeof off === "function") unsubs.push(off);
        } catch {
          // Event unsupported
        }
      };

      safeOn("agent.turn_ended", (event, context) => this.handleLifecycleEvent("agent.turn_ended", event, context));
      safeOn("agent.turn_started", (event, context) => this.handleLifecycleEvent("agent.turn_started", event, context));
      safeOn("agent.updated", (event, context) => this.handleLifecycleEvent("agent.updated", event, context));
      safeOn("agent_update", (event, context) => this.handleLifecycleEvent("agent_update", event, context));

      this.unsubscribeLifecycle = () => {
        for (const off of unsubs) {
          try {
            off();
          } catch (err) {
            this.log(`[warn] lifecycle unsubscribe failed (hook-router.ts:4422): ${err}`);
          }
        }
      };
    }
  }

  public async drain(key?: string): Promise<void> {
    if (this.isClosed) return;
    if (!key) {
      for (const k of this.queues.keys()) {
        if (!this.isRepoPaused(k)) {
          void this.drain(k);
        }
      }
      return;
    }

    if (this.isRepoPaused(key)) {
      this.log(`[info] Drain suppressed for paused repository ${key}`);
      return;
    }

    if (this.isPaused(key)) return;
    if (this.draining.has(key)) return;

    const list = this.queues.get(key);
    if (!list || list.length === 0) {
      // No pending work: drop any stale busy counter so it cannot leak into the
      // next burst of traffic and look like a wedged queue (#1072).
      this.busyAttempts.delete(key);
      this.busyQueues.delete(key);
      return;
    }

    this.draining.add(key);

    try {
      let targetAgentId: string | null = null;
      if (key === "frontdesk") {
        targetAgentId = this.readFrontDesk()?.agentId ?? null;
      } else {
        targetAgentId = this.readOrchestrator(key)?.agentId ?? null;
      }

      if (!targetAgentId) {
        // No target orchestrator / frontdesk registered yet. Leave messages queued.
        return;
      }

      const paseo = this.getPaseo();

      const agentRef = paseo?.agents?.ref ? paseo.agents.ref(targetAgentId) : null;
      const hasSos = Boolean(list[0]?.isSos);

      if (!hasSos) {
        // Check if agent is currently busy or throttled
        let isBusy = false;
        if (key === "frontdesk" && this.frontDeskThrottleMs > 0) {
          const last = this.lastDeliveryTimes.get(targetAgentId) ?? 0;
          if (Date.now() - last < this.frontDeskThrottleMs) {
            isBusy = true;
          }
        }

        if (!isBusy && agentRef) {
          try {
            let currentSnapshot = agentRef.current ? agentRef.current() : null;
            let isSnapshotBusy = Boolean(
              currentSnapshot &&
                (currentSnapshot.status === "running" ||
                  (currentSnapshot.status as string) === "working" ||
                  (currentSnapshot.status as string) === "busy" ||
                  Boolean(currentSnapshot.activeTurn))
            );

            // If snapshot is busy (or absent) and refresh is available, perform fresh live lookup via agentRef
            if ((isSnapshotBusy || !currentSnapshot) && typeof agentRef.refresh === "function") {
              const refreshed: any = await agentRef.refresh().catch(() => null);
              const refreshedAgent = refreshed?.agent ?? (refreshed?.status ? refreshed : null);
              if (refreshedAgent) {
                currentSnapshot = refreshedAgent;
                isSnapshotBusy = Boolean(
                  refreshedAgent.status === "running" ||
                    (refreshedAgent.status as string) === "working" ||
                    (refreshedAgent.status as string) === "busy" ||
                    Boolean(refreshedAgent.activeTurn)
                );
                // If refreshed state transitioned to idle, update cache and reset busy attempts (#795)
                if (!isSnapshotBusy) {
                  if (this.latestAgentMap?.has(targetAgentId)) {
                    const entry = this.latestAgentMap.get(targetAgentId)!;
                    entry.status = refreshedAgent.status ?? "idle";
                    entry.activeTurn = null;
                  }
                  this.busyAttempts.delete(key);
                  this.busyQueues.delete(key);
                }
              }
            }

            if (isSnapshotBusy) {
              isBusy = true;
            }
          } catch {
            // Proceed if status inspection fails
          }
        }

        // Check periodic latestAgentMap cache.
        // If cached state is busy, perform a live check / fresh lookup rather than trusting stale cache (#795).
        if (!isBusy && this.latestAgentMap?.has(targetAgentId)) {
          const cachedAgent = this.latestAgentMap.get(targetAgentId);
          const isCachedBusy = Boolean(
            cachedAgent &&
              (cachedAgent.status === "running" ||
                cachedAgent.status === "working" ||
                cachedAgent.status === "busy" ||
                Boolean(cachedAgent.activeTurn))
          );

          if (isCachedBusy) {
            let liveVerified = false;
            let isLiveBusy = false;

            // 1. If agentRef is available, use it for live verification
            if (agentRef) {
              try {
                if (typeof agentRef.refresh === "function") {
                  const refreshed: any = await agentRef.refresh().catch(() => null);
                  const refAgent = refreshed?.agent ?? (refreshed?.status ? refreshed : null);
                  if (refAgent) {
                    liveVerified = true;
                    isLiveBusy = Boolean(
                      refAgent.status === "running" ||
                        (refAgent.status as string) === "working" ||
                        (refAgent.status as string) === "busy" ||
                        Boolean(refAgent.activeTurn)
                    );
                  }
                } else if (typeof agentRef.current === "function") {
                  const curr = agentRef.current();
                  if (curr) {
                    liveVerified = true;
                    isLiveBusy = Boolean(
                      curr.status === "running" ||
                        (curr.status as string) === "working" ||
                        (curr.status as string) === "busy" ||
                        Boolean(curr.activeTurn)
                    );
                  }
                }
              } catch {
                // fall through to fetchAgentMap
              }
            }

            // 2. If not verified via agentRef, query fresh roster via fetchAgentMap
            if (!liveVerified) {
              try {
                const freshMap = await this.fetchAgentMap();
                if (freshMap) {
                  liveVerified = true;
                  this.latestAgentMap = freshMap;
                  const freshAgent = freshMap.get(targetAgentId);
                  isLiveBusy = Boolean(
                    freshAgent &&
                      (freshAgent.status === "running" ||
                        freshAgent.status === "working" ||
                        freshAgent.status === "busy" ||
                        Boolean(freshAgent.activeTurn))
                  );
                }
              } catch {
                // fall through
              }
            }

            if (liveVerified) {
              if (isLiveBusy) {
                isBusy = true;
              } else {
                isBusy = false;
                // Transition to idle detected: update cache and reset attempts
                if (this.latestAgentMap?.has(targetAgentId)) {
                  const entry = this.latestAgentMap.get(targetAgentId)!;
                  entry.status = "idle";
                  entry.activeTurn = null;
                }
                this.busyAttempts.delete(key);
                this.busyQueues.delete(key);
              }
            } else {
              // If live lookup completely failed, fall back to cached busy
              isBusy = true;
            }
          }
        }

        if (isBusy) {
          this.busyQueues.add(key);
          const attempts = (this.busyAttempts.get(key) ?? 0) + 1;
          this.busyAttempts.set(key, attempts);
          this.log(`[info] Agent ${targetAgentId} busy for ${key}, retry scheduled (attempt ${attempts})`);

          // Schedule a backoff retry in case turn_ended was missed
          if (!this.backoffTimers.has(key)) {
            const delay = Math.min(30000, 3000 * Math.pow(1.5, Math.min(attempts, 5)));
            const timer = setTimeout(() => {
              this.backoffTimers.delete(key);
              void this.drain(key);
            }, delay);
            timer.unref?.();
            this.backoffTimers.set(key, timer);
          }
          return;
        }
      }

      this.busyQueues.delete(key);
      this.busyAttempts.delete(key);

      // Deliver queued messages: batch if multiple entries, or single entry with appropriate steering
      if (list.length > 1) {
        const isAnySos = list.some((e) => Boolean(e.isSos));
        const batchCount = list.length;
        const combinedMsg = `[forgejo-hook] Batch notification (${batchCount} events):\n\n` +
          list.map((e, idx) => `### Event ${idx + 1}\n${e.msg}`).join("\n\n---\n\n");
        const ok = await this.deliverMessage(targetAgentId, combinedMsg, {
          steer: isAnySos,
          noWait: false,
        });
        if (ok) {
          this.lastDeliveryTimes.set(targetAgentId, Date.now());
          list.length = 0;
          this.persistQueue(key);
          this.log(`[info] Delivered batch of ${batchCount} message(s) to agent ${targetAgentId} for ${key}`);
        } else {
          this.log(`[error] Failed to deliver batch to ${targetAgentId} for ${key}`);
        }
      } else if (list.length === 1) {
        const entry = list[0];
        const ok = await this.deliverMessage(targetAgentId, entry.msg, {
          steer: Boolean(entry.isSos),
          noWait: false,
        });
        if (ok) {
          this.lastDeliveryTimes.set(targetAgentId, Date.now());
          list.shift();
          this.persistQueue(key);
          this.log(`[info] Delivered message ${entry.id} to agent ${targetAgentId} for ${key}`);
        } else {
          this.log(`[error] Failed to deliver message to ${targetAgentId} for ${key}`);
        }
      }
    } finally {
      this.draining.delete(key);
    }
  }

  public getStatusOverview(): Record<string, unknown> {
    const frontDesk = this.readFrontDesk();
    const totalQueued = this.getTotalQueued();

    const enrolledRepos = this.getCanonicalEnrolledRepos();
    const allKeys = new Set<string>(enrolledRepos);
    for (const k of this.queues.keys()) allKeys.add(k);

    return {
      ok: true,
      service: "uppidi-fleet-hook-router",
      version: 1,
      uptime: this.getUptime(),
      enrolledRepos,
      frontDesk: frontDesk
        ? {
            version: frontDesk.version ?? 1,
            agentId: frontDesk.agentId,
            updatedAt: frontDesk.updatedAt ?? undefined,
            by: frontDesk.by ?? undefined,
          }
        : null,
      paused: Array.from(this.pausedQueues),
      halted: this.isHaltedState,
      teardownInProgress: this.teardownInProgress,
      totalQueued,
      repoCount: allKeys.size,
      teardown: { at: this.lastTeardownAt, targets: [...this.lastTeardownTargets] },
    };
  }

  public getQueuesOverview(): Record<string, unknown> {
    const queueItems: Record<string, unknown>[] = [];

    // Enumerate enrolled repositories as well as any active queues so idle/empty enrolled queues appear (#448)
    const allKeys = new Set<string>();
    for (const r of this.getEnrolledRepos()) allKeys.add(r);
    for (const k of this.queues.keys()) allKeys.add(k);

    for (const key of allKeys) {
      const entries = this.queues.get(key) ?? [];
      const orch = key === "frontdesk" ? null : this.readOrchestrator(key);
      const isBusy = this.busyQueues.has(key);
      const busyAttempts = this.busyAttempts.get(key) ?? 0;
      const dropped = this.droppedCount.get(key) ?? 0;

      queueItems.push({
        key,
        depth: entries.length,
        dropped,
        paused: this.isPaused(key),
        isBusy,
        busyAttempts,
        orchestrator: orch
          ? {
              agentId: orch.agentId,
              updatedAt: orch.updatedAt ?? undefined,
              by: orch.by ?? undefined,
            }
          : null,
        messages: entries.map((e) => ({
          id: e.id,
          ts: e.ts,
          preview: e.msg.length > 120 ? `${e.msg.slice(0, 120)}...` : e.msg,
        })),
      });
    }

    return {
      ok: true,
      service: "uppidi-fleet-hook-router",
      uptime: this.getUptime(),
      paused: Array.from(this.pausedQueues),
      queues: queueItems,
    };
  }

  public inspectQueues(repo?: string): Record<string, unknown> {
    const overview = this.getQueuesOverview();
    const queues = (overview.queues as Array<Record<string, unknown>>) ?? [];
    if (!repo || !repo.trim()) {
      return overview;
    }
    const rawTarget = repo.trim();
    const canonicalTarget = canonicalRepoKey(rawTarget) ?? rawTarget;
    const filtered = queues.filter((q) => {
      const k = String(q.key ?? "");
      return k === rawTarget || canonicalRepoKey(k) === canonicalTarget || k.toLowerCase().includes(rawTarget.toLowerCase());
    });
    return {
      ...overview,
      queues: filtered,
    };
  }

  public async start(): Promise<void> {
    try {
      await this.reconcileFrontDesk();
    } catch (err) {
      this.log(`[warn] Front Desk startup reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return new Promise((resolve, reject) => {
      this.isClosed = false;
      this.bindLifecycleEvents();
      this.startBackgroundLoops();

      if (this.httpServer && this.httpServer.listening) {
        resolve();
        return;
      }

      this.httpServer = createServer((req, res) => {
        void this.handleHttpRequest(req, res);
      });

      this.httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          this.log(
            `[warn] Port ${this.port} is already in use. Bundled hook router HTTP listener paused (external service active).`,
          );
          this.httpServer = null;
          this.boundPort = 0;
          this.startedAt = null;
          resolve();
        } else {
          this.log(`[error] HTTP server error: ${err.message}`);
          reject(err);
        }
      });

      this.httpServer.listen(this.configuredPort, this.configuredHost, () => {
        const addr = this.httpServer?.address();
        if (addr && typeof addr === "object") {
          this.boundPort = addr.port;
          this.boundHost = addr.address;
        }
        this.startedAt = Date.now();
        this.log(`[info] Bundled hook router listening on http://${this.configuredHost}:${this.port}`);
        this.startBackgroundLoops();
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    this.isClosed = true;
    this.stopBackgroundLoops();

    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    this.backoffTimers.clear();

    for (const entry of this.coalesceBuffers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.coalesceBuffers.clear();

    if (this.unsubscribeLifecycle) {
      this.unsubscribeLifecycle();
      this.unsubscribeLifecycle = undefined;
    }

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null;
          this.boundPort = 0;
          this.boundHost = "";
          this.startedAt = null;
          this.log("[info] Bundled hook router stopped");
          resolve();
        });
      } else {
        this.boundPort = 0;
        this.boundHost = "";
        this.startedAt = null;
        resolve();
      }
    });
  }

  public async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  public async configure(options: {
    host?: string;
    port?: number;
    restart?: boolean;
  }): Promise<{
    configuredHost: string;
    configuredPort: number;
    activeHost: string;
    activePort: number;
    restarted: boolean;
  }> {
    const updatedHost =
      options.host !== undefined && options.host.trim() ? options.host.trim() : this.configuredHost;
    const updatedPort =
      options.port !== undefined && options.port > 0 ? options.port : this.configuredPort;

    saveRouterConfig({
      host: updatedHost,
      port: updatedPort,
    });

    this.configuredHost = updatedHost;
    this.configuredPort = updatedPort;

    let restarted = false;
    const shouldRestart = options.restart !== false;
    if (shouldRestart && this.isListening()) {
      await this.restart();
      restarted = true;
    }

    return {
      configuredHost: this.configuredHost,
      configuredPort: this.configuredPort,
      activeHost: this.isListening() ? this.host : this.configuredHost,
      activePort: this.isListening() ? this.port : this.configuredPort,
      restarted,
    };
  }

  public async reload(): Promise<void> {
    this.loadPersistedQueues();
    this.log("[info] Bundled hook router reloaded persisted queues and configuration");
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Forgejo-Event, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    const pathname = url.pathname;

    try {
      if (req.method === "GET" && pathname === "/health") {
        this.sendJson(res, 200, {
          ok: true,
          status: "healthy",
          uptime: this.getUptime(),
          service: "uppidi-fleet-hook-router",
          port: this.port,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/status") {
        this.sendJson(res, 200, this.getStatusOverview());
        return;
      }

      if (req.method === "GET" && (pathname === "/enrolled" || pathname === "/repos/enrolled")) {
        const enrolledRepos = this.getCanonicalEnrolledRepos();
        this.sendJson(res, 200, { ok: true, count: enrolledRepos.length, enrolledRepos });
        return;
      }

      if (req.method === "GET" && pathname === "/info") {
        const info = this.getInfo();
        this.sendJson(res, 200, {
          host: info.hookHost,
          port: info.hookPort,
          url: info.url,
          frontDeskAgentId: info.frontDeskAgentId,
          uptime: info.uptime,
          isListening: info.isListening,
          registeredRepoKeys: info.registeredRepoKeys,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/queues") {
        this.sendJson(res, 200, this.getQueuesOverview());
        return;
      }

      if (req.method === "GET" && pathname === "/frontdesk") {
        const record = this.readFrontDesk();
        this.sendJson(res, 200, record ?? { agentId: null });
        return;
      }

      if (req.method === "POST" && pathname === "/frontdesk") {
        const body = await this.readJsonBody(req);
        const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
        if (!agentId) {
          this.sendJson(res, 400, { ok: false, error: "agentId is required" });
          return;
        }

        const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
        const previous = this.readFrontDesk()?.agentId ?? null;
        this.writeFrontDesk(agentId, "frontdesk");
        void this.drain("frontdesk");

        await this.updateAgentMetadata(agentId, "Front Desk", {
          role: "front-desk",
          category: "front-desk",
        });

        if (previous && previous !== agentId) {
          await this.updateAgentMetadata(previous, "Front Desk (retired)", {
            role: "retired-front-desk",
          });
          await this.deliverStandDown(previous, "frontdesk", FRONT_DESK_REPO, agentId);
        }

        const activeAgents = await this.getActiveAgentIds();
        const targetOrchestrators = this.listOrchestratorTargets().filter(
          (target) =>
            target.agentId !== agentId && (activeAgents.size === 0 || activeAgents.has(target.agentId)),
        );

        const notice =
          instruction ||
          `Front Desk registered: ${agentId}. Orchestrators must maintain composer silence and route all operator-escalation requests (attention/2-user) to Front Desk (${agentId}) via 'paseo send --steer --no-wait ${agentId} <msg>'.`;

        let notified = 0;
        for (const target of targetOrchestrators) {
          const message = withFleetEnvelope(routerEnvelope({ repo: target.key, kind: "handoff" }), notice);
          const ok = await this.deliverMessage(target.agentId, message, { noWait: true, steer: true });
          if (ok) notified++;
        }

        this.log(`[info] Front Desk registered: ${agentId}, notified ${notified} orchestrator(s)`);
        this.sendJson(res, 200, {
          ok: true,
          agentId,
          orchestratorsNotified: notified,
        });
        return;
      }

      if (req.method === "GET" && (pathname === "/frontdesk-handoff" || pathname === "/handoff")) {
        this.sendJson(res, 200, this.frontDeskHandoffStatus());
        return;
      }

      if (req.method === "POST" && (pathname === "/frontdesk-handoff" || pathname === "/handoff")) {
        const body = await this.readJsonBody(req);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          this.sendJson(res, 400, { ok: false, error: "body must be a JSON object" });
          return;
        }
        try {
          const out = await this.doFrontDeskHandoff({
            agentId: body.agentId,
            handoffText: body.handoffText,
            handoffFile: body.handoffFile,
          });
          this.sendJson(res, 200, out);
        } catch (err: any) {
          this.sendJson(res, Number(err?.status) || 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && (pathname === "/frontdesk-handoff/generate" || pathname === "/handoff/generate")) {
        try {
          const out = await this.generateHandoff();
          this.sendJson(res, 200, out);
        } catch (err: any) {
          this.sendJson(res, Number(err?.status) || 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && pathname === "/orchestrator-rotate") {
        const body = await this.readJsonBody(req).catch(() => ({}));
        try {
          const out = await this.rotateRole({
            role: typeof body?.role === "string" ? body.role : "orchestrator",
            repo: typeof body?.repo === "string" ? body.repo : undefined,
            reason: typeof body?.reason === "string" ? body.reason : undefined,
            force: body?.force === undefined ? true : Boolean(body.force),
          });
          this.sendJson(res, out.ok ? 200 : 409, out);
        } catch (err: any) {
          this.sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "GET" && pathname === "/orchestrator-rotation") {
        const role = url.searchParams.get("role") ?? undefined;
        const repo = url.searchParams.get("repo") ?? undefined;
        this.sendJson(res, 200, this.rotationStatus({ role, repo }));
        return;
      }

      if (req.method === "GET" && pathname === "/rotation-policy") {
        this.sendJson(res, 200, { ok: true, policy: this.readRotationPolicy() });
        return;
      }

      if (req.method === "POST" && pathname === "/rotation-policy") {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const role = typeof body?.role === "string" ? body.role.trim() : "";
        if (!role || typeof body?.policy !== "object" || body.policy === null) {
          this.sendJson(res, 400, { ok: false, error: "role and policy are required" });
          return;
        }
        try {
          const policy = this.setRotationPolicyRole(
            role,
            typeof body.repo === "string" ? body.repo : undefined,
            body.policy,
          );
          this.sendJson(res, 200, { ok: true, policy });
        } catch (err: any) {
          this.sendJson(res, 400, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && pathname === "/orchestrators/prune") {
        try {
          const result = await this.pruneOrchestrators();
          this.sendJson(res, 200, result);
        } catch (err: any) {
          this.sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && pathname === "/board-sweep") {
        try {
          const body = await this.readJsonBody(req).catch(() => ({}));
          const repos = Array.isArray(body?.repos)
            ? body.repos.filter((r: unknown) => typeof r === "string")
            : undefined;
          const result = await this.runBoardSweep(repos, undefined, { explicit: true });
          this.sendJson(res, 200, result);
        } catch (err: any) {
          this.sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "GET" && (pathname === "/orchestrators" || pathname.startsWith("/orchestrators/"))) {
        const pathRepo = pathname.startsWith("/orchestrators/")
          ? decodeURIComponent(pathname.slice("/orchestrators/".length))
          : null;
        const requestedRepo = pathRepo ?? url.searchParams.get("repo");
        if (requestedRepo) {
          const orch = this.readOrchestrator(requestedRepo);
          if (!orch) {
            this.sendJson(res, 404, { ok: false, error: "orchestrator not registered", key: requestedRepo });
            return;
          }
          this.sendJson(res, 200, { ok: true, orchestrator: orch });
          return;
        }

        const list = this.listOrchestratorRecords();
        this.sendJson(res, 200, { ok: true, orchestrators: list });
        return;
      }

      if (req.method === "POST" && pathname === "/orchestrators/spawn") {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
        if (!repo) {
          this.sendJson(res, 400, { ok: false, error: "repo is required" });
          return;
        }
        try {
          const result = await this.ensureOrchestrator({
            repo,
            provider: typeof body?.provider === "string" ? body.provider.trim() : undefined,
            model: typeof body?.model === "string" ? body.model.trim() : undefined,
            mode: typeof body?.mode === "string" ? body.mode.trim() : undefined,
            force: Boolean(body?.force),
          });
          // Genuinely bad input stays 400 (handled above); a failed provision
          // stays 500. A missing workspace is a resolvable configuration gap,
          // so it is surfaced as 422 with the probed registry in `error` (#973).
          const statusCode = result.ok
            ? 200
            : result.errorCode === "workspace_not_found" || result.error?.includes("No workspace found")
              ? 422
              : 500;
          this.sendJson(res, statusCode, result);
        } catch (err: any) {
          this.sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && (pathname === "/orchestrator" || pathname === "/orchestrate")) {
        const body = await this.readJsonBody(req);
        const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
        const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
        if (!repo || !agentId) {
          this.sendJson(res, 400, { ok: false, error: "repo and agentId are required" });
          return;
        }
        this.writeOrchestrator(repo, agentId, "orchestrator");
        for (const cand of candidateRepoKeys(repo)) {
          void this.drain(cand);
        }
        this.sendJson(res, 200, { ok: true, repo, agentId });
        return;
      }

      // Queue pause endpoints: POST /queues/:key/pause or POST /queue/pause
      const pauseMatch = pathname.match(/^\/queues\/(.+)\/pause$/);
      if (req.method === "POST" && (pauseMatch || pathname === "/queue/pause")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = pauseMatch ? decodeURIComponent(pauseMatch[1]) : (body?.repo as string | undefined);
        const allPaused = this.pause(target);
        this.sendJson(res, 200, { ok: true, paused: target ?? "all", allPaused });
        return;
      }

      // Queue resume endpoints: POST /queues/:key/resume or POST /queue/resume
      const resumeMatch = pathname.match(/^\/queues\/(.+)\/resume$/);
      if (req.method === "POST" && (resumeMatch || pathname === "/queue/resume")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = resumeMatch ? decodeURIComponent(resumeMatch[1]) : (body?.repo as string | undefined);
        const allPaused = this.resume(target);
        this.sendJson(res, 200, { ok: true, resumed: target ?? "all", allPaused });
        return;
      }

      // Queue drain endpoints: POST /queues/:key/drain or POST /queue/drain
      const drainMatch = pathname.match(/^\/queues\/(.+)\/drain$/);
      if (req.method === "POST" && (drainMatch || pathname === "/queue/drain")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = drainMatch ? decodeURIComponent(drainMatch[1]) : (body?.repo as string | undefined);
        void this.drain(target);
        this.sendJson(res, 200, { ok: true, draining: target ?? "all" });
        return;
      }

      // Queue purge endpoints: POST /queues/:key/purge or POST /queue/purge
      const purgeMatch = pathname.match(/^\/queues\/(.+)\/purge$/);
      if (req.method === "POST" && (purgeMatch || pathname === "/queue/purge")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = purgeMatch ? decodeURIComponent(purgeMatch[1]) : (body?.repo as string | undefined);
        if (!target) {
          this.sendJson(res, 400, { ok: false, error: "Repository is required for queue purge" });
          return;
        }
        const outcome = this.purgeQueue(target);
        this.sendJson(res, 200, outcome);
        return;
      }

      // Audit receipt gateway (platform#348 Phase A / #1172): append, check
      // and server-side projection over the durable append-only JSONL store.
      if (req.method === "POST" && pathname === "/audits") {
        const body = await this.readJsonBody(req);
        const parsed = UppidiAuditRecordInputSchema.safeParse(body);
        if (!parsed.success) {
          const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          this.sendJson(res, 400, { ok: false, auditId: "", recordedAt: "", error: details });
          return;
        }
        const result = appendAuditReceipt(parsed.data, { filePath: this.auditsFilePath });
        if (!result.ok) {
          this.sendJson(res, 500, {
            ok: false,
            auditId: result.receipt.auditId,
            recordedAt: "",
            error: result.error,
          });
          return;
        }
        this.log(
          `[info] audit receipt recorded ${result.receipt.auditId} for ${result.receipt.repo}#${result.receipt.pr} (${result.receipt.verdict})`,
        );
        this.sendJson(res, 201, {
          ok: true,
          auditId: result.receipt.auditId,
          recordedAt: result.receipt.timestamp,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/audits/check") {
        const repo = (url.searchParams.get("repo") ?? "").trim();
        const prRaw = url.searchParams.get("pr");
        const commit = (url.searchParams.get("commit") ?? "").trim();
        const pr = prRaw === null ? Number.NaN : Number(prRaw);
        if (!repo || !commit || !Number.isInteger(pr) || pr <= 0) {
          this.sendJson(res, 400, {
            ok: false,
            error: "repo, pr (positive integer) and commit query params are required",
          });
          return;
        }
        const out = auditCheck(
          { repo, pr, commit },
          { filePath: this.auditsFilePath },
        );
        this.sendJson(res, 200, out);
        return;
      }

      if (req.method === "GET" && pathname === "/audits/summary") {
        const input: UppidiAuditSummaryInput = {
          repo: url.searchParams.get("repo")?.trim() || undefined,
          since: url.searchParams.get("since")?.trim() || undefined,
        };
        const out = projectAuditSummary(input, {
          filePath: this.auditsFilePath,
          reconciliationsPath: this.auditReconciliationsFilePath,
        });
        this.sendJson(res, 200, out);
        return;
      }

      // Webhook receiver ingress: POST /forgejo or POST /hook
      if (req.method === "POST" && (pathname === "/forgejo" || pathname === "/hook")) {
        const event = (req.headers["x-forgejo-event"] as string | undefined) ?? "unknown";
        const body = await this.readJsonBody(req);

        if (event === "ping") {
          this.log("[info] Webhook ping received on POST /forgejo");
          this.sendJson(res, 200, { ok: true, ping: true });
          return;
        }

        const repoKey = keyFromPayload(body);
        if (!repoKey) {
          this.log("[warn] Webhook rejected: could not derive repository key from payload");
          this.sendJson(res, 400, { ok: false, error: "Could not derive repository key from payload" });
          return;
        }

        this.log(`[info] Webhook received: event=${event} repo=${isFrontDeskEvent(body) ? "frontdesk" : repoKey}`);
        const outcome = await this.ingestWebhook(event, body);
        this.sendJson(res, 200, {
          ok: true,
          queued: true,
          key: outcome.key,
          isBypass: outcome.bypass,
          frontDesk: outcome.frontDesk,
          coalesce: outcome.result,
        });
        return;
      }

      this.sendJson(res, 404, { ok: false, error: "Not Found" });
    } catch (err) {
      this.log(`[error] Request handling error: ${err instanceof Error ? err.message : String(err)}`);
      this.sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const payload = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) {
          reject(new Error("Payload too large"));
        }
      });
      req.on("end", () => {
        if (!data.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }
}

let activeRouter: HookRouter | null = null;

export function getActiveHookRouter(): HookRouter | null {
  return activeRouter;
}

let activePaseoInstance: PaseoApi | null = null;

export function setActiveHookRouter(router: HookRouter | null): void {
  activeRouter = router;
  if (router) {
    if (activePaseoInstance && !router.getPaseo()) {
      router.setActivePaseo(activePaseoInstance);
    }
    setActiveDiskLogger(router.diskLogger);
  } else {
    setActiveDiskLogger(null);
  }
}

export function setActivePaseo(paseo: PaseoApi | null): void {
  activePaseoInstance = paseo;
  const router = getActiveHookRouter();
  if (router) {
    router.setActivePaseo(paseo);
  }
}

export function getOrCreateHookRouter(
  server?: PluginServerContext,
  options?: HookRouterOptions,
): HookRouter {
  if (!activeRouter) {
    activeRouter = new HookRouter(server, options);
  }
  return activeRouter;
}

function formatHookInfoUrl(host: string, port: number): string {
  const hostname = host === "0.0.0.0" || host === "::" || !host ? "127.0.0.1" : host;
  return `http://${hostname}:${port}`;
}

/**
 * Resolves hook router discovery info from the live singleton only (#545).
 * Never reads plugin-data settings or legacy config from disk. Null-safe when
 * the router has not been started.
 */
export function getHookRouterInfo(): HookInfoOutput {
  const router = getActiveHookRouter();
  if (!router) {
    return {
      ok: true,
      running: false,
      hookHost: null,
      hookPort: null,
      url: null,
      isListening: false,
      frontDeskAgentId: null,
      registeredRepoKeys: [],
      registeredRepoCount: 0,
      uptime: 0,
    };
  }
  return router.getInfo();
}

export function getHookServiceStatus(): HookServiceStatusOutput {
  const router = getActiveHookRouter();
  const listening = router ? router.isListening() : false;
  const persisted = loadRouterConfig();
  const configuredPort = router
    ? router.configuredPort
    : (persisted.port ?? Number(process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT ?? 8099));
  const configuredHost = router
    ? router.configuredHost
    : (persisted.host ?? process.env.FORGE_HOOK_HOST ?? "127.0.0.1");
  const port = listening && router ? router.port : undefined;
  const host = listening && router ? router.host : undefined;
  const uptime = router ? router.getUptime() : 0;
  const queued = router ? router.getTotalQueued() : 0;

  return {
    ok: true,
    active: listening,
    state: listening ? "active" : "inactive",
    description: listening
      ? `Bundled hook router listening on port ${port} (${host}, uptime: ${uptime}s, queued: ${queued})`
      : "Bundled hook router is inactive",
    pid: process.pid,
    host,
    configuredHost,
    port,
    configuredPort,
    availableInterfaces: getAvailableNetworkInterfaces(),
  };
}

export async function configureHookService(input: {
  host?: string;
  port?: number;
  restart?: boolean;
}): Promise<HookServiceConfigOutput> {
  try {
    let router = getActiveHookRouter();
    if (!router) {
      const persisted = loadRouterConfig();
      const configuredHost =
        input.host?.trim() || persisted.host || process.env.FORGE_HOOK_HOST || "127.0.0.1";
      const configuredPort =
        input.port || persisted.port || Number(process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT ?? 8099);

      saveRouterConfig({ host: configuredHost, port: configuredPort });

      appendHookLog(`[info] Saved hook router configuration: host=${configuredHost}, port=${configuredPort}`);
      return {
        ok: true,
        configuredHost,
        configuredPort,
        activeHost: configuredHost,
        activePort: configuredPort,
        restarted: false,
        message: `Hook router configuration saved (${configuredHost}:${configuredPort})`,
      };
    }

    const result = await router.configure(input);
    appendHookLog(
      `[info] Configured hook router: host=${result.configuredHost}, port=${result.configuredPort}, restarted=${result.restarted}`,
    );

    return {
      ok: true,
      configuredHost: result.configuredHost,
      configuredPort: result.configuredPort,
      activeHost: result.activeHost,
      activePort: result.activePort,
      restarted: result.restarted,
      message: result.restarted
        ? `Hook router reconfigured and restarted on ${result.configuredHost}:${result.configuredPort}`
        : `Hook router configuration saved (${result.configuredHost}:${result.configuredPort})`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendHookLog(`[error] Failed to configure hook router: ${msg}`);
    const router = getActiveHookRouter();
    const persisted = loadRouterConfig();
    const cfgHost = router?.configuredHost ?? input.host ?? persisted.host ?? "127.0.0.1";
    const cfgPort = router?.configuredPort ?? input.port ?? persisted.port ?? 8099;
    return {
      ok: false,
      configuredHost: cfgHost,
      configuredPort: cfgPort,
      activeHost: router?.isListening() ? router.host : cfgHost,
      activePort: router?.isListening() ? router.port : cfgPort,
      restarted: false,
      error: msg,
    };
  }
}

export async function executeHookServiceAction(
  action: "start" | "stop" | "restart" | "reload",
): Promise<HookServiceActionOutput> {
  try {
    let router = getActiveHookRouter();
    switch (action) {
      case "start": {
        if (!router) {
          router = new HookRouter();
          setActiveHookRouter(router);
        }
        await router.start();
        appendHookLog(`[info] Service action executed: start (port ${router.port})`);
        return {
          ok: true,
          action,
          message: `Bundled hook router started on port ${router.port}`,
        };
      }
      case "stop": {
        if (router) {
          await router.stop();
        }
        appendHookLog("[info] Service action executed: stop");
        return {
          ok: true,
          action,
          message: "Bundled hook router stopped successfully",
        };
      }
      case "restart": {
        if (!router) {
          router = new HookRouter();
          setActiveHookRouter(router);
        }
        await router.restart();
        appendHookLog(`[info] Service action executed: restart (port ${router.port})`);
        return {
          ok: true,
          action,
          message: `Bundled hook router restarted on port ${router.port}`,
        };
      }
      case "reload": {
        if (!router) {
          return {
            ok: true,
            action,
            message: "Bundled hook router is not running; nothing to reload",
          };
        }
        await router.reload();
        appendHookLog("[info] Service action executed: reload");
        return {
          ok: true,
          action,
          message: "Bundled hook router reloaded successfully",
        };
      }
      default: {
        return {
          ok: false,
          action,
          error: `Unknown action: ${String(action)}`,
        };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendHookLog(`[error] Service action ${action} failed: ${msg}`);
    return {
      ok: false,
      action,
      error: msg,
    };
  }
}

export function getHookLogTail(lines?: number): HookLogTailOutput {
  const count = Math.min(Math.max(lines ?? 50, 1), 200);
  return {
    ok: true,
    lines: getHookLogs(count),
  };
}

export function startHookRouter(
  server?: PluginServerContext,
  options?: HookRouterOptions,
): () => Promise<void> {
  const router = new HookRouter(server, options);
  setActiveHookRouter(router);
  void router.start();
  return async () => {
    await router.stop();
    if (getActiveHookRouter() === router) {
      setActiveHookRouter(null);
    }
  };
}

export function getFleetRosterInfo(): {
  enrolledRepos: string[];
  pausedRepos: string[];
  repoQueuedHooks: Record<string, number>;
} {
  const router = getActiveHookRouter();
  const home = resolveHostHome();
  const config = loadRouterConfig();
  const pausedRepos = router ? router.getPausedRepos() : (config.pausedRepos ?? []);

  const enrolledSet = new Set<string>(router ? router.getEnrolledRepos() : (config.enrolledRepos ?? []));

  const repoQueuedHooks: Record<string, number> = {};
  if (router) {
    const overview = router.getQueuesOverview() as any;
    if (Array.isArray(overview?.queues)) {
      for (const q of overview.queues) {
        if (q.key && typeof q.depth === "number") {
          repoQueuedHooks[q.key] = q.depth;
        }
      }
    }
  } else {
    const queueDir = process.env.HOOK_QUEUE_DIR ?? join(home, ".config", "uppidi-fleet", "queues");
    if (existsSync(queueDir)) {
      try {
        const files = readdirSync(queueDir);
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          try {
            const raw = readFileSync(join(queueDir, f), "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const key = parsed[0]?.key || f.replace(/\.json$/, "");
              repoQueuedHooks[key] = parsed.length;
            }
          } catch (err) {
            console.warn(`[uppidi-fleet:hook-router] state read/parse failed (hook-router.ts:5546): ${err}`);
          }
        }
      } catch (err) {
        console.warn(`[uppidi-fleet:hook-router] state read/parse failed (hook-router.ts:5548): ${err}`);
      }
    }
  }

  return {
    enrolledRepos: Array.from(enrolledSet),
    pausedRepos,
    repoQueuedHooks,
  };
}

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Conservative, documented safe-pattern allowlist for fleet permission
 * auto-adjudication (#1084).
 *
 * A pending `pi` "dangerous command" prompt for a routine heredoc, a scoped
 * `.tmp` cleanup, or a read-only repo probe wedges an orchestrator or worker
 * because nothing answers it. This module classifies the *requested command*
 * against a narrow allowlist; a match is auto-allowed through the existing
 * permission seam, and anything unmatched is routed to Front Desk with the full
 * command so a human/agent policy decides instead of the agent sitting blocked.
 *
 * The classifier is conservative by construction: the command must be composed
 * entirely of recognized safe shell segments. Any segment whose head is unknown,
 * any unquoted heredoc delimiter, any output redirection, any command
 * substitution that is not itself safe, or any `..` path escape disqualifies the
 * whole request.
 */

export interface RawPermissionLike {
  id?: string;
  requestId?: string;
  name?: string;
  title?: string;
  tool?: string;
  kind?: string;
  description?: string;
  input?: Record<string, unknown>;
}

export interface FleetAgentLike {
  id?: string;
  name?: string | null;
  title?: string | null;
  cwd?: string | null;
  role?: string | null;
  labels?: Record<string, string> | null;
}

export interface FleetAgentContext {
  /** Registered orchestrator agent ids. */
  orchestratorAgentIds?: Iterable<string>;
  /** Registered Front Desk agent id. */
  frontDeskId?: string | null;
}

/** A documented allowlist rule and the scope the match applies to. */
export interface SafePermissionMatch {
  ruleId: string;
  /** Matched scratch scope for cleanup rules, when one was found. */
  scope?: string;
}

export const SAFE_PERMISSION_RULES: ReadonlyArray<{ id: string; description: string }> = [
  {
    id: "teax-board",
    description:
      "teax board composition/read commands (issue/pr comment, view, list, edit, api, -F <file>), including quoted heredocs",
  },
  {
    id: "paseo-send",
    description: "paseo send (wake/steer a peer agent)",
  },
  {
    id: "paseo-permit-ls",
    description: "paseo permit ls (read-only pending-permission listing)",
  },
  {
    id: "paseo-plugin-reload",
    description: "paseo plugin reload <id> (reload the fleet plugin)",
  },
  {
    id: "scratch-cleanup",
    description:
      "rm -rf scoped to ./.tmp, <workspace>/.tmp, or ~/.cache/... (no global paths, no .. escapes)",
  },
  {
    id: "read-only-probe",
    description: "read-only repo probes: git status/rev-parse/fetch/log/diff/show, ls, cat, pwd",
  },
];

/** Command heads whose invocations are always safe (read-only rc). */
const ALWAYS_SAFE_HEADS = new Set(["ls", "cat", "pwd"]);

/**
 * teax commands permitted for fleet agents.
 * Only the board disk/read/compose surface is allowed. Mutating/admin commands
 * like `pr merge` (which bypasses orchestrator review gate) and `issue close`
 * are strictly forbidden and escalate.
 */
const SAFE_TEAX_PRIMARY_SUBCOMMANDS = new Set([
  "issues",
  "issue",
  "i",
  "pulls",
  "pull",
  "pr",
  "api",
  "whoami",
]);

const FORBIDDEN_TEAX_ACTIONS = new Set(["merge", "close", "reopen", "delete"]);


const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "rev-parse",
  "fetch",
  "log",
  "diff",
  "show",
  "ls-files",
  "ls-tree",
  "cat-file",
  "describe",
]);

// Mutating/destructive flags, plus any output-to-file flag (a read-only probe
// must not write). `remote`, `worktree`, and `stash` are excluded entirely
// because their destructive forms (`remove`, `drop`, `clear`) are subcommands.
const GIT_DESTRUCTIVE_FLAGS = /(^|\s)(-D|--delete|--force|-f|--hard|--mirror|--prune|--output|-o)(\s|=|$)/;

const RM_ALLOWED_FLAGS = new Set(["-r", "-R", "-f", "-rf", "-fr", "--recursive", "--force"]);

// ---------------------------------------------------------------------------
// Shell scanning
// ---------------------------------------------------------------------------

interface Heredoc {
  quoted: boolean;
  /** Text after the delimiter on the opening line, before the body. */
  openRemainder: string;
  /** Index where the opening line ends (start of heredoc body). */
  bodyStart: number;
  /** Index immediately after the terminator line. */
  end: number;
}

interface ScanResult {
  segments: string[];
  substitutions: string[];
  /** An output/input redirection the classifier cannot prove safe. */
  redirection: boolean;
  ok: boolean;
}

/** Reads a `$(...)` body starting at `start` (index just past `$(`). */
function readBalanced(s: string, start: number): { body: string; end: number } | null {
  let depth = 1;
  let quote: string | null = null;
  let escaped = false;
  const body: string[] = [];
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (escaped) {
      body.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      body.push(ch);
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      body.push(ch);
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      body.push(ch);
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return { body: body.join(""), end: i };
    }
    body.push(ch);
  }
  return null;
}

/** Reads a backtick substitution body starting at `start` (just past the backtick). */
function readBacktick(s: string, start: number): { body: string; end: number } | null {
  let escaped = false;
  const body: string[] = [];
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (escaped) {
      body.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      body.push(ch);
      continue;
    }
    if (ch === "`") return { body: body.join(""), end: i };
    body.push(ch);
  }
  return null;
}

/**
 * Reads a heredoc operator starting at `<<`. Only quoted delimiters are
 * accepted: an unquoted delimiter allows parameter/command expansion inside the
 * body, so the body cannot be treated as inert data.
 */
function readHeredoc(s: string, start: number): Heredoc | null {
  let i = start + 2;
  if (s[i] === "-") i++;
  while (s[i] === " " || s[i] === "\t") i++;
  let quoted = false;
  let delim = "";
  if (s[i] === "'" || s[i] === '"') {
    quoted = true;
    const q = s[i];
    i++;
    while (i < s.length && s[i] !== q) {
      delim += s[i];
      i++;
    }
    if (s[i] !== q) return null;
    i++;
  } else {
    while (i < s.length && /[A-Za-z0-9_-]/.test(s[i]!)) {
      delim += s[i];
      i++;
    }
  }
  if (!delim) return null;

  let lineEnd = s.indexOf("\n", i);
  if (lineEnd === -1) lineEnd = s.length;
  const openRemainder = s.slice(i, lineEnd);

  let cursor = lineEnd + 1;
  while (cursor <= s.length) {
    let next = s.indexOf("\n", cursor);
    if (next === -1) next = s.length;
    const line = s.slice(cursor, next);
    if (line === delim) {
      return { quoted, openRemainder, bodyStart: lineEnd + 1, end: Math.min(next + 1, s.length) };
    }
    cursor = next + 1;
  }
  return null;
}

/**
 * Splits a shell command into top-level segments and command-substitution
 * bodies. Heredoc bodies are dropped as inert data (quoted delimiters only).
 * Returns `ok: false` for anything the scanner cannot prove safe.
 */
export function scanShellCommand(command: string): ScanResult {
  const segments: string[] = [];
  const substitutions: string[] = [];
  let redirection = false;
  let buf = "";
  let quote: string | null = null;
  let escaped = false;
  let i = 0;
  const push = () => {
    const trimmed = buf.trim();
    if (trimmed) segments.push(trimmed);
    buf = "";
  };

  while (i < command.length) {
    const ch = command[i]!;
    if (escaped) {
      buf += ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      if (quote !== "'") escaped = true;
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        buf += ch;
        i++;
        continue;
      }
      if (quote === '"' && ch === "$" && command[i + 1] === "(") {
        const inner = readBalanced(command, i + 2);
        if (!inner) return { segments, substitutions, redirection, ok: false };
        substitutions.push(inner.body);
        buf += "$()";
        i = inner.end + 1;
        continue;
      }
      if (quote === '"' && ch === "`") {
        const inner = readBacktick(command, i + 1);
        if (!inner) return { segments, substitutions, redirection, ok: false };
        substitutions.push(inner.body);
        buf += "``";
        i = inner.end + 1;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "`") {
      const inner = readBacktick(command, i + 1);
      if (!inner) return { segments, substitutions, redirection, ok: false };
      substitutions.push(inner.body);
      buf += "``";
      i = inner.end + 1;
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      const inner = readBalanced(command, i + 2);
      if (!inner) return { segments, substitutions, redirection, ok: false };
      substitutions.push(inner.body);
      buf += "$()";
      i = inner.end + 1;
      continue;
    }
    if (ch === "<" && command[i + 1] === "<") {
      const heredoc = readHeredoc(command, i);
      if (!heredoc) return { segments, substitutions, redirection, ok: false };
      if (!heredoc.quoted) return { segments, substitutions, redirection, ok: false };
      // Piping a heredoc body into another process can execute it.
      if (heredocOpenIsRisky(heredoc.openRemainder)) {
        return { segments, substitutions, redirection, ok: false };
      }
      buf += heredoc.openRemainder;
      push();
      i = heredoc.end;
      continue;
    }
    if (ch === ">" || ch === "<") {
      redirection = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      push();
      i++;
      continue;
    }
    if (ch === "&") {
      if (command[i + 1] === "&") i++;
      push();
      i++;
      continue;
    }
    if (ch === "|") {
      if (command[i + 1] === "|") i++;
      push();
      i++;
      continue;
    }
    buf += ch;
    i++;
  }

  if (quote || escaped) return { segments, substitutions, redirection, ok: false };
  push();
  return { segments, substitutions, redirection, ok: true };
}

function heredocOpenIsRisky(openRemainder: string): boolean {
  return /[|]/.test(openRemainder) || /<<\s*['"]?[A-Za-z_]/.test(openRemainder);
}

// ---------------------------------------------------------------------------
// Segment classification
// ---------------------------------------------------------------------------

function stripQuotes(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0]!;
    const last = trimmed[trimmed.length - 1]!;
    if ((first === "'" || first === '"') && first === last) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  const flush = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return tokens;
}

/** Drops leading `VAR=value` assignments and `env VAR=value` prefixes. */
function effectiveHead(tokens: string[]): { head: string; args: string[] } | null {
  let index = 0;
  if (tokens[index] === "env") {
    index++;
    while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index++;
  } else {
    while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index++;
  }
  const raw = tokens[index];
  if (!raw) return null;
  return { head: basename(raw).toLowerCase(), args: tokens.slice(index + 1) };
}

function isScratchTarget(target: string, cwd?: string | null, home?: string | null): boolean {
  const cleaned = stripQuotes(target);
  if (!cleaned) return false;
  if (cleaned === "/" || cleaned === "." || cleaned === "..") return false;
  const parts = cleaned.split("/").filter((p) => p.length > 0);
  if (parts.includes("..")) return false;

  if (cleaned === ".tmp" || cleaned === "./.tmp" || cleaned.startsWith("./.tmp/")) return true;

  const roots = [cwd, home].filter((r): r is string => Boolean(r && r.trim()));
  for (const rawRoot of roots) {
    const root = rawRoot.replace(/[\\/]+$/, "");
    if (cleaned === `${root}/.tmp` || cleaned.startsWith(`${root}/.tmp/`)) return true;
    if (cleaned === `${root}/.cache` || cleaned.startsWith(`${root}/.cache/`)) return true;
  }

  if (cleaned.startsWith("~/.cache") || cleaned.startsWith("$HOME/.cache")) return true;
  return false;
}

function classifyRmArgs(args: string[], cwd?: string | null, home?: string | null): SafePermissionMatch | null {
  const targets: string[] = [];
  let scope: string | undefined;
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!RM_ALLOWED_FLAGS.has(arg)) return null;
      continue;
    }
    if (!isScratchTarget(arg, cwd, home)) return null;
    targets.push(arg);
    if (!scope) scope = stripQuotes(arg);
  }
  if (targets.length === 0) return null;
  return { ruleId: "scratch-cleanup", scope };
}

function classifyTeaxArgs(args: string[]): SafePermissionMatch | null {
  // Strip leading global flags if any before subcommand (e.g. teax --hostname ... -R ... issue ...)
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--hostname" || arg === "-R" || arg === "-r" || arg === "--repo" || arg === "--login") {
      i += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      // e.g. -R=owner/repo or --debug
      i++;
      continue;
    }
    break;
  }
  const primary = (args[i] || "").toLowerCase();
  if (!primary || !SAFE_TEAX_PRIMARY_SUBCOMMANDS.has(primary)) return null;

  // For `api` and `whoami`, any options/path are allowed
  if (primary === "api" || primary === "whoami") {
    return { ruleId: "teax-board" };
  }

  // Look for secondary subcommand / action (e.g. `issue comment`, `pr create`, `issue view`, `issue list`, `issue edit`)
  let j = i + 1;
  while (j < args.length) {
    const subArg = args[j]!;
    if (subArg === "--hostname" || subArg === "-R" || subArg === "-r" || subArg === "--repo" || subArg === "--login") {
      j += 2;
      continue;
    }
    if (subArg.startsWith("-")) {
      j++;
      continue;
    }
    break;
  }
  const action = (args[j] || "").toLowerCase();

  // If a forbidden action is present anywhere in arguments, reject (e.g. `teax pr merge`, `teax issue close`)
  for (const arg of args.slice(i)) {
    const lower = arg.toLowerCase();
    if (FORBIDDEN_TEAX_ACTIONS.has(lower)) return null;
    // Check flags like --state=closed
    if (lower === "--state=closed" || lower === "--state=close") return null;
  }

  // Permitted actions for issues/pulls:
  // comment, view, list, edit, create, or empty/numeric (e.g. `teax issue 42` which is view)
  const isNumeric = /^\d+$/.test(action);
  const isAllowedAction =
    action === "" ||
    isNumeric ||
    action === "comment" ||
    action === "c" ||
    action === "view" ||
    action === "list" ||
    action === "edit" ||
    action === "create";

  if (!isAllowedAction) return null;

  return { ruleId: "teax-board" };
}

function classifySegment(
  segment: string,
  cwd?: string | null,
  home?: string | null,
): SafePermissionMatch | null {
  const tokens = tokenize(segment);
  const effective = effectiveHead(tokens);
  if (!effective) return null;
  const { head, args } = effective;

  if (ALWAYS_SAFE_HEADS.has(head)) {
    // `cat` is only safe as a heredoc/stdin consumer or against scratch paths;
    // `cat <secret>` would otherwise be auto-approved.
    if (head === "cat") {
      for (const arg of args) {
        if (arg.startsWith("-")) continue;
        if (!isScratchTarget(arg, cwd, home)) return null;
      }
    }
    return { ruleId: "read-only-probe" };
  }

  if (head === "teax") return classifyTeaxArgs(args);

  if (head === "rm") return classifyRmArgs(args, cwd, home);

  if (head === "git") {
    const sub = (args[0] || "").toLowerCase();
    if (!READ_ONLY_GIT_SUBCOMMANDS.has(sub)) return null;
    if (GIT_DESTRUCTIVE_FLAGS.test(args.join(" "))) return null;
    return { ruleId: "read-only-probe" };
  }

  if (head === "paseo") {
    const sub = (args[0] || "").toLowerCase();
    const nested = (args[1] || "").toLowerCase();
    if (sub === "send") return { ruleId: "paseo-send" };
    if (sub === "permit" && nested === "ls") return { ruleId: "paseo-permit-ls" };
    if (sub === "plugin" && nested === "reload") return { ruleId: "paseo-plugin-reload" };
    return null;
  }

  return null;
}

/**
 * Classifies a raw command string against the allowlist. Returns the first
 * matching rule only when *every* top-level segment and command substitution is
 * itself safe. Unmatched or ambiguous input returns `null` (never auto-allowed).
 */
export function classifySafeCommand(
  command: string,
  options: { cwd?: string | null; home?: string | null } = {},
): SafePermissionMatch | null {
  const raw = String(command ?? "").trim();
  if (!raw) return null;
  const scan = scanShellCommand(raw);
  if (!scan.ok || scan.redirection) return null;
  if (scan.segments.length === 0) return null;

  let matched: SafePermissionMatch | null = null;
  for (const segment of scan.segments) {
    const result = classifySegment(segment, options.cwd, options.home);
    if (!result) return null;
    matched = matched ?? result;
  }
  for (const substitution of scan.substitutions) {
    const sub = classifySafeCommand(substitution, options);
    if (!sub) return null;
    matched = matched ?? sub;
  }
  return matched;
}

/** Picks the actual command text out of a pending permission payload. */
export function extractPermissionCommandText(permission: RawPermissionLike): string | undefined {
  const input = permission.input;
  if (input && typeof input === "object") {
    for (const key of ["command", "cmd", "script", "code"]) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0];
    }
  }
  for (const key of ["title", "name", "description"] as const) {
    const value = permission[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fleet-agent detection
// ---------------------------------------------------------------------------

const FLEET_ROLE_LABELS = new Set(["front-desk", "orchestrator", "coding-agent", "worker"]);

/**
 * True for agents the fleet owns: label-identified orchestrators/workers, their
 * labelled children, or a registered front desk / orchestrator. Ad-hoc agents
 * the operator runs by hand are never auto-allowed (#1084).
 */
export function isFleetAgent(agent: FleetAgentLike | null | undefined, context: FleetAgentContext = {}): boolean {
  if (!agent) return false;
  const id = agent.id?.trim();
  if (id) {
    if (context.frontDeskId && id === context.frontDeskId) return true;
    if (context.orchestratorAgentIds) {
      for (const orchId of context.orchestratorAgentIds) {
        if (orchId === id) return true;
      }
    }
  }
  const labels = agent.labels ?? {};
  const role = String(agent.role ?? labels.role ?? labels.category ?? "").trim().toLowerCase();
  if (FLEET_ROLE_LABELS.has(role)) return true;
  if (labels.repo?.trim()) return true;
  if (labels["paseo.parent-agent-id"]?.trim()) return true;
  const title = String(agent.title ?? agent.name ?? "").trim();
  if (/^Orchestrator\b/i.test(title) || /front\s*desk/i.test(title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Durable decision log
// ---------------------------------------------------------------------------

export interface AdjudicationDecisionRecord {
  ts: string;
  action: "auto-allow" | "escalate";
  agentId: string;
  agentName?: string;
  permissionId?: string;
  tool?: string;
  command?: string;
  ruleId?: string;
  scope?: string;
  reason: string;
}

export interface AdjudicationLogOptions {
  /** Explicit JSONL path; defaults to `<HOOK_STATE_DIR>/permission-decisions.jsonl`. */
  logPath?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function defaultLogPath(options: AdjudicationLogOptions = {}): string {
  const env = options.env ?? process.env;
  const configured = env.HOOK_STATE_DIR?.trim();
  if (configured) return join(configured, "permission-decisions.jsonl");
  const home = options.home ?? env.HOME ?? os.homedir();
  return join(home, ".paseo", "forgejo-hook", "permission-decisions.jsonl");
}

/** Appends one decision record to the durable JSONL log. Never throws. */
export function appendAdjudicationDecision(
  record: AdjudicationDecisionRecord,
  options: AdjudicationLogOptions = {},
): string | undefined {
  const logPath = options.logPath ?? defaultLogPath(options);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
    return logPath;
  } catch {
    return undefined;
  }
}

/** Reads every decision record from the durable log, in append order. */
export function readAdjudicationDecisions(options: AdjudicationLogOptions = {}): AdjudicationDecisionRecord[] {
  const logPath = options.logPath ?? defaultLogPath(options);
  if (!existsSync(logPath)) return [];
  const records: AdjudicationDecisionRecord[] = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as AdjudicationDecisionRecord);
    } catch {
      // Skip a torn/partial line rather than fail the whole query.
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Adjudication
// ---------------------------------------------------------------------------

export interface AdjudicatePermissionInput {
  agent: FleetAgentLike;
  permission: RawPermissionLike;
  context?: FleetAgentContext;
  /** Injected allow seam; when absent the decision is escalate. */
  allow?: (agentId: string, permissionId: string) => Promise<boolean>;
  logPath?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => Date;
}

export interface AdjudicatePermissionResult {
  action: "auto-allow" | "escalate";
  permissionId?: string;
  ruleId?: string;
  scope?: string;
  command?: string;
  reason: string;
  allowed?: boolean;
}

/**
 * Decides one pending permission for one agent. A fleet agent whose command
 * matches the allowlist is allowed through the injected seam; everything else
 * (non-fleet agent, unmatched/ambiguous command, missing id, no seam) escalates.
 * Every decision is appended to the durable log.
 */
export async function adjudicatePermission(
  input: AdjudicatePermissionInput,
): Promise<AdjudicatePermissionResult> {
  const { agent, permission } = input;
  const permissionId = (permission.id || permission.requestId || "").trim() || undefined;
  const command = extractPermissionCommandText(permission);
  const now = (input.now ?? (() => new Date()))();
  const base: Omit<AdjudicationDecisionRecord, "action" | "reason"> = {
    ts: now.toISOString(),
    agentId: agent.id ?? "unknown",
    agentName: agent.title?.trim() || agent.name?.trim() || undefined,
    permissionId,
    tool: permission.tool || permission.name || permission.kind || undefined,
    command,
  };

  const log = (
    action: "auto-allow" | "escalate",
    reason: string,
    extra: Partial<AdjudicationDecisionRecord> = {},
  ) => {
    appendAdjudicationDecision(
      { ...base, action, reason, ...extra },
      { logPath: input.logPath, env: input.env, home: input.home },
    );
  };

  if (!isFleetAgent(agent, input.context)) {
    log("escalate", "non-fleet agent; manual adjudication required");
    return { action: "escalate", permissionId, command, reason: "non-fleet agent" };
  }

  const match = command
    ? classifySafeCommand(command, {
        cwd: agent.cwd,
        home: input.home ?? input.env?.HOME ?? process.env.HOME,
      })
    : null;
  if (!match) {
    log("escalate", command ? "no safe-pattern match" : "no command text to classify");
    return {
      action: "escalate",
      permissionId,
      command,
      reason: command ? "no safe-pattern match" : "no command text to classify",
    };
  }

  if (!permissionId) {
    log("escalate", "safe-pattern match but no permission request id", {
      ruleId: match.ruleId,
      scope: match.scope,
    });
    return {
      action: "escalate",
      command,
      ruleId: match.ruleId,
      scope: match.scope,
      reason: "missing permission id",
    };
  }

  if (!input.allow) {
    log("escalate", "safe-pattern match but no allow seam available", {
      ruleId: match.ruleId,
      scope: match.scope,
    });
    return {
      action: "escalate",
      permissionId,
      command,
      ruleId: match.ruleId,
      scope: match.scope,
      reason: "no allow seam",
    };
  }

  let allowed = false;
  try {
    allowed = await input.allow(agent.id ?? "", permissionId);
  } catch {
    allowed = false;
  }

  if (allowed) {
    log("auto-allow", `matched ${match.ruleId}`, { ruleId: match.ruleId, scope: match.scope });
    return {
      action: "auto-allow",
      permissionId,
      command,
      ruleId: match.ruleId,
      scope: match.scope,
      reason: `matched ${match.ruleId}`,
      allowed: true,
    };
  }

  log("escalate", "safe-pattern match but allow call failed", {
    ruleId: match.ruleId,
    scope: match.scope,
  });
  return {
    action: "escalate",
    permissionId,
    command,
    ruleId: match.ruleId,
    scope: match.scope,
    reason: "allow call failed",
    allowed: false,
  };
}

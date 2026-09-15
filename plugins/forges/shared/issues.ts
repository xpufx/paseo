import { z } from "zod";
import { defineContract, defineSettingsContract } from "./vendor/paseo-plugin-helper/index.ts";

export const FORGEJO_PLUGIN_ID = "forges";

export const ForgejoIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  updatedAt: z.string().optional(),
});
export type ForgejoIssue = z.infer<typeof ForgejoIssueSchema>;

export const OpenIssuesInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  page: z.number().int().positive().default(1),
});
export type OpenIssuesInput = z.infer<typeof OpenIssuesInputSchema>;

export const OpenIssuesOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable().default(null),
  issues: z.array(ForgejoIssueSchema),
  openIssueCount: z.number().int().nonnegative().nullable().default(null),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  derivedRemote: z.string().nullable().default(null),
  remoteSource: z.enum(["explicit", "derived"]).nullable().default(null),
  repoPublic: z.boolean().nullable().default(null),
  tokenValid: z.boolean().nullable().default(null),
  error: z.string().optional(),
});
export type OpenIssuesOutput = z.infer<typeof OpenIssuesOutputSchema>;

export const openIssuesContract = defineContract({
  name: "forgejo.open-issues",
  description: "List open Forgejo issues for the repo backing a workspace directory",
  input: OpenIssuesInputSchema,
  output: OpenIssuesOutputSchema,
});

export interface ForgejoRemote {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into Forgejo coordinates. Handles
 * git@host:owner/repo(.git), https://host/owner/repo(.git), and
 * ssh://git@host/owner/repo(.git). Returns null when the URL does not
 * carry an owner/repo path.
 */
export function parseForgejoRemote(url: string | undefined | null): ForgejoRemote | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().replace(/\/+$/, "");
  const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  let host: string | undefined;
  let pathPart: string | undefined;
  if (scp && !trimmed.includes("://")) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `ssh://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      host = parsed.hostname || undefined;
      pathPart = parsed.pathname.replace(/^\/+/, "") || undefined;
    } catch {
      return null;
    }
  }
  if (!host || !pathPart) return null;
  const segments = pathPart.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const repo = segments.pop() as string;
  const owner = segments.pop() as string;
  return { host, owner, repo };
}

// ---------------------------------------------------------------------------
// Explicit remote URL override (issue #109 operator redirect).
// A workspace may pin its Forgejo coordinates via the settings screen
// instead of relying on the git origin remote (which can carry SSH
// aliases unknown to the API client). Precedence: explicit config > git remote.
// ---------------------------------------------------------------------------

const BARE_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const ForgejoSettingsSchema = z.object({
  remotesByDirectory: z.record(z.string(), z.string()).default({}),
  tokensByHost: z.record(z.string(), z.string()).default({}),
  namesByDirectory: z.record(z.string(), z.string()).default({}),
});
export type ForgejoSettings = z.infer<typeof ForgejoSettingsSchema>;

export const forgejoSettingsContract = defineSettingsContract({
  name: "forges.settings",
  schema: ForgejoSettingsSchema,
  description: "Forgejo plugin settings: remote overrides and host tokens",
});

export interface ResolvedForgejoRepo {
  host: string;
  repo: string;
}

/**
 * Resolve Forgejo coordinates with explicit-config-wins precedence.
 * The explicit value accepts every `parseForgejoRemote` form
 * (scp-like, ssh://, https://) plus a bare `owner/repo`, which borrows
 * its host from the git remote. Returns null when neither yields coords.
 */
export function resolveForgejoRepo(
  explicitRemote: string | undefined | null,
  gitRemoteUrl: string | undefined | null,
): ResolvedForgejoRepo | null {
  const git = parseForgejoRemote(gitRemoteUrl);
  const explicit = typeof explicitRemote === "string" ? explicitRemote.trim() : "";
  if (explicit) {
    const parsed = parseForgejoRemote(explicit);
    if (parsed) return { host: parsed.host, repo: `${parsed.owner}/${parsed.repo}` };
    if (BARE_REPO_PATTERN.test(explicit) && git) {
      return { host: git.host, repo: explicit };
    }
  }
  if (!git) return null;
  return { host: git.host, repo: `${git.owner}/${git.repo}` };
}

export interface ForgejoIssueLink {
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
}

const ISSUE_URL_PATTERN =
  /https?:\/\/([^/\s#?]+)\/([^/\s#?]+)\/([^/\s#?]+)\/issues\/(\d+)(?![/\w])/g;

/**
 * Extract issue URLs (host/owner/repo/issues/N) from chat text for the
 * timeline linkifier. Returns one entry per match, in order.
 */
export function extractForgejoIssueUrls(text: string | undefined | null): ForgejoIssueLink[] {
  if (!text || typeof text !== "string") return [];
  const links: ForgejoIssueLink[] = [];
  ISSUE_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ISSUE_URL_PATTERN.exec(text)) !== null) {
    links.push({
      host: match[1],
      owner: match[2],
      repo: match[3],
      number: Number(match[4]),
      url: match[0],
    });
  }
  return links;
}

/** Ranges of quoted content where bare-URL extraction must not match. */
function quotedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const push = (start: number, end: number) => {
    if (end > start) ranges.push({ start, end });
  };
  const fencePattern = /```[\s\S]*?(?:```|$)/g;
  let fence: RegExpExecArray | null;
  while ((fence = fencePattern.exec(text)) !== null) push(fence.index, fence.index + fence[0].length);
  const inFence = (index: number) => ranges.some((range) => index >= range.start && index < range.end);
  const codePattern = /`[^`\n]+`/g;
  let code: RegExpExecArray | null;
  while ((code = codePattern.exec(text)) !== null) {
    if (!inFence(code.index)) push(code.index, code.index + code[0].length);
  }
  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let link: RegExpExecArray | null;
  while ((link = linkPattern.exec(text)) !== null) {
    if (!inFence(link.index)) push(link.index, link.index + link[0].length);
  }
  return ranges;
}

/**
 * Extract only bare issue URLs: markdown-linked `[text](url)` targets and
 * quoted code are skipped because the card renders them inline instead of
 * duplicating them as rows (#143).
 */
export function extractBareForgejoIssueUrls(text: string | undefined | null): ForgejoIssueLink[] {
  if (!text || typeof text !== "string") return [];
  const quoted = quotedRanges(text);
  const inQuoted = (index: number) => quoted.some((range) => index >= range.start && index < range.end);
  const links: ForgejoIssueLink[] = [];
  ISSUE_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ISSUE_URL_PATTERN.exec(text)) !== null) {
    if (inQuoted(match.index)) continue;
    links.push({
      host: match[1],
      owner: match[2],
      repo: match[3],
      number: Number(match[4]),
      url: match[0],
    });
  }
  return links;
}

/**
 * Display form of a remote URL: the API speaks HTTPS, so scp-like and
 * ssh:// remotes render as `https://host/owner/repo`. Unparseable input
 * passes through untouched.
 */
export function displayRemoteForApi(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const parsed = parseForgejoRemote(url);
  if (!parsed) return url.trim();
  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}`;
}

/**
 * Pill label for an issue count. Null (unknown) renders a placeholder,
 * never a false zero.
 */
export function formatIssueCountLabel(count: number | null | undefined): string {
  if (count == null) return "issues --";
  return count === 1 ? "1 issue" : `${count} issues`;
}

/**
 * Display name for a workspace: explicit user label wins, otherwise the
 * resolved repo (owner/repo) is inferred. Null when neither exists.
 */
export function displayNameForDirectory(
  settings: Pick<ForgejoSettings, "namesByDirectory"> | undefined | null,
  directory: string | undefined | null,
  inferredRepo: string | undefined | null,
): string | null {
  if (directory) {
    const stored = settings?.namesByDirectory?.[directory];
    if (typeof stored === "string" && stored.trim()) return stored.trim();
  }
  if (typeof inferredRepo === "string" && inferredRepo.trim()) return inferredRepo.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Scoped label vocabularies (verified against the live board; see spec §4.1).
// Forgejo scoped labels are exclusive: applying one label in a scope evicts
// the previous label in that scope at the DB level, so the client only ever
// sends "add", never "remove".
// ---------------------------------------------------------------------------

export const STATE_ORDER = [
  "state/0-triage",
  "state/1-wip",
  "state/2-review",
  "state/3-verify",
  "state/4-done",
] as const;
export type StateLabel = (typeof STATE_ORDER)[number];

export const PRIORITY_ORDER = [
  "priority/0-SOS",
  "priority/1-high",
  "priority/2-normal",
  "priority/3-low",
  "priority/4-backburner",
] as const;
export type PriorityLabel = (typeof PRIORITY_ORDER)[number];

export const ATTENTION_LABELS = [
  "attention/0-orchestrator",
  "attention/1-agent",
  "attention/2-user",
  "attention/3-ignore",
] as const;

export const SPEC_LABELS = [
  "spec/0-needed",
  "spec/1-checklist",
  "spec/2-approved",
] as const;

const STATE_SHORT: Record<string, string> = {
  "state/0-triage": "Triage",
  "state/1-wip": "WIP",
  "state/2-review": "Review",
  "state/3-verify": "Verify",
  "state/4-done": "Done",
};

const PRIORITY_SHORT: Record<string, string> = {
  "priority/0-SOS": "SOS",
  "priority/1-high": "High",
  "priority/2-normal": "Normal",
  "priority/3-low": "Low",
  "priority/4-backburner": "Parked",
};

/** Compact display alias for a scoped label ("state/1-wip" -> "WIP"). */
export function shortLabelName(label: string): string {
  return STATE_SHORT[label] ?? PRIORITY_SHORT[label] ?? label;
}

/** The issue's current `state/*` label, or null when it carries none. */
export function currentStateLabel(labels: string[]): string | null {
  for (const label of labels) {
    if ((STATE_ORDER as readonly string[]).includes(label)) return label;
  }
  return null;
}

/** The issue's current `priority/*` label, defaulting to normal per spec §4.2. */
export function currentPriorityLabel(labels: string[]): string {
  for (const label of labels) {
    if ((PRIORITY_ORDER as readonly string[]).includes(label)) return label;
  }
  return "priority/2-normal";
}

/** Next `state/*` promotion step, or null when already done. */
export function nextStateLabel(labels: string[]): string | null {
  const current = currentStateLabel(labels);
  if (!current) return "state/1-wip";
  const idx = (STATE_ORDER as readonly string[]).indexOf(current);
  if (idx < 0 || idx + 1 >= STATE_ORDER.length) return null;
  return STATE_ORDER[idx + 1];
}

// ---------------------------------------------------------------------------
// Live label sync (issue #122, decision #121.2): the board is the source of
// truth. Scopes are derived from the labels actually present on open issues,
// not from the hardcoded vocabularies above (kept only as fallback/display).
// ---------------------------------------------------------------------------

/** Scope prefix of a `scope/name` label, or null for unscoped labels. */
export function scopeOfLabel(label: string): string | null {
  const slash = label.indexOf("/");
  if (slash <= 0 || slash + 1 >= label.length) return null;
  const scope = label.slice(0, slash);
  if (!/^[A-Za-z0-9_.-]+$/.test(scope)) return null;
  return scope;
}

/** Distinct scopes observed across a set of board labels, in first-seen order. */
export function liveScopesFromLabels(allLabels: string[]): string[] {
  const scopes: string[] = [];
  for (const label of allLabels) {
    const scope = scopeOfLabel(label);
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

/** Distinct scopes observed across a list of issues. */
export function liveScopesFromIssues(issues: Pick<ForgejoIssue, "labels">[]): string[] {
  return liveScopesFromLabels(issues.flatMap((issue) => issue.labels));
}

function rankOf(label: string | null, order: readonly string[]): number {
  if (!label) return order.length;
  const idx = (order as readonly string[]).indexOf(label);
  return idx < 0 ? order.length : idx;
}

/**
 * Rank open issues for display: priority first (SOS..backburner, unknown
 * last), then state order (triage..done), then most recently updated.
 */
export function rankIssues<T extends Pick<ForgejoIssue, "labels" | "updatedAt">>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const pri = rankOf(currentPriorityLabel(a.labels), PRIORITY_ORDER) -
      rankOf(currentPriorityLabel(b.labels), PRIORITY_ORDER);
    if (pri !== 0) return pri;
    const state = rankOf(currentStateLabel(a.labels), STATE_ORDER) -
      rankOf(currentStateLabel(b.labels), STATE_ORDER);
    if (state !== 0) return state;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

// ---------------------------------------------------------------------------
// Optional label-set install (issue #122, decision #121.3): ships our board
// taxonomy as data a foreign board may install (keeping or replacing theirs
// via the editor/API). Never applied automatically.
// ---------------------------------------------------------------------------

export interface LabelDefinition {
  name: string;
  color: string;
  exclusive: boolean;
  description: string;
}

const LABEL_DEFS: LabelDefinition[] = [
  ...STATE_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: ["#1d76db", "#0e7c6b", "#a6700b", "#6e40c9", "#1a7f37"][i] ?? "#59636e",
    exclusive: true,
    description: `Workflow state ${i}`,
  })),
  ...PRIORITY_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: ["#d1242f", "#e85d04", "#1d76db", "#59636e", "#8c959f"][i] ?? "#59636e",
    exclusive: true,
    description: `Priority ${i}`,
  })),
  ...ATTENTION_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#8250df",
    exclusive: true,
    description: "Who acts next",
  })),
  ...SPEC_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#0e7c6b",
    exclusive: true,
    description: "Spec readiness",
  })),
  ...["kind", "target", "format", "size", "dep", "flag"].map((scope): LabelDefinition => ({
    name: `${scope}/`,
    color: "#59636e",
    exclusive: scope !== "flag",
    description: `${scope} scope prefix`,
  })),
];

/** Our board taxonomy as installable data (see decision #121.3). */
export function paseoLabelSet(): LabelDefinition[] {
  return LABEL_DEFS.map((def) => ({ ...def }));
}

// ---------------------------------------------------------------------------
// Agent Envelope (parsed telemetry, spec §4.4).
// Every agent comment ends with the stamped envelope footer:
//   <sub>🤖 **<SessionTitle>** (`<shortId>`) · `<model>` ·
//   `<repo>:<branch>` · _<UTC timestamp>_</sub>
// ---------------------------------------------------------------------------

export const AgentEnvelopeSchema = z.object({
  commentId: z.number(),
  sessionTitle: z.string(),
  agentShortId: z.string(),
  model: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  postedAt: z.string().nullable().default(null),
  commitShas: z.array(z.string().regex(/^[0-9a-f]{7,40}$/)).default([]),
  paseoLinks: z.array(z.string()).default([]),
  serverId: z.string().nullable().default(null),
});
export type AgentEnvelope = z.infer<typeof AgentEnvelopeSchema>;

export const IssueCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  body: z.string(),
  envelope: AgentEnvelopeSchema.nullable().default(null),
});
export type IssueComment = z.infer<typeof IssueCommentSchema>;

export const IssueDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  webUrl: z.string(),
  comments: z.array(IssueCommentSchema),
  envelopes: z.array(AgentEnvelopeSchema),
});
export type IssueDetail = z.infer<typeof IssueDetailSchema>;

const ENVELOPE_FOOTER_PATTERN =
  /<sub>\s*🤖\s*\*\*(.+?)\*\*\s*\(`([^`)]+)`\)\s*·\s*`([^`]+)`\s*·\s*`([^`]+)`\s*·\s*_([^_]+)_\s*<\/sub>/;

/** Remove the agent envelope footer so comment bodies render without duplication. */
export function stripAgentEnvelopeFooter(body: string | undefined | null): string {
  if (!body || typeof body !== "string") return "";
  return body.replace(ENVELOPE_FOOTER_PATTERN, "").replace(/---\s*$/, "").trim();
}

const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/g;
const PASEO_LINK_PATTERN = /paseo:\/\/[^\s)>\]]+/g;
const PASEO_SERVER_PATTERN = /paseo:\/\/h\/([^/\s]+)\/agent\//;

/**
 * Parse the agent envelope footer of one comment body into structured
 * telemetry. Returns null when the comment carries no parseable footer;
 * envelope parsing never fails the detail RPC.
 */
export function parseAgentEnvelope(
  commentId: number,
  body: string | undefined | null,
): AgentEnvelope | null {
  if (!body || typeof body !== "string") return null;
  const match = ENVELOPE_FOOTER_PATTERN.exec(body);
  if (!match) return null;
  const sessionTitle = match[1].trim();
  const agentShortId = match[2].trim();
  if (!sessionTitle || !agentShortId) return null;
  const model = match[3].trim() || null;
  const repoBranch = match[4].trim();
  const postedAt = match[5].trim() || null;
  let repo: string | null = null;
  let branch: string | null = null;
  if (repoBranch) {
    const sep = repoBranch.lastIndexOf(":");
    if (sep > 0) {
      repo = repoBranch.slice(0, sep) || null;
      branch = repoBranch.slice(sep + 1) || null;
    } else {
      branch = repoBranch;
    }
  }
  const commitShas = Array.from(
    new Set(
      (body.match(SHA_PATTERN) ?? []).filter(
        (sha) => sha !== agentShortId && /[0-9]/.test(sha) && /[a-f]/.test(sha),
      ),
    ),
  );
  const paseoLinks = Array.from(new Set(body.match(PASEO_LINK_PATTERN) ?? []));
  const serverMatch = PASEO_SERVER_PATTERN.exec(paseoLinks[0] ?? "");
  return {
    commentId,
    sessionTitle,
    agentShortId,
    model,
    repo,
    branch,
    postedAt,
    commitShas,
    paseoLinks,
    serverId: serverMatch ? serverMatch[1] : null,
  };
}

// ---------------------------------------------------------------------------
// Detail / write contracts (spec §5.2–§5.4).
// Input accepts `issueNumber` (primary) with `number` as a deprecated alias
// so spec-shaped payloads keep working; handlers normalize via
// `normalizeIssueNumber`.
// ---------------------------------------------------------------------------

const IssueNumberInput = z
  .object({
    directory: z.string().optional(),
    remoteUrl: z.string().optional(),
    issueNumber: z.number().int().positive().optional(),
    number: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.issueNumber == null && value.number == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "issueNumber (or number) is required",
      });
    }
  });
export type IssueNumberInput = z.infer<typeof IssueNumberInput>;

/** Resolve the canonical issue number from either input spelling. */
export function normalizeIssueNumber(
  input: IssueNumberInput | { issueNumber?: number; number?: number },
): number | null {
  const issueNumber = (input as { issueNumber?: unknown }).issueNumber;
  if (typeof issueNumber === "number" && Number.isInteger(issueNumber) && issueNumber > 0) {
    return issueNumber;
  }
  const legacy = (input as { number?: unknown }).number;
  if (typeof legacy === "number" && Number.isInteger(legacy) && legacy > 0) {
    return legacy;
  }
  return null;
}

export const IssueDetailInputSchema = IssueNumberInput;
export type IssueDetailInput = z.infer<typeof IssueDetailInputSchema>;

export const IssueDetailOutputSchema = z.object({
  repo: z.string().nullable(),
  issue: IssueDetailSchema.nullable(),
  fetchedAt: z.string().datetime(),
  repoPublic: z.boolean().nullable().default(null),
  tokenValid: z.boolean().nullable().default(null),
  error: z.string().optional(),
});
export type IssueDetailOutput = z.infer<typeof IssueDetailOutputSchema>;

export const issueDetailContract = defineContract({
  name: "forgejo.issue-detail",
  description: "Full body, comments, and parsed Agent Envelopes for one issue",
  input: IssueDetailInputSchema,
  output: IssueDetailOutputSchema,
});

export const SetLabelInputSchema = IssueNumberInput.extend({
  label: z.string().min(1).max(100),
});
export type SetLabelInput = z.infer<typeof SetLabelInputSchema>;

export const SetLabelOutputSchema = z.object({
  number: z.number(),
  labels: z.array(z.string()),
  error: z.string().optional(),
});
export type SetLabelOutput = z.infer<typeof SetLabelOutputSchema>;

export const setLabelContract = defineContract({
  name: "forgejo.set-label",
  description: "Apply one scoped label; Forgejo exclusive scope evicts the rest",
  input: SetLabelInputSchema,
  output: SetLabelOutputSchema,
});

export const AddCommentInputSchema = IssueNumberInput.extend({
  body: z.string().min(1).max(10000),
});
export type AddCommentInput = z.infer<typeof AddCommentInputSchema>;

export const AddCommentOutputSchema = z.object({
  number: z.number(),
  commentId: z.number().nullable(),
  error: z.string().optional(),
});
export type AddCommentOutput = z.infer<typeof AddCommentOutputSchema>;

export const addCommentContract = defineContract({
  name: "forgejo.add-comment",
  description: "Post a quick comment (or steering note) to the issue thread",
  input: AddCommentInputSchema,
  output: AddCommentOutputSchema,
});

// ---------------------------------------------------------------------------
// Markdown-lite (issue #136): focused renderer input for Forgejo issue
// descriptions/comments. Covers paragraphs, headings, unordered/ordered
// list lines, Markdown links, inline code, bold/italic, and fenced code
// blocks. Pure string parsing: no RPC, no side effects, no dependencies.
// ---------------------------------------------------------------------------

export type MarkdownLiteSpan =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

export type MarkdownLiteBlock =
  | { kind: "paragraph"; spans: MarkdownLiteSpan[] }
  | { kind: "heading"; level: 1 | 2 | 3; spans: MarkdownLiteSpan[] }
  | { kind: "list"; ordered: boolean; items: MarkdownLiteSpan[][] }
  | { kind: "code"; text: string; language?: string };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;

/** Split one line of prose into text/bold/italic/code/link spans. */
export function parseMarkdownLiteInline(text: string): MarkdownLiteSpan[] {
  if (!text) return [];
  const spans: MarkdownLiteSpan[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      spans.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    if (match[1]) {
      spans.push({ kind: "code", text: match[1].slice(1, -1) });
    } else if (match[2]) {
      spans.push({ kind: "link", text: match[3], url: match[4] });
    } else if (match[5]) {
      spans.push({ kind: "bold", text: match[6] });
    } else if (match[7]) {
      spans.push({ kind: "bold", text: match[8] });
    } else if (match[9]) {
      spans.push({ kind: "italic", text: match[10] });
    } else if (match[11]) {
      spans.push({ kind: "italic", text: match[12] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ kind: "text", text: text.slice(cursor) });
  }
  return spans.filter((span) => {
    if (span.kind === "link") return span.text.length > 0 && span.url.length > 0;
    return span.text.length > 0;
  });
}

const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*$/;
const UNORDERED_PATTERN = /^\s*[-*]\s+(.+)$/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const FENCE_PATTERN = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/;

/** Split a Markdown body into render blocks for the compact composer view. */
export function parseMarkdownLite(body: string | undefined | null): MarkdownLiteBlock[] {
  if (!body || typeof body !== "string") return [];
  const blocks: MarkdownLiteBlock[] = [];
  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    paragraph.length = 0;
    if (!text) return;
    blocks.push({ kind: "paragraph", spans: parseMarkdownLiteInline(text) });
  };
  const closeList = (list: MarkdownLiteBlock | null) => {
    if (list && list.kind === "list" && list.items.length > 0) blocks.push(list);
  };
  let openList: MarkdownLiteBlock | null = null;
  let fenceLanguage: string | undefined;
  let fenceLines: string[] | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const fence = FENCE_PATTERN.exec(rawLine);
    if (fence) {
      if (fenceLines == null) {
        flushParagraph();
        closeList(openList);
        openList = null;
        fenceLanguage = fence[1] || undefined;
        fenceLines = [];
      } else {
        blocks.push({
          kind: "code",
          text: fenceLines.join("\n").replace(/\n$/, ""),
          ...(fenceLanguage ? { language: fenceLanguage } : {}),
        });
        fenceLanguage = undefined;
        fenceLines = null;
      }
      continue;
    }
    if (fenceLines != null) {
      fenceLines.push(rawLine);
      continue;
    }
    if (!rawLine.trim()) {
      flushParagraph();
      closeList(openList);
      openList = null;
      continue;
    }
    const heading = HEADING_PATTERN.exec(rawLine);
    if (heading) {
      flushParagraph();
      closeList(openList);
      openList = null;
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        spans: parseMarkdownLiteInline(heading[2]),
      });
      continue;
    }
    const unordered = UNORDERED_PATTERN.exec(rawLine);
    const ordered = unordered ? null : ORDERED_PATTERN.exec(rawLine);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = !unordered;
      const content = (unordered?.[1] ?? ordered?.[1] ?? "").trim();
      if (!content) continue;
      if (!openList || openList.kind !== "list" || openList.ordered !== isOrdered) {
        closeList(openList);
        openList = { kind: "list", ordered: isOrdered, items: [] };
      }
      (openList as { kind: "list"; ordered: boolean; items: MarkdownLiteSpan[][] }).items.push(
        parseMarkdownLiteInline(content),
      );
      continue;
    }
    closeList(openList);
    openList = null;
    paragraph.push(rawLine);
  }
  if (fenceLines != null) {
    blocks.push({
      kind: "code",
      text: fenceLines.join("\n").replace(/\n$/, ""),
      ...(fenceLanguage ? { language: fenceLanguage } : {}),
    });
  }
  flushParagraph();
  closeList(openList);
  return blocks;
}
// The autonomous board check stamps a raw text delta into chat
// ("[Autonomous Trigger] Forgejo Board Alert: ..."). The composer view
// restyles it as a structured card; this parser extracts the payload so
// the timeline transformer can build typed renderer data. Pure string
// parsing: no RPC, no side effects.
// ---------------------------------------------------------------------------

export const BoardAlertIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  labels: z.array(z.string()).default([]),
  action: z.string().default(""),
  url: z.string().url().optional(),
});
export type BoardAlertIssue = z.infer<typeof BoardAlertIssueSchema>;

export const BoardAlertSchema = z.object({
  headline: z.string(),
  issues: z.array(BoardAlertIssueSchema),
});
export type BoardAlert = z.infer<typeof BoardAlertSchema>;

export const boardAlertTimelineSchema = z.object({
  headline: z.string(),
  issues: z.array(BoardAlertIssueSchema),
});
export type BoardAlertTimelineData = z.infer<typeof boardAlertTimelineSchema>;

const BOARD_ALERT_MARKERS = ["forgejo board alert", "forgejo board actionable delta"];

const BOARD_ISSUE_LINE = /^\s*[-*]\s*issue\s*#(\d+)\s*:\s*(.+?)\s*$/i;
const BOARD_LABELS_LINE = /^\s*labels\s*:\s*(.+?)\s*$/i;
const BOARD_ACTION_LINE = /^\s*action\s*:\s*(.+?)\s*$/i;

/** True when chat text carries a board-alert delta dump. */
export function isBoardAlertText(text: string | undefined | null): boolean {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return BOARD_ALERT_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Parse a raw board-alert dump into structured card data.
 * Returns null when the text is not a board alert or carries no issues.
 */
export function parseBoardAlert(text: string | undefined | null): BoardAlert | null {
  if (!isBoardAlertText(text)) return null;
  const body = text as string;
  const linksByNumber = new Map<number, string>();
  for (const link of extractForgejoIssueUrls(body)) {
    if (!linksByNumber.has(link.number)) linksByNumber.set(link.number, link.url);
  }
  const lines = body.split(/\r?\n/);
  const issues: BoardAlertIssue[] = [];
  let current: { number: number; title: string; labels: string[]; action: string; url?: string } | null = null;
  const flush = () => {
    if (current) {
      const parsed = BoardAlertIssueSchema.safeParse(current);
      if (parsed.success) issues.push(parsed.data);
      current = null;
    }
  };
  for (const line of lines) {
    const issueMatch = BOARD_ISSUE_LINE.exec(line);
    if (issueMatch) {
      flush();
      const number = Number(issueMatch[1]);
      const rawTitle = issueMatch[2].trim();
      const urlInTitle = extractForgejoIssueUrls(rawTitle)[0]?.url;
      const title = urlInTitle ? rawTitle.replace(urlInTitle, "").replace(/\s{2,}/g, " ").trim() : rawTitle;
      current = {
        number,
        title,
        labels: [],
        action: "",
        ...(linksByNumber.get(number) ? { url: linksByNumber.get(number) as string } : {}),
      };
      continue;
    }
    if (!current) continue;
    const labelsMatch = BOARD_LABELS_LINE.exec(line);
    if (labelsMatch) {
      current.labels = labelsMatch[1]
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);
      continue;
    }
    const actionMatch = BOARD_ACTION_LINE.exec(line);
    if (actionMatch) {
      current.action = actionMatch[1].trim();
    }
  }
  flush();
  if (issues.length === 0) return null;
  const headlineMatch = /forgejo board alert\s*:?\s*([^\n]*)/i.exec(body);
  const headline = headlineMatch?.[1]?.trim() || "New actionable items detected";
  return { headline, issues };
}

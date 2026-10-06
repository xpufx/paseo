import { z } from "zod";
import { defineContract } from "./rpc.js";

// ---------------------------------------------------------------------------
// Label taxonomy & definitions (issues #122, #189, #200)
// ---------------------------------------------------------------------------

// Canonical taxonomy is numberless (platform#247). Readers accept the legacy
// numeric spellings too (dual-read) while the board migrates; `LEGACY_*` arrays
// and `LABEL_ALIASES` keep the two spellings interchangeable.
export const STATE_ORDER = [
  "state/triage",
  "state/wip",
  "state/review",
  "state/verify",
  "state/done",
] as const;
export type StateLabel = (typeof STATE_ORDER)[number];

export const LEGACY_STATE_ORDER = [
  "state/0-triage",
  "state/1-wip",
  "state/2-review",
  "state/3-verify",
  "state/4-done",
] as const;

export const PRIORITY_ORDER = [
  "priority/sos",
  "priority/high",
  "priority/normal",
  "priority/low",
  "priority/backburner",
] as const;
export type PriorityLabel = (typeof PRIORITY_ORDER)[number];

export const LEGACY_PRIORITY_ORDER = [
  "priority/0-SOS",
  "priority/1-high",
  "priority/2-normal",
  "priority/3-low",
  "priority/4-backburner",
] as const;

export const ATTENTION_LABELS = [
  "attention/orchestrator",
  "attention/agent",
  "attention/user",
  "attention/ignore",
] as const;
export type AttentionLabel = (typeof ATTENTION_LABELS)[number];

export const LEGACY_ATTENTION_LABELS = [
  "attention/0-orchestrator",
  "attention/1-agent",
  "attention/2-user",
  "attention/3-ignore",
] as const;

export const SPEC_LABELS = [
  "spec/needed",
  "spec/checklist",
  "spec/approved",
] as const;
export type SpecLabel = (typeof SPEC_LABELS)[number];

export const LEGACY_SPEC_LABELS = [
  "spec/0-needed",
  "spec/1-checklist",
  "spec/2-approved",
] as const;

function aliasPairs(
  canonical: readonly string[],
  legacy: readonly string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  canonical.forEach((name, i) => {
    const legacyName = legacy[i];
    if (legacyName) map[legacyName] = name;
  });
  return map;
}

/** Legacy numeric label -> canonical numberless label (all scopes). */
export const LABEL_ALIASES: Record<string, string> = {
  ...aliasPairs(STATE_ORDER, LEGACY_STATE_ORDER),
  ...aliasPairs(PRIORITY_ORDER, LEGACY_PRIORITY_ORDER),
  ...aliasPairs(ATTENTION_LABELS, LEGACY_ATTENTION_LABELS),
  ...aliasPairs(SPEC_LABELS, LEGACY_SPEC_LABELS),
  "review/0-needed": "review/needed",
  "review/1-changes-requested": "review/changes-requested",
  "review/2-approved": "review/approved",
  "format/0-needed": "format/needed",
  "format/1-ok": "format/ok",
  "size/0-cheap": "size/cheap",
  "size/1-medium": "size/medium",
  "size/2-expensive": "size/expensive",
  "size/3-chunk": "size/chunk",
  "linked/0-needs-split": "linked/needs-split",
  "linked/1-peer": "linked/peer",
  "linked/2-done": "linked/done",
  "upstream/0-explore": "upstream/explore",
  "upstream/1-blocked": "upstream/blocked",
  "upstream/2-aligned": "upstream/aligned",
};

/** Canonical numberless spelling of a label; unknown labels pass through. */
export function canonicalLabel(label: string): string {
  return LABEL_ALIASES[label] ?? label;
}

/** True when two spellings name the same scoped label under the alias map. */
export function sameLabel(a: string, b: string): boolean {
  return canonicalLabel(a) === canonicalLabel(b);
}

const CANONICAL_SHORT: Record<string, string> = {
  "state/triage": "Triage",
  "state/wip": "WIP",
  "state/review": "Review",
  "state/verify": "Verify",
  "state/done": "Done",
  "priority/sos": "SOS",
  "priority/high": "High",
  "priority/normal": "Normal",
  "priority/low": "Low",
  "priority/backburner": "Parked",
};

/** Compact display alias for a scoped label ("state/1-wip" -> "WIP"). */
export function shortLabelName(label: string): string {
  return CANONICAL_SHORT[canonicalLabel(label)] ?? label;
}

/** The issue's current `state/*` label (canonical), or null when it carries none. */
export function currentStateLabel(labels: string[]): string | null {
  for (const label of labels) {
    const canonical = canonicalLabel(label);
    if ((STATE_ORDER as readonly string[]).includes(canonical)) return canonical;
  }
  return null;
}

/** The issue's current `priority/*` label, defaulting to normal per spec §4.2. */
export function currentPriorityLabel(labels: string[]): string {
  for (const label of labels) {
    const canonical = canonicalLabel(label);
    if ((PRIORITY_ORDER as readonly string[]).includes(canonical)) return canonical;
  }
  return "priority/normal";
}

/** Next `state/*` promotion step, or null when already done. */
export function nextStateLabel(labels: string[]): string | null {
  const current = currentStateLabel(labels);
  if (!current) return "state/wip";
  const idx = (STATE_ORDER as readonly string[]).indexOf(current);
  if (idx < 0 || idx + 1 >= STATE_ORDER.length) return null;
  return STATE_ORDER[idx + 1];
}

// ---------------------------------------------------------------------------
// Schemas & Types
// ---------------------------------------------------------------------------

export const ForgeLabelSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  description: z.string().optional(),
});
export type ForgeLabel = z.infer<typeof ForgeLabelSchema>;

export const ForgeIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  labelDetails: z.array(ForgeLabelSchema).default([]),
  comments: z.number().int().nonnegative().default(0),
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
  author: z.string().optional(),
  url: z.string().optional(),
  body: z.string().optional(),
  remoteUrl: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
});
export type ForgeIssue = z.infer<typeof ForgeIssueSchema>;

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
  url: z.string(),
  envelope: AgentEnvelopeSchema.nullable().default(null),
});
export type IssueComment = z.infer<typeof IssueCommentSchema>;

export const IssueDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  labelDetails: z.array(ForgeLabelSchema).default([]),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  webUrl: z.string(),
  comments: z.array(IssueCommentSchema),
  envelopes: z.array(AgentEnvelopeSchema),
});
export type IssueDetail = z.infer<typeof IssueDetailSchema>;

export interface ForgeRepoIdentity {
  host: string;
  owner: string;
  repo: string;
}

export type ForgeVisibility = "public" | "private" | "unknown";
export type ForgeAuthState =
  | "authenticated"
  | "lacks-write-scope"
  | "invalid-token"
  | "anonymous"
  | "unknown";

export interface ForgeAccessState {
  visibility: ForgeVisibility;
  auth: ForgeAuthState;
  canEdit: boolean;
  visibilityLabel: string | null;
  authLabel: string;
  authIcon: string;
  authVariant: "success" | "warning" | "danger" | "neutral";
  summary: string;
  requiredScopes: string;
}

export interface ForgeAccessInput {
  repoPublic?: boolean | null;
  tokenPresent?: boolean | null;
  tokenValid?: boolean | null;
  repoWritePermission?: boolean | null;
}

export function forgeWriteScopeList(): string {
  return "repo, write:issue (or issues:write)";
}

export function deriveForgeAccess(input: ForgeAccessInput = {}): ForgeAccessState {
  const visibility: ForgeVisibility =
    input.repoPublic === true
      ? "public"
      : input.repoPublic === false
        ? "private"
        : "unknown";

  let auth: ForgeAuthState;
  if (input.tokenValid === true) {
    auth = input.repoWritePermission === false ? "lacks-write-scope" : "authenticated";
  } else if (input.tokenPresent !== true) auth = "anonymous";
  else if (input.tokenValid === false) auth = "invalid-token";
  else auth = "unknown";

  const canEdit = auth === "authenticated";
  const visibilityLabel = visibility === "unknown" ? null : visibility;

  let authLabel: string;
  let authIcon: string;
  let authVariant: ForgeAccessState["authVariant"];
  if (auth === "authenticated") {
    authLabel = "Authenticated";
    authIcon = "KeyRound";
    authVariant = "success";
  } else if (auth === "lacks-write-scope") {
    authLabel = "Token lacks write scope";
    authIcon = "ShieldAlert";
    authVariant = "warning";
  } else if (auth === "invalid-token") {
    authLabel = "Token rejected";
    authIcon = "AlertTriangle";
    authVariant = "danger";
  } else if (auth === "anonymous") {
    authLabel = "No token";
    authIcon = "User";
    authVariant = "neutral";
  } else {
    authLabel = "Token unverified";
    authIcon = "AlertCircle";
    authVariant = "warning";
  }

  const scopeHint = `required scopes: ${forgeWriteScopeList()}.`;
  const authClause =
    auth === "authenticated"
      ? "Token accepted with write scope — reads and edits enabled."
      : auth === "lacks-write-scope"
        ? `Token accepted but it cannot push — edits disabled; ${scopeHint}`
        : auth === "invalid-token"
          ? "Saved token was rejected — edits disabled."
          : auth === "anonymous"
            ? "No token saved — edits disabled."
            : "Token state unverified — edits disabled.";

  const summary =
    visibility === "public"
      ? `Public repo — anonymous reads work. ${authClause}`
      : visibility === "private"
        ? `Private repo — a valid token is required for reads. ${authClause}`
        : `Repo visibility unknown (could not reach host). ${authClause}`;

  return {
    visibility,
    auth,
    canEdit,
    visibilityLabel,
    authLabel,
    authIcon,
    authVariant,
    summary,
    requiredScopes: forgeWriteScopeList(),
  };
}

export function writeGateNotice(access: ForgeAccessState, capability: string): string {
  if (access.auth === "lacks-write-scope") {
    return `Read-only — this token cannot ${capability}; it lacks write scope. Add a token with ${access.requiredScopes}.`;
  }
  return `Read-only — ${capability} needs a valid token. ${access.summary}`;
}

const ENVELOPE_FOOTER_PATTERN =
  /<sub>\s*🤖\s*\*\*(.+?)\*\*\s*\(`([^`)]+)`\)\s*·\s*`([^`]+)`\s*·\s*`([^`]+)`\s*·\s*_([^_]+)_\s*<\/sub>/;

export function stripAgentEnvelopeFooter(body: string | undefined | null): string {
  if (!body || typeof body !== "string") return "";
  return body.replace(ENVELOPE_FOOTER_PATTERN, "").replace(/---\s*$/, "").trim();
}

// ---------------------------------------------------------------------------
// Markdown-lite Parser
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
  /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)/g;

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

// ---------------------------------------------------------------------------
// RPC Contracts
// ---------------------------------------------------------------------------

export const IssueNumberInput = z
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

export const IssueDetailInputSchema = IssueNumberInput;
export type IssueDetailInput = z.infer<typeof IssueDetailInputSchema>;

export const IssueDetailOutputSchema = z.object({
  repo: z.string().nullable(),
  issue: IssueDetailSchema.nullable(),
  fetchedAt: z.string().datetime(),
  repoPublic: z.boolean().nullable().default(null),
  tokenPresent: z.boolean().default(false),
  tokenValid: z.boolean().nullable().default(null),
  repoWritePermission: z.boolean().nullable().default(null),
  error: z.string().optional(),
});
export type IssueDetailOutput = z.infer<typeof IssueDetailOutputSchema>;

export const issueDetailContract = defineContract({
  name: "forge.issue-detail",
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
  name: "forge.set-label",
  description: "Apply one scoped label; an exclusive scope evicts the rest",
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
  name: "forge.add-comment",
  description: "Post a quick comment (or steering note) to the issue thread",
  input: AddCommentInputSchema,
  output: AddCommentOutputSchema,
});

export const CREATE_ISSUE_TITLE_MAX = 200;
export const CREATE_ISSUE_BODY_MAX = 10000;
export const CREATE_ISSUE_LABEL_MAX = 50;

export const CreateIssueInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  title: z.string(),
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

export const CreateIssueOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable().default(null),
  number: z.number().int().positive().nullable().default(null),
  error: z.string().optional(),
});
export type CreateIssueOutput = z.infer<typeof CreateIssueOutputSchema>;

export const createIssueContract = defineContract({
  name: "forge.create-issue",
  description: "Create a new issue on the configured forge repo",
  input: CreateIssueInputSchema,
  output: CreateIssueOutputSchema,
});

export function validateCreateIssueInput(input: {
  title?: unknown;
  body?: unknown;
  labels?: unknown;
}): string | null {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return "Issue title must not be empty";
  if (title.length > CREATE_ISSUE_TITLE_MAX) return "Issue title is too long";
  const body = typeof input.body === "string" ? input.body : "";
  if (body.length > CREATE_ISSUE_BODY_MAX) return "Issue description is too long";
  if (input.labels !== undefined) {
    if (!Array.isArray(input.labels)) return "Labels must be a list";
    if (input.labels.length > CREATE_ISSUE_LABEL_MAX) return "Too many labels";
    if (input.labels.some((label) => typeof label !== "string" || !label.trim())) {
      return "Label must not be empty";
    }
  }
  return null;
}

export function parseLabelList(text: string | undefined | null): string[] {
  if (!text || typeof text !== "string") return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    names.push(trimmed);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Open & Search issues RPC contracts
// ---------------------------------------------------------------------------

export const OpenIssuesInputSchema = z.object({
  workspaceId: z.string().optional(),
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  page: z.number().int().positive().default(1),
});
export type OpenIssuesInput = z.infer<typeof OpenIssuesInputSchema>;

export const OpenIssuesOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable().default(null),
  issues: z.array(ForgeIssueSchema),
  openIssueCount: z.number().int().nonnegative().nullable().default(null),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  derivedRemote: z.string().nullable().default(null),
  remoteSource: z.enum(["explicit", "derived"]).nullable().default(null),
  repoPublic: z.boolean().nullable().default(null),
  tokenPresent: z.boolean().default(false),
  tokenValid: z.boolean().nullable().default(null),
  repoWritePermission: z.boolean().nullable().default(null),
  error: z.string().optional(),
});
export type OpenIssuesOutput = z.infer<typeof OpenIssuesOutputSchema>;

export const openIssuesContract = defineContract({
  name: "forge.open-issues",
  description: "List open forge issues for the repo backing a workspace directory",
  input: OpenIssuesInputSchema,
  output: OpenIssuesOutputSchema,
});

export const SearchIssuesInputSchema = z.object({
  workspaceId: z.string().optional(),
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  query: z.string(),
  page: z.number().int().positive().default(1),
});
export type SearchIssuesInput = z.infer<typeof SearchIssuesInputSchema>;

export const SearchIssuesOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable().default(null),
  issues: z.array(ForgeIssueSchema),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  error: z.string().optional(),
});
export type SearchIssuesOutput = z.infer<typeof SearchIssuesOutputSchema>;

export const searchIssuesContract = defineContract({
  name: "forge.search-issues",
  description: "Keyword-search forge issues (open and closed) for the repo backing a workspace directory",
  input: SearchIssuesInputSchema,
  output: SearchIssuesOutputSchema,
});

// ---------------------------------------------------------------------------
// Forge context RPC contracts
// ---------------------------------------------------------------------------

export const ForgeContextInputSchema = z.object({
  workspaceId: z.string().optional(),
  directory: z.string().optional(),
});
export type ForgeContextInput = z.infer<typeof ForgeContextInputSchema>;

export const ForgeContextOutputSchema = z.object({
  directory: z.string().nullable().default(null),
  derivedRemote: z.string().nullable().default(null),
  derivedHost: z.string().nullable().default(null),
  derivedRepo: z.string().nullable().default(null),
});
export type ForgeContextOutput = z.infer<typeof ForgeContextOutputSchema>;

export const forgeContextContract = defineContract({
  name: "forge.context",
  description: "Workspace git-origin forge coordinates",
  input: ForgeContextInputSchema,
  output: ForgeContextOutputSchema,
});

export const forgeForgeContextContract = defineContract({
  name: "forge.forge-context",
  description: "Git-origin forge coordinates for a workspace, independent of issue queries",
  input: ForgeContextInputSchema,
  output: ForgeContextOutputSchema,
});

// ---------------------------------------------------------------------------
// Agent envelope parsing
// ---------------------------------------------------------------------------

export const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/g;
export const PASEO_LINK_PATTERN = /paseo:\/\/[^\s)>\]]+/g;
export const PASEO_SERVER_PATTERN = /paseo:\/\/h\/([^/\s]+)\/agent\//;

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
// Remote coordinates & resolution
// ---------------------------------------------------------------------------

export interface ForgeRemote {
  host: string;
  owner: string;
  repo: string;
}

export function parseForgeRemote(url: string | undefined | null): ForgeRemote | null {
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

export const BARE_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type ForgeTargetResolution =
  | { ok: true; host: string; repo: string; source: "explicit" | "derived" }
  | { ok: false; error: string };

export function resolveForgeTarget(
  explicitTarget: string | undefined | null,
  gitRemoteUrl: string | undefined | null,
): ForgeTargetResolution {
  const explicit = typeof explicitTarget === "string" ? explicitTarget.trim() : "";
  const git = parseForgeRemote(gitRemoteUrl);
  if (explicit) {
    const parsed = parseForgeRemote(explicit);
    if (parsed) {
      return { ok: true, host: parsed.host, repo: `${parsed.owner}/${parsed.repo}`, source: "explicit" };
    }
    if (BARE_REPO_PATTERN.test(explicit)) {
      if (git) return { ok: true, host: git.host, repo: explicit, source: "explicit" };
      return { ok: false, error: `Selected forge "${explicit}" needs a git origin remote to supply its host` };
    }
    return { ok: false, error: `Selected forge "${explicit}" is not a valid forge remote or owner/repo` };
  }
  if (!git) return { ok: false, error: "No forge repo found for this workspace" };
  return { ok: true, host: git.host, repo: `${git.owner}/${git.repo}`, source: "derived" };
}

export function isValidForgeTarget(target: string | undefined | null): boolean {
  const value = typeof target === "string" ? target.trim() : "";
  if (!value) return false;
  return Boolean(parseForgeRemote(value)) || BARE_REPO_PATTERN.test(value);
}

export function forgeCapabilityFromRepo(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const permissions = record.permissions;
  if (permissions && typeof permissions === "object") {
    const perms = permissions as Record<string, unknown>;
    if (typeof perms.push === "boolean" || typeof perms.admin === "boolean") {
      return perms.push === true || perms.admin === true;
    }
  }
  const accessLevel = record.access_level ?? record.accessLevel;
  if (typeof accessLevel === "number") return accessLevel >= 30;
  return null;
}

export function activeForgeForDirectory(
  settings:
    | {
        activeForgeByDirectory?: Record<string, string>;
        remotesByDirectory?: Record<string, string>;
        forgesByDirectory?: Record<string, string[]>;
      }
    | undefined
    | null,
  directory: string | undefined | null,
): string | null {
  const dir = typeof directory === "string" ? directory.trim() : "";
  if (!dir) return null;
  const activeMap = settings?.activeForgeByDirectory;
  if (activeMap && Object.prototype.hasOwnProperty.call(activeMap, dir)) {
    const active = activeMap[dir];
    return typeof active === "string" && active.trim() ? active.trim() : null;
  }
  const remotesMap = settings?.remotesByDirectory;
  if (remotesMap && Object.prototype.hasOwnProperty.call(remotesMap, dir)) {
    const legacy = remotesMap[dir];
    return typeof legacy === "string" && legacy.trim() ? legacy.trim() : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Issue & label utilities
// ---------------------------------------------------------------------------

export function normalizeIssueNumber(input: {
  issueNumber?: number;
  number?: number;
}): number | null {
  const candidate = input.issueNumber ?? input.number;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0
    ? candidate
    : null;
}

export function scopeOfLabel(label: string): string | null {
  const slash = label.indexOf("/");
  if (slash <= 0 || slash + 1 >= label.length) return null;
  const scope = label.slice(0, slash);
  if (!/^[A-Za-z0-9_.-]+$/.test(scope)) return null;
  return scope;
}

export function liveScopesFromLabels(allLabels: string[]): string[] {
  const scopes: string[] = [];
  for (const label of allLabels) {
    const scope = scopeOfLabel(label);
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

export function liveScopesFromIssues(issues: Pick<ForgeIssue, "labels">[]): string[] {
  return liveScopesFromLabels(issues.flatMap((issue) => issue.labels));
}

function rankOf(label: string | null, order: readonly string[]): number {
  if (!label) return order.length;
  const idx = (order as readonly string[]).indexOf(label);
  return idx < 0 ? order.length : idx;
}

export function rankIssues<T extends Pick<ForgeIssue, "labels" | "updatedAt">>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const pri =
      rankOf(currentPriorityLabel(a.labels), PRIORITY_ORDER) -
      rankOf(currentPriorityLabel(b.labels), PRIORITY_ORDER);
    if (pri !== 0) return pri;
    const state =
      rankOf(currentStateLabel(a.labels), STATE_ORDER) -
      rankOf(currentStateLabel(b.labels), STATE_ORDER);
    if (state !== 0) return state;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

export const PASEO_LABEL_SCOPES = [
  "state",
  "priority",
  "attention",
  "spec",
  "kind",
  "target",
  "format",
  "size",
  "dep",
  "flag",
] as const;

export const INSTALL_LABEL_MODES = ["merge", "replace"] as const;
export type InstallLabelMode = (typeof INSTALL_LABEL_MODES)[number];

export interface ForgeLabelRef {
  id?: number;
  name: string;
}

export interface LabelDefinition {
  name: string;
  color: string;
  exclusive: boolean;
  description: string;
}

export interface LabelSetPlan {
  mode: InstallLabelMode;
  create: LabelDefinition[];
  remove: ForgeLabelRef[];
  skip: string[];
}

export const InstallLabelsInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  mode: z.enum(INSTALL_LABEL_MODES),
});
export type InstallLabelsInput = z.infer<typeof InstallLabelsInputSchema>;

export const InstallLabelsOutputSchema = z.object({
  host: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  mode: z.enum(INSTALL_LABEL_MODES).nullable().default(null),
  created: z.array(z.string()).default([]),
  skipped: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type InstallLabelsOutput = z.infer<typeof InstallLabelsOutputSchema>;

const STATE_COLORS = ["#1d76db", "#0e7c6b", "#a6700b", "#6e40c9", "#1a7f37"];
const PRIORITY_COLORS = ["#d1242f", "#e85d04", "#1d76db", "#59636e", "#8c959f"];

const LABEL_DEFS: LabelDefinition[] = [
  ...STATE_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: STATE_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Workflow state ${i}`,
  })),
  ...LEGACY_STATE_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: STATE_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Workflow state ${i} (legacy numeric)`,
  })),
  ...PRIORITY_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: PRIORITY_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Priority ${i}`,
  })),
  ...LEGACY_PRIORITY_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: PRIORITY_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Priority ${i} (legacy numeric)`,
  })),
  ...ATTENTION_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#8250df",
    exclusive: true,
    description: "Who acts next",
  })),
  ...LEGACY_ATTENTION_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#8250df",
    exclusive: true,
    description: "Who acts next (legacy numeric)",
  })),
  ...SPEC_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#0e7c6b",
    exclusive: true,
    description: "Spec readiness",
  })),
  ...LEGACY_SPEC_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#0e7c6b",
    exclusive: true,
    description: "Spec readiness (legacy numeric)",
  })),
];

export function paseoLabelSet(): LabelDefinition[] {
  return LABEL_DEFS.map((def) => ({ ...def }));
}

export function paseoLabelScopes(): string[] {
  const scopes: string[] = [];
  for (const def of LABEL_DEFS) {
    const scope = scopeOfLabel(def.name);
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

export function planLabelSetInstall(
  existing: ForgeLabelRef[],
  mode: InstallLabelMode,
): LabelSetPlan {
  const desired = paseoLabelSet();
  const desiredNames = new Set(desired.map((def) => def.name));
  const existingNames = new Set(
    existing.map((label) => label.name).filter((name): name is string => typeof name === "string"),
  );
  const ownScopes = new Set(paseoLabelScopes());
  const remove =
    mode === "replace"
      ? existing.filter((label) => {
          const scope = scopeOfLabel(label.name);
          return scope !== null && ownScopes.has(scope) && !desiredNames.has(label.name);
        })
      : [];
  const create = desired.filter((def) => !existingNames.has(def.name));
  const skip = desired.filter((def) => existingNames.has(def.name)).map((def) => def.name);
  return { mode, create, remove, skip };
}


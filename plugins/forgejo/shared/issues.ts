import { z } from "zod";
import { defineContract, defineSettingsContract } from "./vendor/paseo-plugin-helper/index.ts";

export const FORGEJO_PLUGIN_ID = "paseo-forgejo";

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
});
export type OpenIssuesInput = z.infer<typeof OpenIssuesInputSchema>;

export const OpenIssuesOutputSchema = z.object({
  repo: z.string().nullable(),
  issues: z.array(ForgejoIssueSchema),
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
// aliases fgjx does not know). Precedence: explicit config > git remote.
// ---------------------------------------------------------------------------

const BARE_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const ForgejoSettingsSchema = z.object({
  remotesByDirectory: z.record(z.string(), z.string()).default({}),
});
export type ForgejoSettings = z.infer<typeof ForgejoSettingsSchema>;

export const forgejoSettingsContract = defineSettingsContract({
  name: "paseo-forgejo.settings",
  schema: ForgejoSettingsSchema,
  description: "Forgejo plugin settings: per-workspace remote URL overrides",
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

/**
 * Pill label for an issue count. Null (unknown) renders a placeholder,
 * never a false zero.
 */
export function formatIssueCountLabel(count: number | null | undefined): string {
  if (count == null) return "issues --";
  return count === 1 ? "1 issue" : `${count} issues`;
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
// Agent Envelope (parsed telemetry, spec §4.4).
// Every agent comment ends with the footer stamped by
// `fgjx issue comment --envelope`:
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

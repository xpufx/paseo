import { z } from "zod";
import { INSTALL_LABEL_MODES } from "./taxonomy.js";

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

const AgentEnvelopeBaseSchema = z.object({
  commentId: z.number(),
  sessionTitle: z.string(),
  agentShortId: z.string(),
  model: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  postedAt: z.string().nullable().default(null),
  commitShas: z.array(z.string().regex(/^[0-9a-f]{7,40}$/)).default([]),
  /** Client-agnostic agent session deep-links (`paseo://`, `happier://`, dashboard URLs). */
  agentLinks: z.array(z.string()).default([]),
  /** @deprecated Alias of `agentLinks`; kept so historical `paseo://` payloads keep parsing. */
  paseoLinks: z.array(z.string()).default([]),
  serverId: z.string().nullable().default(null),
});

/**
 * Agent envelope with normalized link aliases: payloads carrying only the
 * historical `paseoLinks` (or only the new `agentLinks`) read back with both
 * fields populated.
 */
export const AgentEnvelopeSchema = AgentEnvelopeBaseSchema.transform((value) => {
  const agentLinks = value.agentLinks.length > 0 ? value.agentLinks : value.paseoLinks;
  const paseoLinks = value.paseoLinks.length > 0 ? value.paseoLinks : value.agentLinks;
  return { ...value, agentLinks, paseoLinks };
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

// ---------------------------------------------------------------------------
// RPC Contracts & Schemas
// ---------------------------------------------------------------------------

export interface RpcContract<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  name: string;
  description?: string;
  input: TInput;
  output: TOutput;
}

export function defineContract<TName extends string, TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(options: {
  name: TName;
  description?: string;
  input: TInput;
  output: TOutput;
}): RpcContract<TInput, TOutput> {
  return options;
}

export const IssueNumberObjectSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  issueNumber: z.number().int().positive().optional(),
  number: z.number().int().positive().optional(),
});

export const IssueNumberInput = IssueNumberObjectSchema.superRefine((value, ctx) => {
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

export const SetLabelInputSchema = IssueNumberObjectSchema.extend({
  label: z.string().min(1).max(100),
}).superRefine((value, ctx) => {
  if (value.issueNumber == null && value.number == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "issueNumber (or number) is required",
    });
  }
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

export const AddCommentInputSchema = IssueNumberObjectSchema.extend({
  body: z.string().min(1).max(10000),
}).superRefine((value, ctx) => {
  if (value.issueNumber == null && value.number == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "issueNumber (or number) is required",
    });
  }
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

export function normalizeIssueNumber(input: {
  issueNumber?: number;
  number?: number;
}): number | null {
  const candidate = input.issueNumber ?? input.number;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0
    ? candidate
    : null;
}

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
// Pull Request Schemas & Contracts
// ---------------------------------------------------------------------------

export const PrStateSchema = z.enum(["open", "closed", "merged"]);
export type PrState = z.infer<typeof PrStateSchema>;

export const PrReviewCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  body: z.string(),
  url: z.string(),
});
export type PrReviewComment = z.infer<typeof PrReviewCommentSchema>;

export const PrSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: PrStateSchema,
  labels: z.array(z.string()),
  labelDetails: z.array(ForgeLabelSchema).default([]),
  headBranch: z.string(),
  baseBranch: z.string(),
  headRepo: z.string().optional(),
  baseRepo: z.string().optional(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().nullable().default(null),
  closedAt: z.string().nullable().default(null),
  mergeable: z.boolean().nullable().default(null),
  mergeCommitSha: z.string().nullable().default(null),
  comments: z.number().int().nonnegative().default(0),
  reviewComments: z.number().int().nonnegative().default(0),
  commits: z.number().int().nonnegative().default(0),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  changedFiles: z.number().int().nonnegative().default(0),
  url: z.string().optional(),
  body: z.string().optional(),
});
export type Pr = z.infer<typeof PrSchema>;

export const PrViewOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable(),
  pr: PrSchema.nullable(),
  reviewComments: z.array(PrReviewCommentSchema).default([]),
  fetchedAt: z.string().datetime(),
  repoPublic: z.boolean().nullable().default(null),
  tokenPresent: z.boolean().default(false),
  tokenValid: z.boolean().nullable().default(null),
  repoWritePermission: z.boolean().nullable().default(null),
  error: z.string().optional(),
});
export type PrViewOutput = z.infer<typeof PrViewOutputSchema>;

export const PrListInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  state: PrStateSchema.optional().default("open"),
  author: z.string().optional(),
  branch: z.string().optional(),
  page: z.number().int().positive().default(1),
});
export type PrListInput = z.infer<typeof PrListInputSchema>;

export const PrListOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable(),
  pullRequests: z.array(PrSchema).default([]),
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
export type PrListOutput = z.infer<typeof PrListOutputSchema>;

export const PrCreateInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional().default(""),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  draft: z.boolean().optional().default(false),
});
export type PrCreateInput = z.infer<typeof PrCreateInputSchema>;

export const PrCreateOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable(),
  number: z.number().int().positive().nullable(),
  url: z.string().nullable(),
  error: z.string().optional(),
});
export type PrCreateOutput = z.infer<typeof PrCreateOutputSchema>;

export const PrDiffInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  pullRequestNumber: z.number().int().positive(),
});
export type PrDiffInput = z.infer<typeof PrDiffInputSchema>;

export const PrDiffOutputSchema = z.object({
  repo: z.string().nullable(),
  pullRequestNumber: z.number(),
  diff: z.string(),
  patch: z.string().optional(),
  error: z.string().optional(),
});
export type PrDiffOutput = z.infer<typeof PrDiffOutputSchema>;

export const PrMergeInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  pullRequestNumber: z.number().int().positive(),
  title: z.string().optional().default(""),
  commitMsg: z.string().optional().default(""),
  squash: z.boolean().optional().default(true),
});
export type PrMergeInput = z.infer<typeof PrMergeInputSchema>;

export const PrMergeOutputSchema = z.object({
  repo: z.string().nullable(),
  pullRequestNumber: z.number(),
  merged: z.boolean(),
  mergeCommitSha: z.string().nullable(),
  error: z.string().optional(),
});
export type PrMergeOutput = z.infer<typeof PrMergeOutputSchema>;

// RPC contracts for PR tools
export const prListContract = defineContract({
  name: "forge.pr-list",
  description: "Query open, closed, or merged pull requests with filtering",
  input: PrListInputSchema,
  output: PrListOutputSchema,
});

export const prViewContract = defineContract({
  name: "forge.pr-view",
  description: "Retrieve pull request metadata, review comments, and mergeability",
  input: PrListInputSchema.extend({ pullRequestNumber: z.number().int().positive() }),
  output: PrViewOutputSchema,
});

export const prCreateContract = defineContract({
  name: "forge.pr-create",
  description: "Open a new pull request",
  input: PrCreateInputSchema,
  output: PrCreateOutputSchema,
});

export const prDiffContract = defineContract({
  name: "forge.pr-diff",
  description: "Fetch raw patch/diff of a pull request",
  input: PrDiffInputSchema,
  output: PrDiffOutputSchema,
});

export const prMergeContract = defineContract({
  name: "forge.pr-merge",
  description: "Execute squash merge on an approved pull request",
  input: PrMergeInputSchema,
  output: PrMergeOutputSchema,
});

// ---------------------------------------------------------------------------
// CI / Action Run Schemas & Contracts
// ---------------------------------------------------------------------------

export const CiStepStatusSchema = z.enum([
  "completed", "in_progress", "skipped", "waiting", "cancelled",
]);
export type CiStepStatus = z.infer<typeof CiStepStatusSchema>;

export const CiStepSchema = z.object({
  name: z.string(),
  status: CiStepStatusSchema,
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  logUrl: z.string().nullable().default(null),
});
export type CiStep = z.infer<typeof CiStepSchema>;

export const CiRunSchema = z.object({
  id: z.number().int().positive(),
  runId: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  triggeredBy: z.string(),
  ref: z.string(),
  workflowName: z.string(),
  steps: z.array(CiStepSchema).default([]),
  url: z.string(),
});
export type CiRun = z.infer<typeof CiRunSchema>;

export const CiLogsInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  runId: z.number().int().positive(),
  stepId: z.number().int().positive().optional(),
  page: z.number().int().positive().default(1),
});
export type CiLogsInput = z.infer<typeof CiLogsInputSchema>;

export const CiLogsOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable(),
  run: CiRunSchema.nullable(),
  stepLog: z.string().nullable().default(null),
  steps: z.array(CiStepSchema).default([]),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  error: z.string().optional(),
});
export type CiLogsOutput = z.infer<typeof CiLogsOutputSchema>;

export const ciLogsContract = defineContract({
  name: "forge.ci-logs",
  description: "Retrieve Forgejo action run status and step logs for automated debugging",
  input: CiLogsInputSchema,
  output: CiLogsOutputSchema,
});


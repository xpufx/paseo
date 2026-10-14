import { z } from "zod";

// ---------------------------------------------------------------------------
// Ticket tool schemas (backed by @xpufx/backend-tickets)
// ---------------------------------------------------------------------------

/** ticket_list – list open forge issues */
export const TicketListInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  page: z.number().int().positive().default(1),
});
export type TicketListInput = z.infer<typeof TicketListInputSchema>;

export const TicketListOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable(),
  issues: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      state: z.string(),
      labels: z.array(z.string()),
      labelDetails: z.array(
        z.object({ name: z.string(), color: z.string().optional(), description: z.string().optional() })
      ).default([]),
      comments: z.number().int().nonnegative().default(0),
      updatedAt: z.string().optional(),
      createdAt: z.string().optional(),
      author: z.string().optional(),
      url: z.string().optional(),
      body: z.string().optional(),
      remoteUrl: z.string().optional(),
      repo: z.string().optional(),
      branch: z.string().optional(),
    })
  ).default([]),
  openIssueCount: z.number().int().nonnegative().nullable(),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  derivedRemote: z.string().nullable(),
  remoteSource: z.enum(["explicit", "derived"]).nullable(),
  repoPublic: z.boolean().nullable(),
  tokenPresent: z.boolean().default(false),
  tokenValid: z.boolean().nullable(),
  repoWritePermission: z.boolean().nullable(),
  error: z.string().optional(),
});
export type TicketListOutput = z.infer<typeof TicketListOutputSchema>;

/** ticket_view – fetch full detail for one issue */
export const TicketViewInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  issueNumber: z.number().int().positive(),
});
export type TicketViewInput = z.infer<typeof TicketViewInputSchema>;

export const TicketViewOutputSchema = z.object({
  repo: z.string().nullable(),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    labels: z.array(z.string()),
    labelDetails: z.array(
      z.object({ name: z.string(), color: z.string().optional(), description: z.string().optional() })
    ).default([]),
    body: z.string(),
    author: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    webUrl: z.string(),
    comments: z.array(
      z.object({
        id: z.number(),
        author: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        body: z.string(),
        url: z.string(),
      })
    ).default([]),
  }).nullable(),
  fetchedAt: z.string().datetime(),
  repoPublic: z.boolean().nullable(),
  tokenPresent: z.boolean().default(false),
  tokenValid: z.boolean().nullable(),
  repoWritePermission: z.boolean().nullable(),
  error: z.string().optional(),
});
export type TicketViewOutput = z.infer<typeof TicketViewOutputSchema>;

/** ticket_create – create a new issue */
export const TicketCreateInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional().default(""),
  labels: z.array(z.string()).optional().default([]),
});
export type TicketCreateInput = z.infer<typeof TicketCreateInputSchema>;

export const TicketCreateOutputSchema = z.object({
  repo: z.string().nullable(),
  host: z.string().nullable(),
  number: z.number().int().positive().nullable(),
  error: z.string().optional(),
});
export type TicketCreateOutput = z.infer<typeof TicketCreateOutputSchema>;

/** ticket_comment – post a comment on an issue */
export const TicketCommentInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  issueNumber: z.number().int().positive(),
  body: z.string().min(1).max(10000),
});
export type TicketCommentInput = z.infer<typeof TicketCommentInputSchema>;

export const TicketCommentOutputSchema = z.object({
  number: z.number(),
  commentId: z.number().nullable(),
  error: z.string().optional(),
});
export type TicketCommentOutput = z.infer<typeof TicketCommentOutputSchema>;

/** ticket_edit – update issue labels (set-label semantics) */
export const TicketEditInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  issueNumber: z.number().int().positive(),
  label: z.string().min(1).max(100),
});
export type TicketEditInput = z.infer<typeof TicketEditInputSchema>;

export const TicketEditOutputSchema = z.object({
  number: z.number(),
  labels: z.array(z.string()),
  error: z.string().optional(),
});
export type TicketEditOutput = z.infer<typeof TicketEditOutputSchema>;

// ---------------------------------------------------------------------------
// Fleet tool schemas (backed by @xpufx/backend-fleet)
// ---------------------------------------------------------------------------

/** fleet_status – read the canonical fleet roster / health summary */
export const FleetStatusInputSchema = z.object({}).strict().optional().default({});
export type FleetStatusInput = z.infer<typeof FleetStatusInputSchema>;

export const FleetAgentSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  name: z.string(),
  category: z.enum(["front-desk", "orchestrator", "coding-agent", "worker"]),
  status: z.string(),
  deterministicState: z.enum([
    "working", "running", "sleeping", "idle:waiting", "idle:quota-exhausted",
    "attention-required", "permission-prompt",
    "failed:quota-exhausted", "failed:spawn", "failed:timeout", "failed:error", "unknown",
  ]).default("unknown"),
  lifecycleState: z.enum(["running", "waiting_for_input", "idle", "errored", "completed"]).optional(),
  model: z.string().nullable().optional(),
  cwd: z.string().optional(),
  project: z.string().optional(),
  isEnrolled: z.boolean().optional(),
  isPaused: z.boolean().optional(),
  queuedHooksCount: z.number().optional(),
  lastError: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission", "input"]).nullable().optional(),
  attributedWork: z.object({
    repo: z.string().optional(),
    issue: z.number().optional(),
    slug: z.string().optional(),
    branch: z.string().optional(),
  }).nullable().optional(),
});
export type FleetAgent = z.infer<typeof FleetAgentSchema>;

export const FleetStatusOutputSchema = z.object({
  ok: z.boolean(),
  registryAuthoritative: z.boolean().default(false),
  frontDesk: z.array(FleetAgentSchema).default([]),
  orchestrators: z.array(FleetAgentSchema).default([]),
  workers: z.array(FleetAgentSchema).default([]),
  enrolledRepos: z.array(z.string()).default([]),
  pausedRepos: z.array(z.string()).default([]),
  totalCount: z.number().default(0),
  runningCount: z.number().default(0),
  idleCount: z.number().default(0),
  errorCount: z.number().default(0),
  error: z.string().optional(),
});
export type FleetStatusOutput = z.infer<typeof FleetStatusOutputSchema>;

/** fleet_queue_inspect – inspect hook queues per repo */
export const FleetQueueInspectInputSchema = z.object({}).strict().optional().default({});
export type FleetQueueInspectInput = z.infer<typeof FleetQueueInspectInputSchema>;

export const FleetQueueItemSchema = z.object({
  key: z.string(),
  depth: z.number(),
  dropped: z.number().default(0),
  paused: z.boolean(),
  isBusy: z.boolean(),
  busyAttempts: z.number().default(0),
  messages: z.array(
    z.object({ id: z.string(), ts: z.number().nullable().optional(), preview: z.string() })
  ).default([]),
});
export type FleetQueueItem = z.infer<typeof FleetQueueItemSchema>;

export const FleetQueueInspectOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  paused: z.array(z.string()).default([]),
  totalQueued: z.number().default(0),
  queues: z.array(FleetQueueItemSchema).default([]),
  error: z.string().optional(),
});
export type FleetQueueInspectOutput = z.infer<typeof FleetQueueInspectOutputSchema>;

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
}

export const TICKET_TOOLS: McpToolDefinition[] = [
  {
    name: "ticket_list",
    description: "List open forge issues for the configured repository.",
    inputSchema: TicketListInputSchema,
    outputSchema: TicketListOutputSchema,
  },
  {
    name: "ticket_view",
    description: "Fetch full details including comments and envelopes for a single issue.",
    inputSchema: TicketViewInputSchema,
    outputSchema: TicketViewOutputSchema,
  },
  {
    name: "ticket_create",
    description: "Create a new issue on the configured forge repository.",
    inputSchema: TicketCreateInputSchema,
    outputSchema: TicketCreateOutputSchema,
  },
  {
    name: "ticket_comment",
    description: "Post a comment to an existing issue thread.",
    inputSchema: TicketCommentInputSchema,
    outputSchema: TicketCommentOutputSchema,
  },
  {
    name: "ticket_edit",
    description: "Update an issue's labels (applies one scoped label, evicting peers in the same scope).",
    inputSchema: TicketEditInputSchema,
    outputSchema: TicketEditOutputSchema,
  },
];

export const FLEET_TOOLS: McpToolDefinition[] = [
  {
    name: "fleet_status",
    description: "Read the canonical fleet agent roster, state machine, and health summary.",
    inputSchema: FleetStatusInputSchema,
    outputSchema: FleetStatusOutputSchema,
  },
  {
    name: "fleet_queue_inspect",
    description: "Inspect hook queue state across all repositories.",
    inputSchema: FleetQueueInspectInputSchema,
    outputSchema: FleetQueueInspectOutputSchema,
  },
];

// ---------------------------------------------------------------------------
// Pull Request tool schemas (backed by @xpufx/backend-tickets)
// ---------------------------------------------------------------------------

/** pr_list – query open, closed, or merged pull requests */
export const PrListInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  state: z.enum(["open", "closed", "merged"]).optional().default("open"),
  author: z.string().optional(),
  branch: z.string().optional(),
  page: z.number().int().positive().default(1),
});
export type PrListInput = z.infer<typeof PrListInputSchema>;

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
  state: z.enum(["open", "closed", "merged"]),
  labels: z.array(z.string()),
  labelDetails: z.array(
    z.object({ name: z.string(), color: z.string().optional(), description: z.string().optional() })
  ).default([]),
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

/** pr_view – fetch full detail for one PR */
export const PrViewInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  pullRequestNumber: z.number().int().positive(),
});
export type PrViewInput = z.infer<typeof PrViewInputSchema>;

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

/** pr_create – open a new pull request */
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

/** pr_diff – fetch raw patch/diff of a PR */
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

/** pr_merge – squash merge an approved PR */
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

// ---------------------------------------------------------------------------
// CI / Action Run tool schemas (backed by @xpufx/backend-tickets)
// ---------------------------------------------------------------------------

/** ci_logs – retrieve Forgejo action run status and step logs */
export const CiLogsInputSchema = z.object({
  directory: z.string().optional(),
  remoteUrl: z.string().optional(),
  runId: z.number().int().positive(),
  stepId: z.number().int().positive().optional(),
  page: z.number().int().positive().default(1),
});
export type CiLogsInput = z.infer<typeof CiLogsInputSchema>;

export const CiStepSchema = z.object({
  name: z.string(),
  status: z.enum(["completed", "in_progress", "skipped", "waiting", "cancelled"]),
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

// ---------------------------------------------------------------------------
// MCP Tool definitions — PR tools
// ---------------------------------------------------------------------------

export const PR_TOOLS: McpToolDefinition[] = [
  {
    name: "pr_list",
    description: "Query open, closed, or merged pull requests with filtering by author, branch, and status.",
    inputSchema: PrListInputSchema,
    outputSchema: PrListOutputSchema,
  },
  {
    name: "pr_view",
    description: "Retrieve pull request metadata, review comments, mergeability status, and head/base branches.",
    inputSchema: PrViewInputSchema,
    outputSchema: PrViewOutputSchema,
  },
  {
    name: "pr_create",
    description: "Open a new pull request specifying title, body, head branch, and base branch.",
    inputSchema: PrCreateInputSchema,
    outputSchema: PrCreateOutputSchema,
  },
  {
    name: "pr_diff",
    description: "Fetch raw patch/diff of a pull request for pre-flight diff auditing.",
    inputSchema: PrDiffInputSchema,
    outputSchema: PrDiffOutputSchema,
  },
  {
    name: "pr_merge",
    description: "Execute squash merge on approved pull requests with title and commit message formatting.",
    inputSchema: PrMergeInputSchema,
    outputSchema: PrMergeOutputSchema,
  },
];

// ---------------------------------------------------------------------------
// MCP Tool definitions — CI tools
// ---------------------------------------------------------------------------

export const CI_TOOLS: McpToolDefinition[] = [
  {
    name: "ci_logs",
    description: "Retrieve and unpack Forgejo action run status and step logs for automated debugging.",
    inputSchema: CiLogsInputSchema,
    outputSchema: CiLogsOutputSchema,
  },
];

// ---------------------------------------------------------------------------
// Combined tool registry
// ---------------------------------------------------------------------------

export const ALL_MCP_TOOLS = [...TICKET_TOOLS, ...FLEET_TOOLS, ...PR_TOOLS, ...CI_TOOLS] as const;

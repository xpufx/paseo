import { DeterministicAgentState, AgentCategory, FleetAgentWork, FleetAgent, FleetAgentTreeNode } from '../client/index.js';
export { AgentAttentionReason, AgentAttentionReasonSchema, AgentBlockDetail, AgentBlockDetailSchema, AgentCategorySchema, AgentLifecycleState, AgentLifecycleStateSchema, AgentPreset, AgentRoleDivergence, AgentRoleDivergenceSchema, AgentSortField, CODING_AGENT_CATEGORY, CanonicalRepo, DEFAULT_FORGEJO_HOST, DEFAULT_PROJECT, DISPATCH_COMMAND_PATTERNS, DeterministicAgentStateSchema, DeterministicStateConfig, FleetAgentMetrics, FleetAgentMetricsSchema, FleetAgentSchema, FleetAgentTreeNodeSchema, FleetAgentUsage, FleetAgentUsageSchema, FleetAgentWorkSchema, FleetOutput, FleetOutputSchema, FormattedProjectDisplay, FrontDeskActivityItem, FrontDeskActivityItemSchema, FrontDeskActivityType, FrontDeskActivityTypeSchema, HealthGauge, HealthGaugeKind, HealthGaugeSegment, HealthGaugeTone, HookQueueItem, HookQueueItemSchema, HookQueueMessage, HookQueueMessageSchema, HookStatusOutput, HookStatusOutputSchema, NOISE_TOOL_NAMES, PendingPermission, PendingPermissionSchema, ProjectIdentity, QueuePreset, QueueSortField, RepoCoordinates, ResolveCanonicalRepoOptions, SortDirection, StatusLightTone, UppidiAgent, UppidiAgentCategory, UppidiAgentMetrics, UppidiAgentTreeNode, UppidiAgentUsage, UppidiAgentWork, UppidiAgentsOutput, UppidiFrontDeskActivityItem, UppidiFrontDeskActivityType, agentRequiresAttention, buildAgentBlockDetail, candidateRepoKeys, canonicalRepoKey, canonicalRepoName, compactRepoName, computeHealthGauge, deriveLifecycleState, extractPermissionScope, filterAgents, filterQueues, formatProjectDisplay, formatProjectOptionLabel, getAgentAttentionReason, getAgentCategoryIcon, getDeterministicStateConfig, getPendingPermissionAction, getPermissionAdjudicationCommand, getStatusLightTone, isAgentEligibleForBulkArchive, isBlockedLifecycleState, isCodingAgentCategory, isRepoMatching, isSignalActivityItem, normalizeProjectName, normalizeRepoKey, parseTranscriptToActivityItems, repoCoordinates, repoMatches, resolveAgentLifecycleState, resolveCanonicalRepo, sortAgents, sortQueues } from '../client/index.js';
import { z } from 'zod';

type WorkspaceProjectMap = Record<string, string>;
interface RawAgentRecord {
    id: string;
    shortId?: string;
    name?: string;
    title?: string;
    provider?: string;
    model?: string | null;
    status?: string;
    cwd?: string;
    created?: string;
    createdAt?: string;
    updatedAt?: string;
    lastActivityAt?: string | null;
    workspaceId?: string;
    parentId?: string | null;
    ParentAgentId?: string | null;
    project?: string;
    labels?: Record<string, string>;
    lastError?: string;
    requiresAttention?: boolean;
    attentionReason?: string | null;
    attentionTimestamp?: string | null;
    pendingPermissions?: Array<Record<string, any>> | null;
    activeTurn?: {
        turnId?: string;
        startedAt?: string | null;
    } | null;
    lastUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
        totalCostUsd?: number;
        contextWindowUsedTokens?: number;
        contextWindowMaxTokens?: number;
    } | null;
    url?: string;
    category?: AgentCategory;
    role?: string;
}
declare function categorizeAgent(name: string): AgentCategory;
declare const categorize: typeof categorizeAgent;
declare function extractAttributedWork(raw: RawAgentRecord): FleetAgentWork | null;
declare const attributedWork: typeof extractAttributedWork;
declare function extractAgentWorktree(agent: {
    worktree?: string;
    cwd?: string;
    workspaceId?: string;
    labels?: Record<string, string>;
    attributedWork?: {
        slug?: string;
        branch?: string;
    } | null;
    name?: string;
    title?: string;
}): string | undefined;
declare function extractAgentProject(agent: {
    project?: string;
    labels?: Record<string, string>;
    workspaceId?: string;
    attributedWork?: {
        repo?: string;
    } | null;
    name?: string;
    title?: string;
    cwd?: string;
}, parentProject?: string, workspaceProjectMap?: WorkspaceProjectMap): string;
interface DerivedStateResult {
    state: DeterministicAgentState;
    detail?: string;
}
declare function deriveDeterministicState(raw: RawAgentRecord, attributedWork: FleetAgentWork | null, quotaAlertAgentIds?: Set<string>): DerivedStateResult;
declare const deriveState: typeof deriveDeterministicState;
declare function inheritProjectFromParents(agents: FleetAgent[]): void;

declare function buildAgentTree(agents: FleetAgent[]): FleetAgentTreeNode[];

declare const WATCHDOG_TAXONOMY: readonly ["TURN_CONCURRENCY_LOCK", "TURN_CANCELLATION_TIMEOUT", "IDLE_POST_ERROR_AMNESIA", "ZOMBIE_HUNG_TURN", "STALE_ERROR_GHOSTING", "PROVIDER_QUOTA_EXHAUSTION", "REPETITIVE_TOOL_LOOP"];
type WatchdogTaxonomyType = (typeof WATCHDOG_TAXONOMY)[number];
type WatchdogSeverity = "high" | "medium";
declare const DEFAULT_RUNNING_STALE_SECONDS = 1800;
declare const DEFAULT_CANCELLATION_RECENCY_SECONDS = 86400;
declare const DEFAULT_WATCHDOG_STEER_MESSAGE: string;
declare const DEFAULT_WATCHDOG_BUSY_THRESHOLD = 5;
declare const DEFAULT_WATCHDOG_ALERT_COOLDOWN_MS: number;
declare const DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD = 15;
declare const WATCHDOG_SEVERITIES: Record<WatchdogTaxonomyType, WatchdogSeverity>;
declare const STOP_TRIGGERS: ReadonlySet<WatchdogTaxonomyType>;
declare const STEER_TRIGGERS: ReadonlySet<WatchdogTaxonomyType>;
declare const QUOTA_MARKERS: string[];
declare function hasMarker(text: unknown, markers: readonly string[]): boolean;
declare function parseIsoTimestamp(value: unknown): number | null;
declare function coerceEpochMs(value: unknown): number | null;
declare function detectTurnConcurrencyLock(liveStatus: unknown, lastError: unknown): boolean;
declare function detectCancellationTimeout(agentId: string, cancellations: ReadonlyMap<string, number | string | null> | null | undefined, liveStatus: unknown, nowEpochMs?: number, recencySeconds?: number, lastError?: unknown, lastActivityAt?: unknown, lastHandledCancellationAt?: unknown): boolean;
declare function detectStaleErrorGhosting(liveStatus: unknown, lastError: unknown): boolean;
interface ProviderQuotaDetectionOptions {
    now?: number;
    recencySeconds?: number;
    lastActivityAt?: unknown;
    liveStatus?: unknown;
}
declare function findProviderRetryQuotaError(recentTimeline: unknown, options?: ProviderQuotaDetectionOptions): string | null;
declare function detectProviderQuotaExhaustion(lastError: unknown, recentTimeline?: unknown, options?: ProviderQuotaDetectionOptions): boolean;
declare function detectIdlePostErrorAmnesia(liveStatus: unknown, lastError: unknown, requiresAttention: unknown, attentionReason: unknown, activeWorkers: number, assumePendingWork?: boolean): boolean;
declare function detectZombieHungTurn(liveStatus: unknown, lastActivityAt: unknown, now: number, staleSeconds: number): boolean;
declare function toolCallSignature(item: unknown): string | null;
declare function detectRepetitiveToolLoop(timeline: unknown, threshold?: number): number;
interface WatchdogAgentLike {
    id?: string;
    name?: string;
    title?: string;
    status?: string;
    lastStatus?: string;
    lastError?: string;
    requiresAttention?: boolean;
    attentionReason?: string | null;
    lastActivityAt?: string | null;
    updatedAt?: string | null;
    archivedAt?: string | null;
    labels?: Record<string, string>;
    lastHandledCancellationAt?: number | string | null;
    cancellationHandledAt?: number | string | null;
    path?: string | null;
    [key: string]: any;
}
interface WatchdogAssessment {
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
declare function assessAgentHealth(agentId: string, live: WatchdogAgentLike | null | undefined, disk: WatchdogAgentLike | null | undefined, now: number, options?: {
    cancellations?: Map<string, number | null> | null;
    cancellationRecencySeconds?: number;
    activeWorkers?: number;
    assumePendingWork?: boolean;
    runningStaleSeconds?: number;
    recentTimeline?: string | unknown[] | null;
    repetitiveToolLoopThreshold?: number;
}): WatchdogAssessment;
interface WatchdogRecoveryPlan {
    stop: boolean;
    clearError: boolean;
    clearAttention: boolean;
    recordCancellationHandled: boolean;
    steer: boolean;
    steerMessage: string;
    blockedReason: string | null;
}
declare function planWatchdogRecovery(taxonomy: readonly WatchdogTaxonomyType[], steerMessage?: string): WatchdogRecoveryPlan;

interface RpcContract<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
    name: string;
    description?: string;
    input: TInput;
    output: TOutput;
}
declare function defineContract<TName extends string, TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(options: {
    name: TName;
    description?: string;
    input: TInput;
    output: TOutput;
}): RpcContract<TInput, TOutput>;
declare const FleetRosterInputSchema: z.ZodDefault<z.ZodOptional<z.ZodObject<{
    repo: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
    enrolledRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mutedRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    pausedRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kanbanOnlyRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>>>;
type FleetRosterInput = z.infer<typeof FleetRosterInputSchema>;
declare const fleetRosterContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    repo: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
    enrolledRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mutedRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    pausedRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kanbanOnlyRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    registryAuthoritative: z.ZodDefault<z.ZodBoolean>;
    roleDivergences: z.ZodDefault<z.ZodArray<z.ZodObject<{
        agentId: z.ZodString;
        agentName: z.ZodString;
        nameCategory: z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>;
        registryRole: z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>;
        reason: z.ZodString;
    }, z.core.$strip>>>;
    frontDesk: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        shortId: z.ZodString;
        name: z.ZodString;
        category: z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>;
        roleSource: z.ZodOptional<z.ZodEnum<{
            registry: "registry";
            "name-heuristic": "name-heuristic";
        }>>;
        nameCategory: z.ZodOptional<z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>>;
        roleDivergent: z.ZodOptional<z.ZodBoolean>;
        registryRepoKey: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodString;
        cwd: z.ZodOptional<z.ZodString>;
        created: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
        lastActivityAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        workspaceId: z.ZodOptional<z.ZodString>;
        parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        parentName: z.ZodOptional<z.ZodString>;
        parentCategory: z.ZodOptional<z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>>;
        deterministicState: z.ZodDefault<z.ZodEnum<{
            working: "working";
            running: "running";
            sleeping: "sleeping";
            "idle:waiting": "idle:waiting";
            "idle:quota-exhausted": "idle:quota-exhausted";
            "attention-required": "attention-required";
            "permission-prompt": "permission-prompt";
            "failed:quota-exhausted": "failed:quota-exhausted";
            "failed:spawn": "failed:spawn";
            "failed:timeout": "failed:timeout";
            "failed:error": "failed:error";
            unknown: "unknown";
        }>>;
        stateDetail: z.ZodOptional<z.ZodString>;
        lifecycleState: z.ZodOptional<z.ZodEnum<{
            running: "running";
            waiting_for_input: "waiting_for_input";
            idle: "idle";
            errored: "errored";
            completed: "completed";
        }>>;
        blockDetail: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            requiredPermissionId: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
            action: z.ZodOptional<z.ZodString>;
            command: z.ZodString;
        }, z.core.$strip>>>;
        attributedWork: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            repo: z.ZodOptional<z.ZodString>;
            issue: z.ZodOptional<z.ZodNumber>;
            slug: z.ZodOptional<z.ZodString>;
            branch: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        usage: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            cachedInputTokens: z.ZodOptional<z.ZodNumber>;
            totalCostUsd: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        metrics: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            contextUsedTokens: z.ZodOptional<z.ZodNumber>;
            contextMaxTokens: z.ZodOptional<z.ZodNumber>;
            cachedTokens: z.ZodOptional<z.ZodNumber>;
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            costUsd: z.ZodOptional<z.ZodNumber>;
            activeTurnStartedAt: z.ZodOptional<z.ZodString>;
            attentionTimestamp: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        lastError: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        isEnrolled: z.ZodOptional<z.ZodBoolean>;
        isPaused: z.ZodOptional<z.ZodBoolean>;
        isMuted: z.ZodOptional<z.ZodBoolean>;
        hasOrchestrator: z.ZodOptional<z.ZodBoolean>;
        queuedHooksCount: z.ZodOptional<z.ZodNumber>;
        isDetached: z.ZodOptional<z.ZodBoolean>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        isMainDirty: z.ZodOptional<z.ZodBoolean>;
        mainDirtySummary: z.ZodOptional<z.ZodString>;
        repoHeadBranch: z.ZodOptional<z.ZodString>;
        isRepoRootOffMain: z.ZodOptional<z.ZodBoolean>;
        pendingPermissions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            requestId: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
            tool: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            input: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        requiresAttention: z.ZodOptional<z.ZodBoolean>;
        attentionReason: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            finished: "finished";
            error: "error";
            permission: "permission";
            input: "input";
        }>>>;
    }, z.core.$strip>>>;
    orchestrators: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        shortId: z.ZodString;
        name: z.ZodString;
        category: z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>;
        roleSource: z.ZodOptional<z.ZodEnum<{
            registry: "registry";
            "name-heuristic": "name-heuristic";
        }>>;
        nameCategory: z.ZodOptional<z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>>;
        roleDivergent: z.ZodOptional<z.ZodBoolean>;
        registryRepoKey: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodString;
        cwd: z.ZodOptional<z.ZodString>;
        created: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
        lastActivityAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        workspaceId: z.ZodOptional<z.ZodString>;
        parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        parentName: z.ZodOptional<z.ZodString>;
        parentCategory: z.ZodOptional<z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>>;
        deterministicState: z.ZodDefault<z.ZodEnum<{
            working: "working";
            running: "running";
            sleeping: "sleeping";
            "idle:waiting": "idle:waiting";
            "idle:quota-exhausted": "idle:quota-exhausted";
            "attention-required": "attention-required";
            "permission-prompt": "permission-prompt";
            "failed:quota-exhausted": "failed:quota-exhausted";
            "failed:spawn": "failed:spawn";
            "failed:timeout": "failed:timeout";
            "failed:error": "failed:error";
            unknown: "unknown";
        }>>;
        stateDetail: z.ZodOptional<z.ZodString>;
        lifecycleState: z.ZodOptional<z.ZodEnum<{
            running: "running";
            waiting_for_input: "waiting_for_input";
            idle: "idle";
            errored: "errored";
            completed: "completed";
        }>>;
        blockDetail: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            requiredPermissionId: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
            action: z.ZodOptional<z.ZodString>;
            command: z.ZodString;
        }, z.core.$strip>>>;
        attributedWork: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            repo: z.ZodOptional<z.ZodString>;
            issue: z.ZodOptional<z.ZodNumber>;
            slug: z.ZodOptional<z.ZodString>;
            branch: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        usage: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            cachedInputTokens: z.ZodOptional<z.ZodNumber>;
            totalCostUsd: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        metrics: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            contextUsedTokens: z.ZodOptional<z.ZodNumber>;
            contextMaxTokens: z.ZodOptional<z.ZodNumber>;
            cachedTokens: z.ZodOptional<z.ZodNumber>;
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            costUsd: z.ZodOptional<z.ZodNumber>;
            activeTurnStartedAt: z.ZodOptional<z.ZodString>;
            attentionTimestamp: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        lastError: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        isEnrolled: z.ZodOptional<z.ZodBoolean>;
        isPaused: z.ZodOptional<z.ZodBoolean>;
        isMuted: z.ZodOptional<z.ZodBoolean>;
        hasOrchestrator: z.ZodOptional<z.ZodBoolean>;
        queuedHooksCount: z.ZodOptional<z.ZodNumber>;
        isDetached: z.ZodOptional<z.ZodBoolean>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        isMainDirty: z.ZodOptional<z.ZodBoolean>;
        mainDirtySummary: z.ZodOptional<z.ZodString>;
        repoHeadBranch: z.ZodOptional<z.ZodString>;
        isRepoRootOffMain: z.ZodOptional<z.ZodBoolean>;
        pendingPermissions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            requestId: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
            tool: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            input: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        requiresAttention: z.ZodOptional<z.ZodBoolean>;
        attentionReason: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            finished: "finished";
            error: "error";
            permission: "permission";
            input: "input";
        }>>>;
    }, z.core.$strip>>>;
    workers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        shortId: z.ZodString;
        name: z.ZodString;
        category: z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>;
        roleSource: z.ZodOptional<z.ZodEnum<{
            registry: "registry";
            "name-heuristic": "name-heuristic";
        }>>;
        nameCategory: z.ZodOptional<z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>>;
        roleDivergent: z.ZodOptional<z.ZodBoolean>;
        registryRepoKey: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodString;
        cwd: z.ZodOptional<z.ZodString>;
        created: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
        lastActivityAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        workspaceId: z.ZodOptional<z.ZodString>;
        parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        parentName: z.ZodOptional<z.ZodString>;
        parentCategory: z.ZodOptional<z.ZodEnum<{
            "coding-agent": "coding-agent";
            "front-desk": "front-desk";
            orchestrator: "orchestrator";
            worker: "worker";
        }>>;
        deterministicState: z.ZodDefault<z.ZodEnum<{
            working: "working";
            running: "running";
            sleeping: "sleeping";
            "idle:waiting": "idle:waiting";
            "idle:quota-exhausted": "idle:quota-exhausted";
            "attention-required": "attention-required";
            "permission-prompt": "permission-prompt";
            "failed:quota-exhausted": "failed:quota-exhausted";
            "failed:spawn": "failed:spawn";
            "failed:timeout": "failed:timeout";
            "failed:error": "failed:error";
            unknown: "unknown";
        }>>;
        stateDetail: z.ZodOptional<z.ZodString>;
        lifecycleState: z.ZodOptional<z.ZodEnum<{
            running: "running";
            waiting_for_input: "waiting_for_input";
            idle: "idle";
            errored: "errored";
            completed: "completed";
        }>>;
        blockDetail: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            requiredPermissionId: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
            action: z.ZodOptional<z.ZodString>;
            command: z.ZodString;
        }, z.core.$strip>>>;
        attributedWork: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            repo: z.ZodOptional<z.ZodString>;
            issue: z.ZodOptional<z.ZodNumber>;
            slug: z.ZodOptional<z.ZodString>;
            branch: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        usage: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            cachedInputTokens: z.ZodOptional<z.ZodNumber>;
            totalCostUsd: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        metrics: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            contextUsedTokens: z.ZodOptional<z.ZodNumber>;
            contextMaxTokens: z.ZodOptional<z.ZodNumber>;
            cachedTokens: z.ZodOptional<z.ZodNumber>;
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            costUsd: z.ZodOptional<z.ZodNumber>;
            activeTurnStartedAt: z.ZodOptional<z.ZodString>;
            attentionTimestamp: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        lastError: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        isEnrolled: z.ZodOptional<z.ZodBoolean>;
        isPaused: z.ZodOptional<z.ZodBoolean>;
        isMuted: z.ZodOptional<z.ZodBoolean>;
        hasOrchestrator: z.ZodOptional<z.ZodBoolean>;
        queuedHooksCount: z.ZodOptional<z.ZodNumber>;
        isDetached: z.ZodOptional<z.ZodBoolean>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        isMainDirty: z.ZodOptional<z.ZodBoolean>;
        mainDirtySummary: z.ZodOptional<z.ZodString>;
        repoHeadBranch: z.ZodOptional<z.ZodString>;
        isRepoRootOffMain: z.ZodOptional<z.ZodBoolean>;
        pendingPermissions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            requestId: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
            tool: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            input: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        requiresAttention: z.ZodOptional<z.ZodBoolean>;
        attentionReason: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            finished: "finished";
            error: "error";
            permission: "permission";
            input: "input";
        }>>>;
    }, z.core.$strip>>>;
    tree: z.ZodDefault<z.ZodArray<z.ZodType<FleetAgentTreeNode, any, any>>>;
    enrolledRepos: z.ZodDefault<z.ZodArray<z.ZodString>>;
    pausedRepos: z.ZodDefault<z.ZodArray<z.ZodString>>;
    kanbanOnlyRepos: z.ZodDefault<z.ZodArray<z.ZodString>>;
    mutedRepos: z.ZodDefault<z.ZodArray<z.ZodString>>;
    repoQueuedHooks: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    totalCount: z.ZodDefault<z.ZodNumber>;
    runningCount: z.ZodDefault<z.ZodNumber>;
    idleCount: z.ZodDefault<z.ZodNumber>;
    errorCount: z.ZodDefault<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const ArchiveAgentInputSchema: z.ZodObject<{
    agentId: z.ZodString;
    notify: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type ArchiveAgentInput = z.infer<typeof ArchiveAgentInputSchema>;
declare const ArchiveAgentOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ArchiveAgentOutput = z.infer<typeof ArchiveAgentOutputSchema>;
declare const archiveAgentContract: RpcContract<z.ZodObject<{
    agentId: z.ZodString;
    notify: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const ArchiveInactiveAgentsInputSchema: z.ZodDefault<z.ZodOptional<z.ZodObject<{
    beforeHours: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>>;
type ArchiveInactiveAgentsInput = z.infer<typeof ArchiveInactiveAgentsInputSchema>;
declare const ArchiveInactiveAgentsOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    archivedCount: z.ZodDefault<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ArchiveInactiveAgentsOutput = z.infer<typeof ArchiveInactiveAgentsOutputSchema>;
declare const archiveInactiveAgentsContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    beforeHours: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    archivedCount: z.ZodDefault<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const CreateFrontDeskInputSchema: z.ZodDefault<z.ZodOptional<z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>;
type CreateFrontDeskInput = z.infer<typeof CreateFrontDeskInputSchema>;
declare const CreateFrontDeskOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    agentId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type CreateFrontDeskOutput = z.infer<typeof CreateFrontDeskOutputSchema>;
declare const createFrontDeskContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    agentId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const replaceFrontDeskContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    agentId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const AddOrchestratorInputSchema: z.ZodObject<{
    repo: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type AddOrchestratorInput = z.infer<typeof AddOrchestratorInputSchema>;
declare const AddOrchestratorOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    agentId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type AddOrchestratorOutput = z.infer<typeof AddOrchestratorOutputSchema>;
declare const addOrchestratorContract: RpcContract<z.ZodObject<{
    repo: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodBoolean;
    agentId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const replaceOrchestratorContract: RpcContract<z.ZodObject<{
    repo: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodBoolean;
    agentId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const ToggleRepoPauseInputSchema: z.ZodObject<{
    repo: z.ZodString;
    paused: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type ToggleRepoPauseInput = z.infer<typeof ToggleRepoPauseInputSchema>;
declare const ToggleRepoPauseOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    paused: z.ZodBoolean;
    repo: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ToggleRepoPauseOutput = z.infer<typeof ToggleRepoPauseOutputSchema>;
declare const toggleRepoPauseContract: RpcContract<z.ZodObject<{
    repo: z.ZodString;
    paused: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodBoolean;
    paused: z.ZodBoolean;
    repo: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const FleetHaltInputSchema: z.ZodDefault<z.ZodOptional<z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>;
type FleetHaltInput = z.infer<typeof FleetHaltInputSchema>;
declare const FleetHaltOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    halted: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type FleetHaltOutput = z.infer<typeof FleetHaltOutputSchema>;
declare const fleetHaltContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    halted: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const fleetResumeContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    halted: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
declare const FleetTeardownInputSchema: z.ZodDefault<z.ZodOptional<z.ZodObject<{
    force: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>>;
type FleetTeardownInput = z.infer<typeof FleetTeardownInputSchema>;
declare const FleetTeardownOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type FleetTeardownOutput = z.infer<typeof FleetTeardownOutputSchema>;
declare const fleetTeardownContract: RpcContract<z.ZodDefault<z.ZodOptional<z.ZodObject<{
    force: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>>, z.ZodObject<{
    ok: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;

export { type AddOrchestratorInput, AddOrchestratorInputSchema, type AddOrchestratorOutput, AddOrchestratorOutputSchema, AgentCategory, type ArchiveAgentInput, ArchiveAgentInputSchema, type ArchiveAgentOutput, ArchiveAgentOutputSchema, type ArchiveInactiveAgentsInput, ArchiveInactiveAgentsInputSchema, type ArchiveInactiveAgentsOutput, ArchiveInactiveAgentsOutputSchema, type CreateFrontDeskInput, CreateFrontDeskInputSchema, type CreateFrontDeskOutput, CreateFrontDeskOutputSchema, DEFAULT_CANCELLATION_RECENCY_SECONDS, DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD, DEFAULT_RUNNING_STALE_SECONDS, DEFAULT_WATCHDOG_ALERT_COOLDOWN_MS, DEFAULT_WATCHDOG_BUSY_THRESHOLD, DEFAULT_WATCHDOG_STEER_MESSAGE, type DerivedStateResult, DeterministicAgentState, FleetAgent, FleetAgentTreeNode, FleetAgentWork, type FleetHaltInput, FleetHaltInputSchema, type FleetHaltOutput, FleetHaltOutputSchema, type FleetRosterInput, FleetRosterInputSchema, type FleetTeardownInput, FleetTeardownInputSchema, type FleetTeardownOutput, FleetTeardownOutputSchema, type ProviderQuotaDetectionOptions, QUOTA_MARKERS, type RawAgentRecord, type RpcContract, STEER_TRIGGERS, STOP_TRIGGERS, type ToggleRepoPauseInput, ToggleRepoPauseInputSchema, type ToggleRepoPauseOutput, ToggleRepoPauseOutputSchema, WATCHDOG_SEVERITIES, WATCHDOG_TAXONOMY, type WatchdogAgentLike, type WatchdogAssessment, type WatchdogRecoveryPlan, type WatchdogSeverity, type WatchdogTaxonomyType, type WorkspaceProjectMap, addOrchestratorContract, archiveAgentContract, archiveInactiveAgentsContract, assessAgentHealth, attributedWork, buildAgentTree, categorize, categorizeAgent, coerceEpochMs, createFrontDeskContract, defineContract, deriveDeterministicState, deriveState, detectCancellationTimeout, detectIdlePostErrorAmnesia, detectProviderQuotaExhaustion, detectRepetitiveToolLoop, detectStaleErrorGhosting, detectTurnConcurrencyLock, detectZombieHungTurn, extractAgentProject, extractAgentWorktree, extractAttributedWork, findProviderRetryQuotaError, fleetHaltContract, fleetResumeContract, fleetRosterContract, fleetTeardownContract, hasMarker, inheritProjectFromParents, parseIsoTimestamp, planWatchdogRecovery, replaceFrontDeskContract, replaceOrchestratorContract, toggleRepoPauseContract, toolCallSignature };

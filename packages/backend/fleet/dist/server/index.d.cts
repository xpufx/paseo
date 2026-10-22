import { FleetAgentMetrics, AgentAttentionReason, PendingPermission, FleetAgent, FleetOutput } from '../client/index.cjs';
export { AgentAttentionReasonSchema, AgentBlockDetail, AgentBlockDetailSchema, AgentCategory, AgentCategorySchema, AgentLifecycleState, AgentLifecycleStateSchema, AgentPreset, AgentRoleDivergence, AgentRoleDivergenceSchema, AgentSortField, CODING_AGENT_CATEGORY, CanonicalRepo, DEFAULT_FORGEJO_HOST, DEFAULT_PROJECT, DISPATCH_COMMAND_PATTERNS, DeterministicAgentState, DeterministicAgentStateSchema, DeterministicStateConfig, FleetAgentMetricsSchema, FleetAgentSchema, FleetAgentTreeNode, FleetAgentTreeNodeSchema, FleetAgentUsage, FleetAgentUsageSchema, FleetAgentWork, FleetAgentWorkSchema, FleetOutputSchema, FormattedProjectDisplay, FrontDeskActivityItem, FrontDeskActivityItemSchema, FrontDeskActivityType, FrontDeskActivityTypeSchema, HealthGauge, HealthGaugeKind, HealthGaugeSegment, HealthGaugeTone, HookQueueItem, HookQueueItemSchema, HookQueueMessage, HookQueueMessageSchema, HookStatusOutput, HookStatusOutputSchema, NOISE_TOOL_NAMES, PendingPermissionSchema, ProjectIdentity, QueuePreset, QueueSortField, RepoCoordinates, ResolveCanonicalRepoOptions, SortDirection, StatusLightTone, UppidiAgent, UppidiAgentCategory, UppidiAgentMetrics, UppidiAgentTreeNode, UppidiAgentUsage, UppidiAgentWork, UppidiAgentsOutput, UppidiFrontDeskActivityItem, UppidiFrontDeskActivityType, agentRequiresAttention, buildAgentBlockDetail, candidateRepoKeys, canonicalRepoKey, canonicalRepoName, compactRepoName, computeHealthGauge, deriveLifecycleState, extractPermissionScope, filterAgents, filterQueues, formatProjectDisplay, formatProjectOptionLabel, getAgentAttentionReason, getAgentCategoryIcon, getDeterministicStateConfig, getPendingPermissionAction, getPermissionAdjudicationCommand, getStatusLightTone, isAgentEligibleForBulkArchive, isBlockedLifecycleState, isCodingAgentCategory, isRepoMatching, isSignalActivityItem, normalizeProjectName, normalizeRepoKey, parseTranscriptToActivityItems, repoCoordinates, repoMatches, resolveAgentLifecycleState, resolveCanonicalRepo, sortAgents, sortQueues } from '../client/index.cjs';
import { WorkspaceProjectMap, RawAgentRecord, ArchiveAgentInput, ArchiveInactiveAgentsInput, CreateFrontDeskInput, AddOrchestratorInput, ToggleRepoPauseInput, FleetHaltInput, FleetTeardownInput, FleetRosterInput } from '../shared/index.cjs';
export { AddOrchestratorInputSchema, AddOrchestratorOutput, AddOrchestratorOutputSchema, ArchiveAgentInputSchema, ArchiveAgentOutput, ArchiveAgentOutputSchema, ArchiveInactiveAgentsInputSchema, ArchiveInactiveAgentsOutput, ArchiveInactiveAgentsOutputSchema, CreateFrontDeskInputSchema, CreateFrontDeskOutput, CreateFrontDeskOutputSchema, DEFAULT_CANCELLATION_RECENCY_SECONDS, DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD, DEFAULT_RUNNING_STALE_SECONDS, DEFAULT_WATCHDOG_ALERT_COOLDOWN_MS, DEFAULT_WATCHDOG_BUSY_THRESHOLD, DEFAULT_WATCHDOG_STEER_MESSAGE, DerivedStateResult, FleetHaltInputSchema, FleetHaltOutput, FleetHaltOutputSchema, FleetRosterInputSchema, FleetTeardownInputSchema, FleetTeardownOutput, FleetTeardownOutputSchema, ProviderQuotaDetectionOptions, QUOTA_MARKERS, RpcContract, STEER_TRIGGERS, STOP_TRIGGERS, ToggleRepoPauseInputSchema, ToggleRepoPauseOutput, ToggleRepoPauseOutputSchema, WATCHDOG_SEVERITIES, WATCHDOG_TAXONOMY, WatchdogAgentLike, WatchdogAssessment, WatchdogRecoveryPlan, WatchdogSeverity, WatchdogTaxonomyType, addOrchestratorContract, archiveAgentContract, archiveInactiveAgentsContract, assessAgentHealth, attributedWork, buildAgentTree, categorize, categorizeAgent, coerceEpochMs, createFrontDeskContract, defineContract, deriveDeterministicState, deriveState, detectCancellationTimeout, detectIdlePostErrorAmnesia, detectProviderQuotaExhaustion, detectRepetitiveToolLoop, detectStaleErrorGhosting, detectTurnConcurrencyLock, detectZombieHungTurn, extractAgentProject, extractAgentWorktree, extractAttributedWork, findProviderRetryQuotaError, fleetHaltContract, fleetResumeContract, fleetRosterContract, fleetTeardownContract, hasMarker, inheritProjectFromParents, parseIsoTimestamp, planWatchdogRecovery, replaceFrontDeskContract, replaceOrchestratorContract, toggleRepoPauseContract, toolCallSignature } from '../shared/index.cjs';
import 'zod';

/**
 * Resolves the root commit SHA of a git repository using deterministic sorting:
 * `git rev-list --max-parents=0 HEAD | sort | head -n 1`.
 */
declare function resolveGitRootCommit(cwd: string): Promise<string | null>;
/** Synchronous variant of resolveGitRootCommit. */
declare function resolveGitRootCommitSync(cwd: string): string | null;
/**
 * Derives canonical universal project identity:
 * - Git repository: `git-root:<rootCommitSha>`
 * - Non-git directory: explicit sentinel `non-git:<pathHash>`
 */
declare function canonicalProjectKey(cwd: string): string;
/** Async variant of canonicalProjectKey. */
declare function resolveCanonicalProjectKey(cwd: string): Promise<string>;
interface WorkspaceRecord {
    workspaceId: string;
    projectId?: string;
    cwd: string;
    mainRepoRoot?: string | null;
    worktreeRoot?: string | null;
    displayName?: string | null;
    archivedAt?: string | null;
    kind?: string;
    isPaseoOwnedWorktree?: boolean;
    createdAt?: string | number;
    updatedAt?: string | number;
    isolation?: string;
    [key: string]: any;
}
interface ProjectRecord {
    projectId: string;
    displayName?: string;
    projectKey?: string | null;
    rootPath?: string;
    archivedAt?: string | null;
    createdAt?: string | number;
    updatedAt?: string | number;
    [key: string]: any;
}
interface ResolvedWorkspace {
    workspaceId?: string;
    cwd: string;
    projectId?: string;
    displayName?: string;
    repo?: string;
    score?: number;
}
interface WorkspaceLookupOptions {
    workspacesData?: WorkspaceRecord[];
    projectsData?: ProjectRecord[];
    paseo?: any;
}
interface CanonicalWorkspaceDescriptor {
    id?: string;
    workspaceId?: string;
    projectId?: string | null;
    projectDisplayName?: string | null;
    projectRootPath?: string | null;
    workspaceDirectory?: string | null;
    cwd?: string | null;
    workspaceKind?: string | null;
    kind?: string | null;
    name?: string | null;
    title?: string | null;
    archivingAt?: string | null;
    archivedAt?: string | null;
    gitRuntime?: {
        isPaseoOwnedWorktree?: boolean | null;
        remoteUrl?: string | null;
    } | null;
    project?: {
        projectKey?: string | null;
        projectName?: string | null;
        workspaceName?: string | null;
    } | null;
    [key: string]: any;
}
declare class WorkspaceResolutionError extends Error {
    readonly repo: string;
    constructor(repo: string, message: string, options?: {
        cause?: unknown;
    });
}
declare const WORKSPACE_NOT_FOUND_REMEDIATION = "open/register the repository in Paseo (e.g. `paseo workspace create` for an isolated worktree, or `paseo workspace open --cwd <repo_dir>`), then retry";
declare function workspaceNotFoundError(repo: string): WorkspaceResolutionError;
declare function canonicalDescriptorsToRegistry(entries: readonly CanonicalWorkspaceDescriptor[] | null | undefined): {
    workspaces: WorkspaceRecord[];
    projects: ProjectRecord[];
};
declare function resolveWorkspaceForRepo(rawRepo: string, options?: WorkspaceLookupOptions): ResolvedWorkspace | null;
declare function candidateHostCheckoutDir(repo: string, hostHome?: string): string | undefined;
declare function resolveWorkspaceForRepoViaDaemon(rawRepo: string, paseo: any, options?: {
    candidateDir?: (repo: string) => string | undefined;
}): Promise<ResolvedWorkspace | null>;

declare function resolvePaseoHome(overrideHome?: string): string;
declare function resetWorkspaceProjectCache(): void;
declare function parseProjectKey(key?: string | null): string | undefined;
/**
 * Builds a WorkspaceProjectMap purely from workspace and project records.
 * Adheres strictly to the single-key doctrine: project identity is `git-root:<sha>`.
 * Zero fallbacks to workspace display names, project display names, or path basenames.
 */
declare function buildWorkspaceProjectMapFromRegistry(workspaces: readonly WorkspaceRecord[] | null | undefined, projects: readonly ProjectRecord[] | null | undefined): WorkspaceProjectMap;
declare function readWorkspaceProjectMap(options?: {
    home?: string;
    forceRefresh?: boolean;
    workspacesData?: readonly WorkspaceRecord[];
    projectsData?: readonly ProjectRecord[];
}): WorkspaceProjectMap;
declare function readQuotaAlertAgentIds(options?: {
    home?: string;
}): Set<string>;

declare function normalizePendingPermissions(raw: RawAgentRecord["pendingPermissions"]): PendingPermission[];
declare function normalizeAttentionReason(raw: unknown): AgentAttentionReason | null;
declare function normalizeAgentMetrics(raw: RawAgentRecord): FleetAgentMetrics | null;
declare function normalizeRawAgent(raw: RawAgentRecord, options?: {
    quotaAlertAgentIds?: Set<string>;
    workspaceProjectMap?: WorkspaceProjectMap;
    home?: string;
}): FleetAgent;

interface ReadFleetOptions {
    home?: string;
    enrolledRepos?: string[];
    mutedRepos?: string[];
    execFileAsync?: (file: string, args: readonly string[], options?: any) => Promise<{
        stdout: string;
        stderr?: string;
    }>;
}
declare function readRawRoster(context?: any, options?: ReadFleetOptions): Promise<{
    roster: RawAgentRecord[];
    source: "sdk" | "cli" | "none";
    error?: string;
}>;
declare function buildFleetOutput(agents: FleetAgent[], options?: {
    enrolledRepos?: string[];
    mutedRepos?: string[];
    pausedRepos?: string[];
    kanbanOnlyRepos?: string[];
    repoQueuedHooks?: Record<string, number>;
}): FleetOutput;
declare function readFleetRoster(context?: any, options?: ReadFleetOptions & {
    pausedRepos?: string[];
    kanbanOnlyRepos?: string[];
    repoQueuedHooks?: Record<string, number>;
    workspaceProjectMap?: WorkspaceProjectMap;
    workspacesData?: readonly WorkspaceRecord[];
    projectsData?: readonly ProjectRecord[];
}): Promise<FleetOutput>;

interface FleetLogger {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
}
interface FleetHandlerOptions extends ReadFleetOptions {
    log?: FleetLogger;
    pausedRepos?: string[];
    kanbanOnlyRepos?: string[];
    repoQueuedHooks?: Record<string, number>;
    workspaceProjectMap?: WorkspaceProjectMap;
    workspacesData?: readonly WorkspaceRecord[];
    projectsData?: readonly ProjectRecord[];
    onArchiveAgent?: (input: ArchiveAgentInput, context?: any) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    onArchiveInactive?: (input: ArchiveInactiveAgentsInput, context?: any) => Promise<{
        ok: boolean;
        archivedCount: number;
        error?: string;
    }>;
    onCreateFrontDesk?: (input: CreateFrontDeskInput, context?: any) => Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    onReplaceFrontDesk?: (input: CreateFrontDeskInput, context?: any) => Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    onAddOrchestrator?: (input: AddOrchestratorInput, context?: any) => Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    onReplaceOrchestrator?: (input: AddOrchestratorInput, context?: any) => Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    onToggleRepoPause?: (input: ToggleRepoPauseInput, context?: any) => Promise<{
        ok: boolean;
        paused: boolean;
        repo: string;
        error?: string;
    }>;
    onFleetHalt?: (input: FleetHaltInput, context?: any) => Promise<{
        ok: boolean;
        halted: boolean;
        error?: string;
    }>;
    onFleetResume?: (input: FleetHaltInput, context?: any) => Promise<{
        ok: boolean;
        resumed: boolean;
        error?: string;
    }>;
    onFleetTeardown?: (input: FleetTeardownInput, context?: any) => Promise<{
        ok: boolean;
        error?: string;
    }>;
}
interface HandleableServerContext {
    handle(contract: any, handler: (input: any, context?: any) => Promise<any> | any): void;
    [key: string]: any;
}
interface FleetHandlers {
    handleFleetRoster(input?: FleetRosterInput, context?: any): Promise<FleetOutput>;
    handleArchiveAgent(input: ArchiveAgentInput, context?: any): Promise<{
        ok: boolean;
        error?: string;
    }>;
    handleArchiveInactive(input?: ArchiveInactiveAgentsInput, context?: any): Promise<{
        ok: boolean;
        archivedCount: number;
        error?: string;
    }>;
    handleCreateFrontDesk(input?: CreateFrontDeskInput, context?: any): Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    handleReplaceFrontDesk(input?: CreateFrontDeskInput, context?: any): Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    handleAddOrchestrator(input: AddOrchestratorInput, context?: any): Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    handleReplaceOrchestrator(input: AddOrchestratorInput, context?: any): Promise<{
        ok: boolean;
        agentId?: string;
        error?: string;
    }>;
    handleToggleRepoPause(input: ToggleRepoPauseInput, context?: any): Promise<{
        ok: boolean;
        paused: boolean;
        repo: string;
        error?: string;
    }>;
    handleFleetHalt(input?: FleetHaltInput, context?: any): Promise<{
        ok: boolean;
        halted: boolean;
        error?: string;
    }>;
    handleFleetResume(input?: FleetHaltInput, context?: any): Promise<{
        ok: boolean;
        resumed: boolean;
        error?: string;
    }>;
    handleFleetTeardown(input?: FleetTeardownInput, context?: any): Promise<{
        ok: boolean;
        error?: string;
    }>;
}
declare function createFleetHandlers(options?: FleetHandlerOptions): FleetHandlers;
declare function registerFleetHandlers(server: HandleableServerContext, options?: FleetHandlerOptions): FleetHandlers;

export { AddOrchestratorInput, AgentAttentionReason, ArchiveAgentInput, ArchiveInactiveAgentsInput, type CanonicalWorkspaceDescriptor, CreateFrontDeskInput, FleetAgent, FleetAgentMetrics, FleetHaltInput, type FleetHandlerOptions, type FleetHandlers, type FleetLogger, FleetOutput, FleetRosterInput, FleetTeardownInput, type HandleableServerContext, PendingPermission, type ProjectRecord, RawAgentRecord, type ReadFleetOptions, type ResolvedWorkspace, ToggleRepoPauseInput, WORKSPACE_NOT_FOUND_REMEDIATION, type WorkspaceLookupOptions, WorkspaceProjectMap, type WorkspaceRecord, WorkspaceResolutionError, buildFleetOutput, buildWorkspaceProjectMapFromRegistry, candidateHostCheckoutDir, canonicalDescriptorsToRegistry, canonicalProjectKey, createFleetHandlers, normalizeAgentMetrics, normalizeAttentionReason, normalizePendingPermissions, normalizeRawAgent, parseProjectKey, readFleetRoster, readQuotaAlertAgentIds, readRawRoster, readWorkspaceProjectMap, registerFleetHandlers, resetWorkspaceProjectCache, resolveCanonicalProjectKey, resolveGitRootCommit, resolveGitRootCommitSync, resolvePaseoHome, resolveWorkspaceForRepo, resolveWorkspaceForRepoViaDaemon, workspaceNotFoundError };

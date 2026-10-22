import { z } from 'zod';

declare const CODING_AGENT_CATEGORY: "coding-agent";
declare const AgentCategorySchema: z.ZodEnum<{
    "coding-agent": "coding-agent";
    "front-desk": "front-desk";
    orchestrator: "orchestrator";
    worker: "worker";
}>;
type AgentCategory = z.infer<typeof AgentCategorySchema>;
type UppidiAgentCategory = AgentCategory;
declare function isCodingAgentCategory(category?: string | null): boolean;
declare const DeterministicAgentStateSchema: z.ZodEnum<{
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
}>;
type DeterministicAgentState = z.infer<typeof DeterministicAgentStateSchema>;
declare const AgentLifecycleStateSchema: z.ZodEnum<{
    running: "running";
    waiting_for_input: "waiting_for_input";
    idle: "idle";
    errored: "errored";
    completed: "completed";
}>;
type AgentLifecycleState = z.infer<typeof AgentLifecycleStateSchema>;
declare function deriveLifecycleState(state: DeterministicAgentState): AgentLifecycleState;
declare function isBlockedLifecycleState(state: AgentLifecycleState): boolean;
declare function resolveAgentLifecycleState(agent: {
    lifecycleState?: AgentLifecycleState | null;
    deterministicState?: DeterministicAgentState | null;
} | null | undefined): AgentLifecycleState;
declare const AgentAttentionReasonSchema: z.ZodEnum<{
    finished: "finished";
    error: "error";
    permission: "permission";
    input: "input";
}>;
type AgentAttentionReason = z.infer<typeof AgentAttentionReasonSchema>;
declare const PendingPermissionSchema: z.ZodObject<{
    id: z.ZodString;
    requestId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    tool: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    input: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    scope: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type PendingPermission = z.infer<typeof PendingPermissionSchema>;
declare function extractPermissionScope(permission: Pick<PendingPermission, "input" | "description" | "scope">): string | undefined;
declare const AgentBlockDetailSchema: z.ZodObject<{
    requiredPermissionId: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodString>;
    command: z.ZodString;
}, z.core.$strip>;
type AgentBlockDetail = z.infer<typeof AgentBlockDetailSchema>;
declare function getPendingPermissionAction(permission: PendingPermission): string;
declare function getPermissionAdjudicationCommand(agentId: string, permission?: PendingPermission | null): string;
declare function buildAgentBlockDetail(agentId: string, permissions: PendingPermission[] | null | undefined): AgentBlockDetail | undefined;
declare function agentRequiresAttention(agent: {
    pendingPermissions?: PendingPermission[] | null;
    requiresAttention?: boolean;
    attentionReason?: AgentAttentionReason | string | null;
} | null | undefined): boolean;
declare function getAgentAttentionReason(agent: {
    attentionReason?: AgentAttentionReason | string | null;
}): string | undefined;
declare const FleetAgentWorkSchema: z.ZodObject<{
    repo: z.ZodOptional<z.ZodString>;
    issue: z.ZodOptional<z.ZodNumber>;
    slug: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type FleetAgentWork = z.infer<typeof FleetAgentWorkSchema>;
type UppidiAgentWork = FleetAgentWork;
declare const FleetAgentUsageSchema: z.ZodObject<{
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    totalCostUsd: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
type FleetAgentUsage = z.infer<typeof FleetAgentUsageSchema>;
type UppidiAgentUsage = FleetAgentUsage;
declare const FleetAgentMetricsSchema: z.ZodObject<{
    contextUsedTokens: z.ZodOptional<z.ZodNumber>;
    contextMaxTokens: z.ZodOptional<z.ZodNumber>;
    cachedTokens: z.ZodOptional<z.ZodNumber>;
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    activeTurnStartedAt: z.ZodOptional<z.ZodString>;
    attentionTimestamp: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type FleetAgentMetrics = z.infer<typeof FleetAgentMetricsSchema>;
type UppidiAgentMetrics = FleetAgentMetrics;
declare const FleetAgentSchema: z.ZodObject<{
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
}, z.core.$strip>;
type FleetAgent = z.infer<typeof FleetAgentSchema>;
type UppidiAgent = FleetAgent;
interface FleetAgentTreeNode {
    agent: FleetAgent;
    depth: number;
    children: FleetAgentTreeNode[];
    isEnrolled?: boolean;
    isPaused?: boolean;
    hasOrchestrator?: boolean;
    queuedHooksCount?: number;
    isDetached?: boolean;
}
declare const FleetAgentTreeNodeSchema: z.ZodType<FleetAgentTreeNode, any, any>;
type UppidiAgentTreeNode = FleetAgentTreeNode;
declare const AgentRoleDivergenceSchema: z.ZodObject<{
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
}, z.core.$strip>;
type AgentRoleDivergence = z.infer<typeof AgentRoleDivergenceSchema>;
declare const FleetOutputSchema: z.ZodObject<{
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
}, z.core.$strip>;
type FleetOutput = z.infer<typeof FleetOutputSchema>;
type UppidiAgentsOutput = FleetOutput;
declare const HookQueueMessageSchema: z.ZodObject<{
    id: z.ZodString;
    ts: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    preview: z.ZodString;
}, z.core.$strip>;
type HookQueueMessage = z.infer<typeof HookQueueMessageSchema>;
declare const HookQueueItemSchema: z.ZodObject<{
    key: z.ZodString;
    depth: z.ZodNumber;
    dropped: z.ZodDefault<z.ZodNumber>;
    paused: z.ZodBoolean;
    isBusy: z.ZodBoolean;
    busyAttempts: z.ZodDefault<z.ZodNumber>;
    orchestrator: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        agentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        updatedAt: z.ZodOptional<z.ZodString>;
        by: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    messages: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        ts: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        preview: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
type HookQueueItem = z.infer<typeof HookQueueItemSchema>;
declare const HookStatusOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    service: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodNumber>;
    uptime: z.ZodOptional<z.ZodNumber>;
    frontDesk: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodOptional<z.ZodNumber>;
        agentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        updatedAt: z.ZodOptional<z.ZodString>;
        by: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    paused: z.ZodDefault<z.ZodArray<z.ZodString>>;
    totalQueued: z.ZodDefault<z.ZodNumber>;
    queues: z.ZodDefault<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        depth: z.ZodNumber;
        dropped: z.ZodDefault<z.ZodNumber>;
        paused: z.ZodBoolean;
        isBusy: z.ZodBoolean;
        busyAttempts: z.ZodDefault<z.ZodNumber>;
        orchestrator: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            agentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            updatedAt: z.ZodOptional<z.ZodString>;
            by: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        messages: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            ts: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            preview: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type HookStatusOutput = z.infer<typeof HookStatusOutputSchema>;
declare const FrontDeskActivityTypeSchema: z.ZodEnum<{
    error: "error";
    tool: "tool";
    user: "user";
    assistant: "assistant";
    thought: "thought";
    dispatch: "dispatch";
    decision: "decision";
    heartbeat: "heartbeat";
    system: "system";
}>;
type FrontDeskActivityType = z.infer<typeof FrontDeskActivityTypeSchema>;
type UppidiFrontDeskActivityType = FrontDeskActivityType;
declare const FrontDeskActivityItemSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodDefault<z.ZodString>;
    type: z.ZodEnum<{
        error: "error";
        tool: "tool";
        user: "user";
        assistant: "assistant";
        thought: "thought";
        dispatch: "dispatch";
        decision: "decision";
        heartbeat: "heartbeat";
        system: "system";
    }>;
    role: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
    detail: z.ZodOptional<z.ZodString>;
    isSignal: z.ZodDefault<z.ZodBoolean>;
    toolName: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type FrontDeskActivityItem = z.infer<typeof FrontDeskActivityItemSchema>;
type UppidiFrontDeskActivityItem = FrontDeskActivityItem;
declare const DISPATCH_COMMAND_PATTERNS: RegExp[];
declare const NOISE_TOOL_NAMES: Set<string>;
declare function isSignalActivityItem(item: FrontDeskActivityItem): boolean;
declare function parseTranscriptToActivityItems(transcript: string, fallbackTimestamp?: string): FrontDeskActivityItem[];
declare const DEFAULT_FORGEJO_HOST = "forge.mrs.uppidi.com";
declare const DEFAULT_PROJECT = "Default Project";
declare function normalizeRepoKey(raw: string | null | undefined): string | null;
declare function candidateRepoKeys(raw: string | null | undefined): string[];
declare function canonicalRepoKey(raw: string | null | undefined): string | null;
declare function normalizeProjectName(name: string): string;
interface RepoCoordinates {
    host: string;
    owner: string;
    repo: string;
}
interface CanonicalRepo extends RepoCoordinates {
    key: string;
    compact: string;
}
declare function repoCoordinates(input: string | null | undefined): RepoCoordinates | null;
interface ResolveCanonicalRepoOptions {
    knownRepos?: readonly string[] | null;
    host?: string;
}
declare function resolveCanonicalRepo(input: string | null | undefined, options?: ResolveCanonicalRepoOptions): CanonicalRepo | null;
declare function canonicalRepoName(input: string | null | undefined, options?: ResolveCanonicalRepoOptions): string | null;
declare function compactRepoName(input: string | null | undefined, options?: ResolveCanonicalRepoOptions): string | null;
interface ProjectIdentity {
    /** Canonical project key (e.g. `git-root:<sha>` or `non-git:<hash>`). */
    projectKey?: string | null;
    /** Primary identifier or directory path. */
    name?: string | null;
    displayName?: string | null;
    repo?: string | null;
    rootPath?: string | null;
    cwd?: string | null;
    worktree?: string | null;
    branch?: string | null;
}
interface FormattedProjectDisplay {
    primaryName: string;
    orgPill?: string;
    rootShaPill: string;
    worktreePill?: string;
}
declare function formatProjectDisplay(project: ProjectIdentity | string | null | undefined): FormattedProjectDisplay;
declare function formatProjectOptionLabel(project: ProjectIdentity | string | null | undefined): string;

type StatusLightTone = "success" | "warning" | "danger";
declare function getStatusLightTone(agent?: {
    status?: string | null;
    deterministicState?: DeterministicAgentState | string | null;
} | null): StatusLightTone;
declare function getAgentCategoryIcon(category?: AgentCategory | string): string;
interface DeterministicStateConfig {
    state: DeterministicAgentState;
    color: string;
    badgeVariant: "success" | "info" | "warning" | "danger" | "neutral";
    dotVariant: "success" | "info" | "warning" | "danger" | "neutral";
    stateIcon: string;
    categoryIcon: string;
    pulse: boolean;
    label: string;
}
declare function getDeterministicStateConfig(state: DeterministicAgentState, category?: AgentCategory | string): DeterministicStateConfig;
type HealthGaugeKind = "context" | "turn" | "error";
type HealthGaugeTone = "ok" | "warn" | "critical";
interface HealthGaugeSegment {
    kind: HealthGaugeKind;
    ratio: number;
    tone: HealthGaugeTone;
}
interface HealthGauge {
    segments: HealthGaugeSegment[];
    overall: HealthGaugeTone;
}
declare function computeHealthGauge(metrics?: FleetAgentMetrics | null, lastError?: string | null, nowEpochMs?: number): HealthGauge | null;

type SortDirection = "asc" | "desc";
declare function isRepoMatching(targetRepo: string, candidateRepo: string, context?: any): boolean;
declare const repoMatches: typeof isRepoMatching;
declare function isAgentEligibleForBulkArchive(agent?: FleetAgent | null): boolean;
type AgentPreset = "all" | "active" | "idle" | "blocked";
type AgentSortField = "name" | "status" | "category" | "provider";
declare function filterAgents(agents: FleetAgent[], preset: AgentPreset, query: string): FleetAgent[];
declare function sortAgents(agents: FleetAgent[], field: AgentSortField, direction: SortDirection): FleetAgent[];
type QueuePreset = "all" | "pending-processing" | "dead-failed";
type QueueSortField = "repo" | "depth" | "status";
declare function filterQueues(queues: HookQueueItem[], preset: QueuePreset, query: string): HookQueueItem[];
declare function sortQueues(queues: HookQueueItem[], field: QueueSortField, direction: SortDirection): HookQueueItem[];

export { type AgentAttentionReason, AgentAttentionReasonSchema, type AgentBlockDetail, AgentBlockDetailSchema, type AgentCategory, AgentCategorySchema, type AgentLifecycleState, AgentLifecycleStateSchema, type AgentPreset, type AgentRoleDivergence, AgentRoleDivergenceSchema, type AgentSortField, CODING_AGENT_CATEGORY, type CanonicalRepo, DEFAULT_FORGEJO_HOST, DEFAULT_PROJECT, DISPATCH_COMMAND_PATTERNS, type DeterministicAgentState, DeterministicAgentStateSchema, type DeterministicStateConfig, type FleetAgent, type FleetAgentMetrics, FleetAgentMetricsSchema, FleetAgentSchema, type FleetAgentTreeNode, FleetAgentTreeNodeSchema, type FleetAgentUsage, FleetAgentUsageSchema, type FleetAgentWork, FleetAgentWorkSchema, type FleetOutput, FleetOutputSchema, type FormattedProjectDisplay, type FrontDeskActivityItem, FrontDeskActivityItemSchema, type FrontDeskActivityType, FrontDeskActivityTypeSchema, type HealthGauge, type HealthGaugeKind, type HealthGaugeSegment, type HealthGaugeTone, type HookQueueItem, HookQueueItemSchema, type HookQueueMessage, HookQueueMessageSchema, type HookStatusOutput, HookStatusOutputSchema, NOISE_TOOL_NAMES, type PendingPermission, PendingPermissionSchema, type ProjectIdentity, type QueuePreset, type QueueSortField, type RepoCoordinates, type ResolveCanonicalRepoOptions, type SortDirection, type StatusLightTone, type UppidiAgent, type UppidiAgentCategory, type UppidiAgentMetrics, type UppidiAgentTreeNode, type UppidiAgentUsage, type UppidiAgentWork, type UppidiAgentsOutput, type UppidiFrontDeskActivityItem, type UppidiFrontDeskActivityType, agentRequiresAttention, buildAgentBlockDetail, candidateRepoKeys, canonicalRepoKey, canonicalRepoName, compactRepoName, computeHealthGauge, deriveLifecycleState, extractPermissionScope, filterAgents, filterQueues, formatProjectDisplay, formatProjectOptionLabel, getAgentAttentionReason, getAgentCategoryIcon, getDeterministicStateConfig, getPendingPermissionAction, getPermissionAdjudicationCommand, getStatusLightTone, isAgentEligibleForBulkArchive, isBlockedLifecycleState, isCodingAgentCategory, isRepoMatching, isSignalActivityItem, normalizeProjectName, normalizeRepoKey, parseTranscriptToActivityItems, repoCoordinates, repoMatches, resolveAgentLifecycleState, resolveCanonicalRepo, sortAgents, sortQueues };

import { P as PluginRpcContract } from './rpc-D27pph91.cjs';
import { z } from 'zod';
import { S as StatusVariant } from './types-4TBN5lgi.cjs';

/**
 * Cleanup handle returned by a feature contribution.
 *
 * A disposer MUST be idempotent: calling it more than once must not throw and
 * must not tear down anything twice. `composeFeatureModules` additionally
 * wraps every disposer it receives so the *composed* teardown is idempotent
 * even if an individual module forgets.
 */
type FeatureDisposer = () => void;
/**
 * A self-contained, droppable unit of plugin functionality.
 *
 * A feature module owns one concern (custom pills, timeline telemetry,
 * permission auditing, …) and exposes it through up to two contribution hooks:
 * `contributeServer` for the daemon-side `PluginServerContext` and
 * `contributeClient` for the client-side `PluginClientContext`. Both hooks are
 * optional; a module may contribute to one side, both, or neither.
 *
 * Lifecycle contract
 * ------------------
 * - A contribution hook runs at most once per `contribute*` call on the
 *   composing plugin entry.
 * - It may return a {@link FeatureDisposer} for cleanup, or `void` when it owns
 *   nothing to release.
 * - Returned disposers MUST be idempotent (see {@link FeatureDisposer}).
 * - The plugin entry composes modules with {@link composeFeatureModules} and
 *   returns the combined disposer to Paseo.
 * - `contracts` is declarative metadata (name-keyed RPC contracts the module
 *   owns); it is not registered automatically. The composing entry still calls
 *   `server.handle(contract, handler)`.
 *
 * Context types are generic because `paseo-plugin-helper/shared` must not
 * import the Paseo SDK. Type a module with the SDK contexts at the call site:
 *
 * ```ts
 * import type { PluginClientContext } from "@getpaseo/plugin/client";
 * import type { PluginServerContext } from "@getpaseo/plugin/server";
 * import type { FeatureModule } from "paseo-plugin-helper/shared";
 *
 * export const customPills: FeatureModule<PluginServerContext, PluginClientContext> = {
 *   id: "custom-pills",
 *   contracts: { list: listCustomPillsRpc },
 *   contributeServer(server) {
 *     const { unsubscribe } = registerCustomPillsServer(server);
 *     return unsubscribe;
 *   },
 *   contributeClient(client) {
 *     const remove = registerCustomPills(client);
 *     return remove;
 *   },
 * };
 * ```
 */
interface FeatureModule<TServerContext = unknown, TClientContext = unknown> {
    /** Stable, plugin-unique module id (e.g. `"custom-pills"`). */
    readonly id: string;
    /** Daemon-side contribution. Returns an idempotent disposer, or `void`. */
    readonly contributeServer?: (server: TServerContext) => FeatureDisposer | void;
    /** Client-side contribution. Returns an idempotent disposer, or `void`. */
    readonly contributeClient?: (client: TClientContext) => FeatureDisposer | void;
    /** RPC contracts this module owns, keyed by a local name. */
    readonly contracts?: Record<string, PluginRpcContract>;
}
/**
 * A composed set of feature modules. `contributeServer` / `contributeClient`
 * run every module's hook for that side and return a single combined,
 * idempotent disposer that tears the modules down in reverse order.
 */
interface FeatureComposition<TServerContext = unknown, TClientContext = unknown> {
    /** Module ids in composition order. */
    readonly ids: readonly string[];
    /** Every declared contract, flattened in module order and de-duplicated. */
    readonly contracts: readonly PluginRpcContract[];
    /** Run all `contributeServer` hooks; returns the combined disposer. */
    contributeServer(server: TServerContext): FeatureDisposer;
    /** Run all `contributeClient` hooks; returns the combined disposer. */
    contributeClient(client: TClientContext): FeatureDisposer;
}
/**
 * Compose {@link FeatureModule}s into one contribution unit for a plugin entry.
 *
 * Modules run in array order on contribution and are disposed in reverse (LIFO)
 * order. The returned combined disposer is idempotent: calling it twice runs
 * teardown once and never throws the first error a second time.
 *
 * ```ts
 * import type { PluginClientContext } from "@getpaseo/plugin/client";
 * import type { PluginServerContext } from "@getpaseo/plugin/server";
 * import { composeFeatureModules } from "paseo-plugin-helper/shared";
 * import { customPills } from "./features/custom-pills.js";
 * import { timelineTelemetry } from "./features/timeline-telemetry.js";
 *
 * const features = composeFeatureModules<PluginServerContext, PluginClientContext>([
 *   customPills,
 *   timelineTelemetry,
 * ]);
 *
 * export function contributeServer(server: PluginServerContext) {
 *   return features.contributeServer(server);
 * }
 *
 * export function contributeClient(client: PluginClientContext) {
 *   return features.contributeClient(client);
 * }
 * ```
 *
 * @throws if two modules share an `id` or declare the same RPC contract `name`.
 */
declare function composeFeatureModules<TServerContext = unknown, TClientContext = unknown>(modules: readonly FeatureModule<TServerContext, TClientContext>[]): FeatureComposition<TServerContext, TClientContext>;

declare const CustomPillThresholdsSchema: z.ZodObject<{
    warning: z.ZodOptional<z.ZodNumber>;
    danger: z.ZodOptional<z.ZodNumber>;
    invert: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
declare const CustomPillModalSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
    preformatted: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
declare const CustomPillDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    compactTitle: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodString>;
    compactIcon: z.ZodOptional<z.ZodString>;
    command: z.ZodString;
    prefix: z.ZodOptional<z.ZodString>;
    suffix: z.ZodOptional<z.ZodString>;
    intervalMs: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    thresholds: z.ZodOptional<z.ZodObject<{
        warning: z.ZodOptional<z.ZodNumber>;
        danger: z.ZodOptional<z.ZodNumber>;
        invert: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    modal: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        command: z.ZodOptional<z.ZodString>;
        preformatted: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    sourceFile: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type CustomPillDefinition = z.infer<typeof CustomPillDefinitionSchema>;
type CustomPillThresholds = z.infer<typeof CustomPillThresholdsSchema>;
type CustomPillModal = z.infer<typeof CustomPillModalSchema>;
interface CustomPillState {
    id: string;
    title: string;
    compactTitle?: string;
    icon?: string;
    compactIcon?: string;
    rawValue: string;
    displayValue: string;
    numericValue?: number;
    status: StatusVariant;
    lastUpdated: number;
    error?: string;
    sourceFile?: string;
    modalTitle?: string;
    modalDescription?: string;
    modalOutput?: string;
    modalError?: string;
    modalLastUpdated?: number;
}
/**
 * Extracts a numeric value from the raw command output string (e.g. "45.2%" -> 45.2).
 */
declare function parseNumericPillValue(rawValue: string): number | undefined;
/**
 * Resolves the status variant based on numeric value and thresholds.
 */
declare function resolveCustomPillStatus(numericValue: number | undefined, thresholds?: CustomPillThresholds): StatusVariant;
/**
 * Formats the raw output string with optional prefix and suffix.
 */
declare function formatPillDisplay(rawValue: string, prefix?: string, suffix?: string): string;

declare const STATE_ORDER: readonly ["state/triage", "state/wip", "state/review", "state/verify", "state/done"];
type StateLabel = (typeof STATE_ORDER)[number];
declare const LEGACY_STATE_ORDER: readonly ["state/0-triage", "state/1-wip", "state/2-review", "state/3-verify", "state/4-done"];
declare const PRIORITY_ORDER: readonly ["priority/sos", "priority/high", "priority/normal", "priority/low", "priority/backburner"];
type PriorityLabel = (typeof PRIORITY_ORDER)[number];
declare const LEGACY_PRIORITY_ORDER: readonly ["priority/0-SOS", "priority/1-high", "priority/2-normal", "priority/3-low", "priority/4-backburner"];
declare const ATTENTION_LABELS: readonly ["attention/orchestrator", "attention/agent", "attention/user", "attention/ignore"];
type AttentionLabel = (typeof ATTENTION_LABELS)[number];
declare const LEGACY_ATTENTION_LABELS: readonly ["attention/0-orchestrator", "attention/1-agent", "attention/2-user", "attention/3-ignore"];
declare const SPEC_LABELS: readonly ["spec/needed", "spec/checklist", "spec/approved"];
type SpecLabel = (typeof SPEC_LABELS)[number];
declare const LEGACY_SPEC_LABELS: readonly ["spec/0-needed", "spec/1-checklist", "spec/2-approved"];
/** Legacy numeric label -> canonical numberless label (all scopes). */
declare const LABEL_ALIASES: Record<string, string>;
/** Canonical numberless spelling of a label; unknown labels pass through. */
declare function canonicalLabel(label: string): string;
/** True when two spellings name the same scoped label under the alias map. */
declare function sameLabel(a: string, b: string): boolean;
/** Compact display alias for a scoped label ("state/1-wip" -> "WIP"). */
declare function shortLabelName(label: string): string;
/** The issue's current `state/*` label (canonical), or null when it carries none. */
declare function currentStateLabel(labels: string[]): string | null;
/** The issue's current `priority/*` label, defaulting to normal per spec §4.2. */
declare function currentPriorityLabel(labels: string[]): string;
/** Next `state/*` promotion step, or null when already done. */
declare function nextStateLabel(labels: string[]): string | null;
declare const ForgeLabelSchema: z.ZodObject<{
    name: z.ZodString;
    color: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ForgeLabel = z.infer<typeof ForgeLabelSchema>;
declare const ForgeIssueSchema: z.ZodObject<{
    number: z.ZodNumber;
    title: z.ZodString;
    state: z.ZodString;
    labels: z.ZodArray<z.ZodString>;
    labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        color: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    comments: z.ZodDefault<z.ZodNumber>;
    updatedAt: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    repo: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ForgeIssue = z.infer<typeof ForgeIssueSchema>;
declare const AgentEnvelopeSchema: z.ZodObject<{
    commentId: z.ZodNumber;
    sessionTitle: z.ZodString;
    agentShortId: z.ZodString;
    model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
    paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
    serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
type AgentEnvelope = z.infer<typeof AgentEnvelopeSchema>;
declare const IssueCommentSchema: z.ZodObject<{
    id: z.ZodNumber;
    author: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    body: z.ZodString;
    url: z.ZodString;
    envelope: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        commentId: z.ZodNumber;
        sessionTitle: z.ZodString;
        agentShortId: z.ZodString;
        model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
        paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
        serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
type IssueComment = z.infer<typeof IssueCommentSchema>;
declare const IssueDetailSchema: z.ZodObject<{
    number: z.ZodNumber;
    title: z.ZodString;
    state: z.ZodString;
    labels: z.ZodArray<z.ZodString>;
    labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        color: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    body: z.ZodString;
    author: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    webUrl: z.ZodString;
    comments: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        author: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        body: z.ZodString;
        url: z.ZodString;
        envelope: z.ZodDefault<z.ZodNullable<z.ZodObject<{
            commentId: z.ZodNumber;
            sessionTitle: z.ZodString;
            agentShortId: z.ZodString;
            model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
            paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
            serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    envelopes: z.ZodArray<z.ZodObject<{
        commentId: z.ZodNumber;
        sessionTitle: z.ZodString;
        agentShortId: z.ZodString;
        model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
        paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
        serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type IssueDetail = z.infer<typeof IssueDetailSchema>;
interface ForgeRepoIdentity {
    host: string;
    owner: string;
    repo: string;
}
type ForgeVisibility = "public" | "private" | "unknown";
type ForgeAuthState = "authenticated" | "lacks-write-scope" | "invalid-token" | "anonymous" | "unknown";
interface ForgeAccessState {
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
interface ForgeAccessInput {
    repoPublic?: boolean | null;
    tokenPresent?: boolean | null;
    tokenValid?: boolean | null;
    repoWritePermission?: boolean | null;
}
declare function forgeWriteScopeList(): string;
declare function deriveForgeAccess(input?: ForgeAccessInput): ForgeAccessState;
declare function writeGateNotice(access: ForgeAccessState, capability: string): string;
declare function stripAgentEnvelopeFooter(body: string | undefined | null): string;
type MarkdownLiteSpan = {
    kind: "text";
    text: string;
} | {
    kind: "bold";
    text: string;
} | {
    kind: "italic";
    text: string;
} | {
    kind: "code";
    text: string;
} | {
    kind: "link";
    text: string;
    url: string;
};
type MarkdownLiteBlock = {
    kind: "paragraph";
    spans: MarkdownLiteSpan[];
} | {
    kind: "heading";
    level: 1 | 2 | 3;
    spans: MarkdownLiteSpan[];
} | {
    kind: "list";
    ordered: boolean;
    items: MarkdownLiteSpan[][];
} | {
    kind: "code";
    text: string;
    language?: string;
};
declare function parseMarkdownLiteInline(text: string): MarkdownLiteSpan[];
declare function parseMarkdownLite(body: string | undefined | null): MarkdownLiteBlock[];
declare const IssueNumberInput: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
type IssueNumberInput = z.infer<typeof IssueNumberInput>;
declare const IssueDetailInputSchema: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
type IssueDetailInput = z.infer<typeof IssueDetailInputSchema>;
declare const IssueDetailOutputSchema: z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    issue: z.ZodNullable<z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        state: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        body: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        webUrl: z.ZodString;
        comments: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            author: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            body: z.ZodString;
            url: z.ZodString;
            envelope: z.ZodDefault<z.ZodNullable<z.ZodObject<{
                commentId: z.ZodNumber;
                sessionTitle: z.ZodString;
                agentShortId: z.ZodString;
                model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
                paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
                serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        envelopes: z.ZodArray<z.ZodObject<{
            commentId: z.ZodNumber;
            sessionTitle: z.ZodString;
            agentShortId: z.ZodString;
            model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
            paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
            serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    fetchedAt: z.ZodString;
    repoPublic: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    tokenPresent: z.ZodDefault<z.ZodBoolean>;
    tokenValid: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    repoWritePermission: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type IssueDetailOutput = z.infer<typeof IssueDetailOutputSchema>;
declare const issueDetailContract: PluginRpcContract<z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    issue: z.ZodNullable<z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        state: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        body: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        webUrl: z.ZodString;
        comments: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            author: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            body: z.ZodString;
            url: z.ZodString;
            envelope: z.ZodDefault<z.ZodNullable<z.ZodObject<{
                commentId: z.ZodNumber;
                sessionTitle: z.ZodString;
                agentShortId: z.ZodString;
                model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
                paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
                serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        envelopes: z.ZodArray<z.ZodObject<{
            commentId: z.ZodNumber;
            sessionTitle: z.ZodString;
            agentShortId: z.ZodString;
            model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            branch: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            commitShas: z.ZodDefault<z.ZodArray<z.ZodString>>;
            paseoLinks: z.ZodDefault<z.ZodArray<z.ZodString>>;
            serverId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    fetchedAt: z.ZodString;
    repoPublic: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    tokenPresent: z.ZodDefault<z.ZodBoolean>;
    tokenValid: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    repoWritePermission: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare const SetLabelInputSchema: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
    label: z.ZodString;
}, z.core.$strip>;
type SetLabelInput = z.infer<typeof SetLabelInputSchema>;
declare const SetLabelOutputSchema: z.ZodObject<{
    number: z.ZodNumber;
    labels: z.ZodArray<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type SetLabelOutput = z.infer<typeof SetLabelOutputSchema>;
declare const setLabelContract: PluginRpcContract<z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
    label: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    number: z.ZodNumber;
    labels: z.ZodArray<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare const AddCommentInputSchema: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
    body: z.ZodString;
}, z.core.$strip>;
type AddCommentInput = z.infer<typeof AddCommentInputSchema>;
declare const AddCommentOutputSchema: z.ZodObject<{
    number: z.ZodNumber;
    commentId: z.ZodNullable<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type AddCommentOutput = z.infer<typeof AddCommentOutputSchema>;
declare const addCommentContract: PluginRpcContract<z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
    body: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    number: z.ZodNumber;
    commentId: z.ZodNullable<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare const CREATE_ISSUE_TITLE_MAX = 200;
declare const CREATE_ISSUE_BODY_MAX = 10000;
declare const CREATE_ISSUE_LABEL_MAX = 50;
declare const CreateIssueInputSchema: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;
declare const CreateIssueOutputSchema: z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    number: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type CreateIssueOutput = z.infer<typeof CreateIssueOutputSchema>;
declare const createIssueContract: PluginRpcContract<z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    number: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare function validateCreateIssueInput(input: {
    title?: unknown;
    body?: unknown;
    labels?: unknown;
}): string | null;
declare function parseLabelList(text: string | undefined | null): string[];
declare const OpenIssuesInputSchema: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
type OpenIssuesInput = z.infer<typeof OpenIssuesInputSchema>;
declare const OpenIssuesOutputSchema: z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    issues: z.ZodArray<z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        state: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        comments: z.ZodDefault<z.ZodNumber>;
        updatedAt: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodOptional<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
        body: z.ZodOptional<z.ZodString>;
        remoteUrl: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    openIssueCount: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    page: z.ZodDefault<z.ZodNumber>;
    hasMore: z.ZodDefault<z.ZodBoolean>;
    derivedRemote: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    remoteSource: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        explicit: "explicit";
        derived: "derived";
    }>>>;
    repoPublic: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    tokenPresent: z.ZodDefault<z.ZodBoolean>;
    tokenValid: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    repoWritePermission: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type OpenIssuesOutput = z.infer<typeof OpenIssuesOutputSchema>;
declare const openIssuesContract: PluginRpcContract<z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    issues: z.ZodArray<z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        state: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        comments: z.ZodDefault<z.ZodNumber>;
        updatedAt: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodOptional<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
        body: z.ZodOptional<z.ZodString>;
        remoteUrl: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    openIssueCount: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    page: z.ZodDefault<z.ZodNumber>;
    hasMore: z.ZodDefault<z.ZodBoolean>;
    derivedRemote: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    remoteSource: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        explicit: "explicit";
        derived: "derived";
    }>>>;
    repoPublic: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    tokenPresent: z.ZodDefault<z.ZodBoolean>;
    tokenValid: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    repoWritePermission: z.ZodDefault<z.ZodNullable<z.ZodBoolean>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare const SearchIssuesInputSchema: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    query: z.ZodString;
    page: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
type SearchIssuesInput = z.infer<typeof SearchIssuesInputSchema>;
declare const SearchIssuesOutputSchema: z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    issues: z.ZodArray<z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        state: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        comments: z.ZodDefault<z.ZodNumber>;
        updatedAt: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodOptional<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
        body: z.ZodOptional<z.ZodString>;
        remoteUrl: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    page: z.ZodDefault<z.ZodNumber>;
    hasMore: z.ZodDefault<z.ZodBoolean>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type SearchIssuesOutput = z.infer<typeof SearchIssuesOutputSchema>;
declare const searchIssuesContract: PluginRpcContract<z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    query: z.ZodString;
    page: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    repo: z.ZodNullable<z.ZodString>;
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    issues: z.ZodArray<z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        state: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        labelDetails: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        comments: z.ZodDefault<z.ZodNumber>;
        updatedAt: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodOptional<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
        body: z.ZodOptional<z.ZodString>;
        remoteUrl: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    page: z.ZodDefault<z.ZodNumber>;
    hasMore: z.ZodDefault<z.ZodBoolean>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare const ForgeContextInputSchema: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ForgeContextInput = z.infer<typeof ForgeContextInputSchema>;
declare const ForgeContextOutputSchema: z.ZodObject<{
    directory: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    derivedRemote: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    derivedHost: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    derivedRepo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
type ForgeContextOutput = z.infer<typeof ForgeContextOutputSchema>;
declare const forgeContextContract: PluginRpcContract<z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    directory: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    derivedRemote: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    derivedHost: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    derivedRepo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>> & {
    readonly description?: string;
};
declare const SHA_PATTERN: RegExp;
declare const PASEO_LINK_PATTERN: RegExp;
declare const PASEO_SERVER_PATTERN: RegExp;
declare function parseAgentEnvelope(commentId: number, body: string | undefined | null): AgentEnvelope | null;
interface ForgeRemote {
    host: string;
    owner: string;
    repo: string;
}
declare function parseForgeRemote(url: string | undefined | null): ForgeRemote | null;
declare const BARE_REPO_PATTERN: RegExp;
type ForgeTargetResolution = {
    ok: true;
    host: string;
    repo: string;
    source: "explicit" | "derived";
} | {
    ok: false;
    error: string;
};
declare function resolveForgeTarget(explicitTarget: string | undefined | null, gitRemoteUrl: string | undefined | null): ForgeTargetResolution;
declare function isValidForgeTarget(target: string | undefined | null): boolean;
declare function forgeCapabilityFromRepo(payload: unknown): boolean | null;
declare function activeForgeForDirectory(settings: {
    activeForgeByDirectory?: Record<string, string>;
    remotesByDirectory?: Record<string, string>;
    forgesByDirectory?: Record<string, string[]>;
} | undefined | null, directory: string | undefined | null): string | null;
declare function normalizeIssueNumber(input: {
    issueNumber?: number;
    number?: number;
}): number | null;
declare function scopeOfLabel(label: string): string | null;
declare function liveScopesFromLabels(allLabels: string[]): string[];
declare function liveScopesFromIssues(issues: Pick<ForgeIssue, "labels">[]): string[];
declare function rankIssues<T extends Pick<ForgeIssue, "labels" | "updatedAt">>(issues: T[]): T[];
declare const PASEO_LABEL_SCOPES: readonly ["state", "priority", "attention", "spec", "kind", "target", "format", "size", "dep", "flag"];
declare const INSTALL_LABEL_MODES: readonly ["merge", "replace"];
type InstallLabelMode = (typeof INSTALL_LABEL_MODES)[number];
interface ForgeLabelRef {
    id?: number;
    name: string;
}
interface LabelDefinition {
    name: string;
    color: string;
    exclusive: boolean;
    description: string;
}
interface LabelSetPlan {
    mode: InstallLabelMode;
    create: LabelDefinition[];
    remove: ForgeLabelRef[];
    skip: string[];
}
declare const InstallLabelsInputSchema: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    remoteUrl: z.ZodOptional<z.ZodString>;
    mode: z.ZodEnum<{
        replace: "replace";
        merge: "merge";
    }>;
}, z.core.$strip>;
type InstallLabelsInput = z.infer<typeof InstallLabelsInputSchema>;
declare const InstallLabelsOutputSchema: z.ZodObject<{
    host: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    mode: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        replace: "replace";
        merge: "merge";
    }>>>;
    created: z.ZodDefault<z.ZodArray<z.ZodString>>;
    skipped: z.ZodDefault<z.ZodArray<z.ZodString>>;
    removed: z.ZodDefault<z.ZodArray<z.ZodString>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type InstallLabelsOutput = z.infer<typeof InstallLabelsOutputSchema>;
declare function paseoLabelSet(): LabelDefinition[];
declare function paseoLabelScopes(): string[];
declare function planLabelSetInstall(existing: ForgeLabelRef[], mode: InstallLabelMode): LabelSetPlan;

export { type IssueDetailOutput as $, ATTENTION_LABELS as A, BARE_REPO_PATTERN as B, CREATE_ISSUE_BODY_MAX as C, ForgeContextInputSchema as D, type ForgeContextOutput as E, type FeatureComposition as F, ForgeContextOutputSchema as G, type ForgeIssue as H, ForgeIssueSchema as I, type ForgeLabel as J, type ForgeLabelRef as K, ForgeLabelSchema as L, type ForgeRemote as M, type ForgeRepoIdentity as N, type ForgeTargetResolution as O, type ForgeVisibility as P, INSTALL_LABEL_MODES as Q, type InstallLabelMode as R, type InstallLabelsInput as S, InstallLabelsInputSchema as T, type InstallLabelsOutput as U, InstallLabelsOutputSchema as V, type IssueComment as W, IssueCommentSchema as X, type IssueDetail as Y, type IssueDetailInput as Z, IssueDetailInputSchema as _, type AddCommentInput as a, resolveCustomPillStatus as a$, IssueDetailOutputSchema as a0, IssueDetailSchema as a1, IssueNumberInput as a2, LABEL_ALIASES as a3, LEGACY_ATTENTION_LABELS as a4, LEGACY_PRIORITY_ORDER as a5, LEGACY_SPEC_LABELS as a6, LEGACY_STATE_ORDER as a7, type LabelDefinition as a8, type LabelSetPlan as a9, canonicalLabel as aA, composeFeatureModules as aB, createIssueContract as aC, currentPriorityLabel as aD, currentStateLabel as aE, deriveForgeAccess as aF, forgeCapabilityFromRepo as aG, forgeContextContract as aH, forgeWriteScopeList as aI, formatPillDisplay as aJ, isValidForgeTarget as aK, issueDetailContract as aL, liveScopesFromIssues as aM, liveScopesFromLabels as aN, nextStateLabel as aO, normalizeIssueNumber as aP, openIssuesContract as aQ, parseAgentEnvelope as aR, parseForgeRemote as aS, parseLabelList as aT, parseMarkdownLite as aU, parseMarkdownLiteInline as aV, parseNumericPillValue as aW, paseoLabelScopes as aX, paseoLabelSet as aY, planLabelSetInstall as aZ, rankIssues as a_, type MarkdownLiteBlock as aa, type MarkdownLiteSpan as ab, type OpenIssuesInput as ac, OpenIssuesInputSchema as ad, type OpenIssuesOutput as ae, OpenIssuesOutputSchema as af, PASEO_LABEL_SCOPES as ag, PASEO_LINK_PATTERN as ah, PASEO_SERVER_PATTERN as ai, PRIORITY_ORDER as aj, type PriorityLabel as ak, SHA_PATTERN as al, SPEC_LABELS as am, STATE_ORDER as an, type SearchIssuesInput as ao, SearchIssuesInputSchema as ap, type SearchIssuesOutput as aq, SearchIssuesOutputSchema as ar, type SetLabelInput as as, SetLabelInputSchema as at, type SetLabelOutput as au, SetLabelOutputSchema as av, type SpecLabel as aw, type StateLabel as ax, activeForgeForDirectory as ay, addCommentContract as az, AddCommentInputSchema as b, resolveForgeTarget as b0, sameLabel as b1, scopeOfLabel as b2, searchIssuesContract as b3, setLabelContract as b4, shortLabelName as b5, stripAgentEnvelopeFooter as b6, validateCreateIssueInput as b7, writeGateNotice as b8, type AddCommentOutput as c, AddCommentOutputSchema as d, type AgentEnvelope as e, AgentEnvelopeSchema as f, type AttentionLabel as g, CREATE_ISSUE_LABEL_MAX as h, CREATE_ISSUE_TITLE_MAX as i, type CreateIssueInput as j, CreateIssueInputSchema as k, type CreateIssueOutput as l, CreateIssueOutputSchema as m, type CustomPillDefinition as n, CustomPillDefinitionSchema as o, type CustomPillModal as p, CustomPillModalSchema as q, type CustomPillState as r, type CustomPillThresholds as s, CustomPillThresholdsSchema as t, type FeatureDisposer as u, type FeatureModule as v, type ForgeAccessInput as w, type ForgeAccessState as x, type ForgeAuthState as y, type ForgeContextInput as z };

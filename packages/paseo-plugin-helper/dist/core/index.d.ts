import { P as PluginRpcContract, R as RpcInput, a as RpcOutput } from '../rpc-D27pph91.js';
export { D as DefineRpcOptions, d as defineContract, b as defineRpc } from '../rpc-D27pph91.js';
export { A as ATTENTION_LABELS, a as AddCommentInput, b as AddCommentInputSchema, c as AddCommentOutput, d as AddCommentOutputSchema, e as AgentEnvelope, f as AgentEnvelopeSchema, g as AttentionLabel, B as BARE_REPO_PATTERN, C as CREATE_ISSUE_BODY_MAX, h as CREATE_ISSUE_LABEL_MAX, i as CREATE_ISSUE_TITLE_MAX, j as CreateIssueInput, k as CreateIssueInputSchema, l as CreateIssueOutput, m as CreateIssueOutputSchema, n as CustomPillDefinition, o as CustomPillDefinitionSchema, p as CustomPillModal, q as CustomPillModalSchema, r as CustomPillState, s as CustomPillThresholds, t as CustomPillThresholdsSchema, F as FeatureComposition, u as FeatureDisposer, v as FeatureModule, w as ForgeAccessInput, x as ForgeAccessState, y as ForgeAuthState, z as ForgeContextInput, D as ForgeContextInputSchema, E as ForgeContextOutput, G as ForgeContextOutputSchema, H as ForgeIssue, I as ForgeIssueSchema, J as ForgeLabel, K as ForgeLabelRef, L as ForgeLabelSchema, M as ForgeRemote, N as ForgeRepoIdentity, O as ForgeTargetResolution, P as ForgeVisibility, Q as INSTALL_LABEL_MODES, R as InstallLabelMode, S as InstallLabelsInput, T as InstallLabelsInputSchema, U as InstallLabelsOutput, V as InstallLabelsOutputSchema, W as IssueComment, X as IssueCommentSchema, Y as IssueDetail, Z as IssueDetailInput, _ as IssueDetailInputSchema, $ as IssueDetailOutput, a0 as IssueDetailOutputSchema, a1 as IssueDetailSchema, a2 as IssueNumberInput, a3 as LABEL_ALIASES, a4 as LEGACY_ATTENTION_LABELS, a5 as LEGACY_PRIORITY_ORDER, a6 as LEGACY_SPEC_LABELS, a7 as LEGACY_STATE_ORDER, a8 as LabelDefinition, a9 as LabelSetPlan, aa as MarkdownLiteBlock, ab as MarkdownLiteSpan, ac as OpenIssuesInput, ad as OpenIssuesInputSchema, ae as OpenIssuesOutput, af as OpenIssuesOutputSchema, ag as PASEO_LABEL_SCOPES, ah as PASEO_LINK_PATTERN, ai as PASEO_SERVER_PATTERN, aj as PRIORITY_ORDER, ak as PriorityLabel, al as SHA_PATTERN, am as SPEC_LABELS, an as STATE_ORDER, ao as SearchIssuesInput, ap as SearchIssuesInputSchema, aq as SearchIssuesOutput, ar as SearchIssuesOutputSchema, as as SetLabelInput, at as SetLabelInputSchema, au as SetLabelOutput, av as SetLabelOutputSchema, aw as SpecLabel, ax as StateLabel, ay as activeForgeForDirectory, az as addCommentContract, aA as canonicalLabel, aB as composeFeatureModules, aC as createIssueContract, aD as currentPriorityLabel, aE as currentStateLabel, aF as deriveForgeAccess, aG as forgeCapabilityFromRepo, aH as forgeContextContract, aI as forgeWriteScopeList, aJ as formatPillDisplay, aK as isValidForgeTarget, aL as issueDetailContract, aM as liveScopesFromIssues, aN as liveScopesFromLabels, aO as nextStateLabel, aP as normalizeIssueNumber, aQ as openIssuesContract, aR as parseAgentEnvelope, aS as parseForgeRemote, aT as parseLabelList, aU as parseMarkdownLite, aV as parseMarkdownLiteInline, aW as parseNumericPillValue, aX as paseoLabelScopes, aY as paseoLabelSet, aZ as planLabelSetInstall, a_ as rankIssues, a$ as resolveCustomPillStatus, b0 as resolveForgeTarget, b1 as sameLabel, b2 as scopeOfLabel, b3 as searchIssuesContract, b4 as setLabelContract, b5 as shortLabelName, b6 as stripAgentEnvelopeFooter, b7 as validateCreateIssueInput, b8 as writeGateNotice } from '../tickets-CQ2t2Y40.js';
import { S as SettingsContract } from '../settings-CP1gv9q3.js';
export { D as DefineSettingsContractOptions, a as SettingsEmptyInput, b as SettingsEmptyInputSchema, d as defineSettingsContract } from '../settings-CP1gv9q3.js';
import { SuiteSettings } from '../shared/index.js';
export { ForgeKind, ForgeMarkInput, HighlightOptions, HighlightPart, ResolvedForgeMark, SuiteSettingsContract, SuiteSettingsSchema, SuppressedSink, TimeoutError, createTimeoutError, forgeKindFromHost, forgeMarkSource, hasFuzzyHighlight, hasHighlightMatch, isForgeKind, isTimeoutError, normalizeForgeHost, normalizeSearchQuery, reportSuppressed, resolveForgeMark, splitHighlightParts, withTimeout } from '../shared/index.js';
export { F as FormatBytesOptions, a as FormatCompactNumberOptions, M as MetricThresholds, T as TruncateOptions, b as TruncatePathOptions, f as formatBytes, c as formatCompactNumber, d as formatDuration, e as formatNumber, g as formatUptime, r as resolveMetricStatus, s as stripAnsi, t as truncate, h as truncateMiddle, i as truncatePath } from '../formatters-Bv2wa1fZ.js';
export { a as PlatformType, P as PluginTheme, R as ResponsiveLayout, S as StatusVariant, T as ThemeColors } from '../types-4TBN5lgi.js';
export { C as ClientHostDeps, c as ComposerPillRegistrar, H as HostAgentRef, b as HostAgentUpdate, d as HostAgentsApi, e as HostCopyText, f as HostLayout, g as HostPillProps, h as HostRpcContract, a as HostSurfaceProps, i as HostTheme, j as HostThemeColors, k as HostToast, l as HostUseRpc, m as HostUseToast, P as PluginCleanup, n as getClientHost, o as getOptionalClientHost, p as initClientHelpers, q as isClientHostInitialized, s as selectHostScrollView } from '../host-D31sreow.js';
import { UseMutationOptions, UseQueryOptions, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import * as _tanstack_query_core from '@tanstack/query-core';
import * as React from 'react';
export { a as CommandCenterCapabilities, b as CommandCenterContext, C as CommandCenterItemContribution, c as CommandCenterItemRegistrar, r as registerCommandCenterItem } from '../command-center-DQU96J5s.js';
import 'zod';
import 'react-native';
import '@getpaseo/plugin/client';

type RpcQueryOptions<TOutput> = Omit<UseQueryOptions<TOutput, Error, TOutput, readonly unknown[]>, "queryKey" | "queryFn">;
/**
 * Executes a Paseo RPC contract as a cached, reactive React Query.
 * Automatically hashes contract name and input arguments into query keys.
 */
declare function useRpcQuery<TContract extends PluginRpcContract<any, any>, TInput = RpcInput<TContract>, TOutput = RpcOutput<TContract>>(contract: TContract, input: TInput, options?: RpcQueryOptions<TOutput>): UseQueryResult<TOutput, Error>;
type RpcMutationOptions<TInput, TOutput> = UseMutationOptions<TOutput, Error, TInput, unknown>;
/**
 * Executes a Paseo RPC contract as a mutation (for state changes, write operations).
 */
declare function useRpcMutation<TContract extends PluginRpcContract<any, any>, TInput = RpcInput<TContract>, TOutput = RpcOutput<TContract>>(contract: TContract, options?: RpcMutationOptions<TInput, TOutput>): UseMutationResult<TOutput, Error, TInput, unknown>;

type RefreshRate = "1s" | "2s" | "5s" | "10s" | "15s" | "30s" | "60s" | "5m" | "paused";
declare const REFRESH_INTERVALS: Record<RefreshRate, number | false>;
interface UseAutoRefreshQueryOptions<TOutput> extends RpcQueryOptions<TOutput> {
    defaultRate?: RefreshRate;
    /**
     * Custom interval in milliseconds (overrides preset rates when not paused).
     */
    customIntervalMs?: number;
    /**
     * Whether the containing modal or panel is actively open/visible.
     * If false, background refetching is automatically paused to conserve mobile CPU and battery.
     */
    isOpen?: boolean;
}
/**
 * Enhanced React Query hook for live polling metrics.
 * Automatically halts background polling when modal/panel is closed (`isOpen === false`),
 * and provides state controls for user-selectable refresh intervals ("1s", "5s", "30s", "paused", etc.).
 */
declare function useAutoRefreshQuery<TContract extends PluginRpcContract<any, any>, TInput = RpcInput<TContract>, TOutput = RpcOutput<TContract>>(contract: TContract, input: TInput, options?: UseAutoRefreshQueryOptions<TOutput>): {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: TOutput;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: true;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: TOutput;
    error: null;
    isError: false;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: false;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: undefined;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: true;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoading: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isLoading: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: TOutput;
    isError: false;
    error: null;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: true;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
};

interface UsePluginSettingsOptions<TSettings> {
    /**
     * Optional initial settings data. Defaults to `contract.defaultSettings`.
     */
    initialData?: TSettings;
    /**
     * Whether to automatically refetch settings when the window/app regains focus.
     * Defaults to true.
     */
    refetchOnWindowFocus?: boolean;
    /**
     * Stale time in milliseconds before settings are considered stale.
     * Defaults to 0 so that newly opened modals/components always verify fresh
     * state against the daemon without waiting.
     */
    staleTime?: number;
    /**
     * Whether to refetch settings every time a component mounts.
     * Defaults to "always".
     */
    refetchOnMount?: boolean | "always";
    /**
     * Optional background polling interval in milliseconds.
     * When specified, keeps multi-window and mobile/desktop clients automatically in sync.
     */
    refetchInterval?: number | false;
    /**
     * Callback invoked after a successful update.
     */
    onSuccess?: (updated: TSettings) => void;
    /**
     * Callback invoked when an update fails.
     */
    onError?: (error: Error, rollbackSettings?: TSettings) => void;
}
interface UsePluginSettingsResult<TSettings> {
    /**
     * Current settings object. Never undefined (falls back to initialData or contract.defaultSettings).
     */
    settings: TSettings;
    /**
     * Triggers an optimistic update and persists via RPC.
     */
    updateSettings: (updates: Partial<TSettings>) => void;
    /**
     * Async version of updateSettings that returns a promise of the updated settings.
     */
    updateSettingsAsync: (updates: Partial<TSettings>) => Promise<TSettings>;
    /**
     * Resets settings back to their default values.
     */
    resetSettings: () => Promise<TSettings>;
    /**
     * Whether the initial query is loading.
     */
    isLoading: boolean;
    /**
     * Whether an update mutation is currently in-flight.
     */
    isUpdating: boolean;
    /**
     * Whether the last query or mutation encountered an error.
     */
    isError: boolean;
    /**
     * Error object if any error occurred.
     */
    error: Error | null;
    /**
     * Refetches settings from the server.
     */
    refetch: () => Promise<unknown>;
}
/**
 * Reactive hook for managing plugin settings with optimistic updates,
 * error rollbacks, and automatic caching via React Query.
 */
declare function usePluginSettings<TSettings extends Record<string, any>>(contract: SettingsContract<TSettings>, options?: UsePluginSettingsOptions<TSettings>): UsePluginSettingsResult<TSettings>;

interface UseSharedPluginSettingsOptions<TSettings> extends UsePluginSettingsOptions<TSettings> {
    /**
     * Background polling interval keeping sibling plugins in sync when one of
     * them writes the shared file outside this client's RPC round-trip.
     * Defaults to 2000ms. Pass `false` to disable polling.
     */
    pollIntervalMs?: number | false;
}
/**
 * Reactive hook for suite-wide settings shared across independent sibling plugins.
 * Wraps usePluginSettings with sync-friendly defaults: always re-verifies on
 * mount and polls in the background so an update written by Plugin A appears
 * in Plugin B without a manual refresh.
 */
declare function useSharedPluginSettings<TSettings extends Record<string, any>>(contract: SettingsContract<TSettings>, options?: UseSharedPluginSettingsOptions<TSettings>): UsePluginSettingsResult<TSettings>;
/**
 * Convenience hook bound to the canonical xpufx suite settings contract.
 */
declare function useSuiteSettings(options?: UseSharedPluginSettingsOptions<SuiteSettings>): UsePluginSettingsResult<SuiteSettings>;

/**
 * Generic workspace-scoped shared snapshot helpers.
 *
 * When several surfaces (composer pill, modal, dashboard) render different
 * views of one host snapshot, they must share a single React Query cache
 * identity per workspace. Field-specific query keys fragment that cache and
 * let every visible pill start its own poller, so build one stable key per
 * workspace scope and keep selective server-side field collection out of the
 * client cache key.
 *
 * The no-op guards here keep settings listeners and live-label caches from
 * emitting redundant updates: React Query hands out fresh object identities
 * on every refetch, even when values are unchanged.
 */
/** Normalized workspace scope: trimmed directory, or "" for host-wide. */
declare function normalizeSnapshotScope(directory?: string | null): string;
/**
 * Stable shared cache key for one RPC snapshot in one workspace scope.
 * Scopes normalize so `undefined`, `null`, and `""` all map to the
 * host-wide entry instead of three separate caches.
 */
declare function sharedSnapshotKey(contractName: string, directory?: string | null): readonly [string, {
    directory?: string;
}];
/**
 * Shallow record equality for plain settings/snapshot objects.
 * Returns true when both sides hold the same keys with Object.is-equal
 * values. Nested objects compare by reference, which is enough to detect
 * refetch-fresh copies of unchanged flat settings.
 */
declare function shallowEqualRecord(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean;
/**
 * True when listeners should be notified: the snapshot reference changed
 * and its shallow contents differ. Suppresses the no-op fan-out that
 * otherwise fires on every background refetch.
 */
declare function shouldEmitSnapshotUpdate(prev: Record<string, unknown> | null | undefined, next: Record<string, unknown> | null | undefined): boolean;

export { PluginRpcContract, REFRESH_INTERVALS, type RefreshRate, RpcInput, type RpcMutationOptions, RpcOutput, type RpcQueryOptions, SettingsContract, SuiteSettings, type UseAutoRefreshQueryOptions, type UsePluginSettingsOptions, type UsePluginSettingsResult, type UseSharedPluginSettingsOptions, normalizeSnapshotScope, shallowEqualRecord, sharedSnapshotKey, shouldEmitSnapshotUpdate, useAutoRefreshQuery, usePluginSettings, useRpcMutation, useRpcQuery, useSharedPluginSettings, useSuiteSettings };

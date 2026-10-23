import { P as PluginRpcContract, R as RpcInput, a as RpcOutput } from '../rpc-D27pph91.cjs';
export { D as DefineRpcOptions, d as defineContract, b as defineRpc } from '../rpc-D27pph91.cjs';
export { A as ATTENTION_LABELS, a as AddCommentInput, b as AddCommentInputSchema, c as AddCommentOutput, d as AddCommentOutputSchema, e as AgentEnvelope, f as AgentEnvelopeSchema, g as AttentionLabel, B as BARE_REPO_PATTERN, C as CREATE_ISSUE_BODY_MAX, h as CREATE_ISSUE_LABEL_MAX, i as CREATE_ISSUE_TITLE_MAX, j as CreateIssueInput, k as CreateIssueInputSchema, l as CreateIssueOutput, m as CreateIssueOutputSchema, n as CustomPillDefinition, o as CustomPillDefinitionSchema, p as CustomPillModal, q as CustomPillModalSchema, r as CustomPillState, s as CustomPillThresholds, t as CustomPillThresholdsSchema, F as FeatureComposition, u as FeatureDependencyDeclaration, v as FeatureDependencyInput, w as FeatureDependencyMap, x as FeatureDependencyResolution, y as FeatureDependencyValidationError, z as FeatureDisposer, D as FeatureModule, E as ForgeAccessInput, G as ForgeAccessState, H as ForgeAuthState, I as ForgeContextInput, J as ForgeContextInputSchema, K as ForgeContextOutput, L as ForgeContextOutputSchema, M as ForgeIssue, N as ForgeIssueSchema, O as ForgeLabel, P as ForgeLabelRef, Q as ForgeLabelSchema, R as ForgeRemote, S as ForgeRepoIdentity, T as ForgeTargetResolution, U as ForgeVisibility, V as INSTALL_LABEL_MODES, W as InstallLabelMode, X as InstallLabelsInput, Y as InstallLabelsInputSchema, Z as InstallLabelsOutput, _ as InstallLabelsOutputSchema, $ as IssueComment, a0 as IssueCommentSchema, a1 as IssueDetail, a2 as IssueDetailInput, a3 as IssueDetailInputSchema, a4 as IssueDetailOutput, a5 as IssueDetailOutputSchema, a6 as IssueDetailSchema, a7 as IssueNumberInput, a8 as LABEL_ALIASES, a9 as LEGACY_ATTENTION_LABELS, aa as LEGACY_PRIORITY_ORDER, ab as LEGACY_SPEC_LABELS, ac as LEGACY_STATE_ORDER, ad as LabelDefinition, ae as LabelSetPlan, af as MarkdownLiteBlock, ag as MarkdownLiteSpan, ah as OpenIssuesInput, ai as OpenIssuesInputSchema, aj as OpenIssuesOutput, ak as OpenIssuesOutputSchema, al as PASEO_LABEL_SCOPES, am as PASEO_LINK_PATTERN, an as PASEO_SERVER_PATTERN, ao as PRIORITY_ORDER, ap as PriorityLabel, aq as ResolveFeatureDependenciesOptions, ar as ResolvedFeatureDependency, as as SHA_PATTERN, at as SPEC_LABELS, au as STATE_ORDER, av as SearchIssuesInput, aw as SearchIssuesInputSchema, ax as SearchIssuesOutput, ay as SearchIssuesOutputSchema, az as SetLabelInput, aA as SetLabelInputSchema, aB as SetLabelOutput, aC as SetLabelOutputSchema, aD as SpecLabel, aE as StateLabel, aF as activeForgeForDirectory, aG as addCommentContract, aH as canonicalLabel, aI as composeFeatureModules, aJ as createIssueContract, aK as currentPriorityLabel, aL as currentStateLabel, aM as deriveForgeAccess, aN as forgeCapabilityFromRepo, aO as forgeContextContract, aP as forgeWriteScopeList, aQ as formatPillDisplay, aR as isValidForgeTarget, aS as issueDetailContract, aT as liveScopesFromIssues, aU as liveScopesFromLabels, aV as nextStateLabel, aW as normalizeIssueNumber, aX as openIssuesContract, aY as parseAgentEnvelope, aZ as parseForgeRemote, a_ as parseLabelList, a$ as parseMarkdownLite, b0 as parseMarkdownLiteInline, b1 as parseNumericPillValue, b2 as paseoLabelScopes, b3 as paseoLabelSet, b4 as planLabelSetInstall, b5 as rankIssues, b6 as resolveCustomPillStatus, b7 as resolveFeatureDependencies, b8 as resolveForgeTarget, b9 as sameLabel, ba as scopeOfLabel, bb as searchIssuesContract, bc as setLabelContract, bd as shortLabelName, be as stripAgentEnvelopeFooter, bf as validateCreateIssueInput, bg as validateFeatureDependencies, bh as writeGateNotice } from '../tickets-BnvMaAO2.cjs';
import { S as SettingsContract } from '../settings-BNRcFeSP.cjs';
export { D as DefineSettingsContractOptions, a as SettingsEmptyInput, b as SettingsEmptyInputSchema, d as defineSettingsContract } from '../settings-BNRcFeSP.cjs';
import { SuiteSettings } from '../shared/index.cjs';
export { ForgeKind, ForgeMarkInput, HighlightOptions, HighlightPart, ResolvedForgeMark, SuiteSettingsContract, SuiteSettingsSchema, SuppressedSink, TimeoutError, createTimeoutError, forgeKindFromHost, forgeMarkSource, hasFuzzyHighlight, hasHighlightMatch, isForgeKind, isTimeoutError, normalizeForgeHost, normalizeSearchQuery, reportSuppressed, resolveForgeMark, splitHighlightParts, withTimeout } from '../shared/index.cjs';
export { F as FormatBytesOptions, a as FormatCompactNumberOptions, M as MetricThresholds, T as TruncateOptions, b as TruncatePathOptions, f as formatBytes, c as formatCompactNumber, d as formatDuration, e as formatNumber, g as formatUptime, r as resolveMetricStatus, s as stripAnsi, t as truncate, h as truncateMiddle, i as truncatePath } from '../formatters-CtC4syDt.cjs';
export { a as PlatformType, P as PluginTheme, R as ResponsiveLayout, S as StatusVariant, T as ThemeColors } from '../types-4TBN5lgi.cjs';
export { C as ClientHostDeps, c as ComposerPillRegistrar, H as HostAgentRef, b as HostAgentUpdate, d as HostAgentsApi, e as HostCopyText, f as HostLayout, g as HostPillProps, h as HostRpcContract, a as HostSurfaceProps, i as HostTheme, j as HostThemeColors, k as HostToast, l as HostUseRpc, m as HostUseToast, P as PluginCleanup, n as getClientHost, o as getOptionalClientHost, p as initClientHelpers, q as isClientHostInitialized, s as selectHostScrollView } from '../host-D31sreow.cjs';
import { UseMutationOptions, UseQueryOptions, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import * as _tanstack_query_core from '@tanstack/query-core';
import * as React from 'react';
export { a as CommandCenterCapabilities, b as CommandCenterContext, C as CommandCenterItemContribution, c as CommandCenterItemRegistrar, r as registerCommandCenterItem } from '../command-center-CWeeXQoh.cjs';
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

/**
 * Paseo Plugin Helper — Bundle Re-Evaluation Tracking (`paseo-plugin-helper/core`).
 *
 * Tracks how many times each plugin bundle has been re-evaluated by the host
 * daemon.  Useful for detecting hot-reload / reload cycles so plugins can
 * surface a notice to the user.
 *
 * Contract — headless & client-safe:
 * - No `node:*` imports.
 * - No React Native or DOM scraping.
 * - The only React dependency is the exported hook (used inside React trees).
 */
declare global {
    var __PASEO_PLUGIN_LOAD_COUNT__: Record<string, number>;
}
/**
 * Increment and return the load count for *pluginId*.
 *
 * Call this from your plugin's entry-point (or wherever the bundle first
 * executes) so the daemon-side reload counter advances on every evaluation.
 */
declare function bumpPluginLoadCount(pluginId: string): number;
/**
 * Return the current load count for *pluginId* (0 if never bumped).
 */
declare function getPluginLoadCount(pluginId: string): number;
/**
 * Return `true` when the plugin has been reloaded at least once
 * (i.e. load count > 1).
 */
declare function isPluginReloaded(pluginId: string): boolean;
interface PluginReloadNoticeState {
    /** Whether the plugin was reloaded (load count > 1). */
    isReloaded: boolean;
    /** Current load count for the plugin. */
    loadCount: number;
    /** Dismiss the reload notice locally. */
    dismiss: () => void;
}
/**
 * React hook that tracks whether a plugin bundle was reloaded.
 *
 * ```ts
 * const { isReloaded, loadCount, dismiss } = usePluginReloadNotice("my-plugin");
 * ```
 *
 * The `dismiss` callback toggles local state only — it does not affect the
 * global counter.
 */
declare function usePluginReloadNotice(pluginId: string): PluginReloadNoticeState;

/**
 * Paseo Plugin Helper — Global Reload Bus (`paseo-plugin-helper/core`).
 *
 * Centralizes plugin and daemon reload notifications into a debounced,
 * coalesced global toast dispatcher. Prevents notification storms when
 * multiple plugins or daemon rebuilds reload concurrently.
 *
 * Contract — headless & client-safe:
 * - No `node:*` imports.
 * - No React Native or DOM scraping.
 * - Toast delivery delegates to host toast provider via `getOptionalClientHost()?.useToast()`
 *   or `globalThis.__PASEO_HOST__?.toast`.
 */
declare const DEFAULT_RELOAD_DEBOUNCE_MS = 500;
declare const DEFAULT_RELOAD_QUENCH_MS = 5000;
interface ReloadToastAction {
    label: string;
    onClick: () => void;
}
interface ReloadToastOptions {
    duration?: number;
    action?: ReloadToastAction;
    [key: string]: unknown;
}
interface NotifyPluginReloadOptions {
    /**
     * If true, unconditionally enqueues the reload notification even on the
     * initial bundle evaluation (load count <= 1). Useful for manual testing or
     * explicit reload triggers.
     */
    force?: boolean;
    /** Custom debounce window in milliseconds (default: 500ms). */
    debounceMs?: number;
    /** Custom quench cooldown window in milliseconds (default: 5000ms). */
    quenchMs?: number;
}
interface ReloadBusState {
    pendingPlugins: Set<string>;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    lastToastTime: number;
}
declare global {
    var __PASEO_RELOAD_BUS__: ReloadBusState | undefined;
}
/**
 * Deliver a reload toast notification to the host client.
 * Tries `globalThis.__PASEO_HOST__?.toast`, then `getOptionalClientHost()?.useToast()`,
 * falling back to `console.info` if no host toast is available.
 */
declare function deliverReloadToast(message: string, customOptions?: ReloadToastOptions): boolean;
/**
 * Format a human-readable reload toast message for a list of reloaded plugin IDs.
 */
declare function formatReloadMessage(plugins: string[]): string;
/**
 * Immediately flush any pending reload notifications, delivering the coalesced toast.
 */
declare function flushReloadBusNow(options?: {
    quenchMs?: number;
}): boolean;
/**
 * Directly enqueue a plugin ID into the reload debounce queue.
 */
declare function enqueuePluginReload(pluginId: string, options?: NotifyPluginReloadOptions): void;
/**
 * Notify that a plugin was evaluated.
 *
 * Increments the plugin load counter. If the plugin has been reloaded (load count > 1)
 * or if `options.force` is true, queues a debounced, storm-coalesced toast notification.
 */
declare function notifyPluginReload(pluginId: string, options?: NotifyPluginReloadOptions): boolean;
/**
 * Reset the global reload bus state (clears pending queue, timer, and quench timestamp).
 * Useful for test isolation and teardown.
 */
declare function resetReloadBus(): void;
/**
 * Return a copy of currently pending plugin IDs awaiting debounce flush.
 */
declare function getPendingReloadPlugins(): string[];
/**
 * Return the timestamp of the last delivered reload toast.
 */
declare function getLastReloadToastTime(): number;

export { DEFAULT_RELOAD_DEBOUNCE_MS, DEFAULT_RELOAD_QUENCH_MS, type NotifyPluginReloadOptions, type PluginReloadNoticeState, PluginRpcContract, REFRESH_INTERVALS, type RefreshRate, type ReloadBusState, type ReloadToastAction, type ReloadToastOptions, RpcInput, type RpcMutationOptions, RpcOutput, type RpcQueryOptions, SettingsContract, SuiteSettings, type UseAutoRefreshQueryOptions, type UsePluginSettingsOptions, type UsePluginSettingsResult, type UseSharedPluginSettingsOptions, bumpPluginLoadCount, deliverReloadToast, enqueuePluginReload, flushReloadBusNow, formatReloadMessage, getLastReloadToastTime, getPendingReloadPlugins, getPluginLoadCount, isPluginReloaded, normalizeSnapshotScope, notifyPluginReload, resetReloadBus, shallowEqualRecord, sharedSnapshotKey, shouldEmitSnapshotUpdate, useAutoRefreshQuery, usePluginReloadNotice, usePluginSettings, useRpcMutation, useRpcQuery, useSharedPluginSettings, useSuiteSettings };

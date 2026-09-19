import * as _tanstack_query_core from '@tanstack/query-core';
import * as React from 'react';
import { P as PluginRpcContract, R as RpcInput, a as RpcOutput } from './rpc-D27pph91.js';
import { UseMutationOptions, UseQueryOptions, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { S as SettingsContract } from './settings-CP1gv9q3.js';
import { S as SuiteSettings } from './forge-BMhLnv9s.js';

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

export { REFRESH_INTERVALS as R, type UseAutoRefreshQueryOptions as U, type RefreshRate as a, type RpcMutationOptions as b, type RpcQueryOptions as c, type UsePluginSettingsOptions as d, type UsePluginSettingsResult as e, type UseSharedPluginSettingsOptions as f, sharedSnapshotKey as g, shouldEmitSnapshotUpdate as h, usePluginSettings as i, useRpcMutation as j, useRpcQuery as k, useSharedPluginSettings as l, useSuiteSettings as m, normalizeSnapshotScope as n, shallowEqualRecord as s, useAutoRefreshQuery as u };

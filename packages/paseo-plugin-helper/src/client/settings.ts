import { getClientHost } from "./host.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SettingsContract } from "../shared/settings.js";

export interface UsePluginSettingsOptions<TSettings> {
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

export interface UsePluginSettingsResult<TSettings> {
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
export function usePluginSettings<TSettings extends Record<string, any>>(
  contract: SettingsContract<TSettings>,
  options: UsePluginSettingsOptions<TSettings> = {},
): UsePluginSettingsResult<TSettings> {
  const { useRpc } = getClientHost();
  const queryClient = useQueryClient();
  const queryKey = ["plugin-settings", contract.name] as const;

  const callGet = useRpc(contract.get);
  const callUpdate = useRpc(contract.update);
  const callReset = useRpc(contract.reset);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await callGet({} as any);
      return res as TSettings;
    },
    // Use placeholderData so UI displays immediately without marking the cache as fresh forever
    placeholderData: (options.initialData ?? contract.defaultSettings) as any,
    // Ensure newly mounted components (e.g. Opening modal) immediately re-verify from daemon
    staleTime: options.staleTime ?? 0,
    refetchOnMount: options.refetchOnMount ?? "always",
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? true,
    refetchInterval: options.refetchInterval,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<TSettings>) => {
      const res = await callUpdate(updates as any);
      return res as TSettings;
    },
    onMutate: async (newUpdates: Partial<TSettings>) => {
      await queryClient.cancelQueries({ queryKey });
      const previousSettings =
        queryClient.getQueryData<TSettings>(queryKey) ?? contract.defaultSettings;

      const optimistic: TSettings = {
        ...previousSettings,
        ...newUpdates,
      };

      queryClient.setQueryData<TSettings>(queryKey, optimistic);
      return { previousSettings };
    },
    onError: (err: unknown, _newUpdates, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKey, context.previousSettings);
      }
      const error = err instanceof Error ? err : new Error(String(err));
      options.onError?.(error, context?.previousSettings);
    },
    onSuccess: (data: TSettings) => {
      queryClient.setQueryData(queryKey, data);
      options.onSuccess?.(data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await callReset({} as any);
      return res as TSettings;
    },
    onSuccess: (data: TSettings) => {
      queryClient.setQueryData(queryKey, data);
      options.onSuccess?.(data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const settings: TSettings = query.data ?? options.initialData ?? contract.defaultSettings;

  return {
    settings,
    updateSettings: (updates: Partial<TSettings>) => {
      updateMutation.mutate(updates);
    },
    updateSettingsAsync: (updates: Partial<TSettings>) => {
      return updateMutation.mutateAsync(updates);
    },
    resetSettings: () => {
      return resetMutation.mutateAsync();
    },
    isLoading: query.isLoading,
    isUpdating: updateMutation.isPending || resetMutation.isPending,
    isError: query.isError || updateMutation.isError || resetMutation.isError,
    error:
      (query.error as Error | null) ||
      (updateMutation.error as Error | null) ||
      (resetMutation.error as Error | null),
    refetch: () => query.refetch(),
  };
}

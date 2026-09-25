import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { input as ZodInput, output as ZodOutput } from "zod";

/**
 * Thin data layer over the daemon RPC bridge.
 *
 * The shared plugin helper ships equivalents, but #629 explicitly lifts the
 * constraint of being bound to it — and pulling in the helper's *client* entry
 * for four hooks would drag its component tree in behind it. These are the
 * same semantics (query key is `[contract.name, input]`) over `useRpc` directly.
 */

/**
 * What a caller may send: the pre-parse side of the input schema.
 */
export type RpcInput<T> = T extends PluginRpcContract<infer I, any> ? ZodInput<I> : unknown;

/**
 * What a caller gets back: the host validates the RPC response against the
 * contract before handing it over, so this is the *parsed* side. Declared as
 * the pre-parse side it would mark every defaulted field optional and push
 * `?? 0` noise into every view.
 */
export type RpcOutput<T> = T extends PluginRpcContract<any, infer O> ? ZodOutput<O> : unknown;

export interface RpcQueryOptions<T> {
  refetchInterval?: number | false;
  enabled?: boolean;
  staleTime?: number;
  select?: (data: T) => unknown;
}

export function useRpcQuery<TContract extends PluginRpcContract<any, any>>(
  contract: TContract,
  input: RpcInput<TContract>,
  options: RpcQueryOptions<RpcOutput<TContract>> = {},
): UseQueryResult<RpcOutput<TContract>, Error> {
  const callRpc = useRpc(contract);
  const key = useMemo(() => JSON.stringify(input ?? {}), [input]);
  return useQuery({
    queryKey: [contract.name, key],
    queryFn: () => callRpc(input as never) as Promise<RpcOutput<TContract>>,
    refetchInterval: options.refetchInterval ?? false,
    enabled: options.enabled ?? true,
    staleTime: options.staleTime,
  }) as UseQueryResult<RpcOutput<TContract>, Error>;
}

export function useRpcMutation<TContract extends PluginRpcContract<any, any>>(
  contract: TContract,
): UseMutationResult<RpcOutput<TContract>, Error, RpcInput<TContract>> {
  const callRpc = useRpc(contract);
  return useMutation({
    mutationFn: (input: RpcInput<TContract>) => callRpc(input as never) as Promise<RpcOutput<TContract>>,
  }) as UseMutationResult<RpcOutput<TContract>, Error, RpcInput<TContract>>;
}

/** Invalidates every cached query for a contract after a mutation lands. */
export function useInvalidate(contract: PluginRpcContract<any, any>) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [contract.name] });
}

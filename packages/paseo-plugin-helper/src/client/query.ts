import { getClientHost, type HostRpcContract } from "./host.js";
import type { PluginRpcContract } from "../shared/rpc.js";
import type { RpcInput, RpcOutput } from "../shared/rpc.js";
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";

export type RpcQueryOptions<TOutput> = Omit<
  UseQueryOptions<TOutput, Error, TOutput, readonly unknown[]>,
  "queryKey" | "queryFn"
>;

/**
 * Executes a Paseo RPC contract as a cached, reactive React Query.
 * Automatically hashes contract name and input arguments into query keys.
 */
export function useRpcQuery<
  TContract extends PluginRpcContract<any, any>,
  TInput = RpcInput<TContract>,
  TOutput = RpcOutput<TContract>,
>(
  contract: TContract,
  input: TInput,
  options?: RpcQueryOptions<TOutput>,
): UseQueryResult<TOutput, Error> {
  const { useRpc } = getClientHost();
  const callRpc = useRpc(contract);

  return useQuery({
    queryKey: [contract.name, input],
    queryFn: () => callRpc(input),
    ...options,
  });
}

export type RpcMutationOptions<TInput, TOutput> = UseMutationOptions<
  TOutput,
  Error,
  TInput,
  unknown
>;

/**
 * Executes a Paseo RPC contract as a mutation (for state changes, write operations).
 */
export function useRpcMutation<
  TContract extends PluginRpcContract<any, any>,
  TInput = RpcInput<TContract>,
  TOutput = RpcOutput<TContract>,
>(
  contract: TContract,
  options?: RpcMutationOptions<TInput, TOutput>,
): UseMutationResult<TOutput, Error, TInput, unknown> {
  const { useRpc } = getClientHost();
  const callRpc = useRpc(contract);

  return useMutation({
    mutationFn: (input: TInput) => callRpc(input),
    ...options,
  });
}

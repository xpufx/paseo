import type { PluginRpcContract, RpcInput, RpcOutput } from "../shared/rpc.js";

export type MockRpcHandler = (input: any, context: any) => Promise<any> | any;

export interface MockServerContext {
  handle(contract: { name: string }, handler: MockRpcHandler): void;
  registerSettings(definition: unknown): void;
  registerProvider(provider: unknown): void;
  on(name: string, handler: (...args: any[]) => void | Promise<void>): () => void;
  before(name: string, handler: (...args: any[]) => unknown): () => void;
  handlers: Map<string, MockRpcHandler>;
  callRpc: <TContract extends PluginRpcContract<any, any>>(
    contract: TContract,
    input: RpcInput<TContract>,
  ) => Promise<RpcOutput<TContract>>;
}

/**
 * Creates a mock server context for testing server RPC handlers and plugin
 * contributions. Implements the structural handler shape shared by the Paseo
 * v0.7 and v0.8 server contexts without importing any SDK module.
 */
export function createMockServerContext(): MockServerContext {
  const handlers = new Map<string, MockRpcHandler>();
  const noopCleanup = () => {};

  const mock: MockServerContext = {
    handlers,

    handle(contract, handler) {
      handlers.set(contract.name, handler as MockRpcHandler);
    },

    registerSettings() {},
    registerProvider() {},
    on: () => noopCleanup,
    before: () => noopCleanup,

    async callRpc(contract, input) {
      const handler = handlers.get(contract.name);
      if (!handler) {
        throw new Error(`RPC handler for contract "${contract.name}" was not registered.`);
      }
      return handler(input, { paseo: {} as any });
    },
  };

  return mock;
}

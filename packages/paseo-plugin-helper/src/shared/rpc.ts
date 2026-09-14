import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

export interface PluginRpcContract<
  InputSchema extends ZodType = ZodType,
  OutputSchema extends ZodType = ZodType,
> {
  name: string;
  input: InputSchema;
  output: OutputSchema;
}

const RPC_NAME = /^[a-z][a-z0-9._-]*$/;

/**
 * Define a typed Paseo RPC contract conforming to the Paseo RPC protocol.
 * Implemented locally without a runtime dependency on the Paseo SDK.
 */
export function defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
  definition: { name: string; input: InputSchema; output: OutputSchema },
): PluginRpcContract<InputSchema, OutputSchema> {
  const name = definition.name.trim();
  if (!RPC_NAME.test(name)) {
    throw new Error(`Invalid plugin RPC method: ${definition.name}`);
  }
  return { ...definition, name };
}

export type RpcInput<TContract> = TContract extends PluginRpcContract<infer TInput, any>
  ? ZodInput<TInput>
  : unknown;

export type RpcOutput<TContract> = TContract extends PluginRpcContract<any, infer TOutput>
  ? ZodOutput<TOutput>
  : unknown;

export interface DefineRpcOptions<
  TName extends string = string,
  TInput extends ZodType = ZodType,
  TOutput extends ZodType = ZodType,
> {
  name: TName;
  input: TInput;
  output: TOutput;
  description?: string;
}

/**
 * Enhanced helper for defining a typed Paseo RPC contract with optional description.
 */
export function defineContract<
  TName extends string,
  TInput extends ZodType,
  TOutput extends ZodType,
>(
  options: DefineRpcOptions<TName, TInput, TOutput>,
): PluginRpcContract<TInput, TOutput> & { readonly description?: string } {
  const contract = defineRpc({
    name: options.name,
    input: options.input,
    output: options.output,
  });

  if (options.description) {
    Object.defineProperty(contract, "description", {
      value: options.description,
      enumerable: true,
      writable: false,
    });
  }

  return contract as PluginRpcContract<TInput, TOutput> & { readonly description?: string };
}

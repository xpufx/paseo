import { ZodType, input, output } from 'zod';

interface PluginRpcContract<InputSchema extends ZodType = ZodType, OutputSchema extends ZodType = ZodType> {
    name: string;
    input: InputSchema;
    output: OutputSchema;
}
/**
 * Define a typed Paseo RPC contract conforming to the Paseo RPC protocol.
 * Implemented locally without a runtime dependency on the Paseo SDK.
 */
declare function defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(definition: {
    name: string;
    input: InputSchema;
    output: OutputSchema;
}): PluginRpcContract<InputSchema, OutputSchema>;
type RpcInput<TContract> = TContract extends PluginRpcContract<infer TInput, any> ? input<TInput> : unknown;
type RpcOutput<TContract> = TContract extends PluginRpcContract<any, infer TOutput> ? output<TOutput> : unknown;
interface DefineRpcOptions<TName extends string = string, TInput extends ZodType = ZodType, TOutput extends ZodType = ZodType> {
    name: TName;
    input: TInput;
    output: TOutput;
    description?: string;
}
/**
 * Enhanced helper for defining a typed Paseo RPC contract with optional description.
 */
declare function defineContract<TName extends string, TInput extends ZodType, TOutput extends ZodType>(options: DefineRpcOptions<TName, TInput, TOutput>): PluginRpcContract<TInput, TOutput> & {
    readonly description?: string;
};

export { type DefineRpcOptions as D, type PluginRpcContract as P, type RpcInput as R, type RpcOutput as a, defineRpc as b, defineContract as d };

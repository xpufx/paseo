import { ZodType, z } from 'zod';
import { P as PluginRpcContract } from './rpc-D27pph91.cjs';

declare const SettingsEmptyInputSchema: z.ZodOptional<z.ZodUnion<readonly [z.ZodVoid, z.ZodRecord<z.ZodString, z.ZodUnknown>]>>;
type SettingsEmptyInput = z.infer<typeof SettingsEmptyInputSchema>;
interface SettingsContract<TSettings extends Record<string, any>> {
    readonly name: string;
    readonly schema: ZodType<TSettings>;
    readonly defaultSettings: TSettings;
    readonly get: PluginRpcContract<ZodType<SettingsEmptyInput>, ZodType<TSettings>>;
    readonly update: PluginRpcContract<ZodType<Partial<TSettings>>, ZodType<TSettings>>;
    readonly reset: PluginRpcContract<ZodType<SettingsEmptyInput>, ZodType<TSettings>>;
    readonly description?: string;
}
interface DefineSettingsContractOptions<TSettings extends Record<string, any>> {
    /**
     * Unique name for the settings domain (e.g. "top.settings" or "myplugin.config").
     * Automatically normalizes invalid RPC characters.
     */
    name: string;
    /**
     * Zod Object schema representing the full settings shape.
     * Use `.default(...)` on fields to provide default values.
     */
    schema: ZodType<TSettings> & {
        partial?: () => ZodType<Partial<TSettings>>;
    };
    /**
     * Optional default data override if schema fields do not all specify `.default()`.
     */
    defaultData?: Partial<TSettings>;
    /**
     * Optional human-readable description of the settings.
     */
    description?: string;
}
/**
 * Defines a pair of typed Paseo RPC contracts (get, update, reset) for plugin settings.
 */
declare function defineSettingsContract<TSettings extends Record<string, any>>(options: DefineSettingsContractOptions<TSettings>): SettingsContract<TSettings>;

export { type DefineSettingsContractOptions as D, type SettingsContract as S, type SettingsEmptyInput as a, SettingsEmptyInputSchema as b, defineSettingsContract as d };

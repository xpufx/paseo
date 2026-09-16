import { ZodType, z } from 'zod';
import { P as PluginRpcContract } from './rpc-D27pph91.js';

/**
 * Structural theme types for Paseo plugins.
 *
 * These interfaces mirror the Paseo host theme shapes without importing any
 * Paseo SDK module, so `paseo-plugin-helper/shared` (and everything
 * built on it) typechecks and bundles identically against Paseo v0.7 and
 * Paseo v0.8 SDKs.
 */
interface ThemeColors {
    readonly surface0: string;
    readonly surface1: string;
    readonly surface2: string;
    readonly border: string;
    readonly foreground: string;
    readonly foregroundMuted: string;
    readonly accent: string;
    readonly accentForeground: string;
    readonly statusSuccess: string;
    readonly statusWarning: string;
    readonly statusDanger: string;
}
interface PluginTheme {
    readonly colors: ThemeColors;
}
type PlatformType = "ios" | "android" | "web";
interface ResponsiveLayout {
    compact: boolean;
    platform: PlatformType;
    width?: number;
    height?: number;
}
type StatusVariant = "neutral" | "success" | "warning" | "danger" | "accent" | "info";

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

declare const CustomPillThresholdsSchema: z.ZodObject<{
    warning: z.ZodOptional<z.ZodNumber>;
    danger: z.ZodOptional<z.ZodNumber>;
    invert: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
declare const CustomPillModalSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
    preformatted: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
declare const CustomPillDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    compactTitle: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodString>;
    compactIcon: z.ZodOptional<z.ZodString>;
    command: z.ZodString;
    prefix: z.ZodOptional<z.ZodString>;
    suffix: z.ZodOptional<z.ZodString>;
    intervalMs: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    thresholds: z.ZodOptional<z.ZodObject<{
        warning: z.ZodOptional<z.ZodNumber>;
        danger: z.ZodOptional<z.ZodNumber>;
        invert: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    modal: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        command: z.ZodOptional<z.ZodString>;
        preformatted: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    sourceFile: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type CustomPillDefinition = z.infer<typeof CustomPillDefinitionSchema>;
type CustomPillThresholds = z.infer<typeof CustomPillThresholdsSchema>;
type CustomPillModal = z.infer<typeof CustomPillModalSchema>;
interface CustomPillState {
    id: string;
    title: string;
    compactTitle?: string;
    icon?: string;
    compactIcon?: string;
    rawValue: string;
    displayValue: string;
    numericValue?: number;
    status: StatusVariant;
    lastUpdated: number;
    error?: string;
    sourceFile?: string;
    modalTitle?: string;
    modalDescription?: string;
    modalOutput?: string;
    modalError?: string;
    modalLastUpdated?: number;
}
/**
 * Extracts a numeric value from the raw command output string (e.g. "45.2%" -> 45.2).
 */
declare function parseNumericPillValue(rawValue: string): number | undefined;
/**
 * Resolves the status variant based on numeric value and thresholds.
 */
declare function resolveCustomPillStatus(numericValue: number | undefined, thresholds?: CustomPillThresholds): StatusVariant;
/**
 * Formats the raw output string with optional prefix and suffix.
 */
declare function formatPillDisplay(rawValue: string, prefix?: string, suffix?: string): string;

export { type CustomPillDefinition as C, type DefineSettingsContractOptions as D, type PlatformType as P, type ResponsiveLayout as R, type StatusVariant as S, type ThemeColors as T, type SettingsContract as a, type CustomPillState as b, type PluginTheme as c, CustomPillDefinitionSchema as d, type CustomPillModal as e, CustomPillModalSchema as f, type CustomPillThresholds as g, CustomPillThresholdsSchema as h, type SettingsEmptyInput as i, SettingsEmptyInputSchema as j, defineSettingsContract as k, formatPillDisplay as l, parseNumericPillValue as p, resolveCustomPillStatus as r };

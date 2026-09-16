export { C as CustomPillDefinition, d as CustomPillDefinitionSchema, e as CustomPillModal, f as CustomPillModalSchema, b as CustomPillState, g as CustomPillThresholds, h as CustomPillThresholdsSchema, D as DefineSettingsContractOptions, P as PlatformType, c as PluginTheme, R as ResponsiveLayout, a as SettingsContract, i as SettingsEmptyInput, j as SettingsEmptyInputSchema, S as StatusVariant, T as ThemeColors, k as defineSettingsContract, l as formatPillDisplay, p as parseNumericPillValue, r as resolveCustomPillStatus } from '../custom-pills-CnrXjVIR.cjs';
export { D as DefineRpcOptions, P as PluginRpcContract, R as RpcInput, a as RpcOutput, d as defineContract, b as defineRpc } from '../rpc-D27pph91.cjs';
export { a as ForgeKind, F as ForgeMarkInput, b as FormatBytesOptions, c as FormatCompactNumberOptions, M as MetricThresholds, R as ResolvedForgeMark, S as SuiteSettings, d as SuiteSettingsContract, e as SuiteSettingsSchema, g as TruncateOptions, T as TruncatePathOptions, f as forgeKindFromHost, h as formatBytes, j as formatCompactNumber, k as formatDuration, l as formatNumber, m as formatUptime, i as isForgeKind, n as normalizeForgeHost, r as resolveForgeMark, o as resolveMetricStatus, s as stripAnsi, t as truncate, p as truncateMiddle, q as truncatePath } from '../forge-SA-2lJ8A.cjs';
import 'zod';

declare class TimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(message: string, timeoutMs: number);
}
/**
 * Races a promise against a timeout duration in milliseconds.
 * If the timeout expires before the promise resolves, rejects with a TimeoutError.
 * Automatically cleans up the timer on resolution or rejection.
 */
declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label?: string): Promise<T>;

interface SuppressedSink {
    debug?(message: string, data?: unknown): void;
    warn?(message: string, data?: unknown): void;
}
/**
 * Surfaces a caught/suppressed error to the plugin log at debug level
 * (warn when `level: "warn"`). Fire-and-forget `catch(() => undefined)`
 * sites should route through here so `paseo plugin logs` shows them
 * when dev debug logging is enabled.
 */
declare function reportSuppressed(sink: Pick<SuppressedSink, "debug" | "warn"> | undefined, context: string, error: unknown, level?: "debug" | "warn"): void;

export { type SuppressedSink, TimeoutError, reportSuppressed, withTimeout };

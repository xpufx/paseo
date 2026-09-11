export { C as CustomPillDefinition, d as CustomPillDefinitionSchema, e as CustomPillModal, f as CustomPillModalSchema, b as CustomPillState, g as CustomPillThresholds, h as CustomPillThresholdsSchema, D as DefineSettingsContractOptions, P as PlatformType, c as PluginTheme, R as ResponsiveLayout, a as SettingsContract, i as SettingsEmptyInput, j as SettingsEmptyInputSchema, S as StatusVariant, T as ThemeColors, k as defineSettingsContract, l as formatPillDisplay, p as parseNumericPillValue, r as resolveCustomPillStatus } from '../custom-pills-BRMMkgfE.js';
export { D as DefineRpcOptions, P as PluginRpcContract, R as RpcInput, a as RpcOutput, d as defineContract, b as defineRpc } from '../rpc-D27pph91.js';
export { F as FormatBytesOptions, M as MetricThresholds, f as formatBytes, a as formatDuration, b as formatNumber, c as formatUptime, r as resolveMetricStatus, s as stripAnsi, t as truncate } from '../formatters-BtMZotvg.js';
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

export { TimeoutError, withTimeout };

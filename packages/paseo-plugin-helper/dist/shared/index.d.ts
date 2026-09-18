export { C as CustomPillDefinition, a as CustomPillDefinitionSchema, b as CustomPillModal, c as CustomPillModalSchema, d as CustomPillState, e as CustomPillThresholds, f as CustomPillThresholdsSchema, P as PlatformType, g as PluginTheme, R as ResponsiveLayout, S as StatusVariant, T as ThemeColors, h as formatPillDisplay, p as parseNumericPillValue, r as resolveCustomPillStatus } from '../custom-pills-C98QP7Cg.js';
export { D as DefineRpcOptions, P as PluginRpcContract, R as RpcInput, a as RpcOutput, d as defineContract, b as defineRpc } from '../rpc-D27pph91.js';
export { F as ForgeKind, a as ForgeMarkInput, b as FormatBytesOptions, c as FormatCompactNumberOptions, M as MetricThresholds, R as ResolvedForgeMark, S as SuiteSettings, d as SuiteSettingsContract, e as SuiteSettingsSchema, T as TruncateOptions, f as TruncatePathOptions, g as forgeKindFromHost, h as formatBytes, i as formatCompactNumber, j as formatDuration, k as formatNumber, l as formatUptime, m as isForgeKind, n as normalizeForgeHost, r as resolveForgeMark, o as resolveMetricStatus, s as stripAnsi, t as truncate, p as truncateMiddle, q as truncatePath } from '../forge-BMhLnv9s.js';
export { D as DefineSettingsContractOptions, S as SettingsContract, a as SettingsEmptyInput, b as SettingsEmptyInputSchema, d as defineSettingsContract } from '../settings-CP1gv9q3.js';
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

/**
 * Text-run splitting for search highlighting, shared by every helper surface
 * that paints matched query text. The query is matched literally via
 * `indexOf` on lowercased strings — never compiled as a regular expression — so
 * user input cannot inject a pattern.
 */
interface HighlightPart {
    /** The run's source text, in its original casing. */
    text: string;
    /** True when this run is an occurrence of the (trimmed) query. */
    matched: boolean;
}
/**
 * Split `text` into alternating unmatched/matched runs for every
 * case-insensitive, non-overlapping occurrence of `query`. Surrounding
 * whitespace on the query is ignored; an empty or whitespace-only query (or
 * empty text) yields the whole text as a single unmatched run.
 */
declare function splitHighlightParts(text: string, query: string): HighlightPart[];
/** Whether `text` contains at least one occurrence of the trimmed `query`. */
declare function hasHighlightMatch(text: string, query: string): boolean;

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

export { type HighlightPart, type SuppressedSink, TimeoutError, hasHighlightMatch, reportSuppressed, splitHighlightParts, withTimeout };

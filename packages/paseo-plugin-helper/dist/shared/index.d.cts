export { C as CustomPillDefinition, a as CustomPillDefinitionSchema, b as CustomPillModal, c as CustomPillModalSchema, d as CustomPillState, e as CustomPillThresholds, f as CustomPillThresholdsSchema, P as PlatformType, g as PluginTheme, R as ResponsiveLayout, S as StatusVariant, T as ThemeColors, h as formatPillDisplay, p as parseNumericPillValue, r as resolveCustomPillStatus } from '../custom-pills-C98QP7Cg.cjs';
export { D as DefineRpcOptions, P as PluginRpcContract, R as RpcInput, a as RpcOutput, d as defineContract, b as defineRpc } from '../rpc-D27pph91.cjs';
export { F as ForgeKind, a as ForgeMarkInput, b as FormatBytesOptions, c as FormatCompactNumberOptions, M as MetricThresholds, R as ResolvedForgeMark, S as SuiteSettings, d as SuiteSettingsContract, e as SuiteSettingsSchema, T as TruncateOptions, f as TruncatePathOptions, g as forgeKindFromHost, h as formatBytes, i as formatCompactNumber, j as formatDuration, k as formatNumber, l as formatUptime, m as isForgeKind, n as normalizeForgeHost, r as resolveForgeMark, o as resolveMetricStatus, s as stripAnsi, t as truncate, p as truncateMiddle, q as truncatePath } from '../forge-CtVqWZsy.cjs';
export { D as DefineSettingsContractOptions, S as SettingsContract, a as SettingsEmptyInput, b as SettingsEmptyInputSchema, d as defineSettingsContract } from '../settings-BNRcFeSP.cjs';
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
 * that paints matched query text and by the forges search surfaces that scroll
 * to a match. A query is matched literally via `indexOf` on lowercased strings —
 * never compiled as a regular expression — so user input cannot inject a
 * pattern.
 *
 * Remote forge search is fuzzy: a returned issue may match a query it does not
 * contain verbatim. When the literal query is absent the splitter highlights
 * the query's multi-character tokens at word starts, so a fuzzy result still
 * reads. Callers on a single primary label may additionally opt into marking
 * the whole field when not even a token hits (`fallbackToWholeField`); callers
 * that paint many small runs leave it off. `hasFuzzyHighlight` is the
 * whole-surface test for go-to-match.
 *
 * `normalizeSearchQuery` strips surrounding quotes and whitespace for the local
 * filter/highlight paths; remote search keeps the raw query.
 */
interface HighlightPart {
    /** The run's source text, in its original casing. */
    text: string;
    /** True when this run is an occurrence of the (normalized) query. */
    matched: boolean;
}
/**
 * Normalize a search query for local matching and highlighting: trim, then peel
 * any surrounding pair of matching single/double quotes (`"meta"`, `'meta'`,
 * `""meta""`). Remote forge search keeps the raw query — Forgejo treats quotes
 * as a phrase operator — so only the local paths normalize, letting quoted and
 * unquoted input filter and paint identically. A lone quote is left intact.
 */
declare function normalizeSearchQuery(query: string): string;
interface HighlightOptions {
    /**
     * When true and neither a literal nor a token hit exists, the whole text is
     * returned as a single matched run so a fuzzy search result is still visibly
     * marked. Off by default: callers that paint many small runs (label chips,
     * markdown spans) must not light every one of them up.
     */
    fallbackToWholeField?: boolean;
}
/**
 * Split `text` into alternating unmatched/matched runs for every
 * case-insensitive occurrence of `query`. Surrounding whitespace and matching
 * surrounding quotes on the query are ignored; an empty or whitespace-only
 * query (or empty text) yields the whole text as a single unmatched run.
 *
 * When the literal query is absent the splitter highlights the query's
 * multi-character tokens at word starts. If no token hits either, the text is
 * left unmatched unless the caller opted into `fallbackToWholeField`, which
 * marks the whole field so a fuzzy result is never silently unmarked.
 */
declare function splitHighlightParts(text: string, query: string, options?: HighlightOptions): HighlightPart[];
/**
 * Whether `text` contains the literal trimmed query (case-insensitively) —
 * the precise, pre-fuzzy test callers use to tell a true hit from the token
 * fallback.
 */
declare function hasHighlightMatch(text: string, query: string): boolean;
/**
 * Whether `text` highlights at all for the trimmed `query`: a literal hit or,
 * failing that, a word-start hit for any of the query's multi-character tokens.
 * Unlike `splitHighlightParts` this never reports the whole-field fallback, so
 * it pinpoints the result/section that genuinely mentions a fuzzy query rather
 * than every field.
 */
declare function hasFuzzyHighlight(text: string, query: string): boolean;

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

export { type HighlightOptions, type HighlightPart, type SuppressedSink, TimeoutError, hasFuzzyHighlight, hasHighlightMatch, normalizeSearchQuery, reportSuppressed, splitHighlightParts, withTimeout };

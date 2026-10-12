export { a as PlatformType, P as PluginTheme, R as ResponsiveLayout, S as StatusVariant, T as ThemeColors } from '../types-4TBN5lgi.js';
export { D as DefineRpcOptions, P as PluginRpcContract, R as RpcInput, a as RpcOutput, d as defineContract, b as defineRpc } from '../rpc-D27pph91.js';
export { A as ATTENTION_LABELS, a as AddCommentInput, b as AddCommentInputSchema, c as AddCommentOutput, d as AddCommentOutputSchema, e as AgentEnvelope, f as AgentEnvelopeSchema, g as AttentionLabel, B as BARE_REPO_PATTERN, C as CREATE_ISSUE_BODY_MAX, h as CREATE_ISSUE_LABEL_MAX, i as CREATE_ISSUE_TITLE_MAX, j as CreateIssueInput, k as CreateIssueInputSchema, l as CreateIssueOutput, m as CreateIssueOutputSchema, n as CustomPillDefinition, o as CustomPillDefinitionSchema, p as CustomPillModal, q as CustomPillModalSchema, r as CustomPillState, s as CustomPillThresholds, t as CustomPillThresholdsSchema, F as FeatureComposition, u as FeatureDisposer, v as FeatureModule, w as ForgeAccessInput, x as ForgeAccessState, y as ForgeAuthState, z as ForgeContextInput, D as ForgeContextInputSchema, E as ForgeContextOutput, G as ForgeContextOutputSchema, H as ForgeIssue, I as ForgeIssueSchema, J as ForgeLabel, K as ForgeLabelRef, L as ForgeLabelSchema, M as ForgeRemote, N as ForgeRepoIdentity, O as ForgeTargetResolution, P as ForgeVisibility, Q as INSTALL_LABEL_MODES, R as InstallLabelMode, S as InstallLabelsInput, T as InstallLabelsInputSchema, U as InstallLabelsOutput, V as InstallLabelsOutputSchema, W as IssueComment, X as IssueCommentSchema, Y as IssueDetail, Z as IssueDetailInput, _ as IssueDetailInputSchema, $ as IssueDetailOutput, a0 as IssueDetailOutputSchema, a1 as IssueDetailSchema, a2 as IssueNumberInput, a3 as LABEL_ALIASES, a4 as LEGACY_ATTENTION_LABELS, a5 as LEGACY_PRIORITY_ORDER, a6 as LEGACY_SPEC_LABELS, a7 as LEGACY_STATE_ORDER, a8 as LabelDefinition, a9 as LabelSetPlan, aa as MarkdownLiteBlock, ab as MarkdownLiteSpan, ac as OpenIssuesInput, ad as OpenIssuesInputSchema, ae as OpenIssuesOutput, af as OpenIssuesOutputSchema, ag as PASEO_LABEL_SCOPES, ah as PASEO_LINK_PATTERN, ai as PASEO_SERVER_PATTERN, aj as PRIORITY_ORDER, ak as PriorityLabel, al as SHA_PATTERN, am as SPEC_LABELS, an as STATE_ORDER, ao as SearchIssuesInput, ap as SearchIssuesInputSchema, aq as SearchIssuesOutput, ar as SearchIssuesOutputSchema, as as SetLabelInput, at as SetLabelInputSchema, au as SetLabelOutput, av as SetLabelOutputSchema, aw as SpecLabel, ax as StateLabel, ay as activeForgeForDirectory, az as addCommentContract, aA as canonicalLabel, aB as composeFeatureModules, aC as createIssueContract, aD as currentPriorityLabel, aE as currentStateLabel, aF as deriveForgeAccess, aG as forgeCapabilityFromRepo, aH as forgeContextContract, aI as forgeWriteScopeList, aJ as formatPillDisplay, aK as isValidForgeTarget, aL as issueDetailContract, aM as liveScopesFromIssues, aN as liveScopesFromLabels, aO as nextStateLabel, aP as normalizeIssueNumber, aQ as openIssuesContract, aR as parseAgentEnvelope, aS as parseForgeRemote, aT as parseLabelList, aU as parseMarkdownLite, aV as parseMarkdownLiteInline, aW as parseNumericPillValue, aX as paseoLabelScopes, aY as paseoLabelSet, aZ as planLabelSetInstall, a_ as rankIssues, a$ as resolveCustomPillStatus, b0 as resolveForgeTarget, b1 as sameLabel, b2 as scopeOfLabel, b3 as searchIssuesContract, b4 as setLabelContract, b5 as shortLabelName, b6 as stripAgentEnvelopeFooter, b7 as validateCreateIssueInput, b8 as writeGateNotice } from '../tickets-CQ2t2Y40.js';
export { F as FormatBytesOptions, a as FormatCompactNumberOptions, M as MetricThresholds, T as TruncateOptions, b as TruncatePathOptions, f as formatBytes, c as formatCompactNumber, d as formatDuration, e as formatNumber, g as formatUptime, r as resolveMetricStatus, s as stripAnsi, t as truncate, h as truncateMiddle, i as truncatePath } from '../formatters-Bv2wa1fZ.js';
import { S as SettingsContract } from '../settings-CP1gv9q3.js';
export { D as DefineSettingsContractOptions, a as SettingsEmptyInput, b as SettingsEmptyInputSchema, d as defineSettingsContract } from '../settings-CP1gv9q3.js';
import { z } from 'zod';

declare const SuiteSettingsSchema: z.ZodObject<{
    suiteTitle: z.ZodDefault<z.ZodString>;
    accentColor: z.ZodDefault<z.ZodString>;
    density: z.ZodDefault<z.ZodEnum<{
        compact: "compact";
        comfortable: "comfortable";
        spacious: "spacious";
    }>>;
    showSuiteTabs: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
type SuiteSettings = z.infer<typeof SuiteSettingsSchema>;
declare const SuiteSettingsContract: SettingsContract<{
    suiteTitle: string;
    accentColor: string;
    density: "compact" | "comfortable" | "spacious";
    showSuiteTabs: boolean;
}>;

interface TimeoutError extends Error {
    readonly timeoutMs: number;
}
declare function createTimeoutError(message: string, timeoutMs: number): TimeoutError;
declare function isTimeoutError(e: unknown): e is TimeoutError;
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

/**
 * Shared forge brand-mark resolution.
 *
 * One host/kind -> mark table for every plugin that shows forge iconography,
 * so plugins never carry their own per-forge icon maps. The client-side
 * `<ForgeIcon>` renders this descriptor; server/shared code can consume the
 * pure resolver without pulling in React.
 *
 * GitHub and GitLab resolve to their Lucide marks; Codeberg, Forgejo and Gitea
 * have no Lucide equivalent and resolve to helper-drawn official mono marks.
 */
type ForgeKind = "github" | "gitlab" | "codeberg" | "forgejo" | "gitea" | "generic";
interface ResolvedForgeMark {
    /** Stable forge identity. */
    kind: ForgeKind;
    /** Human-readable forge name for labels and accessibility. */
    label: string;
    /** Host Lucide icon name; the exact mark on hosts with SVG support, the closest fallback otherwise. */
    lucideName: string;
    /** True when `<ForgeIcon>` draws the official mark instead of delegating to the host icon set. */
    custom: boolean;
}
interface ForgeMarkInput {
    /** Forge hostname, e.g. `codeberg.org` or `forge.example.com`. */
    host?: string | null;
    /** Explicit forge identity; wins over host detection when it names a known forge. */
    kind?: ForgeKind | string | null;
}
/**
 * Reduce a remote URL, `owner/repo` slug or bare hostname to a lowercase
 * hostname without scheme, userinfo, port, path or a leading `www.`.
 */
declare function normalizeForgeHost(host: string | null | undefined): string | null;
declare function isForgeKind(value: unknown): value is ForgeKind;
declare function forgeKindFromHost(host: string | null | undefined): ForgeKind;
/**
 * Resolve a forge descriptor from a hostname and/or explicit kind. Accepts a
 * bare host string for the common host-only case.
 */
declare function resolveForgeMark(input: ForgeMarkInput | string | null | undefined): ResolvedForgeMark;
/** Inline SVG data URI for a custom mark, tinted with the resolved color. */
declare function forgeMarkSource(kind: ForgeKind, color: string): {
    uri: string;
} | null;

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

export { type ForgeKind, type ForgeMarkInput, type HighlightOptions, type HighlightPart, type ResolvedForgeMark, SettingsContract, type SuiteSettings, SuiteSettingsContract, SuiteSettingsSchema, type SuppressedSink, type TimeoutError, createTimeoutError, forgeKindFromHost, forgeMarkSource, hasFuzzyHighlight, hasHighlightMatch, isForgeKind, isTimeoutError, normalizeForgeHost, normalizeSearchQuery, reportSuppressed, resolveForgeMark, splitHighlightParts, withTimeout };

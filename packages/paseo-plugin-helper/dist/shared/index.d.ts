export { a as PlatformType, P as PluginTheme, R as ResponsiveLayout, S as StatusVariant, T as ThemeColors } from '../types-4TBN5lgi.js';
export { D as DefineRpcOptions, P as PluginRpcContract, R as RpcInput, a as RpcOutput, d as defineContract, b as defineRpc } from '../rpc-D27pph91.js';
export { A as ATTENTION_LABELS, a as AddCommentInput, b as AddCommentInputSchema, c as AddCommentOutput, d as AddCommentOutputSchema, e as AgentEnvelope, f as AgentEnvelopeSchema, g as AttentionLabel, B as BARE_REPO_PATTERN, C as CREATE_ISSUE_BODY_MAX, h as CREATE_ISSUE_LABEL_MAX, i as CREATE_ISSUE_TITLE_MAX, j as CreateIssueInput, k as CreateIssueInputSchema, l as CreateIssueOutput, m as CreateIssueOutputSchema, n as CustomPillDefinition, o as CustomPillDefinitionSchema, p as CustomPillModal, q as CustomPillModalSchema, r as CustomPillState, s as CustomPillThresholds, t as CustomPillThresholdsSchema, F as FeatureComposition, u as FeatureDependencyDeclaration, v as FeatureDependencyInput, w as FeatureDependencyMap, x as FeatureDependencyResolution, y as FeatureDependencyValidationError, z as FeatureDisposer, D as FeatureModule, E as ForgeAccessInput, G as ForgeAccessState, H as ForgeAuthState, I as ForgeContextInput, J as ForgeContextInputSchema, K as ForgeContextOutput, L as ForgeContextOutputSchema, M as ForgeIssue, N as ForgeIssueSchema, O as ForgeLabel, P as ForgeLabelRef, Q as ForgeLabelSchema, R as ForgeRemote, S as ForgeRepoIdentity, T as ForgeTargetResolution, U as ForgeVisibility, V as INSTALL_LABEL_MODES, W as InstallLabelMode, X as InstallLabelsInput, Y as InstallLabelsInputSchema, Z as InstallLabelsOutput, _ as InstallLabelsOutputSchema, $ as IssueComment, a0 as IssueCommentSchema, a1 as IssueDetail, a2 as IssueDetailInput, a3 as IssueDetailInputSchema, a4 as IssueDetailOutput, a5 as IssueDetailOutputSchema, a6 as IssueDetailSchema, a7 as IssueNumberInput, a8 as LABEL_ALIASES, a9 as LEGACY_ATTENTION_LABELS, aa as LEGACY_PRIORITY_ORDER, ab as LEGACY_SPEC_LABELS, ac as LEGACY_STATE_ORDER, ad as LabelDefinition, ae as LabelSetPlan, af as MarkdownLiteBlock, ag as MarkdownLiteSpan, ah as OpenIssuesInput, ai as OpenIssuesInputSchema, aj as OpenIssuesOutput, ak as OpenIssuesOutputSchema, al as PASEO_LABEL_SCOPES, am as PASEO_LINK_PATTERN, an as PASEO_SERVER_PATTERN, ao as PRIORITY_ORDER, ap as PriorityLabel, aq as ResolveFeatureDependenciesOptions, ar as ResolvedFeatureDependency, as as SHA_PATTERN, at as SPEC_LABELS, au as STATE_ORDER, av as SearchIssuesInput, aw as SearchIssuesInputSchema, ax as SearchIssuesOutput, ay as SearchIssuesOutputSchema, az as SetLabelInput, aA as SetLabelInputSchema, aB as SetLabelOutput, aC as SetLabelOutputSchema, aD as SpecLabel, aE as StateLabel, aF as activeForgeForDirectory, aG as addCommentContract, aH as canonicalLabel, aI as composeFeatureModules, aJ as createIssueContract, aK as currentPriorityLabel, aL as currentStateLabel, aM as deriveForgeAccess, aN as forgeCapabilityFromRepo, aO as forgeContextContract, aP as forgeWriteScopeList, aQ as formatPillDisplay, aR as isValidForgeTarget, aS as issueDetailContract, aT as liveScopesFromIssues, aU as liveScopesFromLabels, aV as nextStateLabel, aW as normalizeIssueNumber, aX as openIssuesContract, aY as parseAgentEnvelope, aZ as parseForgeRemote, a_ as parseLabelList, a$ as parseMarkdownLite, b0 as parseMarkdownLiteInline, b1 as parseNumericPillValue, b2 as paseoLabelScopes, b3 as paseoLabelSet, b4 as planLabelSetInstall, b5 as rankIssues, b6 as resolveCustomPillStatus, b7 as resolveFeatureDependencies, b8 as resolveForgeTarget, b9 as sameLabel, ba as scopeOfLabel, bb as searchIssuesContract, bc as setLabelContract, bd as shortLabelName, be as stripAgentEnvelopeFooter, bf as validateCreateIssueInput, bg as validateFeatureDependencies, bh as writeGateNotice } from '../tickets-BrD6Kifn.js';
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

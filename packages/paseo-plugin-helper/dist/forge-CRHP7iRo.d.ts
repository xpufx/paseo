import { S as StatusVariant, a as SettingsContract } from './custom-pills-BRMMkgfE.js';
import { z } from 'zod';

interface FormatBytesOptions {
    /**
     * Number of decimal places (default: 1).
     */
    decimals?: number;
    /**
     * If true, produces compact format with no space and single-character suffix
     * (e.g. "5.3G", "320M", "1.2K"). Ideal for width-constrained composer pills.
     */
    compact?: boolean;
    /**
     * Fixes output unit (e.g. "GB" or "MB") regardless of value size.
     */
    fixedUnit?: "B" | "KB" | "MB" | "GB" | "TB";
}
/**
 * Formats a raw byte count into a human-readable string.
 * Supports standard ("1.5 GB", "320 KB") and compact ("1.5G", "320K") formats.
 */
declare function formatBytes(bytes: number, optionsOrDecimals?: FormatBytesOptions | number): string;
interface MetricThresholds {
    /**
     * Threshold for warning status (default: 75).
     */
    warning?: number;
    /**
     * Threshold for danger status (default: 90).
     */
    danger?: number;
    /**
     * Inverts logic: lower values become worse (e.g. battery level, disk free space).
     */
    invert?: boolean;
}
/**
 * Evaluates a numeric percentage metric (0 - 100) against warning and danger thresholds.
 */
declare function resolveMetricStatus(value: number, thresholds?: MetricThresholds): StatusVariant;
/**
 * Formats uptime seconds into concise human-readable duration (e.g. "3d 4h 12m", "45m").
 */
declare function formatUptime(seconds: number): string;
/**
 * Formats milliseconds into human-readable latency or duration (e.g. "45ms", "1.2s", "3m 12s").
 */
declare function formatDuration(ms: number): string;
/**
 * Formats a number with comma separators (e.g. 1,234,567).
 */
declare function formatNumber(num: number): string;
interface FormatCompactNumberOptions {
    /** Number of decimal places when abbreviated (default: 1). */
    decimals?: number;
    /** Minimum threshold before abbreviating with K/M/B suffixes (default: 1000). */
    threshold?: number;
}
/**
 * Formats a count or token number into a compact string (e.g. 950 -> "950", 1250 -> "1.3k", 1450000 -> "1.5M").
 * Ideal for pills, vitals chips, and narrow timeline badges.
 */
declare function formatCompactNumber(num: number, options?: FormatCompactNumberOptions): string;
interface TruncateOptions {
    /** Ellipsis token to insert. Default: "…" */
    ellipsis?: string;
}
interface TruncatePathOptions extends TruncateOptions {
    /** Directory separator. Default: "/" */
    separator?: string;
    /** Keep leading path segments (e.g. 1 keeps the root/first folder). Default: 1 */
    keepLeading?: number;
    /** Keep trailing path segments (e.g. 1 keeps the filename). Default: 1 */
    keepTrailing?: number;
}
/**
 * Safely truncates a string with an ellipsis if it exceeds maxLength.
 */
declare function truncate(text: string, maxLength: number, suffix?: string): string;
/**
 * Truncates a string in the middle, preserving distinct head and tail characters.
 * Ideal for UUIDs, commit SHAs, hashes, cryptographic keys, and long identifiers.
 *
 * Example: `truncateMiddle("0359a72f-5b58-453b-a35b-956a3f6908ba", 16)` => `"0359a72…6908ba"`
 */
declare function truncateMiddle(text: string, maxLength: number, options?: TruncateOptions): string;
/**
 * Truncates file system and URL paths intelligently, preserving the leaf filename
 * and root directory while compressing intermediate parent directories.
 *
 * Example: `truncatePath("~/code/paseo-plugin-helper/src/client/approvals.tsx", 35)`
 *       => `"~/code/…/src/client/approvals.tsx"`
 */
declare function truncatePath(filePath: string, maxLength: number, options?: TruncatePathOptions): string;
/**
 * Strips ANSI escape sequences (colors, text formatting, cursor controls) from terminal output strings.
 */
declare function stripAnsi(text: string): string;

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

export { type ForgeMarkInput as F, type MetricThresholds as M, type ResolvedForgeMark as R, type SuiteSettings as S, type TruncatePathOptions as T, type ForgeKind as a, type FormatBytesOptions as b, type FormatCompactNumberOptions as c, SuiteSettingsContract as d, SuiteSettingsSchema as e, forgeKindFromHost as f, type TruncateOptions as g, formatBytes as h, isForgeKind as i, formatCompactNumber as j, formatDuration as k, formatNumber as l, formatUptime as m, normalizeForgeHost as n, resolveMetricStatus as o, truncateMiddle as p, truncatePath as q, resolveForgeMark as r, stripAnsi as s, truncate as t };

import type { StatusVariant } from "./types";

export interface FormatBytesOptions {
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
export function formatBytes(
  bytes: number,
  optionsOrDecimals: FormatBytesOptions | number = 1,
): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const options: FormatBytesOptions =
    typeof optionsOrDecimals === "number"
      ? { decimals: optionsOrDecimals }
      : optionsOrDecimals;

  const { decimals = 1, compact = false, fixedUnit } = options;
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const compactSizes = ["B", "K", "M", "G", "T", "P"];

  let unitIndex = Math.floor(Math.log(bytes) / Math.log(k));
  if (fixedUnit) {
    const found = sizes.indexOf(fixedUnit);
    if (found !== -1) unitIndex = found;
  }

  const clampedIndex = Math.max(0, Math.min(unitIndex, sizes.length - 1));
  const value = bytes / Math.pow(k, clampedIndex);

  if (compact) {
    return `${value.toFixed(dm)}${compactSizes[clampedIndex]}`;
  }

  return `${value.toFixed(dm)} ${sizes[clampedIndex]}`;
}

export interface MetricThresholds {
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
export function resolveMetricStatus(
  value: number,
  thresholds: MetricThresholds = {},
): StatusVariant {
  const { warning = 75, danger = 90, invert = false } = thresholds;

  if (!invert) {
    if (value >= danger) return "danger";
    if (value >= warning) return "warning";
    return "success";
  } else {
    if (value <= danger) return "danger";
    if (value <= warning) return "warning";
    return "success";
  }
}

/**
 * Formats uptime seconds into concise human-readable duration (e.g. "3d 4h 12m", "45m").
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}

/**
 * Formats milliseconds into human-readable latency or duration (e.g. "45ms", "1.2s", "3m 12s").
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return formatUptime(Math.round(seconds));
}

/**
 * Formats a number with comma separators (e.g. 1,234,567).
 */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-US").format(num);
}

export interface FormatCompactNumberOptions {
  /** Number of decimal places when abbreviated (default: 1). */
  decimals?: number;
  /** Minimum threshold before abbreviating with K/M/B suffixes (default: 1000). */
  threshold?: number;
}

/**
 * Formats a count or token number into a compact string (e.g. 950 -> "950", 1250 -> "1.3k", 1450000 -> "1.5M").
 * Ideal for pills, vitals chips, and narrow timeline badges.
 */
export function formatCompactNumber(
  num: number,
  options: FormatCompactNumberOptions = {},
): string {
  if (!Number.isFinite(num)) return "0";
  const { decimals = 1, threshold = 1000 } = options;
  const abs = Math.abs(num);
  if (abs < threshold) return `${Math.round(num)}`;
  const sign = num < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    const val = (abs / 1_000_000_000).toFixed(decimals);
    return `${sign}${val.replace(/\.0$/, "")}B`;
  }
  if (abs >= 1_000_000) {
    const val = (abs / 1_000_000).toFixed(decimals);
    return `${sign}${val.replace(/\.0$/, "")}M`;
  }
  const val = (abs / 1_000).toFixed(decimals);
  return `${sign}${val.replace(/\.0$/, "")}k`;
}

export interface TruncateOptions {
  /** Ellipsis token to insert. Default: "…" */
  ellipsis?: string;
}

export interface TruncatePathOptions extends TruncateOptions {
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
export function truncate(text: string, maxLength: number, suffix = "…"): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
}

/**
 * Truncates a string in the middle, preserving distinct head and tail characters.
 * Ideal for UUIDs, commit SHAs, hashes, cryptographic keys, and long identifiers.
 *
 * Example: `truncateMiddle("0359a72f-5b58-453b-a35b-956a3f6908ba", 16)` => `"0359a72…6908ba"`
 */
export function truncateMiddle(text: string, maxLength: number, options?: TruncateOptions): string {
  if (!text || text.length <= maxLength) return text;
  const ellipsis = options?.ellipsis ?? "…";
  if (maxLength <= ellipsis.length) return ellipsis.slice(0, maxLength);

  const available = maxLength - ellipsis.length;
  const headLength = Math.floor(available / 2);
  const tailLength = available - headLength;

  const head = text.slice(0, headLength);
  const tail = tailLength > 0 ? text.slice(-tailLength) : "";
  return `${head}${ellipsis}${tail}`;
}

/**
 * Truncates file system and URL paths intelligently, preserving the leaf filename
 * and root directory while compressing intermediate parent directories.
 *
 * Example: `truncatePath("~/code/paseo-plugin-helper/src/client/approvals.tsx", 35)`
 *       => `"~/code/…/src/client/approvals.tsx"`
 */
export function truncatePath(filePath: string, maxLength: number, options?: TruncatePathOptions): string {
  if (!filePath || filePath.length <= maxLength) return filePath;

  const sep = options?.separator ?? "/";
  const ellipsis = options?.ellipsis ?? "…";
  let keepLeading = options?.keepLeading ?? 1;
  const keepTrailing = options?.keepTrailing ?? 1;

  // If path starts with separator (e.g. /home/...), parts[0] is empty, so adjust keepLeading
  if (filePath.startsWith(sep) && keepLeading === 1) {
    keepLeading = 2; // Keep ["", "home"] which joins to "/home"
  }

  const parts = filePath.split(sep);
  // If no path separators or very few segments, fallback to truncateMiddle
  if (parts.length <= keepLeading + keepTrailing) {
    return truncateMiddle(filePath, maxLength, { ellipsis });
  }

  const prefixParts = parts.slice(0, keepLeading);
  const suffixParts = parts.slice(parts.length - keepTrailing);
  let middleParts = parts.slice(keepLeading, parts.length - keepTrailing);

  // Progressive compression: drop elements from start of middle until it fits
  while (middleParts.length > 0) {
    const candidate = [...prefixParts, ellipsis, ...middleParts, ...suffixParts].join(sep);
    if (candidate.length <= maxLength) {
      return candidate;
    }
    middleParts.shift();
  }

  // If still too long with full ellipsis, just join prefix + ellipsis + suffix
  const minimalCandidate = [...prefixParts, ellipsis, ...suffixParts].join(sep);
  if (minimalCandidate.length <= maxLength) {
    return minimalCandidate;
  }

  // If even prefix + ellipsis + filename exceeds maxLength, middle-truncate the filename
  const filename = suffixParts.join(sep);
  const prefix = prefixParts.join(sep);
  const availableForFile = maxLength - prefix.length - sep.length - ellipsis.length - sep.length;
  if (availableForFile > 4) {
    return `${prefix}${sep}${ellipsis}${sep}${truncateMiddle(filename, availableForFile, { ellipsis })}`;
  }

  return truncateMiddle(filePath, maxLength, { ellipsis });
}

/**
 * Strips ANSI escape sequences (colors, text formatting, cursor controls) from terminal output strings.
 */
export function stripAnsi(text: string): string {
  if (!text) return "";
  // Matches 7-bit ASCII and 8-bit ANSI escape codes
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

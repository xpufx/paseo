import type { StatusVariant } from "./types.js";

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

/**
 * Safely truncates a string with an ellipsis if it exceeds maxLength.
 */
export function truncate(text: string, maxLength: number, suffix = "…"): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
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

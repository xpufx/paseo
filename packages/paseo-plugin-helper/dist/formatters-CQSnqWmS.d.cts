import { S as StatusVariant } from './custom-pills-CnrXjVIR.cjs';

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
/**
 * Safely truncates a string with an ellipsis if it exceeds maxLength.
 */
declare function truncate(text: string, maxLength: number, suffix?: string): string;
/**
 * Strips ANSI escape sequences (colors, text formatting, cursor controls) from terminal output strings.
 */
declare function stripAnsi(text: string): string;

export { type FormatBytesOptions as F, type MetricThresholds as M, formatDuration as a, formatNumber as b, formatUptime as c, formatBytes as f, resolveMetricStatus as r, stripAnsi as s, truncate as t };

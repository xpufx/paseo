import type { MetricThresholds, StatusVariant } from "./types.js";

/**
 * Evaluates a numeric percentage metric (0 - 100) against warning and danger
 * thresholds. Inlined from `paseo-plugin-helper/shared` so this package stays
 * self-contained.
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
  }

  if (value <= danger) return "danger";
  if (value <= warning) return "warning";
  return "success";
}

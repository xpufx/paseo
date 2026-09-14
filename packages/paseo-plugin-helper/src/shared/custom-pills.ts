import { z } from "zod";
import type { StatusVariant } from "./types.js";

export const CustomPillThresholdsSchema = z.object({
  warning: z.number().optional(),
  danger: z.number().optional(),
  /**
   * If true, lower values trigger warnings/dangers instead of higher values
   * (e.g. disk space remaining, battery percentage).
   */
  invert: z.boolean().optional(),
});

export const CustomPillModalSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  command: z.string().optional(),
  /**
   * Whether to format command output as monospace preformatted text (default: true).
   */
  preformatted: z.boolean().default(true),
});

export const CustomPillDefinitionSchema = z.object({
  /**
   * Unique identifier for the custom pill (e.g. "gpu-util", "docker-count").
   */
  id: z.string().min(1),

  /**
   * Title shown in the composer trackbar (e.g. "GPU", "Docker").
   */
  title: z.string().min(1),

  /**
   * Compact title shown when layout is compact (e.g. "G"). Defaults to title.
   */
  compactTitle: z.string().optional(),

  /**
   * Lucide icon name (e.g. "Cpu", "Flame", "HardDrive", "Layers").
   */
  icon: z.string().optional(),

  /**
   * Optional compact icon name. Defaults to icon.
   */
  compactIcon: z.string().optional(),

  /**
   * Shell command executed periodically to produce the pill's value.
   * Can use session environment variables like $PASEO_AGENT_ID, $PASEO_WORKSPACE_ID.
   */
  command: z.string().min(1),

  /**
   * Optional prefix prepended to the output value (e.g. "$", "#").
   */
  prefix: z.string().optional(),

  /**
   * Optional suffix appended to the output value (e.g. "%", "ms", "GB").
   */
  suffix: z.string().optional(),

  /**
   * Polling interval in milliseconds. Minimum 500ms, defaults to 5000ms.
   */
  intervalMs: z.number().min(500).default(5000),

  /**
   * Execution timeout in milliseconds. Defaults to 10000ms.
   */
  timeoutMs: z.number().min(500).default(10000),

  /**
   * Optional threshold rules to automatically transition badge color to warning or danger.
   */
  thresholds: CustomPillThresholdsSchema.optional(),

  /**
   * Optional modal configuration shown when the pill is pressed.
   */
  modal: CustomPillModalSchema.optional(),

  /**
   * Whether this custom pill is enabled. Defaults to true.
   */
  enabled: z.boolean().default(true),

  /**
   * Absolute path to the config file that defined this pill (e.g.
   * ~/.paseo/top/pills/disk-usage.jsonc). Injected at discovery time; not
   * intended to be authored in the config file itself.
   */
  sourceFile: z.string().optional(),
});

export type CustomPillDefinition = z.infer<typeof CustomPillDefinitionSchema>;
export type CustomPillThresholds = z.infer<typeof CustomPillThresholdsSchema>;
export type CustomPillModal = z.infer<typeof CustomPillModalSchema>;

export interface CustomPillState {
  id: string;
  title: string;
  compactTitle?: string;
  icon?: string;
  compactIcon?: string;
  rawValue: string;
  displayValue: string;
  numericValue?: number;
  status: StatusVariant;
  lastUpdated: number;
  error?: string;
  sourceFile?: string;
  modalTitle?: string;
  modalDescription?: string;
  modalOutput?: string;
  modalError?: string;
  modalLastUpdated?: number;
}

/**
 * Extracts a numeric value from the raw command output string (e.g. "45.2%" -> 45.2).
 */
export function parseNumericPillValue(rawValue: string): number | undefined {
  const match = rawValue.match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const num = parseFloat(match[0]);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Resolves the status variant based on numeric value and thresholds.
 */
export function resolveCustomPillStatus(
  numericValue: number | undefined,
  thresholds?: CustomPillThresholds,
): StatusVariant {
  if (numericValue === undefined || !thresholds) {
    return "neutral";
  }

  const { warning, danger, invert } = thresholds;

  if (invert) {
    if (danger !== undefined && numericValue <= danger) return "danger";
    if (warning !== undefined && numericValue <= warning) return "warning";
    return "success";
  }

  if (danger !== undefined && numericValue >= danger) return "danger";
  if (warning !== undefined && numericValue >= warning) return "warning";
  return "neutral";
}

/**
 * Formats the raw output string with optional prefix and suffix.
 */
export function formatPillDisplay(
  rawValue: string,
  prefix?: string,
  suffix?: string,
): string {
  const cleaned = rawValue.trim();
  const pre = prefix ?? "";
  const suf = suffix ?? "";
  return `${pre}${cleaned}${suf}`;
}

'use strict';

var zod = require('zod');

// src/shared/rpc.ts
var RPC_NAME = /^[a-z][a-z0-9._-]*$/;
function defineRpc(definition) {
  const name = definition.name.trim();
  if (!RPC_NAME.test(name)) {
    throw new Error(`Invalid plugin RPC method: ${definition.name}`);
  }
  return { ...definition, name };
}
function defineContract(options) {
  const contract = defineRpc({
    name: options.name,
    input: options.input,
    output: options.output
  });
  if (options.description) {
    Object.defineProperty(contract, "description", {
      value: options.description,
      enumerable: true,
      writable: false
    });
  }
  return contract;
}

// src/shared/formatters.ts
function formatBytes(bytes, optionsOrDecimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const options = typeof optionsOrDecimals === "number" ? { decimals: optionsOrDecimals } : optionsOrDecimals;
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
function resolveMetricStatus(value, thresholds = {}) {
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
function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  const seconds = ms / 1e3;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return formatUptime(Math.round(seconds));
}
function formatNumber(num) {
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-US").format(num);
}
function truncate(text, maxLength, suffix = "\u2026") {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
}
function stripAnsi(text) {
  if (!text) return "";
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}
var SettingsEmptyInputSchema = zod.z.union([zod.z.void(), zod.z.record(zod.z.string(), zod.z.unknown())]).optional();
function stripDefaults(schema) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (schema instanceof zod.z.ZodDefault) {
    return stripDefaults(schema._def.innerType);
  }
  if (schema instanceof zod.z.ZodOptional) {
    return stripDefaults(schema._def.innerType).optional();
  }
  if (schema instanceof zod.z.ZodNullable) {
    return stripDefaults(schema._def.innerType).nullable();
  }
  if (schema._def && schema._def.schema) {
    return stripDefaults(schema._def.schema);
  }
  if (schema instanceof zod.z.ZodObject) {
    const shape = schema.shape;
    const newShape = {};
    for (const key of Object.keys(shape)) {
      newShape[key] = stripDefaults(shape[key]).optional();
    }
    let res = zod.z.object(newShape);
    const unknownKeys = schema._def?.unknownKeys;
    if (unknownKeys === "passthrough") {
      res = res.passthrough();
    } else if (unknownKeys === "strict") {
      res = res.strict();
    }
    return res;
  }
  return typeof schema.optional === "function" ? schema.optional() : schema;
}
function defineSettingsContract(options) {
  const { name, schema, defaultData, description } = options;
  let computedDefaults;
  try {
    computedDefaults = schema.parse(defaultData ?? {});
  } catch {
    computedDefaults = defaultData ?? {};
  }
  const sanitizedName = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  const partialSchema = schema instanceof zod.z.ZodObject ? stripDefaults(schema) : typeof schema.partial === "function" ? schema.partial() : zod.z.record(zod.z.string(), zod.z.unknown());
  const getContract = defineContract({
    name: `${sanitizedName}.get`,
    input: SettingsEmptyInputSchema,
    output: schema,
    description: description ? `Get ${description}` : `Get ${name} settings`
  });
  const updateContract = defineContract({
    name: `${sanitizedName}.update`,
    input: partialSchema,
    output: schema,
    description: description ? `Update ${description}` : `Update ${name} settings`
  });
  const resetContract = defineContract({
    name: `${sanitizedName}.reset`,
    input: SettingsEmptyInputSchema,
    output: schema,
    description: description ? `Reset ${description}` : `Reset ${name} settings to defaults`
  });
  return {
    name: sanitizedName,
    schema,
    defaultSettings: computedDefaults,
    get: getContract,
    update: updateContract,
    reset: resetContract,
    ...description !== void 0 ? { description } : {}
  };
}

// src/shared/async.ts
var TimeoutError = class extends Error {
  timeoutMs;
  constructor(message, timeoutMs) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
};
async function withTimeout(promise, timeoutMs, label = "Operation") {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== void 0) {
      clearTimeout(timer);
    }
  }
}
var CustomPillThresholdsSchema = zod.z.object({
  warning: zod.z.number().optional(),
  danger: zod.z.number().optional(),
  /**
   * If true, lower values trigger warnings/dangers instead of higher values
   * (e.g. disk space remaining, battery percentage).
   */
  invert: zod.z.boolean().optional()
});
var CustomPillModalSchema = zod.z.object({
  title: zod.z.string().optional(),
  description: zod.z.string().optional(),
  command: zod.z.string().optional(),
  /**
   * Whether to format command output as monospace preformatted text (default: true).
   */
  preformatted: zod.z.boolean().default(true)
});
var CustomPillDefinitionSchema = zod.z.object({
  /**
   * Unique identifier for the custom pill (e.g. "gpu-util", "docker-count").
   */
  id: zod.z.string().min(1),
  /**
   * Title shown in the composer trackbar (e.g. "GPU", "Docker").
   */
  title: zod.z.string().min(1),
  /**
   * Compact title shown when layout is compact (e.g. "G"). Defaults to title.
   */
  compactTitle: zod.z.string().optional(),
  /**
   * Lucide icon name (e.g. "Cpu", "Flame", "HardDrive", "Layers").
   */
  icon: zod.z.string().optional(),
  /**
   * Optional compact icon name. Defaults to icon.
   */
  compactIcon: zod.z.string().optional(),
  /**
   * Shell command executed periodically to produce the pill's value.
   * Can use session environment variables like $PASEO_AGENT_ID, $PASEO_WORKSPACE_ID.
   */
  command: zod.z.string().min(1),
  /**
   * Optional prefix prepended to the output value (e.g. "$", "#").
   */
  prefix: zod.z.string().optional(),
  /**
   * Optional suffix appended to the output value (e.g. "%", "ms", "GB").
   */
  suffix: zod.z.string().optional(),
  /**
   * Polling interval in milliseconds. Minimum 500ms, defaults to 5000ms.
   */
  intervalMs: zod.z.number().min(500).default(5e3),
  /**
   * Execution timeout in milliseconds. Defaults to 10000ms.
   */
  timeoutMs: zod.z.number().min(500).default(1e4),
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
  enabled: zod.z.boolean().default(true),
  /**
   * Absolute path to the config file that defined this pill (e.g.
   * ~/.paseo/top/pills/disk-usage.jsonc). Injected at discovery time; not
   * intended to be authored in the config file itself.
   */
  sourceFile: zod.z.string().optional()
});
function parseNumericPillValue(rawValue) {
  const match = rawValue.match(/-?\d+(\.\d+)?/);
  if (!match) return void 0;
  const num = parseFloat(match[0]);
  return Number.isNaN(num) ? void 0 : num;
}
function resolveCustomPillStatus(numericValue, thresholds) {
  if (numericValue === void 0 || !thresholds) {
    return "neutral";
  }
  const { warning, danger, invert } = thresholds;
  if (invert) {
    if (danger !== void 0 && numericValue <= danger) return "danger";
    if (warning !== void 0 && numericValue <= warning) return "warning";
    return "success";
  }
  if (danger !== void 0 && numericValue >= danger) return "danger";
  if (warning !== void 0 && numericValue >= warning) return "warning";
  return "neutral";
}
function formatPillDisplay(rawValue, prefix, suffix) {
  const cleaned = rawValue.trim();
  const pre = prefix ?? "";
  const suf = suffix ?? "";
  return `${pre}${cleaned}${suf}`;
}

exports.CustomPillDefinitionSchema = CustomPillDefinitionSchema;
exports.CustomPillModalSchema = CustomPillModalSchema;
exports.CustomPillThresholdsSchema = CustomPillThresholdsSchema;
exports.SettingsEmptyInputSchema = SettingsEmptyInputSchema;
exports.TimeoutError = TimeoutError;
exports.defineContract = defineContract;
exports.defineRpc = defineRpc;
exports.defineSettingsContract = defineSettingsContract;
exports.formatBytes = formatBytes;
exports.formatDuration = formatDuration;
exports.formatNumber = formatNumber;
exports.formatPillDisplay = formatPillDisplay;
exports.formatUptime = formatUptime;
exports.parseNumericPillValue = parseNumericPillValue;
exports.resolveCustomPillStatus = resolveCustomPillStatus;
exports.resolveMetricStatus = resolveMetricStatus;
exports.stripAnsi = stripAnsi;
exports.truncate = truncate;
exports.withTimeout = withTimeout;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map
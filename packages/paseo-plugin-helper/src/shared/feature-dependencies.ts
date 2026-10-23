/**
 * Phase 3 — plugin-to-plugin feature dependencies.
 *
 * A plugin manifest (`paseo-plugin.json`) may declare:
 *
 * ```json
 * {
 *   "dependencies": {
 *     "top": ["top-custom-pills", "top-timeline-telemetry"]
 *   }
 * }
 * ```
 *
 * i.e. `dependencies` is an optional map of *provider plugin id* -> array of
 * *feature module ids* that the depending plugin needs at runtime.
 *
 * This module provides:
 *  - {@link validateFeatureDependencies} — pure shape validation used by the
 *    CLI conformance rules and by runtime resolvers.
 *  - {@link resolveFeatureDependencies} — pure resolution against a provided
 *    feature registry (plugin id -> feature module ids it exposes). The
 *    server-side runtime resolver in `paseo-plugin-helper/server` wraps this
 *    with installed/running plugin discovery.
 */

export type FeatureDependencyMap = Record<string, readonly string[]>;

export interface FeatureDependencyDeclaration {
  dependencies?: FeatureDependencyMap;
}

export type FeatureDependencyInput =
  | FeatureDependencyMap
  | FeatureDependencyDeclaration
  | null
  | undefined;

export interface FeatureDependencyValidationError {
  pluginId?: string;
  featureModuleId?: string;
  message: string;
}

export interface ResolvedFeatureDependency {
  /** Provider plugin id. */
  pluginId: string;
  /** Requested feature module ids. */
  featureModuleIds: string[];
  /** True when the provider is available (running / registered). */
  available: boolean;
  /** Requested module ids the provider does not expose. */
  missingFeatureModuleIds: string[];
  /** True when every requested module id is available. */
  satisfied: boolean;
}

export interface FeatureDependencyResolution {
  /** True when every declared dependency is satisfied. */
  satisfied: boolean;
  /** Per-provider resolution records. */
  dependencies: ResolvedFeatureDependency[];
  /** Provider ids that are unavailable. */
  missingPlugins: string[];
  /** Providers with missing feature module ids. */
  missingFeatures: Array<{ pluginId: string; featureModuleIds: string[] }>;
  /** Shape / validation errors. */
  errors: FeatureDependencyValidationError[];
  // Convenience aliases used by various callers.
  ok: boolean;
  valid: boolean;
  resolved: ResolvedFeatureDependency[];
  missing: ResolvedFeatureDependency[];
}

function isManifestLike(value: unknown): value is FeatureDependencyDeclaration {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "dependencies" in (value as Record<string, unknown>)
  );
}

function normalizeDependencies(input: FeatureDependencyInput): {
  map: Record<string, unknown>;
  errors: FeatureDependencyValidationError[];
} {
  const errors: FeatureDependencyValidationError[] = [];
  let raw: unknown = input;
  if (isManifestLike(raw)) {
    raw = (raw as FeatureDependencyDeclaration).dependencies;
  }
  if (raw == null) {
    return { map: {}, errors };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ message: "dependencies must be an object mapping plugin id to an array of feature module ids" });
    return { map: {}, errors };
  }
  return { map: raw as Record<string, unknown>, errors };
}

/**
 * Pure shape validation for a `dependencies` declaration.
 *
 * Returns the list of validation errors (empty when valid). Never throws.
 */
export function validateFeatureDependencies(input: FeatureDependencyInput): FeatureDependencyValidationError[] {
  const { map, errors } = normalizeDependencies(input);
  const out = [...errors];

  for (const [pluginId, value] of Object.entries(map)) {
    if (typeof pluginId !== "string" || pluginId.trim().length === 0) {
      out.push({ pluginId: String(pluginId), message: "dependency plugin id must be a non-empty string" });
      continue;
    }
    if (!Array.isArray(value)) {
      out.push({ pluginId, message: `dependencies["${pluginId}"] must be an array of feature module ids` });
      continue;
    }
    const seen = new Set<string>();
    for (const moduleId of value) {
      if (typeof moduleId !== "string" || moduleId.trim().length === 0) {
        out.push({ pluginId, featureModuleId: String(moduleId), message: `dependencies["${pluginId}"] contains an invalid (non-string or empty) feature module id` });
        continue;
      }
      if (seen.has(moduleId)) {
        out.push({ pluginId, featureModuleId: moduleId, message: `dependencies["${pluginId}"] contains duplicate feature module id "${moduleId}"` });
      }
      seen.add(moduleId);
    }
  }

  return out;
}

export interface ResolveFeatureDependenciesOptions {
  /** Map of provider plugin id -> feature module ids that provider exposes. */
  availableFeatures?: Record<string, readonly string[]> | Map<string, readonly string[]> | null;
}

/**
 * Resolve a declared dependency map against a registry of available features.
 *
 * When `availableFeatures` is omitted, every well-formed dependency is treated
 * as resolvable (plugin presence is checked by the server-side resolver).
 */
export function resolveFeatureDependencies(
  input: FeatureDependencyInput,
  availableFeatures?: ResolveFeatureDependenciesOptions["availableFeatures"] | ResolveFeatureDependenciesOptions,
  options?: ResolveFeatureDependenciesOptions,
): FeatureDependencyResolution {
  // Allow resolveFeatureDependencies(input, options) calling convention.
  let opts: ResolveFeatureDependenciesOptions = options ?? {};
  let avail: ResolveFeatureDependenciesOptions["availableFeatures"] = null;
  if (availableFeatures && typeof availableFeatures === "object" && !Array.isArray(availableFeatures) && ("availableFeatures" in (availableFeatures as Record<string, unknown>) || "errors" in (availableFeatures as Record<string, unknown>))) {
    // It's an options bag.
    opts = { ...opts, ...(availableFeatures as ResolveFeatureDependenciesOptions) };
  } else {
    avail = availableFeatures as ResolveFeatureDependenciesOptions["availableFeatures"];
  }
  if (opts.availableFeatures !== undefined) avail = opts.availableFeatures;

  const availMap: Map<string, readonly string[]> | null =
    avail instanceof Map
      ? avail
      : avail && typeof avail === "object"
      ? new Map(Object.entries(avail as Record<string, readonly string[]>))
      : null;

  const errors = validateFeatureDependencies(input);
  const { map } = normalizeDependencies(input);

  const records: ResolvedFeatureDependency[] = [];
  const missingPlugins: string[] = [];
  const missingFeatures: Array<{ pluginId: string; featureModuleIds: string[] }> = [];

  for (const [pluginId, value] of Object.entries(map)) {
    const requested = Array.isArray(value) ? value.filter((v) => typeof v === "string") as string[] : [];
    const provided = availMap ? (availMap.get(pluginId) ?? null) : null;
    const available = availMap ? provided !== null : true;

    let missingModules: string[] = [];
    if (availMap && provided) {
      const providedSet = new Set(provided);
      missingModules = requested.filter((m) => !providedSet.has(m));
    } else if (availMap && !provided) {
      missingModules = [...requested];
    }

    const satisfied = available && missingModules.length === 0;
    // shape errors already in errors; don't mark satisfied false only due to shape? Keep.
    const record: ResolvedFeatureDependency = {
      pluginId,
      featureModuleIds: requested,
      available,
      missingFeatureModuleIds: missingModules,
      satisfied,
    };
    records.push(record);
    if (!available) missingPlugins.push(pluginId);
    if (missingModules.length > 0) missingFeatures.push({ pluginId, featureModuleIds: missingModules });
  }

  const hasErrors = errors.length > 0;
  const allSatisfied = !hasErrors && records.every((r) => r.satisfied);

  return {
    satisfied: allSatisfied,
    dependencies: records,
    missingPlugins,
    missingFeatures,
    errors,
    ok: allSatisfied,
    valid: !hasErrors,
    resolved: records.filter((r) => r.satisfied),
    missing: records.filter((r) => !r.satisfied),
  };
}

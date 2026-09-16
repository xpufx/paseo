import { z, type ZodType } from "zod";
import { defineContract, type PluginRpcContract } from "./rpc.js";

export const SettingsEmptyInputSchema = z
  .union([z.void(), z.record(z.string(), z.unknown())])
  .optional();
export type SettingsEmptyInput = z.infer<typeof SettingsEmptyInputSchema>;

export interface SettingsContract<TSettings extends Record<string, any>> {
  readonly name: string;
  readonly schema: ZodType<TSettings>;
  readonly defaultSettings: TSettings;
  readonly get: PluginRpcContract<ZodType<SettingsEmptyInput>, ZodType<TSettings>>;
  readonly update: PluginRpcContract<ZodType<Partial<TSettings>>, ZodType<TSettings>>;
  readonly reset: PluginRpcContract<ZodType<SettingsEmptyInput>, ZodType<TSettings>>;
  readonly description?: string;
}

export interface DefineSettingsContractOptions<TSettings extends Record<string, any>> {
  /**
   * Unique name for the settings domain (e.g. "top.settings" or "myplugin.config").
   * Automatically normalizes invalid RPC characters.
   */
  name: string;
  /**
   * Zod Object schema representing the full settings shape.
   * Use `.default(...)` on fields to provide default values.
   */
  schema: ZodType<TSettings> & { partial?: () => ZodType<Partial<TSettings>> };
  /**
   * Optional default data override if schema fields do not all specify `.default()`.
   */
  defaultData?: Partial<TSettings>;
  /**
   * Optional human-readable description of the settings.
   */
  description?: string;
}

/**
 * Strips `.default(...)` wrappers recursively from a Zod schema so that
 * omitted fields remain undefined rather than being populated with default values
 * during partial updates.
 */
function stripDefaults(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (schema instanceof z.ZodDefault) {
    return stripDefaults(schema._def.innerType);
  }
  if (schema instanceof z.ZodOptional) {
    return stripDefaults(schema._def.innerType).optional();
  }
  if (schema instanceof z.ZodNullable) {
    return stripDefaults(schema._def.innerType).nullable();
  }
  // Handle ZodEffects, ZodBranded, ZodReadonly, ZodCatch
  if (schema._def && schema._def.schema) {
    return stripDefaults(schema._def.schema);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const newShape: Record<string, any> = {};
    for (const key of Object.keys(shape)) {
      newShape[key] = stripDefaults(shape[key]).optional();
    }
    let res = z.object(newShape);
    const unknownKeys = (schema._def as any)?.unknownKeys;
    if (unknownKeys === "passthrough") {
      res = res.passthrough() as any;
    } else if (unknownKeys === "strict") {
      res = res.strict() as any;
    }
    return res;
  }
  return typeof schema.optional === "function" ? schema.optional() : schema;
}

/**
 * Defines a pair of typed Paseo RPC contracts (get, update, reset) for plugin settings.
 */
export function defineSettingsContract<TSettings extends Record<string, any>>(
  options: DefineSettingsContractOptions<TSettings>,
): SettingsContract<TSettings> {
  const { name, schema, defaultData, description } = options;

  let computedDefaults: TSettings;
  try {
    computedDefaults = schema.parse(defaultData ?? {}) as TSettings;
  } catch {
    computedDefaults = (defaultData ?? {}) as TSettings;
  }

  const sanitizedName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");

  const partialSchema = (
    schema instanceof z.ZodObject
      ? stripDefaults(schema)
      : typeof (schema as any).partial === "function"
        ? (schema as any).partial()
        : z.record(z.string(), z.unknown())
  ) as ZodType<Partial<TSettings>>;

  const getContract = defineContract({
    name: `${sanitizedName}.get`,
    input: SettingsEmptyInputSchema as ZodType<SettingsEmptyInput>,
    output: schema,
    description: description ? `Get ${description}` : `Get ${name} settings`,
  });

  const updateContract = defineContract({
    name: `${sanitizedName}.update`,
    input: partialSchema,
    output: schema,
    description: description ? `Update ${description}` : `Update ${name} settings`,
  });

  const resetContract = defineContract({
    name: `${sanitizedName}.reset`,
    input: SettingsEmptyInputSchema as ZodType<SettingsEmptyInput>,
    output: schema,
    description: description ? `Reset ${description}` : `Reset ${name} settings to defaults`,
  });

  return {
    name: sanitizedName,
    schema,
    defaultSettings: computedDefaults,
    get: getContract,
    update: updateContract,
    reset: resetContract,
    ...(description !== undefined ? { description } : {}),
  };
}

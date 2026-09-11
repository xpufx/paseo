import React, { type ComponentType, type ReactNode } from "react";
import type { SettingsContract } from "../shared/settings.js";
import type { HostSurfaceProps, PluginCleanup } from "./host.js";
import { usePluginSettings } from "./settings.js";

export interface HelperSettingsCardProps {
  children: ReactNode;
  testID?: string;
}

export interface HelperSettingsSectionProps {
  title: string;
  info?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  testID?: string;
}

export interface HelperSettingsRowBaseProps {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
  testID?: string;
}

export interface HelperSettingsSwitchProps extends HelperSettingsRowBaseProps {
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
}

export interface HelperSettingsSelectProps<Value extends string = string>
  extends HelperSettingsRowBaseProps {
  value: Value;
  options: readonly { label: string; value: Value }[];
  onValueChange(value: Value): void;
  disabled?: boolean;
}

export interface HelperSettingsInputProps extends HelperSettingsRowBaseProps {
  initialValue?: string;
  onChangeText(text: string): void;
  placeholder?: string;
  disabled?: boolean;
  secureTextEntry?: boolean;
}

export type HelperSettingsSelectComponent = <Value extends string = string>(
  props: HelperSettingsSelectProps<Value>,
) => ReactNode;

export interface HelperSettingsUiBundle {
  SettingsCard: ComponentType<HelperSettingsCardProps>;
  SettingsSection: ComponentType<HelperSettingsSectionProps>;
  SettingsSwitch: ComponentType<HelperSettingsSwitchProps>;
  SettingsSelect: HelperSettingsSelectComponent;
  SettingsInput: ComponentType<HelperSettingsInputProps>;
}

export interface HelperSettingsScreenContribution {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<HostSurfaceProps>;
}

export interface HelperSettingsScreenRegistrar {
  addSettingsScreen(contribution: HelperSettingsScreenContribution): PluginCleanup;
}

export type HelperSettingsFieldKind = "boolean" | "enum" | "string" | "number";

export interface HelperSettingsField {
  key: string;
  kind: HelperSettingsFieldKind;
  label: string;
  description?: string;
  options?: string[];
}

export interface HelperSettingsFieldOverrides {
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
}

const WRAPPER_TYPES = new Set([
  "default",
  "ZodDefault",
  "prefault",
  "ZodPrefault",
  "optional",
  "ZodOptional",
  "nullable",
  "ZodNullable",
  "readonly",
  "ZodReadonly",
  "catch",
  "ZodCatch",
  "nonoptional",
  "ZodNonOptional",
]);

function readDescription(schema: any): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  if (typeof schema.description === "string" && schema.description.length > 0) {
    return schema.description;
  }
  const def = schema._def ?? schema._zod?.def;
  if (def && typeof def.description === "string" && def.description.length > 0) {
    return def.description;
  }
  return undefined;
}

function readInnerType(schema: any): any {
  if (!schema || typeof schema !== "object") return undefined;
  const def = schema._def ?? schema._zod?.def;
  const inner = def?.innerType ?? schema._def?.innerType ?? schema._zod?.def?.innerType;
  return inner;
}

function unwrapField(raw: any): { leaf: any; description?: string } {
  let current = raw;
  let description = readDescription(raw);
  let guard = 0;
  while (current && typeof current === "object" && guard++ < 20) {
    const def = current._def ?? current._zod?.def;
    const type = def?.type ?? def?.typeName;
    const ctor = current.constructor?.name;
    if (
      (typeof type === "string" && WRAPPER_TYPES.has(type)) ||
      (typeof ctor === "string" && WRAPPER_TYPES.has(ctor))
    ) {
      const inner = readInnerType(current);
      if (!inner || inner === current) break;
      current = inner;
      if (!description) description = readDescription(current);
      continue;
    }
    break;
  }
  if (!description) description = readDescription(current);
  return { leaf: current, description };
}

function leafKind(leaf: any): HelperSettingsFieldKind | undefined {
  if (!leaf || typeof leaf !== "object") return undefined;
  const def = leaf._def ?? leaf._zod?.def ?? {};
  const type = def.type ?? def.typeName;
  const ctor = leaf.constructor?.name;
  if (type === "enum" || type === "ZodEnum" || ctor === "ZodEnum") return "enum";
  if (type === "boolean" || type === "ZodBoolean" || ctor === "ZodBoolean") return "boolean";
  if (type === "number" || type === "ZodNumber" || ctor === "ZodNumber") return "number";
  if (
    type === "string" ||
    type === "ZodString" ||
    type === "string_format" ||
    ctor === "ZodString" ||
    (typeof ctor === "string" && ctor.startsWith("ZodString"))
  ) {
    return "string";
  }
  return undefined;
}

function enumValues(leaf: any): string[] | undefined {
  const found: unknown[] = [];
  const sources: any[] = [leaf?._def, leaf?._zod?.def, leaf];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    if (Array.isArray(source.values)) found.push(...source.values);
    if (Array.isArray(source.options)) {
      for (const option of source.options) {
        if (typeof option === "string") found.push(option);
        else if (option && typeof option === "object" && typeof option.value === "string") {
          found.push(option.value);
        }
      }
    }
    if (source.entries && typeof source.entries === "object") {
      for (const value of Object.values(source.entries)) {
        if (typeof value === "string") found.push(value);
      }
    }
    if (source.enum && typeof source.enum === "object") {
      for (const value of Object.values(source.enum)) {
        if (typeof value === "string") found.push(value);
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of found) {
    if (typeof candidate === "string" && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out.length > 0 ? out : undefined;
}

function getObjectShape(schema: any): Record<string, any> | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const direct = schema.shape;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, any>;
  }
  const def = schema._def ?? schema._zod?.def;
  if (def && def.shape && typeof def.shape === "object") {
    return def.shape as Record<string, any>;
  }
  if (def && typeof def.shape === "function") {
    try {
      const resolved = def.shape();
      if (resolved && typeof resolved === "object") return resolved as Record<string, any>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function contractSchemaToFields(
  schema: unknown,
  overrides: HelperSettingsFieldOverrides = {},
): HelperSettingsField[] {
  const shape = getObjectShape(schema);
  if (!shape) {
    console.warn("paseo-plugin-helper: settings schema has no object shape, no fields mapped");
    return [];
  }
  const fields: HelperSettingsField[] = [];
  for (const key of Object.keys(shape)) {
    try {
      const { leaf, description } = unwrapField(shape[key]);
      const kind = leafKind(leaf);
      if (!kind) {
        console.warn(`paseo-plugin-helper: skipping unsupported settings field "${key}"`);
        continue;
      }
      let options: string[] | undefined;
      if (kind === "enum") {
        options = enumValues(leaf);
        if (!options || options.length === 0) {
          console.warn(`paseo-plugin-helper: skipping enum settings field "${key}" with no options`);
          continue;
        }
      }
      const label = overrides.labels?.[key] ?? description ?? key;
      const hint = overrides.descriptions?.[key] ?? description;
      fields.push({
        key,
        kind,
        label,
        ...(hint !== undefined ? { description: hint } : {}),
        ...(options ? { options } : {}),
      });
    } catch {
      console.warn(`paseo-plugin-helper: skipping unreadable settings field "${key}"`);
    }
  }
  return fields;
}

export interface RegisterHelperSettingsScreenOptions {
  ui: HelperSettingsUiBundle;
  id?: string;
  title?: string;
  icon?: string;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
}

function createSettingsScreenComponent<TSettings extends Record<string, any>>(
  contract: SettingsContract<TSettings>,
  ui: HelperSettingsUiBundle,
  fields: HelperSettingsField[],
  sectionTitle: string,
): ComponentType<HostSurfaceProps> {
  const Select = ui.SettingsSelect as unknown as ComponentType<
    HelperSettingsSelectProps<string>
  >;
  return function HelperSettingsScreen(_props: HostSurfaceProps) {
    const { settings, updateSettings } = usePluginSettings(contract);
    return (
      <ui.SettingsCard>
        <ui.SettingsSection title={sectionTitle}>
          {fields.map((field) => {
            if (field.kind === "boolean") {
              return (
                <ui.SettingsSwitch
                  key={field.key}
                  label={field.label}
                  hint={field.description}
                  value={Boolean(settings[field.key])}
                  onValueChange={(value: boolean) =>
                    updateSettings({ [field.key]: value } as Partial<TSettings>)
                  }
                />
              );
            }
            if (field.kind === "enum") {
              const selectOptions = (field.options ?? []).map((value) => ({ label: value, value }));
              const current = String(settings[field.key] ?? field.options?.[0] ?? "");
              return (
                <Select
                  key={field.key}
                  label={field.label}
                  hint={field.description}
                  value={current}
                  options={selectOptions}
                  onValueChange={(value: string) =>
                    updateSettings({ [field.key]: value } as Partial<TSettings>)
                  }
                />
              );
            }
            const raw = settings[field.key];
            const currentText = raw === undefined || raw === null ? "" : String(raw);
            if (field.kind === "number") {
              return (
                <ui.SettingsInput
                  key={field.key}
                  label={field.label}
                  hint={field.description}
                  initialValue={currentText}
                  onChangeText={(text: string) => {
                    if (text.trim() === "") return;
                    const next = Number(text);
                    if (Number.isNaN(next)) return;
                    updateSettings({ [field.key]: next } as Partial<TSettings>);
                  }}
                />
              );
            }
            return (
              <ui.SettingsInput
                key={field.key}
                label={field.label}
                hint={field.description}
                initialValue={currentText}
                onChangeText={(text: string) =>
                  updateSettings({ [field.key]: text } as Partial<TSettings>)
                }
              />
            );
          })}
        </ui.SettingsSection>
      </ui.SettingsCard>
    );
  };
}

export function registerHelperSettingsScreen<TSettings extends Record<string, any>>(
  client: HelperSettingsScreenRegistrar,
  contract: SettingsContract<TSettings>,
  options: RegisterHelperSettingsScreenOptions,
): PluginCleanup {
  const id = options.id ?? contract.name;
  const rawDescription = (contract as { description?: unknown }).description;
  const title =
    options.title ??
    (typeof rawDescription === "string" && rawDescription.length > 0 ? rawDescription : contract.name);
  const icon = options.icon ?? "Settings";
  const fields = contractSchemaToFields(contract.schema, {
    labels: options.labels,
    descriptions: options.descriptions,
  });
  const Component = createSettingsScreenComponent(contract, options.ui, fields, title);
  return client.addSettingsScreen({ id, title, icon, Component });
}

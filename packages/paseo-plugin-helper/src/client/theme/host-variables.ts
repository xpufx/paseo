import type { ThemeColors } from "../../shared/types.js";

/**
 * Paseo 0.8 host theme variables. On web hosts the live theme is exposed as
 * CSS custom properties on the document root; this map binds each variable
 * to the semantic ThemeColors slot it feeds.
 */
export const PASEO_HOST_CSS_VARIABLES = {
  "--background": "surface0",
  "--foreground": "foreground",
  "--muted": "foregroundMuted",
  "--accent": "accent",
  "--accent-foreground": "accentForeground",
  "--border": "border",
} as const satisfies Record<string, keyof ThemeColors>;

export type PaseoHostCssVariable = keyof typeof PASEO_HOST_CSS_VARIABLES;

export interface HostFontVariables {
  sans?: string;
  mono?: string;
}

export interface HostThemeVariables {
  colors: Partial<ThemeColors>;
  fonts: HostFontVariables;
}

interface StyleReader {
  getPropertyValue(name: string): string;
}

interface DomRuntime {
  document?: {
    documentElement?: object;
    defaultView?: {
      getComputedStyle(target: object): StyleReader;
    };
  };
  getComputedStyle?: (target: object) => StyleReader;
}

type MutableColors = { -readonly [K in keyof ThemeColors]: ThemeColors[K] };

const HOST_FONT_VARIABLES: Record<"sans" | "mono", string[]> = {
  sans: ["--font-sans", "--font-family"],
  mono: ["--font-mono", "--font-family-monospace"],
};

function readVariable(names: string[]): string | undefined {
  const runtime = globalThis as unknown as DomRuntime;
  const doc = runtime.document;
  if (!doc?.documentElement) return undefined;
  const getStyle =
    runtime.getComputedStyle ?? doc.defaultView?.getComputedStyle.bind(doc.defaultView);
  if (!getStyle) return undefined;
  try {
    const computed = getStyle(doc.documentElement);
    for (const name of names) {
      const value = computed
        .getPropertyValue(name)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    // Non-DOM runtimes (native, tests) have no computed style to read.
  }
  return undefined;
}

/**
 * Reads the live Paseo 0.8 host variables. Returns empty slots outside a DOM
 * runtime so native callers merge to static defaults untouched.
 */
export function readHostThemeVariables(): HostThemeVariables {
  const colors: Partial<MutableColors> = {};
  for (const [variable, slot] of Object.entries(PASEO_HOST_CSS_VARIABLES)) {
    const value = readVariable([variable]);
    if (value) {
      colors[slot] = value;
    }
  }
  const fonts: HostFontVariables = {};
  const sans = readVariable(HOST_FONT_VARIABLES.sans);
  if (sans) fonts.sans = sans;
  const mono = readVariable(HOST_FONT_VARIABLES.mono);
  if (mono) fonts.mono = mono;
  return { colors, fonts };
}

function definedValues<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Pure merge for the provider: static defaults lose to live host variables,
 * which lose to the injected host theme, which loses to the flair accent.
 * Runtime `undefined` slots are skipped so a partial host theme falls back
 * instead of blanking a slot. Exported for tests; the provider applies it
 * inside useMemo.
 */
export function mergeThemeColors(
  defaults: ThemeColors,
  hostVariables: Partial<ThemeColors>,
  injected: ThemeColors,
  accentOverride?: string,
): ThemeColors {
  return {
    ...defaults,
    ...definedValues(hostVariables),
    ...definedValues(injected),
    ...(accentOverride ? { accent: accentOverride } : {}),
  };
}

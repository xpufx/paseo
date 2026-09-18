import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { PluginTheme } from "../../shared/types.js";
import type { HostLayout } from "../host.js";
import { Appearance } from "react-native";
import { defaultFlair, resolveRadius, type VisualFlair } from "./flair.js";
import { alpha, getContrastColor, getStatusColor, getVariantPalette } from "./color-utils.js";
import {
  getTouchTargetMin,
  isMobilePlatform,
  resolveEffectiveCompact,
  resolvePadding,
} from "./responsive.js";
import {
  mergeThemeColors,
  readHostThemeVariables,
  type HostFontVariables,
} from "./host-variables.js";
import { resolveTypography, type TypographyScale } from "./tokens.js";
import type { ResponsiveLayout, StatusVariant, ThemeColors } from "../../shared/types.js";

export interface PluginThemeContextValue {
  theme: PluginTheme;
  colors: ThemeColors;
  fonts: HostFontVariables;
  layout: ResponsiveLayout;
  flair: VisualFlair;
  isCompact: boolean;
  isMobile: boolean;
  touchTargetMin: number;
  alpha: (color: string, opacity: number) => string;
  getContrastColor: (bgHex: string, light?: string, dark?: string) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
  resolveRadius: (size?: "xs" | "sm" | "md" | "lg" | "pill") => number;
  padding: { horizontal: number; vertical: number; gap: number };
  typography: TypographyScale;
}

const defaultLayout: ResponsiveLayout = {
  compact: false,
  platform: "web",
};

export const defaultDarkTheme: PluginTheme = {
  colors: {
    surface0: "#18181b",
    surface1: "#27272a",
    surface2: "#3f3f46",
    border: "#3f3f46",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    accent: "#3b82f6",
    accentForeground: "#ffffff",
    statusSuccess: "#22c55e",
    statusWarning: "#eab308",
    statusDanger: "#ef4444",
  },
};

export const defaultLightTheme: PluginTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#e4e4e7",
    foreground: "#09090b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#ca8a04",
    statusDanger: "#dc2626",
  },
};

export function getDefaultTheme(scheme?: string): PluginTheme {
  if (scheme === "light") {
    return defaultLightTheme;
  }
  return defaultDarkTheme;
}

export function useAppearanceScheme(): [string | undefined, (s: string | undefined) => void] {
  const [scheme, setScheme] = useState<string | undefined>(Appearance.getColorScheme?.() ?? undefined);
  useEffect(() => {
    const sub = Appearance.addChangeListener?.(({colorScheme}) => {
      setScheme(colorScheme ?? undefined);
    });
    return () => {
      // remove listener if possible
      // Appearance.addChangeListener returns an object with remove method in RN
      // but in web we may not have it; ignore safely
      if (sub && typeof (sub as any).remove === "function") {
        (sub as any).remove();
      }
    };
  }, []);
  return [scheme, setScheme];
}

const [initialScheme] = useAppearanceScheme();
const initialDefaultTheme = getDefaultTheme(initialScheme);


const PluginThemeContext = createContext<PluginThemeContextValue>({
  theme: initialDefaultTheme,
  colors: initialDefaultTheme.colors,
  fonts: {},
  layout: defaultLayout,
  flair: defaultFlair,
  isCompact: false,
  isMobile: false,
  touchTargetMin: 28,
  alpha: (color, op) => alpha(color, op),
  getContrastColor: (bg, l, d) => getContrastColor(bg, l, d),
  getStatusColor: (v) => getStatusColor(v, initialDefaultTheme.colors),
  getVariantPalette: (v) => getVariantPalette(v, initialDefaultTheme.colors),
  resolveRadius: (s) => resolveRadius("rounded", s),
  padding: resolvePadding(defaultLayout, "comfortable"),
  typography: resolveTypography(defaultLayout, "comfortable"),
});

export interface PluginThemeProviderProps {
  theme: PluginTheme;
  layout?: HostLayout;
  flair?: Partial<VisualFlair>;
  children: ReactNode;
}

export function PluginThemeProvider({
  theme,
  layout = defaultLayout,
  flair: userFlair,
  children,
}: PluginThemeProviderProps) {
  const hostWidth =
    typeof layout.width === "number" && layout.width > 0 ? layout.width : undefined;
  const needsMeasurement = hostWidth === undefined;
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent?.layout?.width;
    if (typeof width !== "number" || width <= 0) return;
    setMeasuredWidth((prev) => (prev === width ? prev : width));
  }, []);

  const effectiveWidth = hostWidth ?? measuredWidth;

  const value = useMemo<PluginThemeContextValue>(() => {
    const flair: VisualFlair = { ...defaultFlair, ...userFlair };
    const hostVariables = readHostThemeVariables();
    const effectiveColors = mergeThemeColors(
      getDefaultTheme().colors,
      hostVariables.colors,
      theme.colors,
      flair.accentColor,
    );

    const isCompact = resolveEffectiveCompact(layout, effectiveWidth);
    const effectiveLayout: ResponsiveLayout =
      effectiveWidth !== undefined
        ? { ...layout, width: effectiveWidth, compact: isCompact }
        : { ...layout, compact: isCompact };
    const isMobile = isMobilePlatform(effectiveLayout.platform);
    const touchTargetMin = getTouchTargetMin(effectiveLayout);
    const padding = resolvePadding(effectiveLayout, flair.density);
    const typography = resolveTypography(effectiveLayout, flair.density);

    return {
      theme,
      colors: effectiveColors,
      fonts: hostVariables.fonts,
      layout: effectiveLayout,
      flair,
      isCompact,
      isMobile,
      touchTargetMin,
      alpha: (c, o) => alpha(c, o),
      getContrastColor: (bg, l, d) => getContrastColor(bg, l, d),
      getStatusColor: (v) => getStatusColor(v, effectiveColors, flair.accentColor),
      getVariantPalette: (v) => getVariantPalette(v, effectiveColors, flair.accentColor),
      resolveRadius: (size = "md") => resolveRadius(flair.radius, size),
      padding,
      typography,
    };
  }, [theme, layout, userFlair, effectiveWidth]);

  return (
    <PluginThemeContext.Provider value={value}>
      {needsMeasurement ? (
        <View style={styles.measureContainer} onLayout={handleLayout}>
          {children}
        </View>
      ) : (
        children
      )}
    </PluginThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  measureContainer: { flex: 1 },
});

export function usePluginTheme(): PluginThemeContextValue {
  return useContext(PluginThemeContext);
}

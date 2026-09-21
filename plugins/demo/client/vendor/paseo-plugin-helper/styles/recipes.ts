import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme, StatusVariant, ThemeColors } from "../../../../shared/vendor/paseo-plugin-helper/types";
import { alpha, getStatusColor, getVariantPalette } from "../theme/color-utils";
import { defaultDarkTheme, type PluginThemeContextValue } from "../theme/provider";
import { FALLBACK_ACCENT_FOREGROUND } from "../theme/tokens";
import type { SurfaceStyle } from "../theme/flair";
import type { ButtonSize, ButtonVariant } from "../components/Button";
import type { BadgeSize, BadgeStyle } from "../components/Badge";

export type ThemeInput =
  | PluginTheme
  | PluginThemeContextValue
  | ThemeColors
  | { colors: ThemeColors }
  | undefined;

/**
 * Resolves ThemeColors from a PluginTheme, PluginThemeContextValue, ThemeColors, or undefined.
 */
export function resolveThemeColors(themeInput?: ThemeInput): ThemeColors {
  if (!themeInput) return defaultDarkTheme.colors;
  if ("colors" in themeInput && themeInput.colors) return themeInput.colors;
  if ("surface0" in themeInput && typeof (themeInput as ThemeColors).surface0 === "string") {
    return themeInput as ThemeColors;
  }
  return defaultDarkTheme.colors;
}

// ---------------------------------------------------------------------------
// 1. INPUT RECIPE
// ---------------------------------------------------------------------------

export interface InputRecipeOptions {
  focused?: boolean;
  isFocused?: boolean;
  error?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  mono?: boolean;
  compact?: boolean;
  size?: "sm" | "md" | "lg";
}

export interface InputRecipeResult extends TextStyle, ViewStyle {
  input: TextStyle & ViewStyle;
  container: ViewStyle;
  label: TextStyle;
  hint: TextStyle;
}

/**
 * Generates standard React Native styles for text inputs and surrounding container/label/hint elements.
 */
export function inputRecipe(
  themeInput?: ThemeInput,
  options?: InputRecipeOptions,
): InputRecipeResult {
  const colors = resolveThemeColors(themeInput);
  const isFocused = Boolean(options?.focused ?? options?.isFocused);
  const hasError = Boolean(options?.error ?? options?.hasError);
  const disabled = Boolean(options?.disabled);
  const multiline = Boolean(options?.multiline);
  const mono = Boolean(options?.mono);
  const compact = Boolean(options?.compact);

  const borderColor = hasError
    ? colors.statusDanger
    : isFocused
      ? colors.accent
      : colors.border;

  const minHeight = multiline
    ? 64
    : options?.size === "sm"
      ? 30
      : options?.size === "lg"
        ? 42
        : compact
          ? 32
          : 36;
  const fontSize =
    options?.size === "sm" ? 12 : options?.size === "lg" ? 15 : compact ? 13 : 14;
  const paddingVertical = multiline
    ? 8
    : options?.size === "sm"
      ? 4
      : options?.size === "lg"
        ? 8
        : 6;
  const paddingHorizontal =
    options?.size === "sm" ? 8 : options?.size === "lg" ? 12 : 10;

  const baseInput: TextStyle & ViewStyle = {
    backgroundColor: disabled ? alpha(colors.surface1, 0.5) : colors.surface0,
    borderColor,
    borderWidth: 1,
    borderRadius: 8,
    color: disabled ? colors.foregroundMuted : colors.foreground,
    fontSize,
    fontFamily: mono ? "monospace" : undefined,
    minHeight,
    paddingHorizontal,
    paddingVertical,
  };

  const container: ViewStyle = {
    gap: 4,
    width: "100%",
  };

  const label: TextStyle = {
    color: hasError ? colors.statusDanger : colors.foreground,
    fontSize: compact ? 12 : 13,
    fontWeight: "600",
  };

  const hint: TextStyle = {
    color: hasError ? colors.statusDanger : colors.foregroundMuted,
    fontSize: 11,
    marginTop: 2,
  };

  return Object.assign(baseInput, {
    input: baseInput,
    container,
    label,
    hint,
  });
}

// ---------------------------------------------------------------------------
// 2. CARD RECIPE
// ---------------------------------------------------------------------------

export interface CardRecipeOptions {
  variant?: SurfaceStyle;
  noPadding?: boolean;
  radius?: number;
  borderWidth?: number;
  compact?: boolean;
}

export interface CardRecipeResult extends ViewStyle {
  card: ViewStyle;
  header: ViewStyle;
  headerTitle: TextStyle;
  headerSubtitle: TextStyle;
}

/**
 * Generates standard React Native styles for cards and card headers.
 */
export function cardRecipe(
  themeInput?: ThemeInput,
  optionsOrVariant?: CardRecipeOptions | SurfaceStyle,
): CardRecipeResult {
  const colors = resolveThemeColors(themeInput);
  const options: CardRecipeOptions =
    typeof optionsOrVariant === "string" ? { variant: optionsOrVariant } : (optionsOrVariant ?? {});

  const variant = options.variant ?? "flat";
  const noPadding = Boolean(options.noPadding);
  const radius = options.radius ?? 8;
  const borderWidth = options.borderWidth ?? 1;

  let bg = colors.surface0;
  let border = colors.border;

  if (variant === "tinted") {
    bg = alpha(colors.accent, 0.04);
    border = alpha(colors.accent, 0.2);
  } else if (variant === "elevated") {
    bg = colors.surface1;
    border = colors.border;
  }

  const baseCard: ViewStyle = {
    backgroundColor: bg,
    borderColor: border,
    borderWidth,
    borderRadius: radius,
    paddingHorizontal: noPadding ? 0 : 12,
    paddingVertical: noPadding ? 0 : 10,
    width: "100%",
    overflow: "hidden",
  };

  const header: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
    marginBottom: 8,
  };

  const headerTitle: TextStyle = {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  };

  const headerSubtitle: TextStyle = {
    color: colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "400",
  };

  return Object.assign(baseCard, {
    card: baseCard,
    header,
    headerTitle,
    headerSubtitle,
  });
}

// ---------------------------------------------------------------------------
// 3. BUTTON RECIPE
// ---------------------------------------------------------------------------

export interface ButtonRecipeOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}

export interface ButtonRecipeResult extends ViewStyle {
  container: ViewStyle;
  text: TextStyle;
}

/**
 * Generates standard React Native styles for interactive buttons and text labels.
 */
export function buttonRecipe(
  themeInput?: ThemeInput,
  optionsOrVariant?: ButtonRecipeOptions | ButtonVariant,
): ButtonRecipeResult {
  const colors = resolveThemeColors(themeInput);
  const options: ButtonRecipeOptions =
    typeof optionsOrVariant === "string" ? { variant: optionsOrVariant } : (optionsOrVariant ?? {});

  const variant = options.variant ?? "secondary";
  const size = options.size ?? "md";
  const pressed = Boolean(options.pressed);
  const disabled = Boolean(options.disabled || options.loading);
  const compact = Boolean(options.compact);

  const radius = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  const py = size === "sm" ? (compact ? 5 : 6) : size === "lg" ? 12 : compact ? 8 : 10;
  const px = size === "sm" ? (compact ? 8 : 10) : size === "lg" ? 18 : compact ? 12 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;

  let bg = "transparent";
  let border = "transparent";
  let textColor = colors.foreground;

  switch (variant) {
    case "primary":
      bg = colors.accent;
      textColor = colors.accentForeground || FALLBACK_ACCENT_FOREGROUND;
      break;
    case "danger":
      bg = alpha(colors.statusDanger, 0.15);
      border = alpha(colors.statusDanger, 0.4);
      textColor = colors.statusDanger;
      break;
    case "ghost":
      bg = "transparent";
      textColor = colors.foregroundMuted;
      break;
    case "secondary":
    default:
      bg = colors.surface1;
      border = colors.border;
      textColor = colors.foreground;
      break;
  }

  const effectiveBg = pressed && !disabled ? alpha(bg === "transparent" ? colors.surface2 : bg, 0.8) : bg;

  const container: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: effectiveBg,
    borderColor: border,
    borderWidth: border !== "transparent" ? 1 : 0,
    borderRadius: radius,
    paddingVertical: py,
    paddingHorizontal: px,
    minHeight: size === "sm" ? 28 : size === "lg" ? 42 : 34,
    opacity: disabled ? 0.45 : 1,
  };

  const text: TextStyle = {
    color: textColor,
    fontSize,
    fontWeight: "600",
    textAlign: "center",
  };

  return Object.assign(container, {
    container,
    text,
  });
}

// ---------------------------------------------------------------------------
// 4. TAB STRIP & TAB ITEM RECIPES
// ---------------------------------------------------------------------------

export interface TabStripRecipeOptions {
  radius?: number;
}

export interface TabStripRecipeResult extends ViewStyle {
  frame: ViewStyle;
  track: ViewStyle;
}

/**
 * Generates standard React Native styles for tab tracks and bounding frames.
 */
export function tabStripRecipe(
  themeInput?: ThemeInput,
  options?: TabStripRecipeOptions,
): TabStripRecipeResult {
  const colors = resolveThemeColors(themeInput);
  const radius = options?.radius ?? 8;

  const frame: ViewStyle = {
    width: "100%",
    backgroundColor: colors.surface1,
    borderRadius: radius,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
  };

  const track: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    padding: 3,
    gap: 2,
  };

  return Object.assign(frame, {
    frame,
    track,
  });
}

export interface TabItemRecipeOptions {
  active?: boolean;
  pressed?: boolean;
  compact?: boolean;
  fit?: boolean;
}

export interface TabItemRecipeResult extends ViewStyle {
  container: ViewStyle;
  text: TextStyle;
  badge: ViewStyle;
  badgeText: TextStyle;
}

/**
 * Generates standard React Native styles for individual tab buttons and inner badges.
 */
export function tabItemRecipe(
  themeInput?: ThemeInput,
  activeOrOptions?: boolean | TabItemRecipeOptions,
  options?: TabItemRecipeOptions,
): TabItemRecipeResult {
  const colors = resolveThemeColors(themeInput);
  const mergedOptions: TabItemRecipeOptions =
    typeof activeOrOptions === "boolean"
      ? { active: activeOrOptions, ...options }
      : (activeOrOptions ?? {});

  const isActive = Boolean(mergedOptions.active);
  const pressed = Boolean(mergedOptions.pressed);
  const compact = Boolean(mergedOptions.compact);
  const fit = mergedOptions.fit ?? true;

  const bg = isActive
    ? colors.surface2
    : pressed
      ? alpha(colors.surface2, 0.5)
      : "transparent";

  const container: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
    borderRadius: 6,
    minHeight: compact ? 26 : 30,
    backgroundColor: bg,
    paddingHorizontal: compact ? 8 : 12,
    paddingVertical: compact ? 4 : 6,
    ...(fit ? { flex: 1, flexShrink: 1, minWidth: 0 } : { flexShrink: 0 }),
  };

  const text: TextStyle = {
    color: isActive ? colors.foreground : colors.foregroundMuted,
    fontSize: compact ? 11 : 12,
    fontWeight: isActive ? "600" : "500",
    textAlign: "center",
  };

  const badge: ViewStyle = {
    borderRadius: 9999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isActive ? colors.accent : alpha(colors.foregroundMuted, 0.2),
  };

  const badgeText: TextStyle = {
    fontSize: 10,
    fontWeight: "700",
    color: isActive ? colors.accentForeground || FALLBACK_ACCENT_FOREGROUND : colors.foregroundMuted,
  };

  return Object.assign(container, {
    container,
    text,
    badge,
    badgeText,
  });
}

// ---------------------------------------------------------------------------
// 5. BADGE RECIPE
// ---------------------------------------------------------------------------

export interface BadgeRecipeOptions {
  variant?: StatusVariant;
  styleVariant?: BadgeStyle;
  size?: BadgeSize;
}

export interface BadgeRecipeResult extends ViewStyle {
  container: ViewStyle;
  text: TextStyle;
  dot: ViewStyle;
}

/**
 * Generates standard React Native styles for pill badges, indicators, and labels.
 */
export function badgeRecipe(
  themeInput?: ThemeInput,
  variantOrOptions?: StatusVariant | BadgeRecipeOptions,
  options?: BadgeRecipeOptions,
): BadgeRecipeResult {
  const colors = resolveThemeColors(themeInput);
  const mergedOptions: BadgeRecipeOptions =
    typeof variantOrOptions === "string"
      ? { variant: variantOrOptions, ...options }
      : (variantOrOptions ?? {});

  const variant = mergedOptions.variant ?? "neutral";
  const styleVariant = mergedOptions.styleVariant ?? "tinted";
  const size = mergedOptions.size ?? "md";

  const palette = getVariantPalette(variant, colors);
  const solidColor = getStatusColor(variant, colors);

  let bg = palette.bg;
  let border = palette.border;
  let textColor = palette.text;

  if (styleVariant === "outline") {
    bg = "transparent";
    border = palette.border;
    textColor = palette.text;
  } else if (styleVariant === "solid") {
    bg = solidColor;
    border = "transparent";
    textColor = colors.accentForeground || FALLBACK_ACCENT_FOREGROUND;
  }

  const fontSize = size === "sm" ? 10 : 11;
  const lineHeight = size === "sm" ? 12 : 15;
  const paddingVertical = size === "sm" ? 1 : 2;
  const paddingHorizontal = size === "sm" ? 5 : 8;

  const container: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: bg,
    borderColor: border,
    borderWidth: 1,
    borderRadius: 9999,
    paddingVertical,
    paddingHorizontal,
    gap: 4,
  };

  const text: TextStyle = {
    color: textColor,
    fontSize,
    lineHeight,
    fontWeight: "600",
  };

  const dot: ViewStyle = {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: textColor,
  };

  return Object.assign(container, {
    container,
    text,
    dot,
  });
}

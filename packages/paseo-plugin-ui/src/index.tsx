import React, {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView as RNScrollView,
  Text,
  View,
  type RefreshControlProps,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  Icon,
  ScrollView as HostScrollView,
  TextInput as HostTextInputPrimitive,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { resolveMetricStatus } from "./metrics.js";
import type {
  MetricThresholds,
  ResponsiveLayout,
  StatusVariant,
  ThemeColors,
} from "./types.js";

/**
 * Canonical shared composition of the presentational pieces every plugin used
 * to hand-roll in its local `client/host-ui.tsx` (xpufx-org/paseo#937, #976).
 *
 * The host SDK owns the design language and provides the primitives that carry
 * host behaviour (`Icon`, `ScrollView`, `useToast`, `copyText`); everything
 * here is plain React Native layout and color-token composition on top of the
 * host `theme` prop.
 *
 * This package is private and bundled (inlined) into each consuming plugin at
 * build time, so it deliberately imports only the host plugin allowlist:
 * `@getpaseo/plugin/client/react-native`, `react`, and `react-native`. It has
 * no root provider and no `react-native-svg`.
 *
 * Components keep the `Host*` names and prop shapes the plugins already use so
 * call sites only change the import path.

// --- theme -----------------------------------------------------------------

/** Converts a hex/rgb color and opacity (0..1) into an alpha-applied color. */
export function alpha(color: string, opacity: number): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const clamped = Math.max(0, Math.min(1, opacity));

  if (color.startsWith("#")) {
    let clean = color.replace("#", "");
    if (clean.length === 3) {
      clean = clean
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (clean.length === 4) {
      clean = clean
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (clean.length === 8) {
      clean = clean.slice(0, 6);
    }
    const alphaHex = Math.round(clamped * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${clean}${alphaHex}`;
  }

  if (color.startsWith("rgb")) {
    const parts = color.replace(/[^\d,.]/g, "").split(",");
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clamped})`;
    }
  }

  return color;
}

/** Resolves a status variant to a host theme color. */
export function getStatusColor(
  variant: StatusVariant,
  colors: ThemeColors,
  customAccent?: string,
): string {
  const accent = customAccent || colors.accent;
  switch (variant) {
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "accent":
      return accent;
    case "info":
      return colors.accent;
    case "neutral":
    default:
      return colors.foregroundMuted;
  }
}

export type { MetricThresholds, PluginTheme, ResponsiveLayout, StatusVariant, ThemeColors } from "./types.js";

export interface PluginUiTheme {
  colors: ThemeColors;
  alpha: (color: string, opacity: number) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
}

export const FALLBACK_COLORS: ThemeColors = {
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
};

/**
 * Fills a possibly-partial host `theme.colors` from FALLBACK_COLORS.
 * Ensures no color token evaluates to undefined on platforms providing partial palettes.
 */
export function resolveHostColors(colors?: Partial<ThemeColors> | null): ThemeColors {
  return { ...FALLBACK_COLORS, ...(colors ?? {}) };
}

function createPluginUiTheme(colors: ThemeColors): PluginUiTheme {
  return {
    colors,
    alpha,
    getStatusColor: (variant) => getStatusColor(variant, colors),
    getVariantPalette: (variant) => {
      const base = getStatusColor(variant, colors);
      return { bg: alpha(base, 0.12), text: base, border: alpha(base, 0.3) };
    },
  };
}

const ThemeContext = createContext<PluginUiTheme>(createPluginUiTheme(FALLBACK_COLORS));

export interface HostThemeProviderProps {
  theme?: { colors: ThemeColors } | { colors?: Partial<ThemeColors> };
  children: ReactNode;
}

/**
 * Carries the host `theme` prop colors to every local adapter below it. Falls
 * back to the static neutral palette when no host theme is supplied (tests,
 * previews) so adapters still render.
 */
export function HostThemeProvider({ theme, children }: HostThemeProviderProps) {
  const value = useMemo(
    () => createPluginUiTheme(resolveHostColors(theme?.colors as Partial<ThemeColors> | undefined)),
    [theme?.colors],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reads the host theme supplied by {@link HostThemeProvider}. */
export function useHostTheme(): PluginUiTheme {
  return useContext(ThemeContext);
}

const DEFAULT_LAYOUT: ResponsiveLayout = { compact: false, platform: "web" };
const LayoutContext = createContext<ResponsiveLayout>(DEFAULT_LAYOUT);

export interface HostLayoutProviderProps {
  layout: ResponsiveLayout;
  children: ReactNode;
}

/** Carries the host layout descriptor to local adapters that branch on it. */
export function HostLayoutProvider({ layout, children }: HostLayoutProviderProps) {
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>;
}

/** Reads the host layout descriptor. */
export function useHostLayout(): ResponsiveLayout {
  return useContext(LayoutContext);
}

// --- layout ----------------------------------------------------------------

export interface HostRowProps {
  children: ReactNode;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function HostRow({
  children,
  gap = 8,
  align = "center",
  justify = "start",
  wrap = false,
  style,
}: HostRowProps) {
  return (
    <View
      style={[
        styles.row,
        {
          gap,
          alignItems: alignMap[align],
          justifyContent: justifyMap[justify],
          flexWrap: wrap ? "wrap" : "nowrap",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface HostStackProps {
  children: ReactNode;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function HostStack({
  children,
  gap = 8,
  align = "stretch",
  justify = "start",
  grow = false,
  style,
}: HostStackProps) {
  return (
    <View
      style={[
        styles.stack,
        {
          gap,
          alignItems: alignMap[align],
          justifyContent: justifyMap[justify],
          ...(grow ? { flex: 1, minHeight: 0 } : null),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface HostGridProps {
  children: ReactNode;
  columns?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function HostGrid({ children, columns = 2, gap = 8, style }: HostGridProps) {
  return (
    <View style={[styles.grid, { gap }, style]}>
      {React.Children.map(children, (child) => (
        <View style={{ flexBasis: `${100 / columns}%`, flexGrow: 0, flexShrink: 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// --- card ------------------------------------------------------------------

export type HostSurfaceVariant = "flat" | "elevated" | "tinted";

function resolveHostSurface(
  colors: ThemeColors,
  variant: HostSurfaceVariant = "flat",
): { backgroundColor: string; borderColor: string } {
  switch (variant) {
    case "elevated":
      return { backgroundColor: colors.surface1, borderColor: colors.border };
    case "tinted":
      return { backgroundColor: alpha(colors.accent, 0.04), borderColor: alpha(colors.accent, 0.2) };
    case "flat":
    default:
      return { backgroundColor: colors.surface0, borderColor: colors.border };
  }
}

export interface HighlightPart {
  text: string;
  matched: boolean;
}

export interface HighlightOptions {
  fallbackToWholeField?: boolean;
}

export function splitHighlightParts(
  text: string,
  query: string,
  options: HighlightOptions = {},
): HighlightPart[] {
  const needle = query.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!needle || !text) return [{ text, matched: false }];
  const haystack = text.toLowerCase();
  if (haystack.includes(needle)) {
    const parts: HighlightPart[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      const hit = haystack.indexOf(needle, cursor);
      if (hit === -1) {
        parts.push({ text: text.slice(cursor), matched: false });
        break;
      }
      if (hit > cursor) parts.push({ text: text.slice(cursor, hit), matched: false });
      parts.push({ text: text.slice(hit, hit + needle.length), matched: true });
      cursor = hit + needle.length;
    }
    return parts.length > 0 ? parts : [{ text, matched: false }];
  }
  const tokens = needle
    .split(/[\s,./_\\:;-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length) {
    const sorted = [...tokens].sort((a, b) => b.length - a.length);
    const parts: HighlightPart[] = [];
    let matchedAny = false;
    let cursor = 0;
    while (cursor < text.length) {
      let best: { index: number; token: string } | null = null;
      for (const token of sorted) {
        let idx = haystack.indexOf(token, cursor);
        while (idx !== -1) {
          const atWordBoundary = idx === 0 || !/[a-z0-9]/i.test(haystack[idx - 1] ?? "");
          if (atWordBoundary) {
            if (best === null || idx < best.index) best = { index: idx, token };
            break;
          }
          idx = haystack.indexOf(token, idx + 1);
        }
      }
      if (best === null) {
        parts.push({ text: text.slice(cursor), matched: false });
        break;
      }
      if (best.index > cursor) parts.push({ text: text.slice(cursor, best.index), matched: false });
      parts.push({ text: text.slice(best.index, best.index + best.token.length), matched: true });
      matchedAny = true;
      cursor = best.index + best.token.length;
    }
    if (matchedAny) return parts;
  }
  return options.fallbackToWholeField ? [{ text, matched: true }] : [{ text, matched: false }];
}

export interface HostHighlightedTextProps {
  text: string;
  query: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  fuzzyFallback?: boolean;
}

/** `<Text>` that paints literal query matches with the accent. */
export function HostHighlightedText({
  text,
  query,
  style,
  numberOfLines,
  selectable,
  fuzzyFallback = false,
}: HostHighlightedTextProps) {
  const { colors } = useHostTheme();
  const parts = useMemo(
    () => splitHighlightParts(text, query, { fallbackToWholeField: fuzzyFallback }),
    [text, query, fuzzyFallback],
  );
  return (
    <Text style={style} numberOfLines={numberOfLines} selectable={selectable}>
      {parts.map((part, index) =>
        part.matched ? (
          <Text
            key={`m${index}`}
            style={{ backgroundColor: colors.accent, color: colors.accentForeground }}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

export interface HostCardProps {
  children: ReactNode;
  variant?: HostSurfaceVariant;
  style?: StyleProp<ViewStyle>;
  noPadding?: boolean;
}

export interface HostCardHeaderProps {
  title: string | ReactNode;
  subtitle?: string;
  value?: string | number | ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  highlightQuery?: string;
}

function HostCardBase({ children, variant, style, noPadding = false }: HostCardProps) {
  const { colors } = useHostTheme();
  const surface = resolveHostSurface(colors, variant);
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: surface.backgroundColor,
          borderColor: surface.borderColor,
          padding: noPadding ? 0 : 12,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function HostCardHeader({
  title,
  subtitle,
  value,
  badge,
  action,
  icon,
  style,
  titleStyle,
  subtitleStyle,
  highlightQuery,
}: HostCardHeaderProps) {
  const { colors } = useHostTheme();
  const renderedTitle =
    typeof title === "string" && highlightQuery ? (
      <HostHighlightedText text={title} query={highlightQuery} fuzzyFallback />
    ) : (
      title
    );
  return (
    <View style={[styles.cardHeader, style]}>
      <View style={styles.cardHeaderLeft}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={styles.titleColumn}>
          {typeof renderedTitle === "string" ? (
            <Text
              style={[styles.cardHeaderTitle, { color: colors.foreground }, titleStyle]}
              numberOfLines={1}
            >
              {renderedTitle}
            </Text>
          ) : (
            renderedTitle
          )}
          {subtitle ? (
            <Text
              style={[styles.cardHeaderSubtitle, { color: colors.foregroundMuted }, subtitleStyle]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.cardHeaderRight}>
        {badge ? <View style={{ marginRight: 4 }}>{badge}</View> : null}
        {typeof value === "string" || typeof value === "number" ? (
          <Text style={[styles.cardHeaderValue, { color: colors.foreground }]}>{value}</Text>
        ) : (
          value
        )}
        {action}
      </View>
    </View>
  );
}

export const HostCard = Object.assign(HostCardBase, { Header: HostCardHeader });


// --- section header --------------------------------------------------------

export interface HostSectionHeaderProps {
  title: string;
  count?: number;
  badgeVariant?: StatusVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function HostSectionHeader({
  title,
  count,
  badgeVariant,
  style,
  textStyle,
}: HostSectionHeaderProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[styles.sectionTitle, { color: colors.foregroundMuted }, textStyle]}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <HostBadge
          label={String(count)}
          variant={badgeVariant ?? (count > 0 ? "warning" : "neutral")}
          styleVariant={count > 0 ? "solid" : "tinted"}
          size="sm"
        />
      ) : null}
    </View>
  );
}

// --- badge -----------------------------------------------------------------

export type HostBadgeStyle = "tinted" | "outline" | "solid";
export type HostBadgeSize = "sm" | "md";

export interface HostBadgeProps {
  label: string;
  variant?: StatusVariant;
  styleVariant?: HostBadgeStyle;
  size?: HostBadgeSize;
  icon?: string | ReactNode;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  highlightQuery?: string;
  highlightFuzzyFallback?: boolean;
}

export function HostBadge({
  label,
  variant = "neutral",
  styleVariant = "tinted",
  size = "md",
  icon,
  dot = false,
  style,
  textStyle,
  highlightQuery,
  highlightFuzzyFallback,
}: HostBadgeProps) {
  const { colors, getVariantPalette, getStatusColor: statusColor } = useHostTheme();

  const fontSize = size === "sm" ? 10 : 11;
  const lineHeight = size === "sm" ? 12 : 15;
  const paddingVertical = size === "sm" ? 1 : 2;
  const paddingHorizontal = size === "sm" ? 5 : 8;
  const iconSize = size === "sm" ? 10 : 11;

  const palette = getVariantPalette(variant);
  const solidColor = statusColor(variant);

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
    textColor = colors.accentForeground;
  }

  const renderIcon = () => {
    if (dot) {
      return <View style={[styles.dot, { backgroundColor: textColor }]} />;
    }
    if (!icon) return null;
    if (typeof icon === "string") {
      return <Icon name={icon} size={iconSize} color={textColor} />;
    }
    return icon;
  };

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderColor: border, paddingVertical, paddingHorizontal },
        style,
      ]}
    >
      {renderIcon()}
      <Text
        accessibilityLabel={label}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[styles.badgeText, { color: textColor, fontSize, lineHeight }, textStyle]}
      >
        {highlightQuery ? (
          <HostHighlightedText
            text={label}
            query={highlightQuery}
            fuzzyFallback={highlightFuzzyFallback}
            numberOfLines={1}
          />
        ) : (
          label
        )}
      </Text>
    </View>
  );
}

export interface HostVitalProps {
  children: ReactNode;
  icon?: string | ReactNode;
  color: string;
  /** Chip grows to share the row and caps at `maxWidth` (default 110). */
  grow?: boolean;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Icon + text chip used to pack the timeline card's vitals several per row.
 *
 * A chip must never claim the full row: it grows from its content width and
 * caps out, so a wrapping parent fits as many as the width allows instead of
 * collapsing to one pill per line (xpufx-org/paseo#1010).
 */
export function HostVital({
  children,
  icon,
  color,
  grow = true,
  maxWidth = 110,
  style,
}: HostVitalProps) {
  return (
    <View
      style={[
        styles.vital,
        grow ? { flexGrow: 1, maxWidth, justifyContent: "center" } : null,
        style,
      ]}
    >
      {icon ? (
        typeof icon === "string" ? (
          <Icon name={icon} size={12} color={color} />
        ) : (
          icon
        )
      ) : null}
      <Text numberOfLines={1} style={[styles.vitalText, { color }]}>
        {children}
      </Text>
    </View>
  );
}

export interface HostStatusDotProps {
  variant?: StatusVariant;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function HostStatusDot({
  variant = "neutral",
  size = "md",
  pulse = false,
  style,
}: HostStatusDotProps) {
  const { getStatusColor } = useHostTheme();
  const color = getStatusColor(variant);
  const dimension = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  return (
    <View
      style={[
        styles.statusDot,
        {
          width: dimension,
          height: dimension,
          backgroundColor: color,
          opacity: pulse ? 0.6 : 1,
        },
        style,
      ]}
    />
  );
}

// --- progress / gauge ------------------------------------------------------

export interface HostProgressBarProps {
  value: number;
  color?: string;
  autoStatusColor?: boolean;
  thresholds?: MetricThresholds;
  label?: string;
  showValueText?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function HostProgressBar({
  value,
  color,
  autoStatusColor = true,
  thresholds,
  label,
  showValueText = false,
  height = 8,
  style,
}: HostProgressBarProps) {
  const { colors } = useHostTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  let barColor = color || colors.accent;
  if (!color && autoStatusColor) {
    const status = resolveMetricStatus(clamped, thresholds);
    barColor =
      status === "danger"
        ? colors.statusDanger
        : status === "warning"
          ? colors.statusWarning
          : colors.statusSuccess;
  }

  return (
    <View style={[styles.progressContainer, style]}>
      {(label || showValueText) && (
        <View style={styles.progressLabelRow}>
          {label ? (
            <Text style={[styles.progressLabel, { color: colors.foregroundMuted }]}>{label}</Text>
          ) : null}
          {showValueText ? (
            <Text style={[styles.progressValue, { color: colors.foreground }]}>
              {Math.round(clamped)}%
            </Text>
          ) : null}
        </View>
      )}
      <View
        style={[
          styles.progressTrack,
          { backgroundColor: colors.surface2, height, borderRadius: height / 2 },
        ]}
      >
        <View
          style={[
            styles.progressFill,
            { width: `${clamped}%`, backgroundColor: barColor, borderRadius: height / 2 },
          ]}
        />
      </View>
    </View>
  );
}

export interface HostMetricGaugeProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  thresholds?: MetricThresholds;
  color?: string;
  autoStatusColor?: boolean;
  label?: string;
  showPercent?: boolean;
  centerSlot?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface GaugeArcProps {
  which: "left" | "right";
  size: number;
  strokeWidth: number;
  color: string;
  rotate: number;
  testID: string;
}

/**
 * One half of a no-SVG ring arc.
 *
 * A full ring with only its top and right borders colored is a 180deg arc; the
 * half-width window clips it to one side of the circle, and the rotation places
 * where that half begins. Two halves compose the full 0..360 sweep without
 * `react-native-svg`, which the host plugin runtime does not bundle. The angle
 * math is in `HostMetricGauge`: the right window shows the 0..min(A,180) part,
 * the left window the 180..A part.
 */
function GaugeArc({ which, size, strokeWidth, color, rotate, testID }: GaugeArcProps) {
  const radius = size / 2;
  const right = which === "right";
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: right ? size / 2 : 0,
        width: size / 2,
        height: size,
        overflow: "hidden",
      }}
    >
      <View
        testID={testID}
        style={{
          position: "absolute",
          top: 0,
          left: right ? -size / 2 : 0,
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth: strokeWidth,
          borderColor: "transparent",
          borderTopColor: color,
          borderRightColor: color,
          transform: [{ rotate: `${rotate}deg` }],
        }}
      />
    </View>
  );
}

export function HostMetricGauge({
  value,
  size = 76,
  strokeWidth = 7,
  thresholds,
  color,
  autoStatusColor = true,
  label,
  showPercent = true,
  centerSlot,
  style,
}: HostMetricGaugeProps) {
  const { colors } = useHostTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  let gaugeColor = color || colors.accent;
  if (!color && autoStatusColor) {
    const status = resolveMetricStatus(clamped, thresholds);
    gaugeColor =
      status === "danger"
        ? colors.statusDanger
        : status === "warning"
          ? colors.statusWarning
          : colors.statusSuccess;
  }

  const radius = size / 2;
  const innerSize = Math.max(0, size - strokeWidth * 2);
  const innerRadius = innerSize / 2;
  const trackColor = colors.surface2;

  if (Platform.OS === "web") {
    const webBackground = `conic-gradient(${gaugeColor} 0% ${clamped}%, ${trackColor} ${clamped}% 100%)`;
    return (
      <View style={[styles.gaugeWrapper, style]}>
        <View
          style={[
            styles.gaugeBox,
            { width: size, height: size, borderRadius: radius },
            { background: webBackground } as unknown as ViewStyle,
          ]}
        >
          <View
            style={[
              styles.gaugeCenterHole,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerRadius,
                backgroundColor: colors.surface0,
              },
            ]}
          >
            {centerSlot ? (
              centerSlot
            ) : showPercent ? (
              <Text style={[styles.gaugePercent, { color: colors.foreground }]}>
                {Math.round(clamped)}%
              </Text>
            ) : null}
          </View>
        </View>
        {label ? (
          <Text style={[styles.gaugeLabel, { color: colors.foregroundMuted }]}>{label}</Text>
        ) : null}
      </View>
    );
  }

  const progressAngle = (clamped / 100) * 360;
  return (
    <View style={[styles.gaugeWrapper, style]}>
      <View style={[styles.gaugeBox, { width: size, height: size, borderRadius: radius }]}>
        <View
          testID="gauge-track"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: radius,
            borderWidth: strokeWidth,
            borderColor: trackColor,
          }}
        />
        {clamped > 0 ? (
          <GaugeArc
            which="right"
            size={size}
            strokeWidth={strokeWidth}
            color={gaugeColor}
            rotate={progressAngle <= 180 ? progressAngle - 135 : 45}
            testID="gauge-arc-right"
          />
        ) : null}
        {progressAngle > 180 ? (
          <GaugeArc
            which="left"
            size={size}
            strokeWidth={strokeWidth}
            color={gaugeColor}
            rotate={progressAngle - 135}
            testID="gauge-arc-left"
          />
        ) : null}
        <View style={styles.gaugeCenterHole}>
          {centerSlot ? (
            centerSlot
          ) : showPercent ? (
            <Text style={[styles.gaugePercent, { color: colors.foreground }]}>
              {Math.round(clamped)}%
            </Text>
          ) : null}
        </View>
      </View>
      {label ? (
        <Text style={[styles.gaugeLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      ) : null}
    </View>
  );
}

// --- attention -------------------------------------------------------------

export type HostAttentionBeaconMode = "radar" | "ring" | "glow" | "badge" | "bounce" | "pulse";
export type HostAttentionBeaconTone = "warning" | "accent" | "danger";

export interface HostAttentionBeaconProps {
  children: ReactNode;
  mode?: HostAttentionBeaconMode;
  tone?: HostAttentionBeaconTone;
  color?: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  badgeIcon?: string | ReactNode;
  easing?: (value: number) => number;
}

export function HostAttentionBeacon({
  children,
  mode = "radar",
  tone = "warning",
  color,
  active = true,
  style,
  accessibilityLabel,
  testID,
}: HostAttentionBeaconProps) {
  const { getStatusColor } = useHostTheme();
  const beaconColor =
    color ?? getStatusColor(tone === "danger" ? "danger" : tone === "accent" ? "accent" : "warning");
  const showDot = active && mode !== "badge";
  return (
    <View style={[{ position: "relative" }, style]}>
      {children}
      {showDot ? (
        <View
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: beaconColor,
            opacity: 0.75,
          }}
        />
      ) : null}
    </View>
  );
}

// --- key-value -------------------------------------------------------------

export type HostKeyValueTruncateMode = "end" | "middle" | "path";

export interface HostKeyValueProps {
  label: string;
  value: string | number | null | undefined;
  subValue?: string;
  mono?: boolean;
  copyable?: boolean;
  truncate?: boolean | HostKeyValueTruncateMode;
  truncateMaxLength?: number;
  layout?: "stacked" | "inline";
  stackOnCompact?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

export function HostKeyValue({
  label,
  value,
  subValue,
  mono = false,
  copyable = false,
  truncate: truncateProp = false,
  truncateMaxLength = 32,
  layout = "stacked",
  stackOnCompact: _stackOnCompact,
  style,
  labelStyle,
  valueStyle,
}: HostKeyValueProps) {
  const { colors } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const rawString = value === null || value === undefined ? "" : String(value);

  let displayValue = rawString || "-";
  if (truncateProp && rawString.length > truncateMaxLength) {
    const mode: HostKeyValueTruncateMode =
      typeof truncateProp === "string" ? truncateProp : "middle";
    if (mode === "path") {
      displayValue = `…${rawString.slice(-truncateMaxLength)}`;
    } else if (mode === "end") {
      displayValue = `${rawString.slice(0, truncateMaxLength)}…`;
    } else {
      const half = Math.floor(truncateMaxLength / 2);
      displayValue = `${rawString.slice(0, half)}…${rawString.slice(-half)}`;
    }
  }

  const handleCopy = async () => {
    if (!copyable || !rawString) return;
    try {
      await copyText(rawString);
      toast?.show?.(label);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error?.("Copy failed");
    }
  };

  const copyButton =
    copyable && value ? (
      <Pressable
        onPress={handleCopy}
        hitSlop={8}
        style={styles.kvCopyBtn}
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
      >
        <Icon
          name={copied ? "Check" : "Copy"}
          size={13}
          color={copied ? colors.statusSuccess : colors.foregroundMuted}
        />
      </Pressable>
    ) : null;

  const valueText = (
    <Text
      selectable
      numberOfLines={1}
      ellipsizeMode="middle"
      style={[
        styles.kvValue,
        { color: colors.foreground, fontFamily: mono ? "monospace" : undefined },
        valueStyle,
      ]}
    >
      {displayValue}
    </Text>
  );

  if (layout === "inline") {
    return (
      <View style={[styles.kvContainer, styles.kvInline, style]}>
        <Text
          numberOfLines={1}
          style={[styles.kvInlineLabel, { color: colors.foregroundMuted }, labelStyle]}
        >
          {label}
        </Text>
        <View style={styles.kvInlineValue}>
          {valueText}
          {copyButton}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.kvContainer, style]}>
      <Text
        numberOfLines={1}
        style={[styles.kvLabel, { color: colors.foregroundMuted }, labelStyle]}
      >
        {label}
      </Text>
      <View style={styles.kvValueRow}>
        {valueText}
        {copyButton}
      </View>
      {subValue ? (
        <Text numberOfLines={1} style={[styles.kvSubValue, { color: colors.foregroundMuted }]}>
          {subValue}
        </Text>
      ) : null}
    </View>
  );
}

export interface HostKeyValueGroupProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/** Fluid key/value grid. */
export function HostKeyValueGroup({
  children,
  columns = 2,
  gap = 8,
  style,
}: HostKeyValueGroupProps) {
  const childArray = React.Children.toArray(children).filter(Boolean);
  return (
    <View
      style={[
        { flexDirection: "row", flexWrap: "wrap", width: "100%", gap },
        style,
      ]}
    >
      {childArray.map((child, index) => (
        <View
          key={index}
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: `${Math.floor(100 / columns) - 2}%`,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

// --- empty state -----------------------------------------------------------

export interface HostEmptyStateProps {
  icon?: string | ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function HostEmptyState({
  icon = "Inbox",
  title,
  description,
  actionLabel,
  onAction,
  style,
}: HostEmptyStateProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[styles.emptyContainer, style]}>
      {icon ? (
        typeof icon === "string" ? (
          <View style={[styles.emptyIconWrapper, { backgroundColor: colors.surface1 }]}>
            <Icon name={icon} size={32} color={colors.foregroundMuted} />
          </View>
        ) : (
          icon
        )
      ) : null}
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {description ? (
        <Text style={[styles.emptyDescription, { color: colors.foregroundMuted }]}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.emptyActionRow}>
          <HostButton label={actionLabel} onPress={onAction} variant="secondary" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

// --- collapsible -----------------------------------------------------------

export interface HostCollapsibleProps {
  title?: string | ReactNode;
  subtitle?: string | ReactNode;
  children: ReactNode;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  badge?: ReactNode;
  headerRight?: ReactNode;
  /** Always-visible preview between the header and the expanded content. */
  summary?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: HostSurfaceVariant;
}

export function HostCollapsible({
  title,
  subtitle,
  children,
  initiallyExpanded = false,
  isExpanded: controlledExpanded,
  onToggle,
  badge,
  headerRight,
  summary,
  icon,
  style,
  headerStyle,
  contentStyle,
  variant = "flat",
}: HostCollapsibleProps) {
  const { colors } = useHostTheme();
  const { compact } = useHostLayout();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const surface = resolveHostSurface(colors, variant);

  const handlePress = () => {
    const next = !isExpanded;
    if (controlledExpanded === undefined) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };

  return (
    <View
      style={[
        styles.collapsibleContainer,
        { borderColor: surface.borderColor, backgroundColor: surface.backgroundColor },
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        style={({ pressed }) => [
          styles.collapsibleHeader,
          compact ? styles.collapsibleHeaderCompact : null,
          { backgroundColor: pressed ? colors.surface1 : "transparent" },
          headerStyle,
        ]}
      >
        {icon ? <Icon name={icon} size={14} color={colors.foregroundMuted} /> : null}
        <View style={styles.collapsibleTitleColumn}>
          {title ? (
            <Text style={[styles.collapsibleTitle, { color: colors.foreground }]}>
              {typeof title === "string" ? title : null}
            </Text>
          ) : null}
          {typeof title !== "string" ? title : null}
          {subtitle ? (
            <Text style={[styles.collapsibleSubtitle, { color: colors.foregroundMuted }]}>
              {typeof subtitle === "string" ? subtitle : null}
            </Text>
          ) : null}
          {typeof subtitle !== "string" ? subtitle : null}
        </View>
        {badge ? <View style={styles.collapsibleHeaderSlot}>{badge}</View> : null}
        {headerRight ? (
          <View style={styles.collapsibleHeaderRight}>{headerRight}</View>
        ) : null}
        <Icon
          name={isExpanded ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={colors.foregroundMuted}
        />
      </Pressable>
      {summary ? (
        <View style={[styles.collapsibleSummary, compact ? styles.collapsibleSummaryCompact : null]}>
          {summary}
        </View>
      ) : null}
      {isExpanded ? (
        <View
          style={[
            styles.collapsibleContent,
            compact ? styles.collapsibleContentCompact : null,
            contentStyle,
          ]}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

// --- tabs ------------------------------------------------------------------

export interface HostTabItem {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: string;
  badge?: string | number;
}

export interface HostTabsProps {
  tabs: HostTabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  mode?: "auto" | "fit" | "scroll";
  style?: StyleProp<ViewStyle>;
}

/**
 * Local segmented tab strip. Wraps instead of scrolling: the surfaces that use
 * it are fluid, and a wrapping strip avoids competing with the host scroller.
 */
export function HostTabs({ tabs, activeTab, onTabChange, style }: HostTabsProps) {
  const { colors, alpha: alphaColor } = useHostTheme();
  return (
    <View
      style={[
        styles.tabsFrame,
        { backgroundColor: colors.surface1, borderColor: colors.border },
        style,
      ]}
    >
      <View style={styles.tabsTrack}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: isActive
                    ? colors.surface2
                    : pressed
                      ? alphaColor(colors.surface2, 0.5)
                      : "transparent",
                },
              ]}
            >
              {tab.icon ? (
                <Icon
                  name={tab.icon}
                  size={13}
                  color={isActive ? colors.foreground : colors.foregroundMuted}
                />
              ) : null}
              <Text
                numberOfLines={1}
                style={[
                  styles.tabText,
                  {
                    color: isActive ? colors.foreground : colors.foregroundMuted,
                    fontWeight: isActive ? "600" : "500",
                  },
                ]}
              >
                {tab.label}
              </Text>
              {tab.badge !== undefined ? (
                <View
                  style={[
                    styles.tabBadge,
                    {
                      backgroundColor: isActive
                        ? colors.accent
                        : alphaColor(colors.foregroundMuted, 0.2),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabBadgeText,
                      { color: isActive ? colors.accentForeground : colors.foregroundMuted },
                    ]}
                  >
                    {tab.badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// --- controls --------------------------------------------------------------

export type HostButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type HostButtonSize = "sm" | "md" | "lg";

export interface HostButtonProps {
  label?: string;
  children?: ReactNode;
  variant?: HostButtonVariant;
  size?: HostButtonSize;
  icon?: string | ReactNode;
  iconPosition?: "left" | "right";
  onPress?: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
}

export function HostButton({
  label,
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "left",
  onPress,
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityRole = "button",
}: HostButtonProps) {
  const { colors, alpha: alphaColor } = useHostTheme();

  const py = size === "sm" ? 6 : size === "lg" ? 12 : 10;
  const px = size === "sm" ? 10 : size === "lg" ? 18 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  let bg = "transparent";
  let border = "transparent";
  let textColor = colors.foreground;

  switch (variant) {
    case "primary":
      bg = colors.accent;
      textColor = colors.accentForeground;
      break;
    case "danger":
      bg = alphaColor(colors.statusDanger, 0.15);
      border = alphaColor(colors.statusDanger, 0.4);
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

  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon === "string") {
      return <Icon name={icon} size={iconSize} color={textColor} />;
    }
    return icon;
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.buttonBase,
        {
          backgroundColor: pressed && !disabled ? alphaColor(bg, 0.8) : bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: 10,
          paddingVertical: py,
          paddingHorizontal: px,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <View style={styles.buttonContent}>
          {iconPosition === "left" ? renderIcon() : null}
          <Text style={[styles.buttonText, { color: textColor, fontSize }, textStyle]}>
            {children ?? label}
          </Text>
          {iconPosition === "right" ? renderIcon() : null}
        </View>
      )}
    </Pressable>
  );
}

export interface HostInlineButtonProps {
  label: string;
  onPress?: () => void | Promise<void>;
  icon?: string | ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/** Compact text/link action for inline timeline and card content. */
export function HostInlineButton({
  label,
  onPress,
  icon,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = "button",
  style,
  textStyle,
}: HostInlineButtonProps) {
  const { colors } = useHostTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        {
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          minHeight: 24,
          paddingHorizontal: 3,
          paddingVertical: 2,
          borderRadius: 4,
          flexShrink: 1,
          maxWidth: "100%",
          opacity: disabled ? 0.45 : 1,
          backgroundColor: pressed && !disabled ? colors.surface2 : "transparent",
        },
        style,
      ]}
    >
      {typeof icon === "string" ? <Icon name={icon} size={13} color={colors.accent} /> : icon}
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          { color: colors.accent, fontSize: 12, fontWeight: "600", flexShrink: 1 },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface HostToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function HostToggle({
  value,
  onValueChange,
  label,
  description,
  disabled = false,
  style,
  labelStyle,
}: HostToggleProps) {
  const { colors, alpha: alphaColor } = useHostTheme();

  const handlePress = () => {
    if (!disabled) {
      onValueChange(!value);
    }
  };

  const trackWidth = 38;
  const trackHeight = 22;
  const thumbSize = 16;
  const thumbPadding = 3;

  const trackColor = value ? colors.accent : alphaColor(colors.foregroundMuted, 0.35);
  const thumbPosition = value ? trackWidth - thumbSize - thumbPadding : thumbPadding;
  const hasText = Boolean(label || description);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.toggleContainer,
        !hasText && styles.toggleBare,
        { minHeight: 40, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {hasText && (
        <View style={styles.toggleTextContainer}>
          {label ? (
            <Text style={[styles.toggleLabel, { color: colors.foreground }, labelStyle]}>
              {label}
            </Text>
          ) : null}
          {description ? (
            <Text style={[styles.toggleDescription, { color: colors.foregroundMuted }]}>
              {description}
            </Text>
          ) : null}
        </View>
      )}
      <View
        style={[
          styles.toggleTrack,
          {
            width: trackWidth,
            height: trackHeight,
            borderRadius: trackHeight / 2,
            backgroundColor: trackColor,
          },
        ]}
      >
        <View
          style={[
            styles.toggleThumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              backgroundColor: colors.accentForeground,
              transform: [{ translateX: thumbPosition }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

export type HostCopyButtonSize = "sm" | "md";
export type HostCopyButtonVariant = "ghost" | "secondary";

export interface HostCopyButtonProps {
  text?: string;
  getText?: () => string | Promise<string>;
  label?: string;
  copiedLabel?: string;
  icon?: string;
  size?: HostCopyButtonSize;
  variant?: HostCopyButtonVariant;
  accessibilityLabel?: string;
  toastMessage?: string;
  feedbackDurationMs?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function HostCopyButton({
  text,
  getText,
  label,
  copiedLabel,
  icon,
  size = "sm",
  variant = "ghost",
  accessibilityLabel,
  toastMessage,
  feedbackDurationMs = 2000,
  disabled = false,
  style,
  textStyle,
}: HostCopyButtonProps): React.ReactElement | null {
  const { colors } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const hasSource = getText !== undefined || text !== undefined;
  if (!hasSource) return null;

  const idleIcon = icon ?? "Copy";
  const idleLabel = label ?? "Copy";
  const doneLabel = copiedLabel ?? "Copied!";
  const feedbackIcon = copied ? "Check" : idleIcon;
  const feedbackLabel = copied ? doneLabel : idleLabel;

  const secondary = variant === "secondary";
  const bg = secondary ? colors.surface1 : "transparent";
  const border = secondary ? colors.border : "transparent";

  const handleCopy = async () => {
    if (disabled) return;
    let value: string | undefined;
    try {
      value = getText ? await getText() : text;
    } catch {
      return;
    }
    if (value === undefined || value === null) return;
    try {
      await copyText(value);
      toast?.show?.(toastMessage ?? "Copied");
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), feedbackDurationMs);
    } catch {
      toast?.error?.("Copy failed");
    }
  };

  return (
    <Pressable
      onPress={handleCopy}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || feedbackLabel}
      hitSlop={4}
      style={({ pressed }) => [
        styles.copyButton,
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: 8,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Icon
        name={feedbackIcon}
        size={size === "sm" ? 12 : 14}
        color={copied ? colors.statusSuccess : colors.foregroundMuted}
      />
      <Text
        style={[
          styles.copyButtonText,
          { color: copied ? colors.statusSuccess : colors.foregroundMuted },
          textStyle,
        ]}
      >
        {feedbackLabel}
      </Text>
    </Pressable>
  );
}

// --- code / command --------------------------------------------------------

export interface HostCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  maxHeight?: number;
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function HostCodeBlock({
  code,
  language,
  title,
  maxHeight = 320,
  copyable = true,
  style,
  textStyle,
}: HostCodeBlockProps) {
  const { colors, alpha } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await copyText(code);
      toast?.show?.(title || "Code");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error?.("Copy failed");
    }
  };
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: colors.surface0,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {title || language || copyable ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderBottomWidth: 1,
            borderBottomColor: alpha(colors.border, 0.7),
          }}
        >
          <Text
            style={{
              color: title ? colors.foreground : colors.foregroundMuted,
              fontSize: 11,
              fontWeight: "600",
            }}
          >
            {title ?? (language ? language.toUpperCase() : "")}
          </Text>
          {copyable ? (
            <Pressable
              onPress={handleCopy}
              accessibilityRole="button"
              accessibilityLabel="Copy code"
              hitSlop={4}
              style={{ padding: 4 }}
            >
              <Icon
                name={copied ? "Check" : "Copy"}
                size={12}
                color={copied ? colors.statusSuccess : colors.foregroundMuted}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <RNScrollView style={{ maxHeight }} contentContainerStyle={{ padding: 12 }}>
        <Text
          selectable
          style={[
            { color: colors.foreground, fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
            textStyle,
          ]}
        >
          {code}
        </Text>
      </RNScrollView>
    </View>
  );
}

export interface HostCommandBoxProps {
  command?: string;
  argv?: string[];
  copyLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function HostCommandBox({
  command,
  argv = [],
  copyLabel = "Copy command",
  style,
  textStyle,
}: HostCommandBoxProps) {
  const { colors } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const fullCommand = command ?? argv.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ");
  const [prog, ...rest] = argv;
  const handleCopy = async () => {
    if (!fullCommand) return;
    try {
      await copyText(fullCommand);
      toast?.show?.("Command");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error?.("Copy failed");
    }
  };
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: colors.surface2,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", flex: 1, flexShrink: 1, minWidth: 0 }}>
        <Text
          style={[
            { color: colors.statusWarning, fontSize: 12, fontWeight: "700", fontFamily: "monospace" },
            textStyle,
          ]}
        >
          {prog ? `$ ${prog}` : "$"}
        </Text>
        {rest.length > 0 ? (
          <Text style={[{ color: colors.foreground, fontSize: 12, fontFamily: "monospace" }, textStyle]}>
            {" "}
            {rest.join(" ")}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={handleCopy}
        accessibilityRole="button"
        accessibilityLabel={copyLabel}
        hitSlop={4}
        style={{ padding: 4 }}
      >
        <Icon
          name={copied ? "Check" : "Copy"}
          size={12}
          color={copied ? colors.statusSuccess : colors.foregroundMuted}
        />
      </Pressable>
    </View>
  );
}

// --- modal content ---------------------------------------------------------

export interface HostModalSectionProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fluid plain View for pill `renderModal` bodies (no nested Modal.Content).
 *
 * The host centered-modal wrapper hands the body a bounded `flex: 1` frame and
 * (with the default `hostScroll: false`) no scroller, so this section must fill
 * that frame: without `flex: 1` / `minHeight: 0` the section sizes to its
 * content and the child `HostScroll` is never given a viewport to scroll in
 * (xpufx-org/paseo#975).
 */
export function HostModalSection({ children, style }: HostModalSectionProps) {
  return <View style={[styles.fluid, styles.modalSection, style]}>{children}</View>;
}

export type ScrollViewInstance = React.ElementRef<typeof HostScrollView>;

export interface HostScrollProps extends ScrollViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Explicit single scroll owner for surfaces where the host supplies none. */
export const HostScroll = forwardRef<ScrollViewInstance, HostScrollProps>(
  function HostScroll({ children, style, contentContainerStyle, ...props }, ref) {
    return (
      <HostScrollView
        ref={ref}
        style={[{ flex: 1, minHeight: 0, width: "100%" }, style]}
        contentContainerStyle={contentContainerStyle}
        {...props}
      >
        {children}
      </HostScrollView>
    );
  },
);

// --- form & interactive controls -------------------------------------------

export interface HostActionBarProps {
  children: ReactNode;
  align?: "start" | "center" | "end" | "between" | "flex-start" | "flex-end" | "space-between";
  direction?: "row" | "column";
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/** Trailing action row inside a card or dialog footer. */
export function HostActionBar({
  children,
  align = "end",
  direction = "row",
  gap = 8,
  style,
}: HostActionBarProps) {
  return (
    <View
      style={[
        {
          flexDirection: direction,
          alignItems: "center",
          justifyContent: justifyMap[align],
          gap,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface HostFormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  layout?: "stacked" | "inline";
  style?: StyleProp<ViewStyle>;
}

/** Label and description stacked or inlined with a single control. */
export function HostFormRow({ label, description, children, layout = "stacked", style }: HostFormRowProps) {
  const { colors } = useHostTheme();
  return (
    <View
      style={[
        layout === "inline"
          ? {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              gap: 8,
            }
          : { gap: 6, width: "100%" },
        style,
      ]}
    >
      <View style={layout === "inline" ? { flex: 1, minWidth: 0 } : undefined}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{label}</Text>
        {description ? (
          <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{description}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export interface HostTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  errorText?: string;
  helperText?: string;
  disabled?: boolean;
  editable?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  mono?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/** Single or multi-line text input using host theme and modal-aware primitive. */
export function HostTextInput({
  value,
  onChangeText,
  label,
  placeholder,
  errorText,
  helperText,
  disabled,
  editable,
  multiline = false,
  numberOfLines,
  mono = false,
  secureTextEntry = false,
  autoCapitalize = "none",
  autoCorrect = false,
  style,
  inputStyle,
}: HostTextInputProps) {
  const { colors, alpha: alphaColor } = useHostTheme();
  const [focused, setFocused] = useState(false);
  const isEditable = editable ?? (disabled !== undefined ? !disabled : true);
  const borderColor = errorText ? colors.statusDanger : focused ? colors.accent : colors.border;

  return (
    <View style={[{ gap: 4, width: "100%" }, style]}>
      {label ? (
        <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{label}</Text>
      ) : null}
      <HostTextInputPrimitive
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        editable={isEditable}
        multiline={multiline}
        numberOfLines={numberOfLines}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        textAlignVertical={multiline ? "top" : "center"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            width: "100%",
            minHeight: multiline ? 64 : 36,
            borderWidth: 1,
            borderRadius: 8,
            borderColor,
            backgroundColor: colors.surface1,
            color: colors.foreground,
            fontSize: 12,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontFamily: mono ? "monospace" : undefined,
            opacity: isEditable ? 1 : 0.5,
          },
          inputStyle,
        ]}
      />
      {errorText ? (
        <Text style={{ fontSize: 11, color: colors.statusDanger }}>{errorText}</Text>
      ) : helperText ? (
        <Text style={{ fontSize: 11, color: alphaColor(colors.statusWarning, 1) }}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

export interface HostSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  height?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/** Search field with leading icon and clear affordance. */
export function HostSearchInput({
  value,
  onChangeText,
  placeholder = "Search...",
  onClear,
  height = 36,
  style,
  inputStyle,
}: HostSearchInputProps) {
  const { colors } = useHostTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          backgroundColor: colors.surface1,
          height,
          paddingHorizontal: 10,
        },
        style,
      ]}
    >
      <Icon name="Search" size={16} color={colors.foregroundMuted} />
      <HostTextInputPrimitive
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[
          {
            flex: 1,
            paddingVertical: 0,
            marginLeft: 8,
            color: colors.foreground,
            fontSize: 13,
          },
          inputStyle,
        ]}
      />
      {value ? (
        <Pressable
          onPress={() => {
            onChangeText("");
            onClear?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
        >
          <Icon name="X" size={14} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface HostSelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface HostSelectProps {
  value: string;
  options: readonly HostSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

/** Inline single-choice picker styled for host dark/light theme palettes. */
export function HostSelect({
  value,
  options,
  onValueChange,
  placeholder = "Select…",
  style,
}: HostSelectProps) {
  const { colors } = useHostTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const display = selected?.label ?? (value || placeholder);
  const canOpen = options.length > 0;

  return (
    <View style={[{ gap: 4, width: "100%" }, style]}>
      <Pressable
        onPress={() => {
          if (canOpen) setOpen((prev) => !prev);
        }}
        disabled={!canOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minHeight: 36,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          backgroundColor: colors.surface1,
          paddingHorizontal: 10,
          paddingVertical: 8,
          opacity: canOpen ? 1 : 0.5,
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.foreground, flexShrink: 1 }}>
          {display}
        </Text>
        <Icon
          name={open ? "ChevronUp" : "ChevronDown"}
          size={14}
          color={colors.foregroundMuted}
        />
      </Pressable>
      {open
        ? options.map((option) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.border,
                  borderRadius: 8,
                  backgroundColor: colors.surface2,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    fontWeight: active ? "600" : "400",
                    color: active ? colors.accent : colors.foreground,
                  }}
                >
                  {option.label}
                </Text>
                {option.description ? (
                  <Text
                    numberOfLines={2}
                    style={{
                      fontSize: 11,
                      color: colors.foregroundMuted,
                      marginTop: 2,
                    }}
                  >
                    {option.description}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

// --- modal scroll ownership ------------------------------------------------

export type ModalBodyScrollOwner = "helper" | "host" | "required" | "popover";

const SCROLL_OWNER_CONTEXT_KEY = Symbol.for("paseo.modalBodyScrollOwnerContext");

export const ModalBodyScrollOwnerContext: React.Context<ModalBodyScrollOwner> =
  ((globalThis as any)[SCROLL_OWNER_CONTEXT_KEY] ??= createContext<ModalBodyScrollOwner>("helper"));

export function useModalBodyScrollOwner(): ModalBodyScrollOwner {
  return useContext(ModalBodyScrollOwnerContext);
}

export interface HostModalBodyProps {
  children: ReactNode;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  size?: "default" | "large";
  headerMode?: "pinned" | "scroll";
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  scrollRef?: React.Ref<ScrollViewInstance>;
  scrollable?: boolean;
}

/** Scrollable body for modal dialogues and plugin surfaces. Owns single scroll unless an ancestor scroller is present. */
export function HostModalBody({
  children,
  header,
  headerStyle,
  style,
  contentContainerStyle,
  size,
  headerMode = "pinned",
  refreshing = false,
  onRefresh,
  scrollRef,
  scrollable,
}: HostModalBodyProps) {
  const { colors } = useHostTheme();
  const scrollOwner = useContext(ModalBodyScrollOwnerContext);
  const hostOwnsScroll = scrollOwner === "host" || scrollOwner === "popover";
  const shouldScroll = scrollable !== undefined ? scrollable : !hostOwnsScroll;
  const isPinned = Boolean(header && headerMode === "pinned");
  const refreshControl = onRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
    />
  ) : undefined;

  if (!shouldScroll) {
    return (
      <View style={[{ width: "100%" }, style]}>
        {header ? (
          <View
            style={[
              { width: "100%", flexShrink: 0, backgroundColor: colors.surface0 },
              headerStyle,
            ]}
          >
            {header}
          </View>
        ) : null}
        <View
          style={[
            {
              width: "100%",
              gap: 12,
              paddingHorizontal: 12,
              paddingTop: 8,
              paddingBottom: 20,
            },
            contentContainerStyle,
          ]}
        >
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, minHeight: 0, width: "100%" }, style]}>
      {isPinned ? (
        <View
          style={[
            { width: "100%", flexShrink: 0, backgroundColor: colors.surface0 },
            headerStyle,
          ]}
        >
          {header}
        </View>
      ) : null}
      <HostScroll
        ref={scrollRef}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        contentContainerStyle={[
          {
            flexGrow: 1,
            width: "100%",
            gap: 12,
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 20,
          },
          contentContainerStyle,
        ]}
      >
        {!isPinned && header ? <View style={headerStyle}>{header}</View> : null}
        {children}
      </HostScroll>
    </View>
  );
}

// --- about -----------------------------------------------------------------

export interface HostAboutLink {
  label: string;
  url: string;
  icon?: string;
}

export interface HostAboutSectionProps {
  name: string;
  description?: string;
  version: string;
  author?: string;
  repository?: string;
  issues?: string;
  homepage?: string;
  license?: string;
  density?: "compact" | "tiny" | "normal";
  links?: HostAboutLink[];
  extraItems?: Array<{
    label: string;
    value: string;
    subValue?: string;
    copyable?: boolean;
  }>;
  style?: StyleProp<ViewStyle>;
}

export function HostAboutSection({
  name,
  description,
  version,
  author,
  repository,
  issues,
  homepage,
  license = "MIT",
  links = [],
  extraItems = [],
  style,
}: HostAboutSectionProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[styles.aboutContainer, style]}>
      <Text style={[styles.aboutName, { color: colors.foreground }]}>{name}</Text>
      {description ? (
        <Text style={[styles.aboutDescription, { color: colors.foregroundMuted }]}>
          {description}
        </Text>
      ) : null}
      <View style={styles.aboutMeta}>
        <HostBadge label={`v${version}`} variant="accent" size="sm" />
        {author ? (
          <Text style={[styles.aboutMetaText, { color: colors.foregroundMuted }]}>{author}</Text>
        ) : null}
        <Text style={[styles.aboutMetaText, { color: colors.foregroundMuted }]}>{license}</Text>
      </View>
      {extraItems.length > 0 ? (
        <View style={styles.aboutItems}>
          {extraItems.map((item) => (
            <HostKeyValue
              key={item.label}
              label={item.label}
              value={item.value}
              subValue={item.subValue}
              copyable={item.copyable}
            />
          ))}
        </View>
      ) : null}
      {links.length > 0 ? (
        <View style={styles.aboutLinks}>
          {links.map((link) => (
            <HostButton
              key={link.label}
              label={link.label}
              variant="ghost"
              size="sm"
              icon={link.icon}
              onPress={() => {
                void Linking?.openURL?.(link.url).catch(() => {});
              }}
            />
          ))}
        </View>
      ) : null}
      {repository ? (
        <Text style={[styles.aboutRepo, { color: colors.foregroundMuted }]}>{repository}</Text>
      ) : null}
    </View>
  );
}

// --- styles ----------------------------------------------------------------

const alignMap = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
} as const;

const justifyMap = {
  start: "flex-start",
  "flex-start": "flex-start",
  center: "center",
  end: "flex-end",
  "flex-end": "flex-end",
  between: "space-between",
  "space-between": "space-between",
} as const;

const styles = {
  fluid: { width: "100%" },
  modalSection: { flex: 1, minHeight: 0, width: "100%" },
  row: { flexDirection: "row", width: "100%" },
  stack: { flexDirection: "column", width: "100%" },
  grid: { flexDirection: "row", flexWrap: "wrap", width: "100%" },
  card: { overflow: "hidden", width: "100%", borderWidth: 1, borderRadius: 12, gap: 8 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  titleColumn: { gap: 1, flexShrink: 1 },
  cardHeaderTitle: { fontWeight: "600", fontSize: 13 },
  cardHeaderSubtitle: { fontWeight: "400", fontSize: 11 },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  cardHeaderValue: { fontWeight: "600", fontSize: 13 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    gap: 4,
    flexShrink: 1,
    maxWidth: "100%",
  },
  badgeText: { fontWeight: "600", flexShrink: 1 },
  vital: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  vitalText: { fontSize: 11, fontWeight: "500", flexShrink: 1, minWidth: 0 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusDot: { borderRadius: 9999 },
  progressContainer: { gap: 4, width: "100%" },
  progressLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressLabel: { fontSize: 11 },
  progressValue: { fontSize: 11, fontWeight: "600" },
  progressTrack: { width: "100%", overflow: "hidden" },
  progressFill: { height: "100%" },
  gaugeWrapper: { alignItems: "center", gap: 4 },
  gaugeBox: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  gaugeCenterHole: { alignItems: "center", justifyContent: "center" },
  gaugePercent: { fontSize: 13, fontWeight: "700" },
  gaugeLabel: { fontSize: 11 },
  kvContainer: { gap: 2, width: "100%" },
  kvInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  kvLabel: { fontSize: 11 },
  kvInlineLabel: { fontSize: 11, flexShrink: 1 },
  kvValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  kvInlineValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: "flex-end",
  },
  kvValue: { fontSize: 12, flexShrink: 1, minWidth: 0 },
  kvSubValue: { fontSize: 11 },
  kvCopyBtn: { padding: 2 },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  emptyIconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  emptyDescription: { fontSize: 12, textAlign: "center" },
  emptyActionRow: { marginTop: 4 },
  collapsibleContainer: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    width: "100%",
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    minHeight: 40,
  },
  // Compact hosts lose horizontal room first; trim the frame so the header
  // and summary stay content-sized on narrow/mobile layouts.
  collapsibleHeaderCompact: { paddingHorizontal: 10, paddingVertical: 8 },
  collapsibleSummaryCompact: { paddingHorizontal: 10, paddingBottom: 8 },
  // Bottom clearance keeps expanded detail out from under the composer pills
  // and the floating scroll controls on compact hosts.
  collapsibleContentCompact: { paddingHorizontal: 10, paddingBottom: 32, gap: 6 },
  collapsibleTitleColumn: { flex: 1, minWidth: 0, flexShrink: 1, gap: 1 },
  collapsibleHeaderSlot: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  collapsibleHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  collapsibleTitle: { fontSize: 13, fontWeight: "600" },
  collapsibleSubtitle: { fontSize: 11 },
  collapsibleSummary: { paddingHorizontal: 12, paddingBottom: 12 },
  collapsibleContent: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  tabsFrame: {
    width: "100%",
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
  },
  tabsTrack: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    width: "100%",
    padding: 3,
    gap: 4,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: 8,
    overflow: "hidden",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tabText: { textAlign: "center", fontSize: 12, flexShrink: 1, minWidth: 0 },
  tabBadge: {
    borderRadius: 9999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: { fontSize: 10, fontWeight: "700" },
  buttonBase: { overflow: "hidden" },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  buttonText: { fontWeight: "600", textAlign: "center" },
  toggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
  },
  toggleBare: { justifyContent: "center", width: "auto" },
  toggleTextContainer: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 13, fontWeight: "600" },
  toggleDescription: { fontSize: 11 },
  toggleTrack: { justifyContent: "center", overflow: "hidden" },
  toggleThumb: { position: "absolute", top: 3, left: 0 },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  copyButtonText: { fontSize: 11, fontWeight: "600" },
  aboutContainer: { gap: 8, width: "100%" },
  aboutName: { fontSize: 16, fontWeight: "700" },
  aboutDescription: { fontSize: 12 },
  aboutMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  aboutMetaText: { fontSize: 11 },
  aboutItems: { gap: 8, width: "100%" },
  aboutLinks: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  aboutRepo: { fontSize: 11 },
} as const;

// --- page templates --------------------------------------------------------

export {
  ListActionPageTemplate,
  type ListActionPageTemplateProps,
  type ListActionHeaderAction,
} from "./templates/list-action.js";

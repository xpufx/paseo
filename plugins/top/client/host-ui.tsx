import React, {
  createContext,
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
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  Icon,
  ScrollView as HostScrollView,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  resolveMetricStatus,
  type MetricThresholds,
  type ResponsiveLayout,
  type StatusVariant,
  type ThemeColors,
} from "paseo-plugin-helper/shared";

/**
 * Local composition of the presentational pieces plugins/top used to import
 * from the helper's `ui` entry (removed for xpufx-org/paseo#937 / #924).
 *
 * The host SDK owns the design language and provides the primitives that carry
 * host behaviour (`Icon`, `ScrollView`, `useToast`, `copyText`); everything
 * here is plain React Native layout and color-token composition on top of the
 * host `theme` prop, mirroring the approach used for permission-audit in #953.
 *
 * The module deliberately keeps the previous `Host*` names and prop shapes so
 * call sites only change the import path.
 */

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

export interface TopTheme {
  colors: ThemeColors;
  alpha: (color: string, opacity: number) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
}

const FALLBACK_COLORS: ThemeColors = {
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

function createTopTheme(colors: ThemeColors): TopTheme {
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

const ThemeContext = createContext<TopTheme>(createTopTheme(FALLBACK_COLORS));

export interface HostThemeProviderProps {
  theme: { colors: ThemeColors };
  children: ReactNode;
}

/** Carries the host `theme` prop colors to every local adapter below it. */
export function HostThemeProvider({ theme, children }: HostThemeProviderProps) {
  const value = useMemo(() => createTopTheme(theme.colors), [theme.colors]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reads the host theme supplied by {@link HostThemeProvider}. */
export function useHostTheme(): TopTheme {
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

export interface HostCardProps {
  children: ReactNode;
  variant?: HostSurfaceVariant;
  style?: StyleProp<ViewStyle>;
  noPadding?: boolean;
}

export interface HostCardHeaderProps {
  title: string;
  subtitle?: string;
  value?: string | number | ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
}

export function HostCard({ children, variant, style, noPadding = false }: HostCardProps) {
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
}: HostCardHeaderProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[styles.cardHeader, style]}>
      <View style={styles.cardHeaderLeft}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={styles.titleColumn}>
          <Text
            style={[styles.cardHeaderTitle, { color: colors.foreground }, titleStyle]}
            numberOfLines={1}
          >
            {title}
          </Text>
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
        {label}
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

  return (
    <View style={[styles.gaugeWrapper, style]}>
      <View style={[styles.gaugeBox, { width: size, height: size, borderRadius: radius }]}>
        <View
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
        <View
          style={[
            styles.gaugeFill,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerRadius,
              backgroundColor: gaugeColor,
              opacity: 0.25 + 0.75 * (clamped / 100),
            },
          ]}
        />
      </View>
      {label ? (
        <Text style={[styles.gaugeLabel, { color: colors.foregroundMuted }]}>{label}</Text>
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

export interface HostScrollProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Explicit single scroll owner for surfaces where the host supplies none. */
export function HostScroll({
  children,
  style,
  contentContainerStyle,
  ...props
}: HostScrollProps & Record<string, unknown>) {
  return (
    <HostScrollView
      {...(props as Record<string, unknown>)}
      style={[styles.fluid, style]}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </HostScrollView>
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
  center: "center",
  end: "flex-end",
  between: "space-between",
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
  gaugeFill: { position: "absolute", bottom: 0, left: 0, right: 0 },
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

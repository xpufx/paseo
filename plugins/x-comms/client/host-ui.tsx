import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView as RNScrollView,
  Text,
  View,
  type ImageSourcePropType,
  type KeyboardTypeOptions,
  type ScrollView as ScrollViewInstance,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  Icon,
  Modal,
  ScrollView as HostScrollView,
  TextInput as HostTextInput,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useHostTheme, triggerHaptic, FALLBACK_COLORS, HOST_SHADOW_COLOR } from "paseo-plugin-helper/lifecycle";
import { HostScroll } from "paseo-plugin-helper/ui";
import type { SurfaceStyle } from "paseo-plugin-helper/lifecycle";
import {
  truncate,
  truncateMiddle,
  truncatePath,
  type StatusVariant,
  type ThemeColors,
  type TruncatePathOptions,
} from "paseo-plugin-helper/shared";

/**
 * Plugin-local presentation layer for `plugins/x-comms`.
 *
 * The frozen helper `client/` bespoke kit that this plugin used to vendor as a
 * fork (`plugins/x-comms/client/vendor/**`) was removed in
 * xpufx-org/paseo#938. The host SDK ships no Card/Badge/Button/table
 * primitives, so x-comms composes the handful of pieces it actually renders
 * here, over the host `theme` (via `useHostTheme`) and plain React Native —
 * following the accepted pattern from `plugins/uppidi-fleet/client/host-ui.tsx`
 * (#961–#968). Deliberately plugin-local: it is not a shared design system and
 * adds nothing to the helper.
 *
 * The host owns theme, scroll, modal frames and icons; this file only composes
 * the genuinely missing presentational atoms.
 */

export { HostThemeProvider, useHostTheme } from "paseo-plugin-helper/lifecycle";

// --- theme -----------------------------------------------------------------

const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

type SpacingValue = keyof typeof SPACING | number;

function resolveSpacing(value: SpacingValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return typeof value === "number" ? value : (SPACING[value] ?? fallback);
}

interface TypographyToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700";
}

const TYPOGRAPHY: Record<
  "title" | "heading" | "body" | "bodyStrong" | "bodySmall" | "caption" | "label",
  TypographyToken
> = {
  title: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  heading: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19, fontWeight: "400" },
  bodyStrong: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  bodySmall: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: "400" },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
};

const RESOLVE_RADIUS: Record<"xs" | "sm" | "md" | "lg" | "pill", number> = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  pill: 9999,
};

export interface XCommsTheme {
  colors: ThemeColors;
  alpha: (color: string, opacity: number) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
  resolveRadius: (size?: "xs" | "sm" | "md" | "lg" | "pill") => number;
  isCompact: boolean;
  isMobile: boolean;
  touchTargetMin: number;
  padding: { horizontal: number; vertical: number; gap: number };
  typography: typeof TYPOGRAPHY;
  flair: { surfaceStyle: SurfaceStyle; borderWidth: number; headingTransform: "none" | "uppercase" };
}

/**
 * The x-comms surfaces read colors from the host `theme` prop (carried by the
 * lifecycle registration wrappers' `HostThemeProvider`) and pin their own
 * static spacing/typography scale. No `client/` provider, no CSS scraping.
 */
export function usePluginTheme(): XCommsTheme {
  const host = useHostTheme();
  return useMemo(
    () => ({
      colors: host.colors,
      alpha: host.alpha,
      getStatusColor: host.getStatusColor,
      getVariantPalette: host.getVariantPalette,
      resolveRadius: (size = "md") => RESOLVE_RADIUS[size],
      isCompact: false,
      isMobile: false,
      touchTargetMin: 40,
      padding: { horizontal: 12, vertical: 10, gap: 12 },
      typography: TYPOGRAPHY,
      flair: { surfaceStyle: "flat", borderWidth: 1, headingTransform: "none" },
    }),
    [host],
  );
}

// --- button ----------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  label?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
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

export function Button({
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
}: ButtonProps) {
  const { colors, resolveRadius, touchTargetMin, isCompact, alpha } = usePluginTheme();

  const radius = resolveRadius(size === "sm" ? "sm" : size === "lg" ? "lg" : "md");
  const py = size === "sm" ? (isCompact ? 5 : 6) : size === "lg" ? 12 : isCompact ? 8 : 10;
  const px = size === "sm" ? (isCompact ? 8 : 10) : size === "lg" ? 18 : isCompact ? 12 : 14;
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

  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon === "string") return <Icon name={icon} size={iconSize} color={textColor} />;
    return icon;
  };

  const contentHeight = Math.round(fontSize * 1.2) + py * 2;
  const hitSlopSide = Math.max(0, (touchTargetMin - contentHeight) / 2);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={hitSlopSide}
      style={({ pressed }) => [
        styles.buttonBase,
        {
          backgroundColor: pressed && !disabled ? alpha(bg, 0.8) : bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: radius,
          paddingVertical: py,
          paddingHorizontal: px,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <Text style={{ color: textColor, fontSize }}>…</Text>
      ) : children ? (
        children
      ) : (
        <>
          {iconPosition === "left" && renderIcon()}
          {label ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.buttonText, { color: textColor, fontSize }, textStyle]}
            >
              {label}
            </Text>
          ) : null}
          {iconPosition === "right" && renderIcon()}
        </>
      )}
    </Pressable>
  );
}

export interface InlineButtonProps {
  label: string;
  onPress?: () => void | Promise<void>;
  icon?: string | ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function InlineButton({
  label,
  onPress,
  icon,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = "button",
  style,
  textStyle,
}: InlineButtonProps) {
  const { colors, touchTargetMin, alpha } = usePluginTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={Math.max(0, (touchTargetMin - 24) / 2)}
      style={({ pressed }) => [
        styles.inlineButton,
        {
          opacity: disabled ? 0.45 : 1,
          backgroundColor: pressed && !disabled ? alpha(colors.accent, 0.12) : "transparent",
        },
        style,
      ]}
    >
      {typeof icon === "string" ? <Icon name={icon} size={13} color={colors.accent} /> : icon}
      <Text
        accessibilityLabel={label}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[styles.inlineButtonText, { color: colors.accent }, textStyle]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// --- badge / status --------------------------------------------------------

export type BadgeStyle = "tinted" | "outline" | "solid";
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  label: string;
  variant?: StatusVariant;
  styleVariant?: BadgeStyle;
  size?: BadgeSize;
  icon?: string | ReactNode;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function Badge({
  label,
  variant = "neutral",
  styleVariant = "tinted",
  size = "md",
  icon,
  dot = false,
  style,
  textStyle,
}: BadgeProps) {
  const { colors, resolveRadius, getVariantPalette, getStatusColor, typography } = usePluginTheme();
  const caption = typography.caption;
  const fontSize = size === "sm" ? 10 : caption.fontSize;
  const lineHeight = size === "sm" ? 12 : caption.lineHeight;
  const paddingVertical = size === "sm" ? 1 : 2;
  const paddingHorizontal = size === "sm" ? 5 : 8;
  const iconSize = size === "sm" ? 10 : 11;

  const radius = resolveRadius("pill");
  const palette = getVariantPalette(variant);
  const solidColor = getStatusColor(variant);

  let bg = palette.bg;
  let border = palette.border;
  let textColor = palette.text;
  if (styleVariant === "outline") {
    bg = "transparent";
    border = palette.border;
  } else if (styleVariant === "solid") {
    bg = solidColor;
    border = "transparent";
    textColor = colors.accentForeground;
  }

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderColor: border, borderRadius: radius, paddingVertical, paddingHorizontal },
        style,
      ]}
    >
      {dot ? (
        <View style={[styles.badgeDot, { backgroundColor: textColor }]} />
      ) : typeof icon === "string" ? (
        <Icon name={icon} size={iconSize} color={textColor} />
      ) : (
        icon ?? null
      )}
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

export interface StatusDotProps {
  variant?: StatusVariant;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StatusDot({ variant = "neutral", size = "md", pulse = false, style }: StatusDotProps) {
  const { getStatusColor } = usePluginTheme();
  const color = getStatusColor(variant);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulseAnim]);

  const dimension = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  return (
    <View style={[styles.statusDotContainer, { width: dimension, height: dimension }, style]}>
      <Animated.View
        style={[
          styles.statusDot,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: color,
            shadowColor: color,
            opacity: pulseAnim,
          },
        ]}
      />
    </View>
  );
}

// --- surfaces --------------------------------------------------------------

function resolveSurface(
  variant: SurfaceStyle,
  colors: ThemeColors,
  alpha: (color: string, opacity: number) => string,
): { backgroundColor: string; borderColor: string } {
  if (variant === "tinted") return { backgroundColor: alpha(colors.accent, 0.04), borderColor: alpha(colors.accent, 0.2) };
  if (variant === "elevated") return { backgroundColor: colors.surface1, borderColor: colors.border };
  return { backgroundColor: colors.surface0, borderColor: colors.border };
}

export interface CardProps {
  children: ReactNode;
  variant?: SurfaceStyle;
  style?: StyleProp<ViewStyle>;
  noPadding?: boolean;
}

export interface CardHeaderProps {
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

export function CardHeader({
  title,
  subtitle,
  value,
  badge,
  action,
  icon,
  style,
  titleStyle,
  subtitleStyle,
}: CardHeaderProps) {
  const { colors, padding } = usePluginTheme();
  return (
    <View style={[styles.cardHeader, { marginBottom: padding.gap }, style]}>
      <View style={styles.cardHeaderLeft}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={styles.cardHeaderTitleColumn}>
          <Text style={[styles.cardHeaderTitle, { color: colors.foreground }, titleStyle]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.cardHeaderSubtitle, { color: colors.foregroundMuted }, subtitleStyle]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.cardHeaderRight}>
        {badge ? <View style={{ marginRight: 6 }}>{badge}</View> : null}
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

export function Card({ children, variant, style, noPadding = false }: CardProps) {
  const { colors, alpha, resolveRadius, padding } = usePluginTheme();
  const effectiveVariant: SurfaceStyle = variant ?? "flat";
  const surface = resolveSurface(effectiveVariant, colors, alpha);
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: surface.backgroundColor,
          borderColor: surface.borderColor,
          borderRadius: resolveRadius("md"),
          borderWidth: 1,
          paddingHorizontal: noPadding ? 0 : padding.horizontal,
          paddingVertical: noPadding ? 0 : padding.vertical,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

Card.Header = CardHeader;

export interface CollapsibleProps {
  title?: string | ReactNode;
  subtitle?: string | ReactNode;
  children: ReactNode;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  badge?: ReactNode;
  headerRight?: ReactNode;
  summary?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: SurfaceStyle;
}

export function Collapsible({
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
  variant,
}: CollapsibleProps) {
  const { colors, alpha, resolveRadius, isCompact, touchTargetMin } = usePluginTheme();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const surface = resolveSurface(variant ?? "flat", colors, alpha);

  const handlePress = () => {
    const next = !isExpanded;
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onToggle?.(next);
  };

  return (
    <View
      style={[
        styles.collapsibleContainer,
        { borderColor: surface.borderColor, borderRadius: resolveRadius(variant === "elevated" ? "lg" : "md"), backgroundColor: surface.backgroundColor },
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        style={({ pressed }) => [
          styles.collapsibleHeader,
          {
            minHeight: Math.max(touchTargetMin, 36),
            backgroundColor: pressed ? alpha(colors.foreground, 0.06) : "transparent",
          },
          headerStyle,
        ]}
      >
        <View style={styles.collapsibleHeaderLeft}>
          <View
            style={[
              styles.collapsibleChevron,
              { backgroundColor: alpha(colors.accent, 0.12), borderColor: alpha(colors.accent, 0.25) },
            ]}
          >
            <Icon name={isExpanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
          </View>
          {icon ? <Icon name={icon} size={14} color={colors.accent} /> : null}
          <View style={styles.collapsibleTitleBlock}>
            <View style={styles.collapsibleTitleRow}>
              {typeof title === "string" ? (
                <Text style={[styles.collapsibleTitle, { color: colors.foreground, fontSize: isCompact ? 12 : 13 }]}>
                  {title}
                </Text>
              ) : (
                <View style={styles.collapsibleTitleSlot}>{title}</View>
              )}
              {badge ? <View style={styles.collapsibleBadgeSlot}>{badge}</View> : null}
            </View>
            {subtitle ? (
              <View style={{ marginTop: 2 }}>
                {typeof subtitle === "string" ? (
                  <Text style={[styles.collapsibleSubtitle, { color: colors.foregroundMuted, fontSize: isCompact ? 11 : 12 }]}>
                    {subtitle}
                  </Text>
                ) : (
                  subtitle
                )}
              </View>
            ) : null}
            {summary ? <View style={{ marginTop: 4, flexDirection: "row" }}>{summary}</View> : null}
          </View>
        </View>
        {(headerRight || summary === undefined) && <View style={styles.collapsibleHeaderRight}>{headerRight}</View>}
      </Pressable>
      {isExpanded && (
        <View style={[styles.collapsibleContent, { borderTopColor: colors.border, borderTopWidth: 1 }, contentStyle]}>
          {children}
        </View>
      )}
    </View>
  );
}

export interface SectionHeaderProps {
  title: string;
  count?: number;
  badgeVariant?: StatusVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function SectionHeader({ title, count, badgeVariant, style, textStyle }: SectionHeaderProps) {
  const { colors, typography } = usePluginTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          styles.sectionHeaderTitle,
          {
            color: colors.foregroundMuted,
            fontSize: typography.bodyStrong.fontSize,
            lineHeight: typography.bodyStrong.lineHeight,
            fontWeight: typography.bodyStrong.fontWeight,
          },
          textStyle,
        ]}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <Badge
          label={String(count)}
          variant={badgeVariant ?? (count > 0 ? "warning" : "neutral")}
          styleVariant={count > 0 ? "solid" : "tinted"}
        />
      ) : null}
    </View>
  );
}

export interface EmptyStateProps {
  icon?: string | ReactNode;
  title: string;
  description?: string;
  action?: ButtonProps;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon = "Inbox", title, description, action, actionLabel, onAction, style }: EmptyStateProps) {
  const { colors, isCompact, typography, padding } = usePluginTheme();
  const resolvedAction: ButtonProps | undefined = action
    ? action
    : actionLabel && onAction
      ? { label: actionLabel, onPress: onAction, variant: "secondary" }
      : undefined;
  return (
    <View style={[styles.emptyState, { padding: isCompact ? padding.horizontal + 8 : padding.horizontal * 2 }, style]}>
      {icon ? (
        typeof icon === "string" ? (
          <View style={[styles.emptyStateIcon, { backgroundColor: colors.surface1 }]}>
            <Icon name={icon} size={isCompact ? 24 : 32} color={colors.foregroundMuted} />
          </View>
        ) : (
          icon
        )
      ) : null}
      <Text style={[styles.emptyStateTitle, { color: colors.foreground, ...typography.title }]}>{title}</Text>
      {description ? (
        <Text style={[styles.emptyStateDescription, { color: colors.foregroundMuted, ...typography.body }]}>
          {description}
        </Text>
      ) : null}
      {resolvedAction ? (
        <View style={{ marginTop: 8 }}>
          <Button size={isCompact ? "sm" : "md"} {...resolvedAction} />
        </View>
      ) : null}
    </View>
  );
}

// --- key/value -------------------------------------------------------------

export type KeyValueTruncateMode = "end" | "middle" | "path";

export interface KeyValueProps {
  label: string;
  value: string | number | null | undefined;
  subValue?: string;
  mono?: boolean;
  copyable?: boolean;
  truncate?: boolean | KeyValueTruncateMode;
  truncateMaxLength?: number;
  truncatePathOptions?: TruncatePathOptions;
  layout?: "stacked" | "inline";
  stackOnCompact?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

export function KeyValue({
  label,
  value,
  subValue,
  mono = false,
  copyable = false,
  truncate: truncateProp = false,
  truncateMaxLength = 32,
  truncatePathOptions,
  layout = "stacked",
  stackOnCompact = true,
  style,
  labelStyle,
  valueStyle,
}: KeyValueProps) {
  const { colors, isCompact, touchTargetMin } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const rawString = value === null || value === undefined ? "" : String(value);
  let displayValue = rawString || "-";
  if (truncateProp && rawString.length > truncateMaxLength) {
    const mode: KeyValueTruncateMode = typeof truncateProp === "string" ? truncateProp : "middle";
    if (mode === "path") displayValue = truncatePath(rawString, truncateMaxLength, truncatePathOptions);
    else if (mode === "end") displayValue = truncate(rawString, truncateMaxLength);
    else displayValue = truncateMiddle(rawString, truncateMaxLength);
  }

  const handleCopy = async () => {
    if (!copyable || !rawString) return;
    try {
      await copyText(rawString);
      toast.show(label, { variant: "success" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  const fontFamily = mono
    ? Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })
    : undefined;

  const copyButton = copyable && value ? (
    <Pressable
      onPress={handleCopy}
      hitSlop={Math.max(8, (touchTargetMin - 20) / 2)}
      style={styles.keyValueCopy}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
    >
      <Icon
        name={copied ? "Check" : "Copy"}
        size={isCompact ? 12 : 13}
        color={copied ? colors.statusSuccess : colors.foregroundMuted}
      />
    </Pressable>
  ) : null;

  if (layout === "inline") {
    return (
      <View style={[styles.keyValueContainer, styles.keyValueInline, style]}>
        <Text style={[styles.keyValueLabel, { color: colors.foregroundMuted, ...TYPOGRAPHY.label }, labelStyle]}>
          {label}
        </Text>
        <Text
          selectable
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[styles.keyValueInlineText, { color: colors.foreground, ...TYPOGRAPHY.bodySmall, fontFamily }, valueStyle]}
        >
          {displayValue}
        </Text>
        {subValue ? (
          <Text selectable numberOfLines={1} style={{ color: colors.foregroundMuted, ...TYPOGRAPHY.caption }}>
            {subValue}
          </Text>
        ) : null}
        {copyButton}
      </View>
    );
  }

  const shouldStack = stackOnCompact && isCompact;
  if (shouldStack) {
    return (
      <View style={[styles.keyValueContainer, styles.keyValueStacked, style]}>
        <View style={styles.keyValueStackedHeader}>
          <Text style={[styles.keyValueLabel, { color: colors.foregroundMuted, ...TYPOGRAPHY.label }, labelStyle]}>
            {label}
          </Text>
          {copyButton}
        </View>
        <Text
          selectable
          style={[styles.keyValueStackedText, { color: colors.foreground, ...TYPOGRAPHY.bodySmall, fontFamily }, valueStyle]}
        >
          {displayValue}
        </Text>
        {subValue ? (
          <Text style={{ color: colors.foregroundMuted, ...TYPOGRAPHY.caption }}>{subValue}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.keyValueContainer, styles.keyValueRow, style]}>
      <Text style={[styles.keyValueLabel, { color: colors.foregroundMuted, ...TYPOGRAPHY.label }, labelStyle]}>
        {label}
      </Text>
      <View style={styles.keyValueRowWrapper}>
        <View style={styles.keyValueRowLine}>
          <Text
            selectable
            style={[styles.keyValueRowText, { color: colors.foreground, ...TYPOGRAPHY.bodySmall, fontFamily }, valueStyle]}
          >
            {displayValue}
          </Text>
          {copyButton}
        </View>
        {subValue ? (
          <Text style={{ color: colors.foregroundMuted, ...TYPOGRAPHY.caption }}>{subValue}</Text>
        ) : null}
      </View>
    </View>
  );
}

export interface KeyValueGroupProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function KeyValueGroup({ children, columns = 2, gap = SPACING.md, style }: KeyValueGroupProps) {
  const childArray = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.keyValueGroup, { gap }, style]}>
      {childArray.map((child, index) => (
        <View
          key={index}
          style={{ flexGrow: 1, flexShrink: 1, flexBasis: `${Math.floor(100 / columns) - 2}%` }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

// --- tabs ------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: string;
  badge?: string | number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  mode?: "auto" | "fit" | "scroll";
  style?: StyleProp<ViewStyle>;
}

export function Tabs({ tabs, activeTab, onTabChange, mode = "auto", style }: TabsProps) {
  const { colors, resolveRadius, touchTargetMin, isCompact, alpha } = usePluginTheme();
  const shouldFit = mode === "fit" || (mode === "auto" && (isCompact || tabs.length <= 4));
  const radius = resolveRadius("sm");

  const renderTab = (tab: TabItem) => {
    const isActive = tab.id === activeTab;
    const displayLabel = shouldFit && isCompact && tab.shortLabel ? tab.shortLabel : tab.label;
    return (
      <Pressable
        key={tab.id}
        onPress={() => onTabChange(tab.id)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        style={({ pressed }) => [
          styles.tab,
          shouldFit ? styles.tabFit : styles.tabScroll,
          {
            borderRadius: radius - 2,
            minHeight: Math.max(30, touchTargetMin - 8),
            backgroundColor: isActive ? colors.surface2 : pressed ? alpha(colors.surface2, 0.5) : "transparent",
            paddingHorizontal: shouldFit
              ? isCompact
                ? tabs.length > 3
                  ? SPACING.xs
                  : SPACING.sm
                : tabs.length >= 3
                  ? SPACING.sm
                  : SPACING.md
              : SPACING.md,
            paddingVertical: isCompact ? SPACING.xs : SPACING.sm,
          },
        ]}
      >
        {tab.icon ? (
          <Icon name={tab.icon} size={isCompact ? 11 : 13} color={isActive ? colors.foreground : colors.foregroundMuted} />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.tabText,
            {
              color: isActive ? colors.foreground : colors.foregroundMuted,
              fontSize: isCompact ? 11 : 12,
              fontWeight: isActive ? "600" : "500",
            },
          ]}
        >
          {displayLabel}
        </Text>
        {tab.badge !== undefined ? (
          <View style={[styles.tabBadge, { backgroundColor: isActive ? colors.accent : alpha(colors.foregroundMuted, 0.2) }]}>
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
  };

  if (shouldFit) {
    return (
      <View style={[styles.tabsFrame, { backgroundColor: colors.surface1, borderRadius: radius, borderColor: colors.border }, style]}>
        <View style={styles.tabsTrackFit}>{tabs.map((tab) => renderTab(tab))}</View>
      </View>
    );
  }

  return (
    <View style={[styles.tabsFrame, { backgroundColor: colors.surface1, borderRadius: radius, borderColor: colors.border }, style]}>
      <RNScrollView
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={!isCompact}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsScrollContent}
      >
        {tabs.map((tab) => renderTab(tab))}
      </RNScrollView>
    </View>
  );
}

// --- code ------------------------------------------------------------------

export interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  maxHeight?: number;
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function CodeBlock({ code, language, title, maxHeight = 320, copyable = true, style, textStyle }: CodeBlockProps) {
  const { colors, resolveRadius, isCompact, touchTargetMin, alpha } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const radius = resolveRadius("md");

  const handleCopy = async () => {
    try {
      await copyText(code);
      toast.show(title || "Code", { variant: "success" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  const fontFamily = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
  return (
    <View style={[styles.codeBlock, { backgroundColor: colors.surface0, borderColor: colors.border, borderRadius: radius }, style]}>
      {(title || language || copyable) && (
        <View style={[styles.codeBlockHeader, { borderBottomColor: alpha(colors.border, 0.7) }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {title ? (
              <Text style={[styles.codeBlockTitle, { color: colors.foreground }]}>{title}</Text>
            ) : language ? (
              <Text style={[styles.codeBlockLanguage, { color: colors.foregroundMuted }]}>{language.toUpperCase()}</Text>
            ) : null}
          </View>
          {copyable && (
            <Pressable
              onPress={handleCopy}
              hitSlop={Math.max(0, (touchTargetMin - 28) / 2)}
              style={({ pressed }) => [
                styles.codeBlockCopy,
                { backgroundColor: pressed ? colors.surface2 : colors.surface1, borderColor: colors.border, borderRadius: radius - 2 },
              ]}
            >
              <Icon name={copied ? "Check" : "Copy"} size={12} color={copied ? colors.statusSuccess : colors.foregroundMuted} />
              <Text style={[styles.codeBlockCopyText, { color: copied ? colors.statusSuccess : colors.foregroundMuted }]}>
                {copied ? "Copied!" : "Copy"}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      <RNScrollView nestedScrollEnabled style={{ maxHeight }} contentContainerStyle={{ padding: 10 }}>
        <RNScrollView horizontal showsHorizontalScrollIndicator>
          <Text
            selectable
            style={[styles.codeBlockText, { color: colors.foreground, fontFamily, fontSize: isCompact ? 11 : 12 }, textStyle]}
          >
            {code}
          </Text>
        </RNScrollView>
      </RNScrollView>
    </View>
  );
}

// --- controls --------------------------------------------------------------

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function Toggle({ value, onValueChange, label, description, disabled = false, style, labelStyle }: ToggleProps) {
  const { colors, touchTargetMin, isCompact, alpha } = usePluginTheme();
  const trackWidth = 38;
  const trackHeight = 22;
  const thumbSize = 16;
  const thumbPadding = 3;
  const trackColor = value ? colors.accent : alpha(colors.foregroundMuted, 0.35);
  const thumbPosition = value ? trackWidth - thumbSize - thumbPadding : thumbPadding;
  const hasText = Boolean(label || description);

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      hitSlop={Math.max(0, (touchTargetMin - trackHeight) / 2)}
      style={({ pressed }) => [
        styles.toggle,
        !hasText && styles.toggleBare,
        { minHeight: touchTargetMin, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {(label || description) && (
        <View style={styles.toggleText}>
          {label ? (
            <Text style={[styles.toggleLabel, { color: colors.foreground, fontSize: isCompact ? 13 : 14 }, labelStyle]}>
              {label}
            </Text>
          ) : null}
          {description ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{description}</Text>
          ) : null}
        </View>
      )}
      <View style={[styles.toggleTrack, { width: trackWidth, height: trackHeight, borderRadius: trackHeight / 2, backgroundColor: trackColor }]}>
        <View
          style={[
            styles.toggleThumb,
            { width: thumbSize, height: thumbSize, borderRadius: thumbSize / 2, backgroundColor: colors.surface0, transform: [{ translateX: thumbPosition }] },
          ]}
        />
      </View>
    </Pressable>
  );
}

export interface TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  disabled?: boolean;
  mono?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  onSubmitEditing?: () => void;
}

export function TextInput({
  value,
  onChangeText,
  label,
  placeholder,
  helperText,
  errorText,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "none",
  autoCorrect = false,
  disabled = false,
  mono = false,
  multiline = false,
  numberOfLines = 1,
  style,
  inputStyle,
  onSubmitEditing,
}: TextInputProps) {
  const { colors, resolveRadius, isCompact, touchTargetMin, alpha } = usePluginTheme();
  const [isFocused, setIsFocused] = useState(false);
  const hasError = Boolean(errorText);
  const borderColor = hasError ? colors.statusDanger : isFocused ? colors.accent : colors.border;
  const minHeight = multiline ? Math.max(touchTargetMin * 1.5, 64) : touchTargetMin;

  return (
    <View style={[{ gap: 4 }, style]}>
      {label ? (
        <Text style={[styles.textInputLabel, { color: hasError ? colors.statusDanger : colors.foreground, fontSize: isCompact ? 12 : 13 }]}>
          {label}
        </Text>
      ) : null}
      <HostTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        editable={!disabled}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onSubmitEditing={onSubmitEditing}
        style={[
          styles.textInput,
          {
            color: disabled ? colors.foregroundMuted : colors.foreground,
            backgroundColor: disabled ? alpha(colors.surface1, 0.5) : colors.surface0,
            borderColor,
            borderRadius: resolveRadius("md"),
            minHeight,
            paddingVertical: multiline ? 8 : 6,
            paddingHorizontal: 10,
            fontSize: isCompact ? 13 : 14,
            fontFamily: mono ? "monospace" : undefined,
          },
          inputStyle,
        ]}
      />
      {(errorText || helperText) && (
        <Text style={{ color: hasError ? colors.statusDanger : colors.foregroundMuted, fontSize: 11, marginTop: 2 }}>
          {errorText || helperText}
        </Text>
      )}
    </View>
  );
}

// --- layout ----------------------------------------------------------------

export interface ActionBarProps {
  children: ReactNode;
  align?: "flex-start" | "flex-end" | "center" | "space-between";
  direction?: "row" | "column" | "auto";
  style?: StyleProp<ViewStyle>;
}

export function ActionBar({ children, align = "flex-end", direction = "auto", style }: ActionBarProps) {
  const { isCompact, padding } = usePluginTheme();
  const isColumn = direction === "column" || (direction === "auto" && isCompact);
  return (
    <View
      style={[
        styles.actionBar,
        {
          flexDirection: isColumn ? "column" : "row",
          justifyContent: isColumn ? "flex-start" : align,
          alignItems: isColumn ? "stretch" : "center",
          gap: isCompact ? 8 : 10,
          marginTop: padding.vertical,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface FormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  layout?: "stacked" | "inline";
  style?: StyleProp<ViewStyle>;
}

export function FormRow({ label, description, children, layout = "stacked", style }: FormRowProps) {
  const { colors } = usePluginTheme();
  const labelBlock = (
    <View style={styles.formRowLabelBlock}>
      <Text style={[styles.formRowLabel, { color: colors.foreground }]}>{label}</Text>
      {description ? (
        <Text style={[styles.formRowDescription, { color: colors.foregroundMuted }]}>{description}</Text>
      ) : null}
    </View>
  );
  if (layout === "inline") {
    return (
      <View style={[styles.formRow, styles.formRowInline, style]}>
        {labelBlock}
        <View style={styles.formRowInlineContent}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[styles.formRow, style]}>
      {labelBlock}
      <View style={{ marginTop: 2 }}>{children}</View>
    </View>
  );
}

export interface RowProps {
  children?: ReactNode;
  gap?: SpacingValue;
  wrap?: boolean;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
}

export function Row({ children, gap, wrap = false, align, justify, style }: RowProps) {
  const { padding } = usePluginTheme();
  return (
    <View
      style={[
        { flexDirection: "row", gap: resolveSpacing(gap, padding.gap) },
        wrap && { flexWrap: "wrap" },
        align !== undefined && { alignItems: align },
        justify !== undefined && { justifyContent: justify },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// --- about -----------------------------------------------------------------

export interface AboutSectionProps {
  name: string;
  description?: string;
  version: string;
  author?: string;
  repository?: string;
  issues?: string;
  homepage?: string;
  license?: string;
  logo?: ImageSourcePropType | string;
  style?: StyleProp<ViewStyle>;
  density?: "default" | "compact" | "tiny";
}

export function AboutSection({
  name,
  description,
  version,
  author,
  repository,
  issues,
  homepage,
  license = "MIT",
  logo,
  style,
  density = "default",
}: AboutSectionProps) {
  const { colors, resolveRadius, isCompact } = usePluginTheme();
  const [copied, setCopied] = useState(false);
  const isTiny = density === "tiny";
  const radius = resolveRadius("md");

  let logoNode: ReactNode;
  if (typeof logo === "string" && /^https?:/.test(logo)) {
    logoNode = <Image source={{ uri: logo }} style={[styles.aboutLogo, { borderRadius: radius }]} />;
  } else if (typeof logo === "string") {
    logoNode = (
      <View style={[styles.aboutLogoFallback, { backgroundColor: colors.surface2, borderColor: colors.border, borderRadius: radius }]}>
        <Icon name={logo} size={26} color={colors.accent} />
      </View>
    );
  } else if (logo) {
    logoNode = <Image source={logo} style={[styles.aboutLogo, { borderRadius: radius }]} />;
  } else {
    logoNode = (
      <View style={[styles.aboutLogoFallback, { backgroundColor: colors.surface2, borderColor: colors.border, borderRadius: radius }]}>
        <Icon name="Layers" size={26} color={colors.accent} />
      </View>
    );
  }

  const links: Array<{ label: string; url: string; icon: string }> = [
    ...(repository ? [{ label: "Repository", url: repository, icon: "ExternalLink" }] : []),
    ...(issues ? [{ label: "Report Issue", url: issues, icon: "Bug" }] : []),
    ...(homepage ? [{ label: "Documentation", url: homepage, icon: "BookOpen" }] : []),
  ];

  const handleOpen = (url: string) => {
    triggerHaptic("light");
    void Linking.openURL(url).catch(() => {});
  };

  const handleCopyDiagnostics = async () => {
    triggerHaptic("success");
    const lines = [
      `Plugin: ${name} v${version}`,
      author ? `Author: ${author}` : null,
      `License: ${license}`,
      `Platform: ${Platform.OS} (${isCompact ? "compact" : "regular"})`,
      repository ? `Repository: ${repository}` : null,
    ].filter(Boolean);
    try {
      await copyText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Copy unavailable — leave the button unchanged.
    }
  };

  return (
    <View style={[{ gap: 12 }, style]}>
      <Card variant="elevated">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {logoNode}
          <View style={{ flex: 1, gap: 5, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <Text style={{ color: colors.foreground, fontSize: isTiny ? 11 : 14, fontWeight: "600" }}>{name}</Text>
              <Badge variant="accent" label={`v${version}`} />
            </View>
            {description ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: isTiny ? 9 : 13 }}>{description}</Text>
            ) : null}
            {author ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: isTiny ? 9 : 11 }}>by {author}</Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Badge variant="neutral" label={license} />
            </View>
          </View>
        </View>
        <View style={[styles.aboutActions, { borderTopColor: colors.border }]}>
          {links.map((link) => (
            <Button key={link.url} size="sm" variant="secondary" icon={link.icon} label={link.label} onPress={() => handleOpen(link.url)} />
          ))}
          <Button
            size="sm"
            variant={copied ? "primary" : "ghost"}
            icon={copied ? "Check" : "Copy"}
            label={copied ? "Diagnostics Copied!" : "Copy Diagnostics"}
            onPress={handleCopyDiagnostics}
          />
        </View>
      </Card>
      <Card variant="elevated">
        <Card.Header title="Runtime Environment" subtitle="Diagnostics for issue reports and system verification" />
        <KeyValueGroup columns={isCompact ? 1 : 2}>
          <KeyValue label="Plugin Version" value={`v${version}`} copyable />
          <KeyValue label="Client Platform" value={Platform.OS} />
          {author ? <KeyValue label="Author" value={author} /> : null}
          {license ? <KeyValue label="License" value={license} /> : null}
        </KeyValueGroup>
      </Card>
    </View>
  );
}

// --- recipes ---------------------------------------------------------------

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

type ThemeInput = ThemeColors | { colors: ThemeColors } | undefined;

function resolveRecipeColors(input: ThemeInput): ThemeColors {
  if (input && "colors" in input && input.colors) return input.colors;
  if (input && "surface0" in input) return input as ThemeColors;
  return FALLBACK_COLORS;
}

/** Local card style recipe for timeline content; mirrors the removed kit. */
export function cardRecipe(themeInput?: ThemeInput, optionsOrVariant?: CardRecipeOptions | SurfaceStyle): CardRecipeResult {
  const colors = resolveRecipeColors(themeInput);
  const options: CardRecipeOptions =
    typeof optionsOrVariant === "string" ? { variant: optionsOrVariant } : optionsOrVariant ?? {};
  const variant = options.variant ?? "flat";
  const compact = Boolean(options.compact);
  const radius = options.radius ?? (compact ? 6 : 8);
  const borderWidth = options.borderWidth ?? 1;

  let bg = colors.surface0;
  let border = colors.border;
  if (variant === "tinted") {
    bg = colors.accent + "0a";
    border = colors.accent + "33";
  } else if (variant === "elevated") {
    bg = colors.surface1;
  }

  const baseCard: ViewStyle = {
    backgroundColor: bg,
    borderColor: border,
    borderWidth,
    borderRadius: radius,
    paddingHorizontal: options.noPadding ? 0 : compact ? 8 : 12,
    paddingVertical: options.noPadding ? 0 : compact ? 6 : 10,
    width: "100%",
    overflow: "hidden",
  };
  return Object.assign({ ...baseCard }, {
    card: { ...baseCard },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: compact ? 4 : 8,
      width: "100%",
      marginBottom: compact ? 4 : 8,
    } as ViewStyle,
    headerTitle: { color: colors.foreground, fontSize: compact ? 13 : 14, fontWeight: "600", lineHeight: compact ? 18 : 20 } as TextStyle,
    headerSubtitle: { color: colors.foregroundMuted, fontSize: compact ? 10 : 11, lineHeight: compact ? 14 : 15, fontWeight: "400" } as TextStyle,
  });
}

// --- modal -----------------------------------------------------------------

export interface ModalBodyProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  headerMode?: "pinned" | "scroll";
  scrollMode?: "auto" | "always";
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  size?: "default" | "large";
}

/**
 * Scrollable body. On sidebar surfaces the host supplies no scroller, so this
 * is the single scroll owner; inside a pill it owns the bounded dialog's
 * scroller because the pill wrapper renders `<Modal.Content scrollable={false}>`.
 */
export function ModalBody({
  children,
  style,
  contentContainerStyle,
  header,
  headerStyle,
  headerMode = "scroll",
  refreshing = false,
  onRefresh,
}: ModalBodyProps) {
  const { colors, padding } = usePluginTheme();
  const refreshControl = onRefresh ? (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
  ) : undefined;
  const headerNode = header ? <View style={[{ width: "100%", flexShrink: 0 }, headerStyle]}>{header}</View> : null;
  return (
    <View style={[styles.modalBody, style]}>
      {headerNode}
      <HostScroll
        style={[styles.modalBodyScroll, { backgroundColor: colors.surface0 }]}
        contentContainerStyle={[
          styles.modalBodyContent,
          {
            paddingHorizontal: padding.horizontal,
            paddingTop: padding.vertical,
            paddingBottom: 24,
            gap: padding.gap,
          },
          contentContainerStyle,
        ]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </HostScroll>
    </View>
  );
}

export interface ModalContentProps {
  children: ReactNode;
  scrollable?: boolean;
  size?: "default" | "large";
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  headerMode?: "pinned" | "scroll";
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
}

/**
 * Fluid content for a plugin's OWN host `<Modal>`. Delegates scroll ownership
 * to the host `<Modal.Content>` so sheet gestures and safe areas keep working;
 * no second scroller is added.
 */
export function ModalContent({ children, scrollable = true, style, contentContainerStyle }: ModalContentProps) {
  return (
    <Modal.Content scrollable={scrollable}>
      <View style={[styles.fluid, style, contentContainerStyle]}>{children}</View>
    </Modal.Content>
  );
}

// --- styles ----------------------------------------------------------------

const styles = {
  fluid: { width: "100%" },

  buttonBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexShrink: 1,
    maxWidth: "100%",
  },
  buttonText: { fontWeight: "600", textAlign: "center", flexShrink: 1 },

  inlineButton: {
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
  },
  inlineButtonText: { fontSize: 12, fontWeight: "600", flexShrink: 1 },

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
  badgeDot: { width: 6, height: 6, borderRadius: 3 },

  statusDotContainer: { alignItems: "center", justifyContent: "center" },
  statusDot: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 3 },

  card: { overflow: "hidden", width: "100%" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  cardHeaderTitleColumn: { gap: 1, flexShrink: 1, minWidth: 0 },
  cardHeaderTitle: { fontWeight: "600", fontSize: 13, lineHeight: 19 },
  cardHeaderSubtitle: { fontWeight: "400", fontSize: 11, lineHeight: 15 },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  cardHeaderValue: { fontWeight: "600" },

  collapsibleContainer: { borderWidth: 1, overflow: "hidden" },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  collapsibleHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  collapsibleChevron: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  collapsibleTitleBlock: { flex: 1 },
  collapsibleTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  collapsibleTitleSlot: { flexDirection: "row", alignItems: "center" },
  collapsibleBadgeSlot: { flexDirection: "row", alignItems: "center" },
  collapsibleHeaderRight: { flexDirection: "row", alignItems: "center", marginLeft: 8 },
  collapsibleTitle: { fontWeight: "600" },
  collapsibleSubtitle: { fontWeight: "400" },
  collapsibleContent: { padding: 12 },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2, flexShrink: 1, maxWidth: "100%" },
  sectionHeaderTitle: { letterSpacing: 0.8, flexShrink: 1 },

  emptyState: { alignItems: "center", justifyContent: "center", gap: 8 },
  emptyStateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyStateTitle: { fontWeight: "600", textAlign: "center" },
  emptyStateDescription: { textAlign: "center", maxWidth: 280, lineHeight: 18 },

  keyValueContainer: { width: "100%" },
  keyValueRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  keyValueStacked: { flexDirection: "column", gap: 3, width: "100%" },
  keyValueStackedHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  keyValueStackedText: { width: "100%" },
  keyValueInline: { flexDirection: "row", alignItems: "center", gap: SPACING.xs, minWidth: 0 },
  keyValueInlineText: { flexShrink: 1, minWidth: 0 },
  keyValueRowWrapper: { flexDirection: "column", alignItems: "flex-end", flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 },
  keyValueRowLine: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, flexShrink: 1, minWidth: 0, maxWidth: "100%" },
  keyValueRowText: { flexShrink: 1, minWidth: 0, textAlign: "right" },
  keyValueGroup: { flexDirection: "row", flexWrap: "wrap", width: "100%" },
  keyValueLabel: { flexShrink: 1, minWidth: 0 },
  keyValueCopy: { padding: 3, alignItems: "center", justifyContent: "center" },

  tabsFrame: { width: "100%", maxWidth: "100%", borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  tabsTrackFit: { flexDirection: "row", flexWrap: "nowrap", alignItems: "center", width: "100%", padding: 3, gap: 2 },
  tabsScroll: { width: "100%", maxWidth: "100%" },
  tabsScrollContent: { flexDirection: "row", alignItems: "center", padding: 3, gap: 4 },
  tab: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" },
  tabFit: { flex: 1, flexShrink: 1, minWidth: 0 },
  tabScroll: { flexShrink: 0 },
  tabText: { textAlign: "center", flexShrink: 1, minWidth: 0 },
  tabBadge: { borderRadius: 9999, paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: "center", justifyContent: "center" },
  tabBadgeText: { fontSize: 10, fontWeight: "700" },

  codeBlock: { borderWidth: 1, overflow: "hidden" },
  codeBlockHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1 },
  codeBlockTitle: { fontSize: 12, fontWeight: "600" },
  codeBlockLanguage: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  codeBlockCopy: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  codeBlockCopyText: { fontSize: 11, fontWeight: "500" },
  codeBlockText: { lineHeight: 18 },

  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" },
  toggleBare: { width: "auto", alignSelf: "flex-start", flexShrink: 0, justifyContent: "flex-start" },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
  toggleLabel: { fontWeight: "500" },
  toggleTrack: { justifyContent: "center", flexShrink: 0 },
  toggleThumb: { shadowColor: HOST_SHADOW_COLOR, shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },

  textInput: { borderWidth: 1 },
  textInputLabel: { fontWeight: "600" },

  actionBar: { flexWrap: "wrap" },
  formRow: { gap: 4, width: "100%" },
  formRowInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  formRowLabelBlock: { gap: 2, flexShrink: 1, minWidth: 0 },
  formRowInlineContent: { flexShrink: 0, alignItems: "flex-end" },
  formRowLabel: { fontWeight: "600", fontSize: 12, lineHeight: 16 },
  formRowDescription: { lineHeight: 16, fontSize: 11 },

  aboutLogo: { width: 48, height: 48, resizeMode: "cover" },
  aboutLogoFallback: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  aboutActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 0.5,
  },

  modalBody: { flex: 1, minHeight: 0, width: "100%" },
  modalBodyScroll: { flex: 1, width: "100%" },
  modalBodyContent: { flexGrow: 1, width: "100%" },
} as const;

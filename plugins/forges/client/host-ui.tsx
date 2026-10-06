import React, {
  forwardRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
  type ImageStyle,
  type RefreshControlProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  Icon,
  ScrollView as HostScrollView,
  TextInput as HostTextInput,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import type { ScrollViewProps } from "react-native";
import { useHostTheme } from "paseo-plugin-helper/lifecycle";
import {
  forgeMarkSource,
  resolveForgeMark,
  splitHighlightParts,
  type ForgeMarkInput,
  type StatusVariant,
} from "paseo-plugin-helper/shared";

/**
 * Plugin-local presentation layer for `plugins/forges`.
 *
 * The frozen helper `client/` bespoke kit is being removed
 * (xpufx-org/paseo#924/#937). The host SDK ships no Card/Badge/Button/table
 * primitives, so forges composes the handful of pieces it actually renders
 * here, over the host `theme` (via `useHostTheme`), the host
 * `Icon`/`ScrollView`/`TextInput`/`copyText`/`useToast`, and plain React
 * Native. Deliberately plugin-local: it is not a shared design system and adds
 * nothing to the helper.
 *
 * The host owns theme, scroll, modal frames and icons; this file only composes
 * the genuinely missing presentational atoms. `HostThemeProvider` is mounted by
 * the lifecycle registration wrappers for pill/panel surfaces, and timeline
 * cards wrap their own subtree with the host-supplied `theme` prop.
 */

export { HostThemeProvider, useHostTheme } from "paseo-plugin-helper/lifecycle";

export type ScrollViewInstance = React.ElementRef<typeof HostScrollView>;

const PILL_RADIUS = 9999;
const SPACING = { xs: 4, sm: 8, md: 12, lg: 16 } as const;

// --- text ------------------------------------------------------------------

export interface HighlightedTextProps {
  text: string;
  query: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  /** Mark the whole field when the query has neither a literal nor a token hit. */
  fuzzyFallback?: boolean;
}

/** `<Text>` that paints literal (case-insensitive) query matches with the accent. */
export function HighlightedText({
  text,
  query,
  style,
  numberOfLines,
  selectable,
  fuzzyFallback = false,
}: HighlightedTextProps) {
  const { colors } = useHostTheme();
  const parts = useMemo(
    () => splitHighlightParts(text, query, { fallbackToWholeField: fuzzyFallback }),
    [text, query, fuzzyFallback],
  );
  return (
    <Text style={style} numberOfLines={numberOfLines} selectable={selectable}>
      {parts.map((part, index) =>
        part.matched ? (
          <Text key={`m${index}`} style={{ backgroundColor: colors.accent, color: colors.accentForeground }}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

// --- layout ----------------------------------------------------------------

export interface ActionBarProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Right-aligned wrapping action row. */
export function ActionBar({ children, style }: ActionBarProps) {
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: SPACING.sm, marginTop: SPACING.md }, style]}>
      {children}
    </View>
  );
}

export interface FormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Label/description block stacked above its control. */
export function FormRow({ label, description, children, style }: FormRowProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ gap: 4, width: "100%" }, style]}>
      <View style={{ gap: 2, flexShrink: 1, minWidth: 0 }}>
        <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "600" }}>{label}</Text>
        {description ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{description}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// --- surfaces --------------------------------------------------------------

export type SurfaceVariant = "flat" | "elevated" | "tinted";

function resolveSurface(
  variant: SurfaceVariant,
  colors: ReturnType<typeof useHostTheme>["colors"],
  alpha: ReturnType<typeof useHostTheme>["alpha"],
): { backgroundColor: string; borderColor: string } {
  if (variant === "tinted") {
    return { backgroundColor: alpha(colors.accent, 0.04), borderColor: alpha(colors.accent, 0.2) };
  }
  if (variant === "elevated") {
    return { backgroundColor: colors.surface1, borderColor: colors.border };
  }
  return { backgroundColor: colors.surface0, borderColor: colors.border };
}

export interface CardProps {
  children: ReactNode;
  variant?: SurfaceVariant;
  style?: StyleProp<ViewStyle>;
  noPadding?: boolean;
}

export interface CardHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  highlightQuery?: string;
}

/** Card header: optional icon, title/subtitle column, and a trailing slot. */
export function CardHeader({
  title,
  subtitle,
  badge,
  icon,
  style,
  titleStyle,
  subtitleStyle,
  highlightQuery,
}: CardHeaderProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: SPACING.sm, width: "100%", marginBottom: SPACING.sm }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={{ gap: 1, flexShrink: 1, minWidth: 0 }}>
          <Text style={[{ color: colors.foreground, fontSize: 13, fontWeight: "600" }, titleStyle]}>
            {highlightQuery ? <HighlightedText text={title} query={highlightQuery} fuzzyFallback /> : title}
          </Text>
          {subtitle ? (
            <Text style={[{ color: colors.foregroundMuted, fontSize: 11 }, subtitleStyle]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {badge ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>{badge}</View> : null}
    </View>
  );
}

function CardBase({ children, variant = "flat", style, noPadding = false }: CardProps) {
  const { colors, alpha } = useHostTheme();
  const surface = resolveSurface(variant, colors, alpha);
  return (
    <View
      style={[
        {
          ...surface,
          borderRadius: 8,
          borderWidth: 1,
          overflow: "hidden",
          width: "100%",
          paddingHorizontal: noPadding ? 0 : SPACING.md,
          paddingVertical: noPadding ? 0 : SPACING.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export const Card = Object.assign(CardBase, { Header: CardHeader });

// --- chips -----------------------------------------------------------------

export type BadgeStyle = "tinted" | "outline" | "solid";
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  label: string;
  variant?: StatusVariant;
  styleVariant?: BadgeStyle;
  size?: BadgeSize;
  icon?: string | ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  highlightQuery?: string;
  highlightFuzzyFallback?: boolean;
}

export function Badge({
  label,
  variant = "neutral",
  styleVariant = "tinted",
  size = "md",
  icon,
  style,
  textStyle,
  highlightQuery,
  highlightFuzzyFallback,
}: BadgeProps) {
  const { colors, getVariantPalette, getStatusColor } = useHostTheme();
  const palette = getVariantPalette(variant);
  const fontSize = size === "sm" ? 10 : 11;
  const iconSize = size === "sm" ? 10 : 11;

  let bg = palette.bg;
  let border = palette.border;
  let textColor = palette.text;
  if (styleVariant === "outline") {
    bg = "transparent";
    border = palette.border;
    textColor = palette.text;
  } else if (styleVariant === "solid") {
    bg = getStatusColor(variant);
    border = "transparent";
    textColor = colors.accentForeground;
  }

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 4,
          flexShrink: 1,
          maxWidth: "100%",
          borderWidth: 1,
          borderColor: border,
          borderRadius: PILL_RADIUS,
          backgroundColor: bg,
          paddingVertical: size === "sm" ? 1 : 2,
          paddingHorizontal: size === "sm" ? 5 : 8,
        },
        style,
      ]}
    >
      {typeof icon === "string" ? <Icon name={icon} size={iconSize} color={textColor} /> : icon}
      <Text
        accessibilityLabel={label}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[{ color: textColor, fontSize, fontWeight: "600", flexShrink: 1 }, textStyle]}
      >
        {highlightQuery ? (
          <HighlightedText text={label} query={highlightQuery} fuzzyFallback={highlightFuzzyFallback} numberOfLines={1} />
        ) : (
          label
        )}
      </Text>
    </View>
  );
}

// --- controls --------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  label?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string | ReactNode;
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
  onPress,
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityRole = "button",
}: ButtonProps) {
  const { colors, alpha } = useHostTheme();
  const py = size === "sm" ? 6 : size === "lg" ? 12 : 10;
  const px = size === "sm" ? 10 : size === "lg" ? 18 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  let bg = colors.surface1;
  let border = colors.border;
  let textColor = colors.foreground;
  if (variant === "primary") {
    bg = colors.accent;
    border = "transparent";
    textColor = colors.accentForeground;
  } else if (variant === "danger") {
    bg = alpha(colors.statusDanger, 0.15);
    border = alpha(colors.statusDanger, 0.4);
    textColor = colors.statusDanger;
  } else if (variant === "ghost") {
    bg = "transparent";
    border = "transparent";
    textColor = colors.foregroundMuted;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          flexShrink: 1,
          maxWidth: "100%",
          borderWidth: border !== "transparent" ? 1 : 0,
          borderColor: border,
          borderRadius: size === "sm" ? 6 : 8,
          backgroundColor: pressed && !disabled ? alpha(bg === "transparent" ? colors.surface2 : bg, 0.8) : bg,
          paddingVertical: py,
          paddingHorizontal: px,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : children ? (
        children
      ) : (
        <>
          {typeof icon === "string" ? <Icon name={icon} size={iconSize} color={textColor} /> : icon}
          {label ? (
            <Text numberOfLines={1} ellipsizeMode="tail" style={[{ color: textColor, fontSize, fontWeight: "600", flexShrink: 1 }, textStyle]}>
              {label}
            </Text>
          ) : null}
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

/** Compact text/link action for inline timeline content. */
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
  const { colors } = useHostTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 24, paddingHorizontal: 3, paddingVertical: 2, borderRadius: 4, flexShrink: 1, maxWidth: "100%", opacity: disabled ? 0.45 : 1, backgroundColor: pressed && !disabled ? colors.surface2 : "transparent" },
        style,
      ]}
    >
      {typeof icon === "string" ? <Icon name={icon} size={13} color={colors.accent} /> : icon}
      <Text numberOfLines={1} ellipsizeMode="tail" style={[{ color: colors.accent, fontSize: 12, fontWeight: "600", flexShrink: 1 }, textStyle]}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface CopyButtonProps {
  text: string;
  label?: string;
  accessibilityLabel?: string;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}

/** Copy affordance with Check feedback, over the host clipboard + toast. */
export function CopyButton({ text, label = "Copy", accessibilityLabel, size = "sm", style }: CopyButtonProps) {
  const { colors } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await copyText(text);
    } catch {
      return;
    }
    setCopied(true);
    toast.show("Copied");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Pressable
      onPress={handleCopy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingVertical: size === "sm" ? 3 : 5, paddingHorizontal: size === "sm" ? 8 : 10, backgroundColor: pressed ? colors.surface2 : "transparent" },
        style,
      ]}
    >
      <Icon name={copied ? "Check" : "Copy"} size={size === "sm" ? 12 : 14} color={copied ? colors.statusSuccess : colors.foregroundMuted} />
      {label !== "" ? (
        <Text style={{ fontSize: size === "sm" ? 11 : 12, fontWeight: "500", color: copied ? colors.statusSuccess : colors.foregroundMuted }}>{copied ? "Copied!" : label}</Text>
      ) : null}
    </Pressable>
  );
}

export interface TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function TextInput({
  value,
  onChangeText,
  label,
  placeholder,
  secureTextEntry = false,
  autoCapitalize = "none",
  autoCorrect = false,
  multiline = false,
  numberOfLines = 1,
  style,
  inputStyle,
}: TextInputProps) {
  const { colors } = useHostTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 4 }, style]}>
      {label ? <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{label}</Text> : null}
      <HostTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            color: colors.foreground,
            backgroundColor: colors.surface0,
            borderWidth: 1,
            borderColor: focused ? colors.accent : colors.border,
            borderRadius: 8,
            minHeight: multiline ? 64 : 32,
            paddingVertical: multiline ? 8 : 6,
            paddingHorizontal: 10,
            fontSize: 13,
          },
          inputStyle,
        ]}
      />
    </View>
  );
}

export interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Search field with leading icon and clear affordance. */
export function SearchInput({ value, onChangeText, placeholder = "Search...", onClear, style }: SearchInputProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface1, height: 36, paddingHorizontal: 10 }, style]}>
      <Icon name="Search" size={16} color={colors.foregroundMuted} />
      <HostTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, paddingVertical: 0, marginLeft: 8, color: colors.foreground, fontSize: 13 }}
      />
      {value ? (
        <Pressable
          onPress={() => {
            onChangeText("");
            onClear?.();
          }}
          accessibilityLabel="Clear search"
          hitSlop={8}
        >
          <Icon name="X" size={14} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Toggle({ value, onValueChange, disabled = false, style }: ToggleProps) {
  const { colors, alpha } = useHostTheme();
  const trackWidth = 38;
  const trackHeight = 22;
  const thumbSize = 16;
  const thumbPadding = 3;
  return (
    <Pressable
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[{ width: trackWidth, height: trackHeight, borderRadius: trackHeight / 2, justifyContent: "center", opacity: disabled ? 0.5 : 1, backgroundColor: value ? colors.accent : alpha(colors.foregroundMuted, 0.35) }, style]}
    >
      <View
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: thumbSize / 2,
          backgroundColor: colors.surface0,
          transform: [{ translateX: value ? trackWidth - thumbSize - thumbPadding : thumbPadding }],
        }}
      />
    </Pressable>
  );
}

// --- tabs ------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: string;
  shortLabel?: string;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  style?: StyleProp<ViewStyle>;
}

/** Fluid segmented tab strip. */
export function Tabs({ tabs, activeTab, onTabChange, style }: TabsProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ flexDirection: "row", width: "100%", backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 3, gap: 2 }, style]}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onTabChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              {
                flex: 1,
                minWidth: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                minHeight: 30,
                paddingHorizontal: SPACING.sm,
                backgroundColor: active ? colors.surface2 : pressed ? colors.surface2 : "transparent",
              },
            ]}
          >
            <Text numberOfLines={1} style={{ color: active ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: active ? "600" : "500" }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- disclosure ------------------------------------------------------------

export interface CollapsibleProps {
  title?: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

export function Collapsible({
  title,
  subtitle,
  icon,
  children,
  initiallyExpanded = false,
  isExpanded: controlled,
  onToggle,
  style,
}: CollapsibleProps) {
  const { colors, alpha } = useHostTheme();
  const [internal, setInternal] = useState(initiallyExpanded);
  const expanded = controlled !== undefined ? controlled : internal;
  const toggle = () => {
    const next = !expanded;
    if (controlled === undefined) setInternal(next);
    onToggle?.(next);
  };
  return (
    <View style={[{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface0, overflow: "hidden" }, style]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          { flexDirection: "row", alignItems: "center", gap: SPACING.sm, minHeight: 36, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: pressed ? alpha(colors.foreground, 0.06) : "transparent" },
        ]}
      >
        <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1, borderColor: alpha(colors.accent, 0.25), backgroundColor: alpha(colors.accent, 0.12), alignItems: "center", justifyContent: "center" }}>
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
        </View>
        {icon ? <Icon name={icon} size={14} color={colors.accent} /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          {title ? <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{title}</Text> : null}
          {subtitle ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{subtitle}</Text> : null}
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: SPACING.sm }}>{children}</View>
      ) : null}
    </View>
  );
}

// --- status / empty --------------------------------------------------------

export interface EmptyStateProps {
  icon?: string | ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon = "Inbox", title, description, actionLabel, onAction, style }: EmptyStateProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ alignItems: "center", justifyContent: "center", gap: SPACING.sm, padding: SPACING.md }, style]}>
      {typeof icon === "string" ? (
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface1, marginBottom: 4 }}>
          <Icon name={icon} size={28} color={colors.foregroundMuted} />
        </View>
      ) : (
        icon
      )}
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {description ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 280 }}>{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: SPACING.sm }}>
          <Button size="sm" variant="secondary" label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

// --- code / key-value ------------------------------------------------------

export interface CodeBlockProps {
  code: string;
  language?: string;
  style?: StyleProp<ViewStyle>;
}

export function CodeBlock({ code, language, style }: CodeBlockProps) {
  const { colors } = useHostTheme();
  const toast = useToast();
  const copy = async () => {
    try {
      await copyText(code);
      toast.show("Copied");
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <View style={[{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1, overflow: "hidden" }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>{language ?? "code"}</Text>
        <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel="Copy code">
          <Icon name="Copy" size={12} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 8 }}>
        <HostScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
          <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{code}</Text>
        </HostScrollView>
      </View>
    </View>
  );
}

export interface CommandBoxProps {
  command: string;
  copyLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function CommandBox({ command, copyLabel = "Copy command", style }: CommandBoxProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface1, paddingHorizontal: 8, paddingVertical: 4 }, style]}>
      <Text selectable numberOfLines={1} style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12, flexShrink: 1 }}>{command}</Text>
      <CopyButton text={command} label={copyLabel} />
    </View>
  );
}

export interface KeyValueProps {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

export function KeyValue({ label, value, mono = false, copyable = false, style, valueStyle }: KeyValueProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[{ gap: 2, width: "100%" }, style]}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text selectable style={[{ color: colors.foreground, fontSize: 12, fontFamily: mono ? "monospace" : undefined, flexShrink: 1 }, valueStyle]}>
          {value === null || value === undefined || value === "" ? "-" : String(value)}
        </Text>
        {copyable && value ? <CopyButton text={String(value)} label="" accessibilityLabel={`Copy ${label}`} /> : null}
      </View>
    </View>
  );
}

export interface KeyValueGroupProps {
  children: ReactNode;
  columns?: number;
  style?: StyleProp<ViewStyle>;
}

export function KeyValueGroup({ children, columns = 2, style }: KeyValueGroupProps) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: SPACING.md }, style]}>
      {items.map((child, index) => (
        <View key={index} style={{ flexGrow: 1, flexShrink: 1, flexBasis: `${Math.floor(100 / columns) - 2}%` }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// --- modal bodies ----------------------------------------------------------

export interface HostScrollProps extends ScrollViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Explicit single scroll owner for surfaces where the host supplies none. */
export const HostScroll = forwardRef<ScrollViewInstance, HostScrollProps>(function HostScroll(
  { children, style, contentContainerStyle, ...props },
  ref,
) {
  return (
    <HostScrollView ref={ref} style={[{ flex: 1, minHeight: 0, width: "100%" }, style]} contentContainerStyle={contentContainerStyle} {...props}>
      {children}
    </HostScrollView>
  );
});

export interface HostModalBodyProps {
  children: ReactNode;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  scrollRef?: React.Ref<ScrollViewInstance>;
}

/**
 * Pinned-header scrollable body for the forges modal/panel. The host owns the
 * dialog frame; this owns exactly one scroller below the fixed header.
 */
export function HostModalBody({
  children,
  header,
  headerStyle,
  style,
  contentContainerStyle,
  refreshing = false,
  onRefresh,
  scrollRef,
}: HostModalBodyProps) {
  const { colors } = useHostTheme();
  const refreshControl: React.ReactElement<RefreshControlProps> | undefined = onRefresh ? (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
  ) : undefined;
  return (
    <View style={[{ flex: 1, minHeight: 0, width: "100%" }, style]}>
      {header ? (
        <View style={[{ width: "100%", flexShrink: 0, backgroundColor: colors.surface0 }, headerStyle]}>{header}</View>
      ) : null}
      <HostScroll
        ref={scrollRef}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        contentContainerStyle={[{ flexGrow: 1, width: "100%", gap: SPACING.md, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20 }, contentContainerStyle]}
      >
        {children}
      </HostScroll>
    </View>
  );
}

// --- forge mark ------------------------------------------------------------

export interface ForgeIconProps extends ForgeMarkInput {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}

/** Host-resolved forge brand mark, over the shared resolver. */
export function ForgeIcon({ host, kind, size = 16, color, style, accessibilityLabel }: ForgeIconProps) {
  const { colors } = useHostTheme();
  const markColor = color ?? colors.foreground;
  const mark = resolveForgeMark({ host, kind });
  const source = mark.custom && Platform.OS === "web" ? forgeMarkSource(mark.kind, markColor) : null;
  if (!source) {
    return <Icon name={mark.lucideName} size={size} color={markColor} />;
  }
  return (
    <Image
      accessibilityLabel={accessibilityLabel ?? mark.label}
      accessibilityRole="image"
      accessible
      source={source}
      style={[{ width: size, height: size }, style as StyleProp<ImageStyle>]}
    />
  );
}

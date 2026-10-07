import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  Icon,
  ScrollView as HostScrollView,
  TextInput as HostTextInputPrimitive,
} from "@getpaseo/plugin/client/react-native";
import { useHostTheme } from "./vendor/paseo-plugin-helper/lifecycle";
import type { StatusVariant } from "../shared/vendor/paseo-plugin-helper";

/**
 * Plugin-local presentation layer for `plugins/slash`.
 *
 * The frozen `paseo-plugin-helper/client` bespoke kit is being removed
 * (xpufx-org/paseo#924 / #937). The host SDK ships no Card/Badge/Button/tab
 * primitives, so slash composes the pieces it actually renders here, over the
 * lifecycle `useHostTheme()` colors, the host `Icon`/`ScrollView`/`TextInput`
 * primitives, and plain React Native. Deliberately plugin-local: not a shared
 * design system, and nothing is added to the helper.
 */

// --- spacing ---------------------------------------------------------------

/** Static spacing scale shared by the console layout. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

type SpacingValue = keyof typeof spacing | number;

function gapOf(value: SpacingValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return typeof value === "number" ? value : (spacing[value] ?? fallback);
}

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

// --- layout ----------------------------------------------------------------

export interface HostRowProps {
  children: ReactNode;
  gap?: SpacingValue;
  align?: keyof typeof alignMap;
  justify?: keyof typeof justifyMap;
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Horizontal flex row. */
export function HostRow({
  children,
  gap,
  align = "center",
  justify = "start",
  wrap = false,
  style,
}: HostRowProps) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: alignMap[align],
          justifyContent: justifyMap[justify],
          flexWrap: wrap ? "wrap" : "nowrap",
          gap: gapOf(gap, 8),
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
  gap?: SpacingValue;
  align?: keyof typeof alignMap;
  style?: StyleProp<ViewStyle>;
}

/** Vertical flex stack. */
export function HostStack({ children, gap, align = "stretch", style }: HostStackProps) {
  return (
    <View style={[{ flexDirection: "column", alignItems: alignMap[align], gap: gapOf(gap, 8) }, style]}>
      {children}
    </View>
  );
}

export interface HostActionBarProps {
  children: ReactNode;
  align?: keyof typeof justifyMap;
  direction?: "row" | "column";
  gap?: SpacingValue;
  style?: StyleProp<ViewStyle>;
}

/** Trailing action row inside a card. */
export function HostActionBar({
  children,
  align = "end",
  direction = "row",
  gap,
  style,
}: HostActionBarProps) {
  return (
    <View
      style={[
        {
          flexDirection: direction,
          alignItems: "center",
          justifyContent: justifyMap[align],
          gap: gapOf(gap, 8),
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
}

/** Label / hint stacked over a single control. */
export function HostFormRow({ label, description, children }: HostFormRowProps) {
  const { colors } = useHostTheme();
  return (
    <View style={{ gap: 6, width: "100%" }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{label}</Text>
      {description ? (
        <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{description}</Text>
      ) : null}
      {children}
    </View>
  );
}

// --- surfaces --------------------------------------------------------------

export type HostSurfaceVariant = "flat" | "elevated" | "tinted";

function surfaceStyle(
  colors: ReturnType<typeof useHostTheme>["colors"],
  alpha: ReturnType<typeof useHostTheme>["alpha"],
  variant: HostSurfaceVariant,
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
  noPadding?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Bordered content surface. */
export function HostCard({ children, variant = "flat", noPadding = false, style }: HostCardProps) {
  const { colors, alpha } = useHostTheme();
  const surface = surfaceStyle(colors, alpha, variant);
  return (
    <View
      style={[
        {
          width: "100%",
          borderWidth: 1,
          borderRadius: 12,
          gap: 8,
          padding: noPadding ? 0 : 12,
          backgroundColor: surface.backgroundColor,
          borderColor: surface.borderColor,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface HostCardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Card title block with an optional icon, badge and trailing action. */
export function HostCardHeader({
  title,
  subtitle,
  icon,
  badge,
  action,
  style,
}: HostCardHeaderProps) {
  const { colors } = useHostTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          width: "100%",
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
        }}
      >
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={{ gap: 1, flexShrink: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{ fontSize: 11, color: colors.foregroundMuted }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {badge}
        {action}
      </View>
    </View>
  );
}

export interface HostSectionHeaderProps {
  title: string;
  count?: number;
}

/** Uppercase section divider with an optional count badge. */
export function HostSectionHeader({ title, count }: HostSectionHeaderProps) {
  const { colors } = useHostTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          fontWeight: "600",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: colors.foregroundMuted,
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <HostBadge
          label={String(count)}
          size="sm"
          styleVariant={count > 0 ? "solid" : "tinted"}
          variant={count > 0 ? "warning" : "neutral"}
        />
      ) : null}
    </View>
  );
}

// --- badge -----------------------------------------------------------------

export type HostBadgeStyle = "tinted" | "outline" | "solid";

export interface HostBadgeProps {
  label: string;
  variant?: StatusVariant;
  styleVariant?: HostBadgeStyle;
  size?: "sm" | "md";
  icon?: string;
}

/** Small status pill composed over the host status colors. */
export function HostBadge({
  label,
  variant = "neutral",
  styleVariant = "tinted",
  size = "md",
  icon,
}: HostBadgeProps) {
  const { colors, getVariantPalette, getStatusColor, alpha } = useHostTheme();

  const palette = getVariantPalette(variant);
  const solid = getStatusColor(variant);

  let backgroundColor = palette.bg;
  let borderColor = palette.border;
  let textColor = palette.text;
  if (styleVariant === "outline") {
    backgroundColor = "transparent";
  } else if (styleVariant === "solid") {
    backgroundColor = solid;
    borderColor = "transparent";
    textColor = colors.accentForeground;
  }

  const small = size === "sm";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        borderWidth: 1,
        gap: 4,
        flexShrink: 1,
        maxWidth: "100%",
        borderRadius: 9999,
        backgroundColor,
        borderColor,
        paddingVertical: small ? 1 : 2,
        paddingHorizontal: small ? 5 : 8,
      }}
    >
      {icon ? <Icon name={icon} size={small ? 10 : 11} color={textColor} /> : null}
      <Text
        numberOfLines={1}
        style={{
          fontSize: small ? 10 : 11,
          lineHeight: small ? 12 : 15,
          fontWeight: "600",
          color: textColor,
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// --- controls --------------------------------------------------------------

export type HostButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface HostButtonProps {
  label?: string;
  variant?: HostButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}

/** Pressable button. The host SDK exposes no button primitive. */
export function HostButton({
  label,
  variant = "secondary",
  size = "md",
  icon,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
}: HostButtonProps) {
  const { colors, alpha } = useHostTheme();

  const paddingVertical = size === "sm" ? 6 : size === "lg" ? 12 : 10;
  const paddingHorizontal = size === "sm" ? 10 : size === "lg" ? 18 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  let backgroundColor = "transparent";
  let borderColor = "transparent";
  let textColor = colors.foreground;
  if (variant === "primary") {
    backgroundColor = colors.accent;
    textColor = colors.accentForeground;
  } else if (variant === "danger") {
    backgroundColor = alpha(colors.statusDanger, 0.15);
    borderColor = alpha(colors.statusDanger, 0.4);
    textColor = colors.statusDanger;
  } else if (variant === "ghost") {
    textColor = colors.foregroundMuted;
  } else {
    backgroundColor = colors.surface1;
    borderColor = colors.border;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: 10,
        borderWidth: borderColor === "transparent" ? 0 : 1,
        backgroundColor: pressed && !disabled ? alpha(backgroundColor, 0.8) : backgroundColor,
        borderColor,
        paddingVertical,
        paddingHorizontal,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={iconSize} color={textColor} /> : null}
          {label ? (
            <Text style={{ fontSize, fontWeight: "600", color: textColor }}>{label}</Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export interface HostToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}

/** Bare on/off switch for row trailing actions. */
export function HostToggle({ value, onValueChange, disabled = false }: HostToggleProps) {
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
      hitSlop={8}
      style={{
        justifyContent: "center",
        minHeight: 24,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: trackWidth,
          height: trackHeight,
          borderRadius: trackHeight / 2,
          justifyContent: "center",
          backgroundColor: value ? colors.accent : alpha(colors.foregroundMuted, 0.35),
        }}
      >
        <View
          style={{
            position: "absolute",
            top: thumbPadding,
            left: thumbPadding,
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: colors.accentForeground,
            transform: [{ translateX: value ? trackWidth - thumbSize - thumbPadding * 2 : 0 }],
          }}
        />
      </View>
    </Pressable>
  );
}

export interface HostTextInputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  errorText?: string;
  helperText?: string;
  multiline?: boolean;
  numberOfLines?: number;
  mono?: boolean;
}

/** Single / multi-line text field backed by the host modal-aware input. */
export function HostTextInput({
  value,
  onChangeText,
  placeholder,
  errorText,
  helperText,
  multiline = false,
  numberOfLines,
  mono = false,
}: HostTextInputProps) {
  const { colors, alpha } = useHostTheme();
  const borderColor = errorText ? colors.statusDanger : colors.border;
  return (
    <View style={{ gap: 4, width: "100%" }}>
      <HostTextInputPrimitive
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        multiline={multiline}
        numberOfLines={numberOfLines}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
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
        }}
      />
      {errorText ? (
        <Text style={{ fontSize: 11, color: colors.statusDanger }}>{errorText}</Text>
      ) : helperText ? (
        <Text style={{ fontSize: 11, color: alpha(colors.statusWarning, 1) }}>{helperText}</Text>
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
}

/** Inline single-choice picker. The host SDK exposes no select primitive. */
export function HostSelect({ value, options, onValueChange, placeholder = "Select…" }: HostSelectProps) {
  const { colors } = useHostTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const display = selected?.label ?? (value || placeholder);
  const canOpen = options.length > 0;

  return (
    <View style={{ gap: 4, width: "100%" }}>
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

// --- tabs ------------------------------------------------------------------

export interface HostTabItem {
  id: string;
  label: string;
  icon?: string;
}

export interface HostTabsProps {
  tabs: readonly HostTabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

/** Local segmented tab strip. */
export function HostTabs({ tabs, activeTab, onTabChange }: HostTabsProps) {
  const { colors } = useHostTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        width: "100%",
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface1,
        padding: 3,
        gap: 4,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onTabChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              borderRadius: 8,
              backgroundColor: active ? colors.surface2 : "transparent",
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            {tab.icon ? (
              <Icon
                name={tab.icon}
                size={13}
                color={active ? colors.foreground : colors.foregroundMuted}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                fontWeight: active ? "600" : "500",
                color: active ? colors.foreground : colors.foregroundMuted,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- collapsible -----------------------------------------------------------

export interface HostCollapsibleProps {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: ReactNode;
  children: ReactNode;
  initiallyExpanded?: boolean;
}

/** Collapsible surface. */
export function HostCollapsible({
  title,
  subtitle,
  icon,
  badge,
  children,
  initiallyExpanded = false,
}: HostCollapsibleProps) {
  const { colors } = useHostTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <View
      style={{
        width: "100%",
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface0,
      }}
    >
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 40,
          padding: 12,
        }}
      >
        {icon ? <Icon name={icon} size={14} color={colors.foregroundMuted} /> : null}
        <View style={{ flex: 1, flexShrink: 1, gap: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{subtitle}</Text>
          ) : null}
        </View>
        {badge}
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={{ gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>{children}</View>
      ) : null}
    </View>
  );
}

// --- empty state -----------------------------------------------------------

export interface HostEmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
}

/** Centered empty / loading placeholder. */
export function HostEmptyState({ icon = "Inbox", title, description }: HostEmptyStateProps) {
  const { colors } = useHostTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface1,
        }}
      >
        <Icon name={icon} size={32} color={colors.foregroundMuted} />
      </View>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>
        {title}
      </Text>
      {description ? (
        <Text style={{ fontSize: 12, color: colors.foregroundMuted, textAlign: "center" }}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

// --- scroll ----------------------------------------------------------------

export interface HostScrollProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Single scroll owner for the slash console surface. `registerSidebarSurface`
 * supplies no host scroller, so the surface must own its own.
 */
export function HostScroll({ children, style }: HostScrollProps) {
  return (
    <HostScrollView
      style={[{ flex: 1, width: "100%" }, style]}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 20,
        gap: 12,
      }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
    >
      {children}
    </HostScrollView>
  );
}

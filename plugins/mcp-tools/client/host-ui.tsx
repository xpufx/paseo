import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
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
  TextInput as HostTextInputBase,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useHostLayout, useHostTheme } from "paseo-plugin-helper/lifecycle";
import type { StatusVariant, ThemeColors } from "paseo-plugin-helper/shared";

/**
 * Plugin-local presentation layer for `plugins/mcp-tools`.
 *
 * The frozen helper `client/` bespoke kit is being removed
 * (xpufx-org/paseo#924/#937). The host SDK ships no Card/Badge/Button/tab
 * primitives, so mcp-tools composes only the pieces it actually renders here,
 * over the host `theme` (via `useHostTheme`), host `Icon`/`TextInput`/
 * `copyText`/`useToast`, and plain React Native. Deliberately plugin-local:
 * it is not a shared design system and adds nothing to the helper.
 *
 * The module keeps the `Host*` names so call sites read as host-composed
 * rather than imports from the removed helper kit.
 */

// --- surfaces --------------------------------------------------------------

export interface HostModalSectionProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fluid plain section for a pill `renderModal` body (no nested Modal.Content).
 *
 * The host centered-modal wrapper hands the body a bounded `flex: 1` frame and
 * (with the default `hostScroll: false`) no scroller, so this section must fill
 * that frame: without `flex: 1` / `minHeight: 0` the section sizes to its
 * content and the child `HostScroll` is never given a viewport to scroll in
 * (xpufx-org/paseo#975).
 */
export function HostModalSection({ children, style }: HostModalSectionProps) {
  return <View style={[styles.modalSection, style]}>{children}</View>;
}

export interface HostScrollProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Explicit single scroll owner for surfaces where the host supplies none.
 *
 * Pill `renderModal` content is the owner when `hostScroll` is unset: the host
 * renders `<Modal.Content scrollable={false}>`, so this must be the only
 * vertical scroller in the subtree. Never nest it inside another scroller.
 */
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

export interface HostActionBarProps {
  children: ReactNode;
  align?: "flex-start" | "flex-end" | "center" | "space-between";
  direction?: "row" | "column" | "auto";
  style?: StyleProp<ViewStyle>;
}

/** Responsive action toolbar; stacks on compact host layouts. */
export function HostActionBar({
  children,
  align = "flex-end",
  direction = "auto",
  style,
}: HostActionBarProps) {
  const { compact } = useHostLayout();
  const isColumn = direction === "column" || (direction === "auto" && compact);
  return (
    <View
      style={[
        styles.actionBar,
        {
          flexDirection: isColumn ? "column" : "row",
          justifyContent: isColumn ? "flex-start" : align,
          alignItems: isColumn ? "stretch" : "center",
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
  style?: StyleProp<ViewStyle>;
}

/** Labeled settings row: label/description above the control. */
export function HostFormRow({ label, description, children, style }: HostFormRowProps) {
  const { colors } = useHostTheme();
  return (
    <View style={[styles.formRow, style]}>
      <View style={styles.formRowLabel}>
        <Text style={[styles.formRowTitle, { color: colors.foreground }]}>{label}</Text>
        {description ? (
          <Text style={[styles.formRowDescription, { color: colors.foregroundMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <View style={styles.formRowControl}>{children}</View>
    </View>
  );
}

// --- card ------------------------------------------------------------------

export interface HostCardProps {
  children: ReactNode;
  variant?: "flat" | "elevated" | "tinted";
  style?: StyleProp<ViewStyle>;
}

function resolveCardSurface(
  colors: ThemeColors,
  alpha: (color: string, opacity: number) => string,
  variant: HostCardProps["variant"],
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

export function HostCard({ children, variant = "flat", style }: HostCardProps) {
  const { colors, alpha } = useHostTheme();
  const surface = resolveCardSurface(colors, alpha, variant);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: surface.backgroundColor, borderColor: surface.borderColor },
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
  value?: string | number | ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
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
  const { colors, alpha } = useHostTheme();
  return (
    <View style={[styles.cardHeader, style]}>
      <View style={styles.cardHeaderLeft}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={styles.cardHeaderTitleColumn}>
          <Text
            numberOfLines={1}
            style={[styles.cardHeaderTitle, { color: colors.foreground }, titleStyle]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={[styles.cardHeaderSubtitle, { color: colors.foregroundMuted }, subtitleStyle]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.cardHeaderRight}>
        {badge ? <View style={styles.cardHeaderBadge}>{badge}</View> : null}
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

HostCard.Header = HostCardHeader;

// --- badge / status --------------------------------------------------------

export interface HostBadgeProps {
  label: string;
  variant?: StatusVariant;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function HostBadge({ label, variant = "neutral", size = "md", style, textStyle }: HostBadgeProps) {
  const { getVariantPalette } = useHostTheme();
  const palette = getVariantPalette(variant);
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          paddingVertical: size === "sm" ? 1 : 2,
          paddingHorizontal: size === "sm" ? 5 : 8,
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.badgeText,
          { color: palette.text, fontSize: size === "sm" ? 10 : 11 },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export interface HostStatusDotProps {
  variant?: StatusVariant;
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
}

export function HostStatusDot({ variant = "neutral", size = "md", style }: HostStatusDotProps) {
  const { getStatusColor } = useHostTheme();
  const dimension = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  return (
    <View
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: getStatusColor(variant),
          flexShrink: 0,
        },
        style,
      ]}
    />
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
  const { colors, alpha } = useHostTheme();

  const paddingVertical = size === "sm" ? 6 : size === "lg" ? 12 : 10;
  const paddingHorizontal = size === "sm" ? 10 : size === "lg" ? 18 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  let backgroundColor = "transparent";
  let borderColor = "transparent";
  let textColor = colors.foreground;

  switch (variant) {
    case "primary":
      backgroundColor = colors.accent;
      textColor = colors.accentForeground;
      break;
    case "danger":
      backgroundColor = alpha(colors.statusDanger, 0.15);
      borderColor = alpha(colors.statusDanger, 0.4);
      textColor = colors.statusDanger;
      break;
    case "ghost":
      backgroundColor = "transparent";
      textColor = colors.foregroundMuted;
      break;
    case "secondary":
    default:
      backgroundColor = colors.surface1;
      borderColor = colors.border;
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
        styles.button,
        {
          backgroundColor: pressed && !disabled ? alpha(backgroundColor, 0.8) : backgroundColor,
          borderColor,
          borderWidth: borderColor !== "transparent" ? 1 : 0,
          borderRadius: 10,
          paddingVertical,
          paddingHorizontal,
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
          {iconPosition === "left" ? renderIcon() : null}
          {label ? (
            <Text numberOfLines={1} style={[styles.buttonText, { color: textColor, fontSize }, textStyle]}>
              {label}
            </Text>
          ) : null}
          {iconPosition === "right" ? renderIcon() : null}
        </>
      )}
    </Pressable>
  );
}

export interface HostToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function HostToggle({ value, onValueChange, disabled = false, style }: HostToggleProps) {
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
      style={({ pressed }) => [
        styles.toggle,
        { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <View
        style={[
          styles.toggleTrack,
          {
            width: trackWidth,
            height: trackHeight,
            borderRadius: trackHeight / 2,
            backgroundColor: value ? colors.accent : alpha(colors.foregroundMuted, 0.35),
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
              backgroundColor: colors.surface0,
              transform: [
                { translateX: value ? trackWidth - thumbSize - thumbPadding : thumbPadding },
              ],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

export interface HostTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  errorText?: string;
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

export function HostTextInput({
  value,
  onChangeText,
  label,
  placeholder,
  helperText,
  errorText,
  autoCapitalize = "none",
  autoCorrect = false,
  disabled = false,
  mono = false,
  multiline = false,
  numberOfLines = 1,
  style,
  inputStyle,
  onSubmitEditing,
}: HostTextInputProps) {
  const { colors, alpha } = useHostTheme();
  const [isFocused, setIsFocused] = useState(false);
  const hasError = Boolean(errorText);

  return (
    <View style={[styles.textInputContainer, style]}>
      {label ? (
        <Text
          style={[
            styles.textInputLabel,
            { color: hasError ? colors.statusDanger : colors.foreground },
          ]}
        >
          {label}
        </Text>
      ) : null}
      <HostTextInputBase
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        editable={!disabled}
        multiline={multiline}
        numberOfLines={numberOfLines}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onSubmitEditing={onSubmitEditing}
        style={[
          styles.textInput,
          {
            color: disabled ? colors.foregroundMuted : colors.foreground,
            backgroundColor: disabled ? alpha(colors.surface1, 0.5) : colors.surface0,
            borderColor: hasError ? colors.statusDanger : isFocused ? colors.accent : colors.border,
            minHeight: multiline ? 64 : 40,
            paddingVertical: multiline ? 8 : 6,
            paddingHorizontal: 10,
            fontFamily: mono ? "monospace" : undefined,
          },
          inputStyle,
        ]}
      />
      {errorText || helperText ? (
        <Text
          style={[
            styles.textInputHint,
            { color: hasError ? colors.statusDanger : colors.foregroundMuted },
          ]}
        >
          {errorText || helperText}
        </Text>
      ) : null}
    </View>
  );
}

export interface HostSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

export function HostSearchInput({ value, onChangeText, placeholder = "Search...", style }: HostSearchInputProps) {
  const { colors } = useHostTheme();
  return (
    <View
      style={[
        styles.searchInput,
        { backgroundColor: colors.surface1, borderColor: colors.border },
        style,
      ]}
    >
      <View style={styles.searchIcon}>
        <Icon name="Search" size={16} color={colors.foregroundMuted} />
      </View>
      <HostTextInputBase
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.searchInputField, { color: colors.foreground }]}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText("")}
          hitSlop={8}
          accessibilityLabel="Clear search"
          style={styles.searchClear}
        >
          <Icon name="X" size={14} color={colors.foregroundMuted} />
        </Pressable>
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

/** Local segmented tab strip. Wraps rather than scrolling: the surfaces that
 * use it are fluid, and a wrapping strip avoids competing with the host
 * scroller. */
export function HostTabs({ tabs, activeTab, onTabChange, style }: HostTabsProps) {
  const { colors, alpha } = useHostTheme();
  const { compact } = useHostLayout();
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
          const displayLabel = compact && tab.shortLabel ? tab.shortLabel : tab.label;
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
                      ? alpha(colors.surface2, 0.5)
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
                {displayLabel}
              </Text>
              {tab.badge !== undefined ? (
                <View
                  style={[
                    styles.tabBadge,
                    { backgroundColor: isActive ? colors.accent : alpha(colors.foregroundMuted, 0.2) },
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
    <View style={[styles.emptyState, style]}>
      {icon ? (
        typeof icon === "string" ? (
          <View style={[styles.emptyIcon, { backgroundColor: colors.surface1 }]}>
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
        <View style={styles.emptyAction}>
          <HostButton label={actionLabel} variant="secondary" size="sm" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

// --- code block ------------------------------------------------------------

export interface HostCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  maxHeight?: number;
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/** Local code block over host `copyText`. No nested scroller: the host
 * popover owns scrolling, so a long snippet grows the host surface instead of
 * nesting a second scroll region inside it (#219). */
export function HostCodeBlock({
  code,
  language,
  title,
  copyable = true,
  style,
  textStyle,
}: HostCodeBlockProps) {
  const { colors, alpha } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const fontFamily = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  const handleCopy = async () => {
    try {
      await copyText(code);
      toast?.show?.(title || "Copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error?.("Copy failed");
    }
  };

  return (
    <View
      style={[
        styles.codeBlock,
        { backgroundColor: colors.surface0, borderColor: colors.border },
        style,
      ]}
    >
      {title || language || copyable ? (
        <View style={[styles.codeHeader, { borderBottomColor: alpha(colors.border, 0.7) }]}>
          <Text style={[styles.codeHeaderText, { color: colors.foregroundMuted }]}>
            {title ?? language?.toUpperCase()}
          </Text>
          {copyable ? (
            <Pressable
              onPress={() => void handleCopy()}
              hitSlop={6}
              accessibilityLabel="Copy code"
              style={({ pressed }) => [
                styles.codeCopy,
                {
                  backgroundColor: pressed ? colors.surface2 : colors.surface1,
                  borderColor: colors.border,
                },
              ]}
            >
              <Icon
                name={copied ? "Check" : "Copy"}
                size={12}
                color={copied ? colors.statusSuccess : colors.foregroundMuted}
              />
              <Text
                style={[
                  styles.codeCopyText,
                  { color: copied ? colors.statusSuccess : colors.foregroundMuted },
                ]}
              >
                {copied ? "Copied!" : "Copy"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Text selectable style={[styles.codeText, { color: colors.foreground, fontFamily }, textStyle]}>
        {code}
      </Text>
    </View>
  );
}

// --- about -----------------------------------------------------------------

export interface HostAboutItem {
  label: string;
  value: string;
  subValue?: string;
  copyable?: boolean;
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
  links?: Array<{ label: string; url: string; icon?: string }>;
  extraItems?: HostAboutItem[];
  density?: "default" | "compact" | "tiny";
  style?: StyleProp<ViewStyle>;
}

function resolveGitHubAvatarUrl(repository?: string, author?: string): string | null {
  if (repository) {
    const match = repository.match(/github\.com[/:]([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return `https://github.com/${match[1]}.png?size=128`;
  }
  if (author && !author.includes(" ") && !author.includes("@")) {
    return `https://github.com/${author}.png?size=128`;
  }
  return null;
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
  density = "default",
  style,
}: HostAboutSectionProps) {
  const { colors, alpha } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const isTiny = density === "tiny";

  const avatarUrl = resolveGitHubAvatarUrl(repository, author);
  const allLinks = [
    ...(repository ? [{ label: "Repository", url: repository, icon: "ExternalLink" }] : []),
    ...(issues ? [{ label: "Report Issue", url: issues, icon: "Bug" }] : []),
    ...(homepage ? [{ label: "Documentation", url: homepage, icon: "BookOpen" }] : []),
    ...links,
  ];

  const handleCopyDiagnostics = async () => {
    const lines = [
      `Plugin: ${name} v${version}`,
      author ? `Author: ${author}` : null,
      `License: ${license}`,
      repository ? `Repository: ${repository}` : null,
      ...extraItems.map((item) => `${item.label}: ${item.value}`),
    ].filter(Boolean);
    try {
      await copyText(lines.join("\n"));
      toast?.show?.("Diagnostics");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error?.("Copy failed");
    }
  };

  return (
    <View style={[styles.about, isTiny && styles.aboutTiny, style]}>
      <HostCard variant="elevated">
        <View style={styles.aboutHeader}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.aboutLogo} />
          ) : (
            <View style={[styles.aboutLogo, styles.aboutLogoFallback, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Icon name="Layers" size={26} color={colors.accent} />
            </View>
          )}
          <View style={styles.aboutMeta}>
            <View style={styles.aboutTitleRow}>
              <Text
                numberOfLines={2}
                style={[
                  styles.aboutTitle,
                  { color: colors.foreground },
                  isTiny && styles.aboutTitleTiny,
                ]}
              >
                {name}
              </Text>
              <HostBadge variant="accent" label={`v${version}`} size="sm" />
            </View>
            {description ? (
              <Text numberOfLines={3} style={[styles.aboutDescription, { color: colors.foregroundMuted }]}>
                {description}
              </Text>
            ) : null}
            {author ? (
              <Text style={[styles.aboutAuthor, { color: colors.foregroundMuted }]}>
                by {author}
              </Text>
            ) : null}
            <View style={styles.aboutTitleRow}>
              <HostBadge variant="neutral" label={license} size="sm" />
            </View>
          </View>
        </View>

        <View style={[styles.aboutActions, { borderTopColor: alpha(colors.border, 0.7) }]}>
          {allLinks.map((link) => (
            <HostButton
              key={link.url}
              size="sm"
              variant="secondary"
              icon={link.icon ?? "ExternalLink"}
              label={link.label}
              onPress={() => void Linking.openURL(link.url).catch(() => {})}
            />
          ))}
          <HostButton
            size="sm"
            variant={copied ? "primary" : "ghost"}
            icon={copied ? "Check" : "Copy"}
            label={copied ? "Diagnostics Copied!" : "Copy Diagnostics"}
            onPress={() => void handleCopyDiagnostics()}
          />
        </View>
      </HostCard>

      <HostCard variant="elevated">
        <HostCard.Header
          title="Runtime Environment"
          subtitle="Diagnostics for issue reports and system verification"
        />
        <View style={styles.aboutItems}>
          <HostFormRow label="Plugin Version">
            <Text selectable style={[styles.aboutItemValue, { color: colors.foreground }]}>
              v{version}
            </Text>
          </HostFormRow>
          {author ? (
            <HostFormRow label="Author">
              <Text selectable style={[styles.aboutItemValue, { color: colors.foreground }]}>
                {author}
              </Text>
            </HostFormRow>
          ) : null}
          <HostFormRow label="License">
            <Text selectable style={[styles.aboutItemValue, { color: colors.foreground }]}>
              {license}
            </Text>
          </HostFormRow>
          {extraItems.map((item) => (
            <HostFormRow key={item.label} label={item.label}>
              <Text selectable style={[styles.aboutItemValue, { color: colors.foreground }]}>
                {item.value}
              </Text>
            </HostFormRow>
          ))}
        </View>
      </HostCard>
    </View>
  );
}

// --- styles ----------------------------------------------------------------

const styles = {
  fluid: { width: "100%" },
  modalSection: { flex: 1, minHeight: 0, width: "100%" },
  actionBar: { width: "100%", flexWrap: "wrap", gap: 8 },
  formRow: { gap: 4, width: "100%" },
  formRowLabel: { gap: 2 },
  formRowTitle: { fontSize: 13, fontWeight: "600" },
  formRowDescription: { fontSize: 11, lineHeight: 16 },
  formRowControl: { marginTop: 2 },
  card: { width: "100%", borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, overflow: "hidden" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  cardHeaderTitleColumn: { gap: 1, flexShrink: 1 },
  cardHeaderTitle: { fontSize: 13, fontWeight: "600" },
  cardHeaderSubtitle: { fontSize: 11, fontWeight: "400" },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  cardHeaderBadge: { marginRight: 2 },
  cardHeaderValue: { fontSize: 13, fontWeight: "600" },
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderWidth: 1, borderRadius: 9999, gap: 4, flexShrink: 1, maxWidth: "100%" },
  badgeText: { fontWeight: "600", flexShrink: 1 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 1, maxWidth: "100%", overflow: "hidden" },
  buttonText: { fontWeight: "600", textAlign: "center", flexShrink: 1 },
  toggle: { width: "auto", alignSelf: "flex-start", justifyContent: "flex-start" },
  toggleTrack: { justifyContent: "center", flexShrink: 0 },
  toggleThumb: { position: "absolute", top: 3, left: 0 },
  textInputContainer: { gap: 4, width: "100%" },
  textInputLabel: { fontSize: 13, fontWeight: "600" },
  textInput: { borderWidth: 1, borderRadius: 8 },
  textInputHint: { fontSize: 11, marginTop: 2 },
  searchInput: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, height: 40, paddingHorizontal: 10, width: "100%" },
  searchIcon: { marginRight: 8, alignItems: "center", justifyContent: "center" },
  searchInputField: { flex: 1, paddingVertical: 0, fontSize: 14 },
  searchClear: { padding: 4, marginLeft: 4 },
  tabsFrame: { width: "100%", maxWidth: "100%", borderWidth: 1, borderRadius: 10, overflow: "hidden", justifyContent: "center" },
  tabsTrack: { flexDirection: "row", flexWrap: "nowrap", alignItems: "center", width: "100%", padding: 3, gap: 2 },
  tab: { flex: 1, flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 8, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  tabText: { textAlign: "center", fontSize: 12, flexShrink: 1, minWidth: 0 },
  tabBadge: { borderRadius: 9999, paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: "center", justifyContent: "center" },
  tabBadgeText: { fontSize: 10, fontWeight: "700" },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  emptyDescription: { fontSize: 12, textAlign: "center", maxWidth: 280, lineHeight: 18 },
  emptyAction: { marginTop: 8 },
  codeBlock: { width: "100%", borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  codeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1 },
  codeHeaderText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  codeCopy: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 6 },
  codeCopyText: { fontSize: 11, fontWeight: "500" },
  codeText: { padding: 10, fontSize: 12, lineHeight: 18 },
  about: { gap: 12 },
  aboutTiny: { gap: 6 },
  aboutHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  aboutLogo: { width: 48, height: 48, borderRadius: 8, resizeMode: "cover" },
  aboutLogoFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  aboutMeta: { flex: 1, gap: 5, minWidth: 0 },
  aboutTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  aboutTitle: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  aboutTitleTiny: { fontSize: 13 },
  aboutDescription: { fontSize: 12, flexShrink: 1 },
  aboutAuthor: { fontSize: 11, flexShrink: 1 },
  aboutActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  aboutItems: { gap: 8, width: "100%" },
  aboutItemValue: { fontSize: 12 },
} as const;

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView as RNScrollView,
  Text,
  TextInput as RNTextInput,
  View,
  type AccessibilityRole,
  type GestureResponderEvent,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export interface SafeToast {
  show: (message?: string, options?: any) => void;
  copied: (label?: string) => void;
  error: (message?: string) => void;
}

export function useToast(): SafeToast {
  const host = getOptionalClientHost();
  let toast: any = null;
  if (typeof host?.useToast === "function") {
    try {
      toast = host.useToast();
    } catch {}
  }
  return {
    show: (msg?: string, opts?: any) => {
      if (typeof toast?.show === "function") {
        toast.show(msg ?? "", opts);
      }
    },
    copied: (label?: string) => {
      if (typeof toast?.copied === "function") {
        toast.copied(label);
      }
    },
    error: (msg?: string) => {
      if (typeof toast?.error === "function") {
        toast.error(msg ?? "");
      }
    },
  };
}

export async function copyText(text: string): Promise<void> {
  const host = getOptionalClientHost();
  if (typeof host?.copyText === "function") {
    try {
      await host.copyText(text);
      return;
    } catch {}
  }
}
import {
  ATTENTION_LABELS,
  PRIORITY_ORDER,
  SPEC_LABELS,
  STATE_ORDER,
  addCommentContract,
  createIssueContract,
  currentPriorityLabel,
  currentStateLabel,
  forgeMarkSource,
  getClientHost,
  getOptionalClientHost,
  issueDetailContract,
  nextStateLabel,
  parseLabelList,
  parseMarkdownLite,
  resolveForgeMark,
  setLabelContract,
  shortLabelName,
  stripAgentEnvelopeFooter,
  useRpcMutation,
  useRpcQuery,
  writeGateNotice,
  type AgentEnvelope,
  type ForgeAccessState,
  type ForgeLabel,
  type ForgeMarkInput,
  type IssueComment,
  type MarkdownLiteSpan,
} from "paseo-plugin-helper/core";
import { ModalBodyScrollOwnerContext } from "paseo-plugin-helper/lifecycle";
import { useFleetTheme } from "./theme.js";

/**
 * Plugin-local presentation layer for `plugins/uppidi-fleet`.
 *
 * The frozen helper `client/` bespoke kit is being removed
 * (xpufx-org/paseo#924/#937). The host SDK ships no Card/Badge/Button/table
 * primitives, so uppidi-fleet composes the pieces it actually renders here,
 * over the host `theme` (via `useFleetTheme`), host `Icon`/`copyText`/
 * `useToast`, and plain React Native. This is deliberately plugin-local: it is
 * not a shared design system and adds nothing to the helper.
 */

// --- safe icon defense -----------------------------------------------------

export interface SafeIconProps {
  name?: string | null;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Defensive Icon component that guards against:
 * 1. Undefined Icon export from host or @getpaseo/plugin/client/react-native on Hermes / mobile.
 * 2. Undefined or empty icon name (which causes React.createElement(undefined) or Hermes throw).
 * 3. Throws from missing Lucide icon implementations.
 */
export function SafeIcon({ name, size = 14, color, style }: SafeIconProps) {
  if (!name || typeof name !== "string") {
    return <View style={style} />;
  }
  const host = getOptionalClientHost();
  const IconComponent = host?.Icon;
  if (!IconComponent || (typeof IconComponent !== "function" && typeof IconComponent !== "object")) {
    return <View style={style} />;
  }
  try {
    return (
      <View style={style}>
        <IconComponent name={name} size={size} color={color} />
      </View>
    );
  } catch {
    return <View style={style} />;
  }
}

export const Icon = SafeIcon;

// --- spacing ---------------------------------------------------------------

const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

type SpacingValue = keyof typeof SPACING | number;

function gapOf(value: SpacingValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return typeof value === "number" ? value : (SPACING[value] ?? fallback);
}

// --- text helpers ----------------------------------------------------------

interface TextPart {
  text: string;
  matched: boolean;
}

function splitHighlightParts(text: string, query: string, fuzzyFallback: boolean): TextPart[] {
  if (!query) return [{ text, matched: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: TextPart[] = [];
  let cursor = 0;
  let hit = lowerText.indexOf(lowerQuery, cursor);
  while (hit !== -1) {
    if (hit > cursor) parts.push({ text: text.slice(cursor, hit), matched: false });
    parts.push({ text: text.slice(hit, hit + query.length), matched: true });
    cursor = hit + query.length;
    hit = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
  if (!parts.some((p) => p.matched)) {
    return fuzzyFallback ? [{ text, matched: true }] : [{ text, matched: false }];
  }
  return parts;
}

export interface HighlightedTextProps {
  text: string;
  query?: string;
  numberOfLines?: number;
  selectable?: boolean;
  fuzzyFallback?: boolean;
  style?: StyleProp<TextStyle>;
}

export function HighlightedText({
  text,
  query = "",
  numberOfLines,
  selectable = true,
  fuzzyFallback = false,
  style,
}: HighlightedTextProps) {
  const { colors } = useFleetTheme();
  const parts = splitHighlightParts(text, query, fuzzyFallback);
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

// --- layout ----------------------------------------------------------------

export interface RowProps {
  children?: ReactNode;
  gap?: SpacingValue;
  wrap?: boolean;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Row({ children, gap, wrap = false, align, justify, style, testID }: RowProps) {
  return (
    <View
      testID={testID}
      style={[
        { flexDirection: "row", gap: gapOf(gap, 8) },
        wrap && { flexWrap: "wrap" as const },
        align !== undefined && { alignItems: align },
        justify !== undefined && { justifyContent: justify },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface StackProps {
  children?: ReactNode;
  gap?: SpacingValue;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Stack({ children, gap, align, justify, style, testID }: StackProps) {
  return (
    <View
      testID={testID}
      style={[
        { flexDirection: "column", gap: gapOf(gap, 8) },
        align !== undefined && { alignItems: align },
        justify !== undefined && { justifyContent: justify },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export const VStack = Stack;

export interface GridProps {
  children?: ReactNode;
  columns?: number;
  gap?: SpacingValue;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Grid({ children, columns = 2, gap, style, testID }: GridProps) {
  const cells = React.Children.toArray(children).filter(Boolean);
  const resolvedGap = gapOf(gap, 8);
  return (
    <View testID={testID} style={[{ flexDirection: "row", flexWrap: "wrap", width: "100%", gap: resolvedGap }, style]}>
      {cells.map((child, index) => (
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

export interface ActionBarProps {
  children: ReactNode;
  align?: "flex-start" | "flex-end" | "center" | "space-between";
  direction?: "row" | "column" | "auto";
  style?: StyleProp<ViewStyle>;
}

export function ActionBar({ children, align = "flex-end", direction = "row", style }: ActionBarProps) {
  const isColumn = direction === "column";
  return (
    <View
      style={[
        { flexDirection: isColumn ? "column" : "row", flexWrap: "wrap", gap: 8 },
        { justifyContent: isColumn ? "flex-start" : align, alignItems: isColumn ? "stretch" : "center" },
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
  const { colors } = useFleetTheme();
  return (
    <View
      style={[
        { gap: 4, width: "100%" },
        layout === "inline" && { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
        style,
      ]}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
        {description ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{description}</Text>
        ) : null}
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

// --- card ------------------------------------------------------------------

export type SurfaceVariant = "flat" | "tinted" | "elevated";

export interface CardProps {
  children: ReactNode;
  variant?: SurfaceVariant;
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
  highlightQuery?: string;
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
  highlightQuery,
}: CardHeaderProps) {
  const { colors, typography } = useFleetTheme();
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
          marginBottom: 8,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={{ gap: 1, flexShrink: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={[{ color: colors.foreground, ...typography.heading, fontWeight: "600" }, titleStyle]}
          >
            {highlightQuery ? <HighlightedText text={title} query={highlightQuery} fuzzyFallback /> : title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={[{ color: colors.foregroundMuted, ...typography.caption }, subtitleStyle]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {badge ? <View style={{ marginRight: 6 }}>{badge}</View> : null}
        {typeof value === "string" || typeof value === "number" ? (
          <Text style={{ color: colors.foreground, ...typography.bodyStrong }}>{value}</Text>
        ) : (
          value
        )}
        {action}
      </View>
    </View>
  );
}

export function Card({ children, variant, style, noPadding = false }: CardProps) {
  const { colors, alpha } = useFleetTheme();
  const effective = variant ?? "flat";
  let backgroundColor = colors.surface0;
  let borderColor = colors.border;
  if (effective === "tinted") {
    backgroundColor = alpha(colors.accent, 0.04);
    borderColor = alpha(colors.accent, 0.2);
  } else if (effective === "elevated") {
    backgroundColor = colors.surface1;
  }
  return (
    <View
      style={[
        {
          overflow: "hidden",
          width: "100%",
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: noPadding ? 0 : 12,
          paddingVertical: noPadding ? 0 : 8,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

Card.Header = CardHeader;

// --- badge / status --------------------------------------------------------

export type BadgeStyle = "tinted" | "outline" | "solid";
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  label: string;
  variant?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  styleVariant?: BadgeStyle;
  size?: BadgeSize;
  icon?: string | ReactNode;
  dot?: boolean;
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
  dot = false,
  style,
  textStyle,
  highlightQuery,
  highlightFuzzyFallback,
}: BadgeProps) {
  const { colors, getVariantPalette, getStatusColor, typography } = useFleetTheme();
  const fontSize = size === "sm" ? 10 : typography.caption.fontSize;
  const lineHeight = size === "sm" ? 12 : typography.caption.lineHeight;
  const palette = getVariantPalette(variant);
  let backgroundColor = palette.bg;
  let borderColor = palette.border;
  let textColor = palette.text;
  if (styleVariant === "outline") {
    backgroundColor = "transparent";
    borderColor = palette.border;
    textColor = palette.text;
  } else if (styleVariant === "solid") {
    backgroundColor = getStatusColor(variant);
    borderColor = "transparent";
    textColor = colors.accentForeground;
  }
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          borderWidth: 1,
          borderRadius: 9999,
          gap: 4,
          flexShrink: 1,
          minWidth: 0,
          maxWidth: "100%",
          backgroundColor,
          borderColor,
          paddingVertical: size === "sm" ? 1 : 2,
          paddingHorizontal: size === "sm" ? 5 : 8,
        },
        style,
      ]}
    >
      {dot ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: textColor }} />
      ) : typeof icon === "string" ? (
        <Icon name={icon} size={size === "sm" ? 10 : 11} color={textColor} />
      ) : (
        icon
      )}
      <Text
        accessibilityLabel={label}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[{ color: textColor, fontSize, lineHeight, fontWeight: "600", flexShrink: 1, minWidth: 0 }, textStyle]}
      >
        {highlightQuery ? (
          <HighlightedText
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

export interface StatusDotProps {
  variant?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StatusDot({ variant = "neutral", size = "md", pulse = false, style }: StatusDotProps) {
  const { getStatusColor } = useFleetTheme();
  const dimension = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  return (
    <View
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: getStatusColor(variant),
          opacity: pulse ? 0.6 : 1,
        },
        style,
      ]}
    />
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
  const { colors, alpha } = useFleetTheme();
  const paddingVertical = size === "sm" ? 6 : size === "lg" ? 12 : 10;
  const paddingHorizontal = size === "sm" ? 10 : size === "lg" ? 18 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
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
  const renderedIcon =
    typeof icon === "string" ? (
      <Icon name={icon} size={size === "sm" ? 12 : size === "lg" ? 16 : 14} color={textColor} />
    ) : (
      icon ?? null
    );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={4}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          flexShrink: 1,
          minWidth: 0,
          maxWidth: "100%",
          backgroundColor: pressed && !disabled ? alpha(backgroundColor, 0.8) : backgroundColor,
          borderColor,
          borderWidth: borderColor !== "transparent" ? 1 : 0,
          borderRadius: 8,
          paddingVertical,
          paddingHorizontal,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {iconPosition === "left" ? renderedIcon : null}
          {label !== undefined || children ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[{ color: textColor, fontSize, fontWeight: "600", textAlign: "center", flexShrink: 1, minWidth: 0 }, textStyle]}
            >
              {children ?? label}
            </Text>
          ) : null}
          {iconPosition === "right" ? renderedIcon : null}
        </>
      )}
    </Pressable>
  );
}

// --- inputs ----------------------------------------------------------------

export interface TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "number-pad" | "url";
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
  const { colors } = useFleetTheme();
  const [focused, setFocused] = useState(false);
  const ResolvedInput = (getOptionalClientHost()?.TextInput ?? RNTextInput) as React.ComponentType<any>;
  const hasError = Boolean(errorText);
  const borderColor = hasError ? colors.statusDanger : focused ? colors.accent : colors.border;
  return (
    <View style={[{ gap: 4, width: "100%" }, style]}>
      {label ? (
        <Text style={{ color: hasError ? colors.statusDanger : colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {label}
        </Text>
      ) : null}
      <ResolvedInput
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
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            color: colors.foreground,
            backgroundColor: colors.surface0,
            borderColor,
            borderWidth: 1,
            borderRadius: 8,
            minHeight: multiline ? 64 : 40,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontSize: 14,
            fontFamily: mono ? "monospace" : undefined,
          },
          inputStyle,
        ]}
      />
      {errorText ? (
        <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{errorText}</Text>
      ) : helperText ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{helperText}</Text>
      ) : null}
    </View>
  );
}

export interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  height?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = "Search...",
  onClear,
  height,
  style,
  inputStyle,
  testID,
}: SearchInputProps) {
  const { colors } = useFleetTheme();
  const ResolvedInput = (getOptionalClientHost()?.TextInput ?? RNTextInput) as React.ComponentType<any>;
  // The compact default matches the frozen helper's opt-in contract: call sites
  // that need a compact pill pass `height`; the rest keep the 36/40 box.
  const isCompact = false;
  const resolvedHeight = height ?? (isCompact ? 36 : 40);
  const handleClear = () => {
    onChangeText("");
    onClear?.();
  };
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderRadius: 8,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          height: resolvedHeight,
          paddingHorizontal: 10,
        },
        style,
      ]}
    >
      <View style={{ marginRight: 8, alignItems: "center", justifyContent: "center" }}>
        <Icon name="Search" size={16} color={colors.foregroundMuted} />
      </View>
      <ResolvedInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        style={[
          { flex: 1, paddingVertical: 0, color: colors.foreground, fontSize: height !== undefined && height <= 26 ? 12 : 13 },
          inputStyle,
        ]}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value ? (
        <Pressable
          onPress={handleClear}
          style={{ padding: 4, marginLeft: 4 }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Icon name="X" size={14} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// --- select ----------------------------------------------------------------

export interface SelectOption {
  /** Full value. Also the accessibility label and hover/focus tooltip. */
  label: string;
  value: string;
  /**
   * Optional shorter, distinguishable text for the trigger and option row.
   * When omitted, the label is middle-truncated so a long shared prefix (the
   * forge host) never makes every option look identical.
   */
  display?: string;
}

/**
 * Keeps both ends of a long value when the available width cannot show it all.
 * The fleet repo keys all start with the same forge host, so a plain tail
 * truncation erases the only part that distinguishes one option from another.
 */
export function middleTruncate(text: string, maxLength = 34): string {
  if (text.length <= maxLength) return text;
  const ellipsis = "…";
  const keep = Math.max(1, maxLength - ellipsis.length);
  const front = Math.ceil(keep / 2);
  const back = keep - front;
  return `${text.slice(0, front)}${ellipsis}${text.slice(text.length - back)}`;
}

interface SelectTriggerCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FALLBACK_SELECT_COORDS: SelectTriggerCoords = { x: 0, y: 0, width: 0, height: 0 };
const SELECT_OPTION_LIST_MAX_HEIGHT = 216;
/**
 * Fixed minimum row height for the two-line Select option rows (#1074 rework).
 * Every row always renders both lines, so hovered and idle rows measure the
 * same and the open dropdown never jumps.
 */
const SELECT_OPTION_ROW_MIN_HEIGHT = 46;

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  label?: string;
  size?: "sm" | "md";
  placeholder?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Select({
  value,
  options,
  onValueChange,
  label,
  size = "md",
  placeholder = "Select…",
  disabled = false,
  style,
}: SelectProps) {
  const { colors, alpha } = useFleetTheme();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<SelectTriggerCoords | null>(null);
  const triggerRef = useRef<View>(null);
  const selected = options.find((option) => option.value === value);
  const display = selected
    ? selected.display ?? middleTruncate(selected.label)
    : value || placeholder;
  const canOpen = !disabled && options.length > 0;
  const isOpen = open && canOpen;

  const openAt = (next: SelectTriggerCoords) => {
    setCoords(next);
    setOpen(true);
  };

  const handleToggle = () => {
    if (isOpen) {
      setOpen(false);
      return;
    }
    const node = triggerRef.current;
    if (!node || typeof node.measureInWindow !== "function") {
      openAt(FALLBACK_SELECT_COORDS);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      openAt({ x, y, width, height });
    });
  };

  return (
    <View testID="fleet-select-root" style={[{ width: "100%" }, style]}>
      <Pressable
        ref={triggerRef}
        testID="fleet-select-trigger"
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${display}` : display}
        accessibilityState={{ expanded: isOpen, disabled }}
        disabled={!canOpen}
        onPress={handleToggle}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            borderWidth: 1,
            minHeight: size === "sm" ? 28 : 34,
            paddingVertical: size === "sm" ? 3 : 6,
            paddingHorizontal: size === "sm" ? 8 : 10,
            borderColor: isOpen ? colors.accent : colors.border,
            backgroundColor: pressed ? colors.surface2 : colors.surface0,
            opacity: disabled || !canOpen ? 0.5 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontSize: size === "sm" ? 10 : 12,
            fontWeight: selected ? "600" : "500",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {display}
        </Text>
        <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={size === "sm" ? 12 : 14} color={colors.foregroundMuted} />
      </Pressable>
      {isOpen && coords ? (
        // The option list portals into a transparent Modal so it paints above
        // later siblings without contributing to the trigger's parent layout.
        <RNModal transparent visible={isOpen} animationType="none" onRequestClose={() => setOpen(false)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss options"
            onPress={() => setOpen(false)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            testID="fleet-select-overlay"
            style={{
              position: "absolute",
              top: coords.y + coords.height + 4,
              left: coords.x,
              minWidth: coords.width,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              backgroundColor: colors.surface0,
              overflow: "hidden",
              zIndex: 1000,
              elevation: 20,
            }}
          >
            <RNScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: SELECT_OPTION_LIST_MAX_HEIGHT }}
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                const primary = option.display ?? middleTruncate(option.label);
                const hasMore = primary !== option.label;
                return (
                  <Pressable
                    key={option.value}
                    testID={`fleet-select-option-${option.value}`}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityHint={hasMore ? option.label : undefined}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      {
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        minHeight: SELECT_OPTION_ROW_MIN_HEIGHT,
                        justifyContent: "center",
                        backgroundColor: isSelected ? colors.surface2 : pressed ? alpha(colors.surface2, 0.5) : "transparent",
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={{ color: isSelected ? colors.foreground : colors.foregroundMuted, fontSize: 13, fontWeight: isSelected ? "600" : "400" }}
                    >
                      {primary}
                    </Text>
                    {/* Always-visible smaller second line: every row keeps the
                        same two-line height so hover/focus never resizes the
                        open dropdown (#1074 rework). */}
                    <Text
                      testID={`fleet-select-option-full-${option.value}`}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      selectable
                      style={{ color: colors.foregroundMuted, fontSize: 11, marginTop: 2 }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </RNScrollView>
          </View>
        </RNModal>
      ) : null}
    </View>
  );
}

// --- interactive row -------------------------------------------------------

export interface InteractiveRowProps {
  children?: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  title?: string;
  disabled?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  hoverStyle?: StyleProp<ViewStyle>;
  hoverTint?: boolean;
  hoverTintOpacity?: number;
  pressedOpacity?: number;
  hoveredOpacity?: number;
  opacity?: number;
  disabledOpacity?: number;
  hitSlop?: number;
  onHoverChange?: (hovered: boolean) => void;
}

export function InteractiveRow({
  children,
  onPress,
  title,
  disabled = false,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  hoverStyle,
  hoverTint = false,
  hoverTintOpacity = 0.05,
  pressedOpacity = 0.7,
  hoveredOpacity,
  opacity = 1,
  disabledOpacity = 0.45,
  hitSlop,
  onHoverChange,
}: InteractiveRowProps) {
  const { colors, alpha } = useFleetTheme();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const interactive = hovered && !disabled;
  const handleEnter = useCallback(() => {
    if (disabled) return;
    setHovered(true);
    onHoverChange?.(true);
  }, [disabled, onHoverChange]);
  const handleLeave = useCallback(() => {
    setHovered(false);
    onHoverChange?.(false);
  }, [onHoverChange]);
  const webProps = {
    onMouseEnter: handleEnter,
    onMouseLeave: handleLeave,
    ...(title ? { title } : {}),
  } as any;
  return (
    <Pressable
      {...webProps}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? (onPress ? "button" : undefined)}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={hitSlop}
      style={[
        { cursor: onPress && !disabled ? "pointer" : "auto" },
        { flexShrink: 1, maxWidth: "100%" },
        style,
        interactive && hoverTint ? { backgroundColor: alpha(colors.accent, hoverTintOpacity) } : null,
        interactive ? hoverStyle : null,
        { opacity: disabled ? disabledOpacity : pressed ? pressedOpacity : interactive ? (hoveredOpacity ?? opacity) : opacity },
      ]}
    >
      {children}
    </Pressable>
  );
}

// --- empty state -----------------------------------------------------------

export interface EmptyStateProps {
  icon?: string | ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon = "Inbox", title, description, actionLabel, onAction, style }: EmptyStateProps) {
  const { colors } = useFleetTheme();
  return (
    <View style={[{ alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }, style]}>
      {typeof icon === "string" ? (
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
      ) : (
        icon
      )}
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {description ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, textAlign: "center" }}>{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: 4 }}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

// --- key value -------------------------------------------------------------

export interface KeyValueProps {
  label: string;
  value: string | number | null | undefined;
  subValue?: string;
  mono?: boolean;
  copyable?: boolean;
  truncate?: boolean | "end" | "middle" | "path";
  truncateMaxLength?: number;
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
  layout = "stacked",
  stackOnCompact = true,
  style,
  labelStyle,
  valueStyle,
}: KeyValueProps) {
  const { colors } = useFleetTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const rawString = value === null || value === undefined ? "" : String(value);
  let displayValue = rawString || "-";
  if (truncateProp && rawString.length > truncateMaxLength) {
    const mode = typeof truncateProp === "string" ? truncateProp : "middle";
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
    copyable && rawString ? (
      <Pressable onPress={handleCopy} hitSlop={8} style={{ padding: 2 }} accessibilityRole="button" accessibilityLabel={`Copy ${label}`}>
        <Icon name={copied ? "Check" : "Copy"} size={13} color={copied ? colors.statusSuccess : colors.foregroundMuted} />
      </Pressable>
    ) : null;
  const valueText = (
    <Text
      selectable
      numberOfLines={1}
      ellipsizeMode="middle"
      style={[{ color: colors.foreground, fontSize: 12, flexShrink: 1, minWidth: 0, fontFamily: mono ? "monospace" : undefined }, valueStyle]}
    >
      {displayValue}
    </Text>
  );
  const shouldInline = layout === "inline";
  if (shouldInline) {
    return (
      <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }, style]}>
        <Text numberOfLines={1} style={[{ color: colors.foregroundMuted, fontSize: 11, flexShrink: 1 }, labelStyle]}>
          {label}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, justifyContent: "flex-end" }}>
          {valueText}
          {copyButton}
        </View>
      </View>
    );
  }
  void stackOnCompact;
  return (
    <View style={[{ gap: 2, width: "100%" }, style]}>
      <Text numberOfLines={1} style={[{ color: colors.foregroundMuted, fontSize: 11 }, labelStyle]}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {valueText}
        {copyButton}
      </View>
      {subValue ? (
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          {subValue}
        </Text>
      ) : null}
    </View>
  );
}

export interface KeyValueGroupProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: number;
  collapse?: "compact" | "never";
  minColumnWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function KeyValueGroup({ children, columns = 2, gap = 12, style }: KeyValueGroupProps) {
  const childArray = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", width: "100%", gap }, style]}>
      {childArray.map((child, index) => (
        <View key={index} style={{ flexGrow: 1, flexShrink: 1, flexBasis: `${Math.floor(100 / columns) - 2}%` }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// --- attention -------------------------------------------------------------

export type AttentionBeaconMode = "radar" | "ring" | "glow" | "badge" | "bounce" | "pulse";
export type AttentionBeaconTone = "warning" | "accent" | "danger";

export interface AttentionBeaconProps {
  children: ReactNode;
  mode?: AttentionBeaconMode;
  tone?: AttentionBeaconTone;
  color?: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  haloStyle?: StyleProp<ViewStyle>;
  badgeStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  badgeIcon?: string | ReactNode;
  duration?: number;
  easing?: (value: number) => number;
}

export function AttentionBeacon({
  children,
  mode = "radar",
  tone = "warning",
  color,
  active = true,
  style,
  accessibilityLabel,
  testID,
}: AttentionBeaconProps) {
  const { colors, getStatusColor } = useFleetTheme();
  const beaconColor = color ?? getStatusColor(tone === "danger" ? "danger" : tone === "accent" ? "accent" : "warning");
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

// --- code / command --------------------------------------------------------

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
  const { colors, alpha } = useFleetTheme();
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
    <View style={[{ borderWidth: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surface0, borderColor: colors.border }, style]}>
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
          <Text style={{ color: title ? colors.foreground : colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
            {title ?? (language ? language.toUpperCase() : "")}
          </Text>
          {copyable ? (
            <Pressable onPress={handleCopy} accessibilityRole="button" accessibilityLabel="Copy code" hitSlop={4} style={{ padding: 4 }}>
              <Icon name={copied ? "Check" : "Copy"} size={12} color={copied ? colors.statusSuccess : colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <RNScrollView style={{ maxHeight }} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={[{ color: colors.foreground, fontSize: 12, lineHeight: 18, fontFamily: "monospace" }, textStyle]}>
          {code}
        </Text>
      </RNScrollView>
    </View>
  );
}

export interface CommandBoxProps {
  command?: string;
  argv?: string[];
  copyLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function CommandBox({ command, argv = [], copyLabel = "Copy command", style, textStyle }: CommandBoxProps) {
  const { colors } = useFleetTheme();
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
        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface2, borderColor: colors.border },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", flex: 1, flexShrink: 1, minWidth: 0 }}>
        <Text style={[{ color: colors.statusWarning, fontSize: 12, fontWeight: "700", fontFamily: "monospace" }, textStyle]}>
          {prog ? `$ ${prog}` : "$"}
        </Text>
        {rest.length > 0 ? (
          <Text style={[{ color: colors.foreground, fontSize: 12, fontFamily: "monospace" }, textStyle]}> {rest.join(" ")}</Text>
        ) : null}
      </View>
      <Pressable onPress={handleCopy} accessibilityRole="button" accessibilityLabel={copyLabel} hitSlop={4} style={{ padding: 4 }}>
        <Icon name={copied ? "Check" : "Copy"} size={12} color={copied ? colors.statusSuccess : colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

// --- data table ------------------------------------------------------------

export interface DataColumn<T> {
  key: string;
  header: string;
  flex?: number;
  width?: number;
  align?: "left" | "center" | "right";
  render: (item: T) => ReactNode;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataColumn<T>[];
  keyExtractor: (item: T, index: number) => string;
  emptyState?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function DataTable<T>({ data, columns, keyExtractor, emptyState, style }: DataTableProps<T>) {
  const { colors } = useFleetTheme();
  if (!data || data.length === 0) {
    return emptyState ? <View style={style}>{emptyState}</View> : null;
  }
  const cellStyle = (col: DataColumn<T>): StyleProp<ViewStyle> => ({
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...(col.flex !== undefined ? { flex: col.flex } : { flex: 1 }),
    ...(col.width !== undefined ? { width: col.width } : null),
    alignItems: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start",
  });
  return (
    <View style={[{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0, borderRadius: 8, overflow: "hidden" }, style]}>
      <View style={{ flexDirection: "row", backgroundColor: colors.surface1, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {columns.map((col) => (
          <View key={col.key} style={cellStyle(col)}>
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" }}>
              {col.header}
            </Text>
          </View>
        ))}
      </View>
      {data.map((item, idx) => (
        <View
          key={keyExtractor(item, idx)}
          style={[
            { flexDirection: "row" },
            idx < data.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
          ]}
        >
          {columns.map((col) => (
            <View key={col.key} style={cellStyle(col)}>
              {col.render(item)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// --- collapsible / tabs ----------------------------------------------------

export interface CollapsibleProps {
  title?: string | ReactNode;
  subtitle?: string | ReactNode;
  children: ReactNode;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  badge?: ReactNode;
  headerRight?: ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: SurfaceVariant;
}

export function Collapsible({
  title,
  subtitle,
  children,
  initiallyExpanded = false,
  isExpanded: controlled,
  onToggle,
  badge,
  headerRight,
  icon,
  style,
  headerStyle,
  contentStyle,
}: CollapsibleProps) {
  const { colors } = useFleetTheme();
  const [internal, setInternal] = useState(initiallyExpanded);
  const expanded = controlled !== undefined ? controlled : internal;
  const toggle = () => {
    const next = !expanded;
    if (controlled === undefined) setInternal(next);
    onToggle?.(next);
  };
  return (
    <View style={[{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden", width: "100%" }, style]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, minHeight: 40, backgroundColor: pressed ? colors.surface1 : "transparent" },
          headerStyle,
        ]}
      >
        {icon ? <Icon name={icon} size={14} color={colors.foregroundMuted} /> : null}
        <View style={{ flex: 1, flexShrink: 1, gap: 1, minWidth: 0 }}>
          {typeof title === "string" ? (
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {title}
            </Text>
          ) : (
            title
          )}
          {typeof subtitle === "string" ? (
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )}
        </View>
        {badge}
        {headerRight}
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
      </Pressable>
      {expanded ? <View style={[{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }, contentStyle]}>{children}</View> : null}
    </View>
  );
}

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

export function Tabs({ tabs, activeTab, onTabChange, style }: TabsProps) {
  const { colors, alpha } = useFleetTheme();
  return (
    <View style={[{ width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surface1 }, style]}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", width: "100%", padding: 3, gap: 4 }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  borderRadius: 6,
                  flexGrow: 1,
                  flexShrink: 1,
                  minWidth: 0,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  backgroundColor: isActive ? colors.surface2 : pressed ? alpha(colors.surface2, 0.5) : "transparent",
                },
              ]}
            >
              {tab.icon ? (
                <Icon name={tab.icon} size={13} color={isActive ? colors.foreground : colors.foregroundMuted} />
              ) : null}
              <Text
                numberOfLines={1}
                style={{ color: isActive ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: isActive ? "600" : "500", flexShrink: 1, minWidth: 0 }}
              >
                {tab.label}
              </Text>
              {tab.badge !== undefined ? (
                <View style={{ borderRadius: 9999, paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: "center", justifyContent: "center", backgroundColor: isActive ? colors.accent : alpha(colors.foregroundMuted, 0.2) }}>
                  <Text style={{ color: isActive ? colors.accentForeground : colors.foregroundMuted, fontSize: 10, fontWeight: "700" }}>
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

// --- responsive ------------------------------------------------------------

export interface ResponsiveProps {
  desktop?: ReactNode;
  mobile?: ReactNode;
  compact?: ReactNode;
  wide?: ReactNode;
  children?: ReactNode | ((responsive: { isCompact: boolean; isMobile: boolean; isWide: boolean }) => ReactNode);
}

/** Wide desktop is the default; registrations that need compact render their own. */
export function Responsive({ desktop, mobile, compact, wide, children }: ResponsiveProps) {
  const isCompact = false;
  const isMobile = Platform.OS === "ios" || Platform.OS === "android";
  const isWide = !isCompact;
  if (typeof children === "function") {
    return <>{children({ isCompact, isMobile, isWide })}</>;
  }
  const selected = isMobile && mobile !== undefined
    ? mobile
    : isCompact && compact !== undefined
      ? compact
      : !isCompact && wide !== undefined
        ? wide
        : desktop;
  return <>{selected ?? children ?? null}</>;
}

// --- modal body ------------------------------------------------------------

export interface ModalBodyProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  size?: "default" | "large";
  headerMode?: "pinned" | "scroll";
  scrollMode?: "auto" | "always";
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
}

export function ModalBody({
  children,
  style,
  contentContainerStyle,
  header,
  headerStyle,
  headerMode = "scroll",
  scrollMode = "auto",
}: ModalBodyProps) {
  const scrollOwner = useContext(ModalBodyScrollOwnerContext);
  const ownsScroll = scrollOwner !== "host" && scrollOwner !== "popover";
  const Scroller = (getOptionalClientHost()?.ScrollView ?? RNScrollView) as React.ComponentType<any>;
  const body = ownsScroll ? (
    <Scroller
      style={[{ flex: 1, minHeight: 0, width: "100%" }, style]}
      contentContainerStyle={contentContainerStyle}
      refreshControl={undefined}
    >
      {headerMode === "scroll" ? header : null}
      {children}
    </Scroller>
  ) : (
    <View style={[{ flex: 1, minHeight: 0, width: "100%" }, style]}>
      {headerMode === "scroll" ? header : null}
      {children}
    </View>
  );
  if (!header || headerMode !== "pinned") {
    return <View style={{ flex: 1, minHeight: 0, width: "100%" }}>{body}</View>;
  }
  return (
    <View style={{ flex: 1, minHeight: 0, width: "100%" }}>
      <View style={headerStyle}>{header}</View>
      {body}
    </View>
  );
}

export interface ModalContentProps extends Omit<ModalBodyProps, "scrollMode"> {
  children: ReactNode;
  scrollable?: boolean;
}

export function ModalContent({ children, scrollable = true, ...bodyProps }: ModalContentProps) {
  const host = getOptionalClientHost();
  const Modal = host?.Modal;
  const Content = (Modal as any)?.Content;
  const inner = (
    <ModalBodyScrollOwnerContext.Provider value={scrollable ? "host" : "required"}>
      <ModalBody {...bodyProps}>{children}</ModalBody>
    </ModalBodyScrollOwnerContext.Provider>
  );
  if (!Content) return inner;
  return <Content scrollable={scrollable}>{inner}</Content>;
}

export interface SafeModalProps {
  title?: string;
  icon?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function HostModalWrapper(props: SafeModalProps) {
  const host = getOptionalClientHost();
  const HostModalComponent = host?.Modal;
  if (!HostModalComponent) {
    if (props.open === false) return null;
    return <View>{props.children}</View>;
  }
  return <HostModalComponent {...(props as any)} />;
}
HostModalWrapper.Content = ModalContent;

export const Modal = HostModalWrapper;

// --- forge icon ------------------------------------------------------------

export interface ForgeIconProps extends ForgeMarkInput {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}

export function ForgeIcon({ host, kind, size = 16, color, style, accessibilityLabel }: ForgeIconProps) {
  const { colors } = useFleetTheme();
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
      style={[{ width: size, height: size }, style]}
    />
  );
}

// --- ticket views ----------------------------------------------------------

function formatTimestamp(value: string | undefined | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function editorLabelChips(names: readonly string[], known: Map<string, ForgeLabel>): ForgeLabel[] {
  return names.map((name) => known.get(name) ?? { name });
}

function renderInlineSpans(spans: MarkdownLiteSpan[], accent: string, keyPrefix: string, query: string) {
  return spans.map((span, index) => {
    const key = `${keyPrefix}-${index}`;
    if (span.kind === "bold") {
      return (
        <Text key={key} style={{ fontWeight: "700" }}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "italic") {
      return (
        <Text key={key} style={{ fontStyle: "italic" }}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "code") {
      return (
        <Text key={key} style={{ fontFamily: "monospace", fontSize: 12, backgroundColor: `${accent}18` }}>
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "link") {
      return (
        <Text
          key={key}
          style={{ color: accent, textDecorationLine: "underline" }}
          onPress={() => {
            Linking.openURL(span.url).catch(() => {
              copyText(span.url).catch(() => {});
            });
          }}
        >
          <HighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    return <HighlightedText key={key} text={span.text} query={query} />;
  });
}

export function MarkdownLite({ body, query = "" }: { body: string; query?: string }) {
  const { colors, typography } = useFleetTheme();
  const blocks = useMemo(() => parseMarkdownLite(body), [body]);
  return (
    <Stack gap="xs" style={{ width: "100%" }}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return <CodeBlock key={index} code={block.text} language={block.language} />;
        }
        if (block.kind === "heading") {
          const fontSize = block.level === 1 ? 18 : block.level === 2 ? 16 : 14;
          return (
            <Text key={index} selectable style={[typography.heading, { fontSize, fontWeight: "700", color: colors.foreground, marginTop: 4 }]}>
              {renderInlineSpans(block.spans, colors.accent, `h${index}`, query)}
            </Text>
          );
        }
        if (block.kind === "list") {
          return (
            <Stack key={index} gap="xxs" style={{ paddingLeft: 4 }}>
              {block.items.map((item, itemIndex) => (
                <Row key={itemIndex} align="flex-start" gap="xs">
                  <Text selectable style={[typography.body, { color: colors.foregroundMuted }]}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <Text selectable style={[typography.body, { color: colors.foreground, flex: 1 }]}>
                    {renderInlineSpans(item, colors.accent, `li${index}-${itemIndex}`, query)}
                  </Text>
                </Row>
              ))}
            </Stack>
          );
        }
        return (
          <Text key={index} selectable style={[typography.body, { color: colors.foreground, lineHeight: 20 }]}>
            {renderInlineSpans(block.spans, colors.accent, `p${index}`, query)}
          </Text>
        );
      })}
    </Stack>
  );
}

export function AgentEnvelopeCard({ envelope }: { envelope: AgentEnvelope }) {
  const openSession = () => {
    const link = envelope.paseoLinks[0];
    if (link) Linking.openURL(link).catch(() => {});
  };
  return (
    <Card variant="tinted" style={{ marginTop: 6 }}>
      <CardHeader
        title={envelope.sessionTitle}
        subtitle={envelope.postedAt ?? undefined}
        badge={<Badge variant="neutral" label={envelope.agentShortId} />}
        icon="Bot"
      />
      <KeyValueGroup columns={2}>
        <KeyValue label="Model" value={envelope.model ?? "-"} mono />
        <KeyValue
          label="Branch"
          value={envelope.branch ? `${envelope.repo ?? ""}:${envelope.branch}` : "-"}
          mono
          copyable={Boolean(envelope.branch)}
        />
      </KeyValueGroup>
      {envelope.commitShas.length > 0 ? (
        <Stack gap="xxs" style={{ marginTop: 4 }}>
          {envelope.commitShas.map((sha) => (
            <CommandBox key={sha} command={sha} copyLabel={`Copy commit ${sha}`} />
          ))}
        </Stack>
      ) : null}
      {envelope.paseoLinks.length > 0 ? (
        <Button size="sm" variant="ghost" icon="ExternalLink" label="Open agent session" onPress={openSession} />
      ) : null}
    </Card>
  );
}

export function CommentCard({ comment, issueUrl, query }: { comment: IssueComment; issueUrl?: string; query?: string }) {
  const body = stripAgentEnvelopeFooter(comment.body) || comment.body;
  const target = comment.url || issueUrl || "";
  const open = () => {
    if (target) Linking.openURL(target).catch(() => {});
  };
  return (
    <Card variant="flat" style={{ marginVertical: 4 }}>
      <CardHeader title={comment.author} subtitle={formatTimestamp(comment.createdAt)} icon="MessageSquare" />
      <Stack gap="xs" style={{ padding: 8 }}>
        <MarkdownLite body={body} query={query} />
        {target ? (
          <Row justify="flex-end" align="center" gap="xs">
            <Button
              size="sm"
              variant="ghost"
              icon="ExternalLink"
              label="Open comment"
              accessibilityLabel={`Open comment by ${comment.author}`}
              onPress={open}
            />
          </Row>
        ) : null}
      </Stack>
      {comment.envelope ? <AgentEnvelopeCard envelope={comment.envelope} /> : null}
    </Card>
  );
}

export function ScopedLabelGroup({
  title,
  labels,
  active,
  pending = false,
  onSelect,
}: {
  title: string;
  labels: readonly ForgeLabel[];
  active: string | null;
  pending?: boolean;
  onSelect: (label: string) => void;
}) {
  const { colors, typography } = useFleetTheme();
  return (
    <Stack gap="xxs" style={{ marginVertical: 2 }}>
      <Text style={[typography.caption, { color: colors.foregroundMuted, fontWeight: "600" }]}>{title}</Text>
      <Row wrap gap="xxs">
        {labels.map((label) => (
          <Button
            key={label.name}
            onPress={() => onSelect(label.name)}
            disabled={pending}
            accessibilityLabel={shortLabelName(label.name)}
            size="sm"
            variant={active === label.name ? "primary" : "ghost"}
            label={shortLabelName(label.name)}
          />
        ))}
      </Row>
    </Stack>
  );
}

export interface NewIssueComposerProps {
  directory?: string;
  remoteUrl?: string;
  access?: ForgeAccessState;
  onCreated?: (number?: number) => void;
  onOpenSettings?: () => void;
}

export function NewIssueComposer({ directory, remoteUrl, access, onCreated, onOpenSettings }: NewIssueComposerProps) {
  const { colors, typography } = useFleetTheme();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const create = useRpcMutation(createIssueContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast?.error?.(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setLabelsText("");
      setExpanded(false);
      onCreated?.(result.number ?? undefined);
      toast?.show?.(result.number ? `Created issue #${result.number}` : "Issue created", { variant: "success" });
    },
    onError: (error) => {
      toast?.error?.(error instanceof Error ? error.message : "Could not create issue");
    },
  });
  if (access && access.auth === "anonymous") return null;
  if (access && !access.canEdit) {
    return (
      <Card variant="flat" style={{ padding: 8 }}>
        <Text style={[typography.caption, { color: colors.foregroundMuted }]}>{writeGateNotice(access, "creating issues")}</Text>
        {onOpenSettings ? (
          <Button size="sm" variant="secondary" icon="Settings" label="Add a token" onPress={onOpenSettings} />
        ) : null}
      </Card>
    );
  }
  const pending = create.isPending;
  const canSubmit = title.trim().length > 0 && !pending;
  const submit = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    create.mutate({
      directory: directory ?? undefined,
      remoteUrl: remoteUrl || undefined,
      title: nextTitle,
      body: body.trim(),
      labels: parseLabelList(labelsText),
    });
  };
  return (
    <Collapsible title="New ticket" subtitle="Open a ticket on the active forge" icon="Plus" isExpanded={expanded} onToggle={setExpanded}>
      <Stack gap="xs" style={{ padding: 8 }}>
        <FormRow label="Title">
          <TextInput value={title} onChangeText={setTitle} placeholder="Short, specific title" autoCapitalize="sentences" />
        </FormRow>
        <FormRow label="Description" description="Markdown supported.">
          <TextInput value={body} onChangeText={setBody} placeholder="What needs to happen?" multiline numberOfLines={4} />
        </FormRow>
        <Collapsible title="Labels" subtitle="Optional — comma-separated names" icon="Tags">
          <FormRow label="Label names">
            <TextInput value={labelsText} onChangeText={setLabelsText} placeholder="state/1-wip, priority/1-high" />
          </FormRow>
        </Collapsible>
        <ActionBar>
          <Button label="Cancel" variant="ghost" disabled={pending} onPress={() => setExpanded(false)} />
          <Button label={pending ? "Creating…" : "Create ticket"} variant="primary" icon="Plus" disabled={!canSubmit} loading={pending} onPress={submit} />
        </ActionBar>
      </Stack>
    </Collapsible>
  );
}

export interface TicketLifecycleViewProps {
  issueNumber: number;
  workspaceId?: string;
  directory?: string;
  remoteUrl?: string;
  repo?: string | null;
  query?: string;
  boardLabels?: Map<string, ForgeLabel>;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  children?: ReactNode;
}

export function TicketLifecycleView({
  issueNumber,
  directory,
  remoteUrl,
  query = "",
  boardLabels,
  onRefresh,
  children,
}: TicketLifecycleViewProps) {
  const { colors, typography } = useFleetTheme();
  const toast = useToast();
  const baseInput = { issueNumber, directory: directory ?? undefined, remoteUrl: remoteUrl || undefined };
  const detail = useRpcQuery(issueDetailContract, baseInput, { refetchInterval: 30000 });
  const [commentDraft, setCommentDraft] = useState("");
  const setLabel = useRpcMutation(setLabelContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast?.error?.(result.error);
        return;
      }
      detail.refetch();
      onRefresh?.();
    },
    onError: (error) => toast?.error?.(error instanceof Error ? error.message : "Could not update labels"),
  });
  const addComment = useRpcMutation(addCommentContract, {
    onSuccess: (result) => {
      if (result.error) {
        toast?.error?.(result.error);
        return;
      }
      setCommentDraft("");
      detail.refetch();
      onRefresh?.();
      toast?.show?.("Comment posted", { variant: "success" });
    },
    onError: (error) => toast?.error?.(error instanceof Error ? error.message : "Could not post comment"),
  });
  const issue = detail.data && !detail.data.error ? detail.data.issue : null;
  const labels = issue?.labels ?? [];
  const state = currentStateLabel(labels);
  const priority = issue ? currentPriorityLabel(labels) : null;
  const next = issue ? nextStateLabel(labels) : null;
  const labelPending = setLabel.isPending;
  const commentPending = addComment.isPending;
  const candidates = useMemo(() => {
    const known = new Map(boardLabels ?? new Map());
    for (const label of issue?.labelDetails ?? []) known.set(label.name, label);
    return {
      state: editorLabelChips(STATE_ORDER, known),
      priority: editorLabelChips(PRIORITY_ORDER, known),
      attention: editorLabelChips(ATTENTION_LABELS, known),
      spec: editorLabelChips(SPEC_LABELS, known),
    };
  }, [boardLabels, issue?.labelDetails]);
  const handleSelectLabel = (labelName: string) => {
    setLabel.mutate({ issueNumber, directory: directory ?? undefined, remoteUrl: remoteUrl || undefined, label: labelName });
  };
  const handlePostComment = () => {
    const text = commentDraft.trim();
    if (!text) return;
    addComment.mutate({ issueNumber, directory: directory ?? undefined, remoteUrl: remoteUrl || undefined, body: text });
  };
  return (
    <Stack gap="sm" style={{ width: "100%" }}>
      {detail.isLoading && !detail.data ? (
        <Text style={[typography.caption, { color: colors.foregroundMuted }]}>Loading ticket #{issueNumber}…</Text>
      ) : null}
      {detail.data?.error || (!detail.isLoading && !issue) ? (
        <EmptyState
          icon="AlertCircle"
          title={`Ticket #${issueNumber} unavailable`}
          description={detail.data?.error ?? "Could not reach forge host."}
          actionLabel="Retry"
          onAction={() => detail.refetch()}
        />
      ) : null}
      <Stack gap="xs" style={{ paddingVertical: 4 }}>
        {next ? (
          <Row align="center" gap="xs">
            <Button
              size="sm"
              variant="secondary"
              icon="ArrowRight"
              label={`Move to ${shortLabelName(next).toLowerCase()}`}
              loading={labelPending}
              disabled={labelPending}
              onPress={() => handleSelectLabel(next)}
            />
          </Row>
        ) : null}
        <ScopedLabelGroup title="Workflow State" labels={candidates.state} active={state} pending={labelPending} onSelect={handleSelectLabel} />
        <ScopedLabelGroup title="Priority" labels={candidates.priority} active={priority} pending={labelPending} onSelect={handleSelectLabel} />
        <ScopedLabelGroup
          title="Attention"
          labels={candidates.attention}
          active={labels.find((l) => (ATTENTION_LABELS as readonly string[]).includes(l)) ?? null}
          pending={labelPending}
          onSelect={handleSelectLabel}
        />
        <ScopedLabelGroup
          title="Spec"
          labels={candidates.spec}
          active={labels.find((l) => (SPEC_LABELS as readonly string[]).includes(l)) ?? null}
          pending={labelPending}
          onSelect={handleSelectLabel}
        />
      </Stack>
      {children}
      {issue?.body ? (
        <Card variant="flat" style={{ marginVertical: 4 }}>
          <CardHeader title="Description" icon="FileText" />
          <View style={{ padding: 8 }}>
            <MarkdownLite body={issue.body} query={query} />
          </View>
        </Card>
      ) : null}
      <Card variant="flat" style={{ marginTop: 8 }}>
        <CardHeader title={`Comments${issue?.comments ? ` (${issue.comments.length})` : ""}`} icon="MessageSquare" />
        <Stack gap="xs" style={{ padding: 8 }}>
          {issue?.comments && issue.comments.length > 0 ? (
            issue.comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} issueUrl={issue.webUrl} query={query} />
            ))
          ) : (
            <Text style={[typography.caption, { color: colors.foregroundMuted }]}>No comments yet.</Text>
          )}
          <Stack gap="xxs" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <TextInput value={commentDraft} onChangeText={setCommentDraft} placeholder="Write a comment…" multiline numberOfLines={3} />
            <Row justify="flex-end">
              <Button
                size="sm"
                variant="primary"
                icon="Send"
                label={commentPending ? "Posting…" : "Post comment"}
                disabled={!commentDraft.trim() || commentPending}
                loading={commentPending}
                onPress={handlePostComment}
              />
            </Row>
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
}

export { useRpcMutation, useRpcQuery };

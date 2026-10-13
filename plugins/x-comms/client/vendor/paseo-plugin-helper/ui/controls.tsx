import React, { useRef, useState, type ComponentType, type ReactNode, type Ref } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  TouchableWithoutFeedback,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type TextInput as RNTextInputInstance,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost, getOptionalClientHost } from "../core/host";
import { copyToClipboard } from "../lifecycle/clipboard";
import { useHostTheme } from "./theme";
import { alpha } from "./color";
import { spacing } from "./layout";

/**
 * Paseo Plugin Helper — UI control adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, host-delegating control adapters
 * (Button, Toggle, Select, TextInput, …). Same contract as the rest of ui/:
 * host theme colors only, no scroll ownership, no design-system machinery.
 * Text inputs prefer the host-injected `TextInput` (modal keyboard
 * positioning) and fall back to plain React Native.
 */

// --- Button ----------------------------------------------------------------

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

/** Pressable button with host-theme variant colors. */
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
  const { Icon } = getClientHost();
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
          {children ? (
            <Text style={[styles.buttonText, { color: textColor, fontSize }, textStyle]}>
              {children}
            </Text>
          ) : (
            <Text style={[styles.buttonText, { color: textColor, fontSize }, textStyle]}>
              {label}
            </Text>
          )}
          {iconPosition === "right" ? renderIcon() : null}
        </View>
      )}
    </Pressable>
  );
}

// --- Inline button ---------------------------------------------------------

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

/** Compact text/link action for inline cards and timeline content. */
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
  const { Icon } = getClientHost();
  const { colors } = useHostTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.inlineButton,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {icon ? (
        typeof icon === "string" ? (
          <Icon name={icon} size={13} color={colors.accent} />
        ) : (
          icon
        )
      ) : null}
      <Text style={[styles.inlineButtonText, { color: colors.accent }, textStyle]}>{label}</Text>
    </Pressable>
  );
}

// --- Toggle ----------------------------------------------------------------

export interface HostToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

/** Switch control with optional label/description. */
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
        {
          minHeight: 40,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
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

// --- Select ----------------------------------------------------------------

export interface HostSelectOption {
  label: string;
  value: string;
}

export interface HostSelectProps {
  value: string;
  options: HostSelectOption[];
  onValueChange: (value: string) => void;
  label?: string;
  size?: "sm" | "md";
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  style?: StyleProp<ViewStyle>;
}

const OPTION_LIST_MAX_HEIGHT = 216;

interface TriggerCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FALLBACK_COORDS: TriggerCoords = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Compact single-choice picker. The closed trigger stays one line tall;
 * opening mounts the menu in a root transparent `<Modal>` overlay portal, so a
 * long list never expands the trigger's parent container and always paints
 * above later siblings. The option list scrolls with a plain React Native
 * ScrollView — never the host sheet-gesture scroller (#219).
 */
export function HostSelect({
  value,
  options,
  onValueChange,
  label,
  size = "md",
  placeholder = "Select…",
  disabled = false,
  searchable = false,
  searchPlaceholder,
  style,
}: HostSelectProps) {
  const { Icon } = getClientHost();
  const { colors, alpha: alphaColor } = useHostTheme();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<TriggerCoords | null>(null);
  const triggerRef = useRef<View>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fontSize = size === "sm" ? 10 : 12;
  const lineHeight = size === "sm" ? 12 : 15;
  const paddingVertical = size === "sm" ? 3 : 6;
  const paddingHorizontal = size === "sm" ? 8 : 10;
  const iconSize = size === "sm" ? 12 : 14;

  const selected = options.find((option) => option.value === value);
  const display = selected?.label ?? (value ? value : placeholder);
  const canOpen = !disabled && options.length > 0;
  const isOpen = open && canOpen;

  const triggerMinHeight = size === "sm" ? 28 : 34;

  const openAt = (next: TriggerCoords) => {
    setCoords(next);
    setOpen(true);
  };

  const handleToggle = () => {
    if (isOpen) {
      setOpen(false);
      setSearchQuery("");
      return;
    }
    const node = triggerRef.current;
    if (!node || typeof node.measureInWindow !== "function") {
      openAt(FALLBACK_COORDS);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      openAt({ x, y, width, height });
    });
  };

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue);
    setOpen(false);
    setSearchQuery("");
  };

  const filteredOptions = searchable && searchQuery
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          option.value.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : options;

  const ResolvedSearchInput = (
    getOptionalClientHost()?.TextInput ?? RNTextInput
  ) as ComponentType<RNTextInputProps & { ref?: Ref<RNTextInputInstance> }>;

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
  };

  return (
    <View style={[styles.selectContainer, style]}>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${display}` : display}
        accessibilityState={{ expanded: isOpen, disabled }}
        disabled={!canOpen}
        onPress={handleToggle}
        style={({ pressed }) => [
          styles.selectTrigger,
          {
            minHeight: triggerMinHeight,
            borderColor: isOpen ? colors.accent : colors.border,
            backgroundColor:
              disabled || !canOpen
                ? alphaColor(colors.surface1, 0.5)
                : pressed
                  ? colors.surface2
                  : colors.surface0,
            paddingVertical,
            paddingHorizontal,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.selectTriggerText,
            {
              color: disabled || !canOpen ? colors.foregroundMuted : colors.foreground,
              fontSize,
              lineHeight,
              fontWeight: selected ? "600" : "500",
            },
          ]}
        >
          {display}
        </Text>
        <Icon
          name={isOpen ? "ChevronUp" : "ChevronDown"}
          size={iconSize}
          color={colors.foregroundMuted}
        />
      </Pressable>

      {isOpen && coords ? (
        <Modal transparent visible={isOpen} animationType="none" onRequestClose={() => setOpen(false)}>
          <TouchableWithoutFeedback
            accessibilityRole="button"
            accessibilityLabel="Dismiss options"
            onPress={() => setOpen(false)}
          >
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <View
            style={[
              styles.selectOverlayList,
              {
                top: coords.y + coords.height + spacing.xs,
                left: coords.x,
                minWidth: coords.width,
                borderColor: colors.border,
                backgroundColor: colors.surface0,
              },
            ]}
          >
            {searchable ? (
              <View style={{ padding: spacing.xs }}>
                <ResolvedSearchInput
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  placeholder={searchPlaceholder ?? "Search..."}
                  placeholderTextColor={colors.foregroundMuted}
                  style={[
                    styles.searchInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.surface0,
                      borderColor: colors.border,
                      borderRadius: 8,
                      fontSize: 13,
                    },
                  ]}
                />
              </View>
            ) : null}
            <RNScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: OPTION_LIST_MAX_HEIGHT }}
            >
              {filteredOptions.length === 0 ? (
                <View style={{ padding: spacing.sm }}>
                  <Text
                    style={{
                      color: colors.foregroundMuted,
                      fontSize: 13,
                      textAlign: "center",
                    }}
                  >
                    No matching options
                  </Text>
                </View>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => handleSelect(option.value)}
                      style={({ pressed }) => [
                        styles.selectOption,
                        {
                          paddingVertical,
                          paddingHorizontal,
                          backgroundColor: isSelected
                            ? colors.surface2
                            : pressed
                              ? alphaColor(colors.surface2, 0.5)
                              : "transparent",
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.selectOptionText,
                          {
                            color: isSelected ? colors.foreground : colors.foregroundMuted,
                            fontSize: fontSize + 1,
                            lineHeight,
                            fontWeight: isSelected ? "600" : "400",
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </RNScrollView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

// --- Copy button -----------------------------------------------------------

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

/** Copy-to-clipboard button. Uses the host clipboard via `copyToClipboard`. */
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
  const { Icon, useToast } = getClientHost();
  const { colors, alpha: alphaColor } = useHostTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
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
    const ok = await copyToClipboard(value, { toast, toastMessage });
    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), feedbackDurationMs);
    }
  };

  // RN-web hover hooks (same passthrough `InteractiveRow` uses). On desktop a
  // copy affordance must respond to the pointer, not only to a press.
  const hoverProps = {
    onMouseEnter: () => {
      if (!disabled) setHovered(true);
    },
    onMouseLeave: () => setHovered(false),
  } as any;

  return (
    <Pressable
      {...hoverProps}
      onPress={handleCopy}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || feedbackLabel}
      hitSlop={4}
      style={({ pressed }) => [
        styles.copyButton,
        { cursor: disabled ? "auto" : "pointer" },
        {
          paddingVertical: size === "sm" ? 3 : 5,
          paddingHorizontal: size === "sm" ? 8 : 10,
          backgroundColor:
            !disabled && (pressed || hovered)
              ? alphaColor(colors.surface2, secondary ? 1 : 0.7)
              : bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: size === "sm" ? 6 : 8,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Icon
        name={feedbackIcon}
        size={size === "sm" ? 12 : 14}
        color={copied ? colors.statusSuccess : colors.foregroundMuted}
      />
      {feedbackLabel !== "" ? (
        <Text
          style={[
            styles.copyButtonText,
            {
              fontSize: size === "sm" ? 11 : 12,
              color: copied ? colors.statusSuccess : colors.foregroundMuted,
            },
            textStyle,
          ]}
        >
          {feedbackLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

// --- Text input ------------------------------------------------------------

export interface HostTextInputProps {
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

/**
 * Text input. Prefers the host-injected `TextInput` (native focus integrated
 * with modal keyboard positioning) and falls back to plain React Native.
 */
export function HostTextInput({
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
}: HostTextInputProps) {
  const { colors } = useHostTheme();
  const [isFocused, setIsFocused] = useState(false);
  const ResolvedInput = (getOptionalClientHost()?.TextInput ??
    RNTextInput) as ComponentType<RNTextInputProps & { ref?: Ref<RNTextInputInstance> }>;

  const hasError = Boolean(errorText);
  const borderColor = hasError ? colors.statusDanger : isFocused ? colors.accent : colors.border;
  const minHeight = multiline ? 64 : 40;

  return (
    <View style={[styles.inputContainer, style]}>
      {label ? (
        <Text
          style={[
            styles.inputLabel,
            { color: hasError ? colors.statusDanger : colors.foreground },
          ]}
        >
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
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.surface0,
            borderColor,
            minHeight,
            fontFamily: mono ? "monospace" : undefined,
          },
          inputStyle,
        ]}
      />
      {errorText ? (
        <Text style={[styles.inputHelper, { color: colors.statusDanger }]}>{errorText}</Text>
      ) : helperText ? (
        <Text style={[styles.inputHelper, { color: colors.foregroundMuted }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

// --- Search input ----------------------------------------------------------

export interface HostSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  height?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
}

/** Search input with a leading icon and optional clear button. */
export function HostSearchInput({
  value,
  onChangeText,
  placeholder = "Search...",
  onClear,
  height = 40,
  style,
  inputStyle,
  testID,
}: HostSearchInputProps) {
  const { Icon } = getClientHost();
  const { colors } = useHostTheme();
  const ResolvedInput = (getOptionalClientHost()?.TextInput ??
    RNTextInput) as ComponentType<RNTextInputProps & { ref?: Ref<RNTextInputInstance> }>;

  const handleClear = () => {
    onChangeText("");
    if (onClear) onClear();
  };

  return (
    <View
      style={[
        styles.searchContainer,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          height,
        },
        style,
      ]}
    >
      <View style={styles.searchIconWrapper}>
        <Icon name="Search" size={16} color={colors.foregroundMuted} />
      </View>
      <ResolvedInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        style={[
          styles.searchInput,
          {
            color: colors.foreground,
            fontSize: height <= 26 ? 12 : 14,
          },
          inputStyle,
        ]}
      />
      {value ? (
        <Pressable
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={styles.searchClearBtn}
        >
          <Icon name="X" size={14} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  buttonText: {
    fontWeight: "600",
  },
  inlineButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inlineButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  toggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  toggleBare: {
    justifyContent: "center",
  },
  toggleTextContainer: {
    flex: 1,
    gap: 1,
  },
  toggleLabel: {
    fontSize: 14,
  },
  toggleDescription: {
    fontSize: 11,
  },
  toggleTrack: {
    justifyContent: "center",
  },
  toggleThumb: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  selectContainer: {
    width: "100%",
  },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
  },
  selectTriggerText: {
    flexShrink: 1,
    minWidth: 0,
  },
  selectOverlayList: {
    position: "absolute",
    borderWidth: 1,
    overflow: "hidden",
    elevation: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  selectOption: {},
  selectOptionText: {
    flexShrink: 1,
    minWidth: 0,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  inputContainer: {
    gap: 4,
    width: "100%",
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  inputHelper: {
    fontSize: 11,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  searchIconWrapper: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
  },
  searchClearBtn: {
    flexShrink: 0,
    padding: 2,
  },
});

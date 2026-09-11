import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import { FALLBACK_ACCENT_FOREGROUND } from "../theme/tokens.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  label?: string;
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
}

export function Button({
  label,
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
}: ButtonProps) {
  const { Icon } = getClientHost();
  const { colors, resolveRadius, touchTargetMin, isCompact, alpha } = usePluginTheme();

  const radius = resolveRadius(size === "sm" ? "sm" : size === "lg" ? "lg" : "md");

  // Determine sizing
  const py = size === "sm" ? (isCompact ? 5 : 6) : size === "lg" ? 12 : isCompact ? 8 : 10;
  const px = size === "sm" ? (isCompact ? 8 : 10) : size === "lg" ? 18 : isCompact ? 12 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  // Determine colors by variant
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
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={Math.max(0, (touchTargetMin - 32) / 2)}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed && !disabled ? alpha(bg, 0.8) : bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: radius,
          paddingVertical: py,
          paddingHorizontal: px,
          minHeight: Math.max(30, touchTargetMin - 4),
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {iconPosition === "left" && renderIcon()}
          {label ? (
            <Text
              style={[
                styles.text,
                {
                  color: textColor,
                  fontSize,
                },
                textStyle,
              ]}
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

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  text: {
    fontWeight: "600",
    textAlign: "center",
  },
});

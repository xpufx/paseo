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
import { AttentionBeacon, type AttentionBeaconMode, type AttentionBeaconTone } from "./AttentionBeacon.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonAttention = boolean | "radar" | "glow" | "bounce";

export function resolveButtonAttentionMode(
  attention?: ButtonAttention,
): AttentionBeaconMode | null {
  if (!attention) return null;
  if (attention === true) return "radar";
  return attention;
}

export function resolveButtonAttentionTone(variant: ButtonVariant): AttentionBeaconTone {
  if (variant === "danger") return "danger";
  if (variant === "primary") return "accent";
  return "warning";
}

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
  attention?: ButtonAttention;
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
  attention,
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

  const attentionMode = resolveButtonAttentionMode(attention);

  // Accessibility touch targets are met with `hitSlop`, which expands the
  // tappable area without moving a single neighbouring pixel. They are NOT met
  // by inflating the painted box: a `minHeight` floor forced `size="sm"` to
  // render 40px tall on mobile against a ~26px recipe, because the floor was
  // computed from the touch target rather than from the size (#647).
  //
  // The slop has to be derived from this button's own height, not a fixed 32 —
  // a 32px baseline silently under-serves every smaller recipe, so `sm` got
  // both a too-tall box and too little slop.
  const contentHeight = Math.round(fontSize * 1.2) + py * 2;
  const hitSlopSide = Math.max(0, (touchTargetMin - contentHeight) / 2);

  const pressable = (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={hitSlopSide}
      style={({ pressed }) => [
        styles.base,
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
        <ActivityIndicator size="small" color={textColor} />
      ) : children ? (
        children
      ) : (
        <>
          {iconPosition === "left" && renderIcon()}
          {label ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
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

  if (!attentionMode) return pressable;

  return (
    <AttentionBeacon mode={attentionMode} tone={resolveButtonAttentionTone(variant)}>
      {pressable}
    </AttentionBeacon>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    // Labels are caller-supplied and unbounded (issue titles, branch names,
    // sort labels). Yoga defaults `flexShrink` to 0, so an unconstrained
    // button claims its full label width and overflows narrow viewports.
    flexShrink: 1,
    maxWidth: "100%",
  },
  text: {
    fontWeight: "600",
    textAlign: "center",
    // The label must be allowed to compress for `numberOfLines` to engage.
    flexShrink: 1,
  },
});

import React, { type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";

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

/** Compact text/link action for inline cards and timeline content. */
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
  const { Icon } = getClientHost();
  const { colors, touchTargetMin, alpha } = usePluginTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      hitSlop={Math.max(0, (touchTargetMin - 24) / 2)}
      style={({ pressed }) => [
        styles.base,
        {
          opacity: disabled ? 0.45 : 1,
          backgroundColor: pressed && !disabled ? alpha(colors.accent, 0.12) : "transparent",
        },
        style,
      ]}
    >
      {typeof icon === "string" ? <Icon name={icon} size={13} color={colors.accent} /> : icon}
      <Text style={[styles.text, { color: colors.accent }, textStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderRadius: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});

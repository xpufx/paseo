import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import { FALLBACK_ACCENT_FOREGROUND } from "../theme/tokens.js";
import type { StatusVariant } from "../../shared/types.js";

export type BadgeStyle = "tinted" | "outline" | "solid";

export interface BadgeProps {
  label: string;
  variant?: StatusVariant;
  styleVariant?: BadgeStyle;
  icon?: string | ReactNode;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function Badge({
  label,
  variant = "neutral",
  styleVariant = "tinted",
  icon,
  dot = false,
  style,
  textStyle,
}: BadgeProps) {
  const { Icon } = getClientHost();
  const { colors, flair, resolveRadius, getVariantPalette, getStatusColor, isCompact } =
    usePluginTheme();

  const radius = resolveRadius("pill");
  const palette = getVariantPalette(variant);
  const solidColor = getStatusColor(variant);

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
    textColor = colors.accentForeground || FALLBACK_ACCENT_FOREGROUND;
  }

  const renderIcon = () => {
    if (dot) {
      return (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: textColor,
            },
          ]}
        />
      );
    }
    if (!icon) return null;
    if (typeof icon === "string") {
      return <Icon name={icon} size={isCompact ? 10 : 11} color={textColor} />;
    }
    return icon;
  };

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: radius,
          paddingVertical: isCompact ? 2 : 3,
          paddingHorizontal: isCompact ? 6 : 8,
        },
        style,
      ]}
    >
      {renderIcon()}
      <Text
        style={[
          styles.text,
          {
            color: textColor,
            fontSize: isCompact ? 10 : 11,
            textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    gap: 4,
  },
  text: {
    fontWeight: "600",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

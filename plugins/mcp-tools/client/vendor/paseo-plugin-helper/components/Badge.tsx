import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";
import { FALLBACK_ACCENT_FOREGROUND } from "../theme/tokens";
import { HighlightedText } from "./HighlightedText";
import type { StatusVariant } from "../../../../shared/vendor/paseo-plugin-helper/types";

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
  /**
   * When set, every case-insensitive occurrence of the query inside `label` is
   * painted with the accent highlight. The query is matched literally, never as
   * a regular expression.
   */
  highlightQuery?: string;
  /**
   * With `highlightQuery`, marks the whole label when the query has neither a
   * literal nor a token hit — for a single primary chip, not a chip list.
   */
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
  const { Icon } = getClientHost();
  const { colors, flair, resolveRadius, getVariantPalette, getStatusColor, typography } =
    usePluginTheme();
  const caption = typography?.caption ?? {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "400" as const,
  };

  const fontSize = size === "sm" ? 10 : caption.fontSize;
  const lineHeight = size === "sm" ? 12 : caption.lineHeight;
  const paddingVertical = size === "sm" ? 1 : Math.max(2, Math.floor(caption.lineHeight / 5));
  const paddingHorizontal = size === "sm" ? 5 : caption.fontSize < 11 ? 6 : 8;
  const iconSize = size === "sm" ? 10 : caption.fontSize < 11 ? 10 : 11;

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
      return <Icon name={icon} size={iconSize} color={textColor} />;
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
          paddingVertical,
          paddingHorizontal,
        },
        style,
      ]}
    >
      {renderIcon()}
      <Text
        accessibilityLabel={label}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          styles.text,
          {
            color: textColor,
            fontSize,
            lineHeight,
            textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
          },
          textStyle,
        ]}
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

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    gap: 4,
    // A badge carries operator-supplied strings (ids, paths, refs, model names)
    // of unbounded length. Yoga defaults `flexShrink` to 0, so without this the
    // chip insists on its full text width and pushes its row past the viewport
    // instead of truncating.
    flexShrink: 1,
    maxWidth: "100%",
  },
  text: {
    fontWeight: "600",
    // Truncation only engages if the label itself is allowed to compress.
    flexShrink: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

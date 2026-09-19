import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";
import { HighlightedText } from "./HighlightedText";
import type { SurfaceStyle } from "../theme/flair";

export interface CardProps {
  children: ReactNode;
  variant?: SurfaceStyle;
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
  /**
   * When set, every case-insensitive (literal, non-regex) occurrence of the
   * query inside `title` is painted with the accent highlight.
   */
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
  const { Icon } = getClientHost();
  const { colors, flair, typography, padding } = usePluginTheme();

  return (
    <View
      style={[
        styles.headerContainer,
        // Density-aware gap below the header. A hardcoded 8 wasted vertical
        // space under the compact preset (xpufx-org/paseo#213).
        { marginBottom: padding.gap },
        style,
      ]}
    >
      <View style={styles.headerLeft}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={styles.titleColumn}>
          <Text
            style={[
              styles.headerTitle,
              {
                color: colors.foreground,
                ...typography.heading,
                textTransform:
                  flair.headingTransform === "uppercase" ? "uppercase" : "none",
              },
              titleStyle,
            ]}
          >
            {highlightQuery ? <HighlightedText text={title} query={highlightQuery} /> : title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.headerSubtitle,
                { color: colors.foregroundMuted, ...typography.caption },
                subtitleStyle,
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.headerRight}>
        {badge ? <View style={{ marginRight: 6 }}>{badge}</View> : null}
        {typeof value === "string" || typeof value === "number" ? (
          <Text
            style={[
              styles.headerValue,
              { color: colors.foreground, ...typography.bodyStrong },
            ]}
          >
            {value}
          </Text>
        ) : (
          value
        )}
        {action}
      </View>
    </View>
  );
}

export function Card({ children, variant, style, noPadding = false }: CardProps) {
  const { colors, flair, resolveRadius, padding, alpha } = usePluginTheme();

  const effectiveVariant = variant || flair.surfaceStyle;
  const radius = resolveRadius("md");

  let bg = colors.surface0;
  let border = colors.border;

  if (effectiveVariant === "tinted") {
    bg = alpha(colors.accent, 0.04);
    border = alpha(colors.accent, 0.2);
  } else if (effectiveVariant === "elevated") {
    bg = colors.surface1;
    border = colors.border;
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: radius,
          borderWidth: flair.borderWidth,
          paddingHorizontal: noPadding ? 0 : padding.horizontal,
          paddingVertical: noPadding ? 0 : padding.vertical,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

Card.Header = CardHeader;

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    width: "100%",
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    flexShrink: 1,
  },
  titleColumn: {
    gap: 1,
    flexShrink: 1,
  },
  headerTitle: {
    fontWeight: "600",
  },
  headerSubtitle: {
    fontWeight: "400",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  headerValue: {
    fontWeight: "600",
  },
});

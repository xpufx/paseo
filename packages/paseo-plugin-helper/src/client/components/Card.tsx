import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import type { SurfaceStyle } from "../theme/flair.js";

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
}: CardHeaderProps) {
  const { Icon } = getClientHost();
  const { colors, flair, isCompact } = usePluginTheme();

  return (
    <View style={[styles.headerContainer, style]}>
      <View style={styles.headerLeft}>
        {icon ? <Icon name={icon} size={15} color={colors.foregroundMuted} /> : null}
        <View style={styles.titleColumn}>
          <Text
            style={[
              styles.headerTitle,
              {
                color: colors.foreground,
                fontSize: isCompact ? 12 : 13,
                textTransform:
                  flair.headingTransform === "uppercase" ? "uppercase" : "none",
              },
              titleStyle,
            ]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.headerSubtitle,
                { color: colors.foregroundMuted, fontSize: 11 },
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
              { color: colors.foreground, fontSize: isCompact ? 12 : 13 },
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
    marginBottom: 8,
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

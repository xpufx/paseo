import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import type { StatusVariant } from "../../shared/types.js";
import { Badge } from "./Badge.js";

export interface SectionHeaderProps {
  title: string;
  /** Optional count — shown as a Badge (warning variant when > 0, neutral otherwise) */
  count?: number;
  /** Badge variant override */
  badgeVariant?: StatusVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function SectionHeader({
  title,
  count,
  badgeVariant,
  style,
  textStyle,
}: SectionHeaderProps): React.ReactElement | null {
  const theme = usePluginTheme();
  const caption = theme.typography?.caption ?? {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "400" as const,
  };
  const headingTransform = (theme.flair?.headingTransform ?? "none") === "uppercase"
    ? "uppercase"
    : "none";

  return (
    <View style={[styles.container, style]}>
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.foregroundMuted,
            textTransform: headingTransform,
            fontSize: caption.fontSize,
            lineHeight: caption.lineHeight,
            fontWeight: "700",
          },
          textStyle,
        ]}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <Badge
          label={String(count)}
          variant={badgeVariant ?? (count > 0 ? "warning" : "neutral")}
          styleVariant={count > 0 ? "solid" : "tinted"}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
  },
  title: {
    letterSpacing: 0.8,
  },
});

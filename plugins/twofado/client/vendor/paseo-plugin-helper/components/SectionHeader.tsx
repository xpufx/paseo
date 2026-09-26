import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { usePluginTheme } from "../theme/provider";
import type { StatusVariant } from "../../../../shared/vendor/paseo-plugin-helper/types";
import { Badge } from "./Badge";

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
  const titleType = theme.typography?.bodyStrong ?? {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600" as const,
  };
  const headingTransform = (theme.flair?.headingTransform ?? "none") === "uppercase"
    ? "uppercase"
    : "none";

  return (
    <View style={[styles.container, style]}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          styles.title,
          {
            color: theme.colors.foregroundMuted,
            textTransform: headingTransform,
            fontSize: titleType.fontSize,
            lineHeight: titleType.lineHeight,
            fontWeight: titleType.fontWeight,
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
    flexShrink: 1,
    maxWidth: "100%",
  },
  title: {
    letterSpacing: 0.8,
    // Section titles are caller-supplied and unbounded; the title must be
    // allowed to compress for `numberOfLines` to engage.
    flexShrink: 1,
  },
});

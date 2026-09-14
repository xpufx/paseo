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
  const headingTransform = (theme.flair?.headingTransform ?? "uppercase") === "uppercase"
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
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
});

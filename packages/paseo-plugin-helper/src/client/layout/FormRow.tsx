import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";

export interface FormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  /**
   * "stacked" (default) keeps the historical label/description above the
   * control. "inline" puts the label + description in a left column and the
   * control on the right of the SAME line, which is what a short control
   * (Toggle, StatusDot, Badge, small Button) wants. Stacking a one-line
   * control under its label doubles a settings row's height for no gain
   * (xpufx-org/paseo#213).
   */
  layout?: "stacked" | "inline";
  style?: StyleProp<ViewStyle>;
}

export function FormRow({
  label,
  description,
  children,
  layout = "stacked",
  style,
}: FormRowProps) {
  const { colors, flair, typography } = usePluginTheme();

  const labelBlock = (
    <View style={styles.labelBlock}>
      <Text
        style={[
          styles.label,
          {
            color: colors.foreground,
            ...typography.label,
            textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
          },
        ]}
      >
        {label}
      </Text>
      {description && (
        <Text
          style={[
            styles.description,
            { color: colors.foregroundMuted, ...typography.caption },
          ]}
        >
          {description}
        </Text>
      )}
    </View>
  );

  if (layout === "inline") {
    return (
      <View style={[styles.container, styles.inlineContainer, style]}>
        {labelBlock}
        <View style={styles.inlineContent}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {labelBlock}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
    width: "100%",
  },
  inlineContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  labelBlock: {
    gap: 2,
    flexShrink: 1,
    minWidth: 0,
  },
  inlineContent: {
    flexShrink: 0,
    alignItems: "flex-end",
  },
  label: {
    fontWeight: "600",
  },
  description: {
    lineHeight: 16,
  },
  content: {
    marginTop: 2,
  },
});

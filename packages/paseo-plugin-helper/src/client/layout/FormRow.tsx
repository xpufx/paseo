import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";

export interface FormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function FormRow({ label, description, children, style }: FormRowProps) {
  const { colors, flair, isCompact } = usePluginTheme();

  return (
    <View style={[styles.container, style]}>
      <Text
        style={[
          styles.label,
          {
            color: colors.foreground,
            fontSize: isCompact ? 12 : 13,
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
            { color: colors.foregroundMuted, fontSize: isCompact ? 11 : 12 },
          ]}
        >
          {description}
        </Text>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
    width: "100%",
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

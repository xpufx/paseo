import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import { Button, type ButtonProps } from "./Button.js";

export interface EmptyStateProps {
  icon?: string | ReactNode;
  title: string;
  description?: string;
  action?: ButtonProps;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon = "Inbox",
  title,
  description,
  action,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  const { Icon } = getClientHost();
  const { colors, isCompact } = usePluginTheme();

  const resolvedAction: ButtonProps | undefined = action
    ? action
    : actionLabel && onAction
      ? { label: actionLabel, onPress: onAction, variant: "secondary" }
      : undefined;

  return (
    <View style={[styles.container, { padding: isCompact ? 20 : 32 }, style]}>
      {icon ? (
        typeof icon === "string" ? (
          <View style={[styles.iconWrapper, { backgroundColor: colors.surface1 }]}>
            <Icon name={icon} size={isCompact ? 24 : 32} color={colors.foregroundMuted} />
          </View>
        ) : (
          icon
        )
      ) : null}

      <Text style={[styles.title, { color: colors.foreground, fontSize: isCompact ? 14 : 16 }]}>
        {title}
      </Text>

      {description ? (
        <Text
          style={[
            styles.description,
            { color: colors.foregroundMuted, fontSize: isCompact ? 12 : 13 },
          ]}
        >
          {description}
        </Text>
      ) : null}

      {resolvedAction ? (
        <View style={styles.actionRow}>
          <Button size={isCompact ? "sm" : "md"} {...resolvedAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  iconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontWeight: "600",
    textAlign: "center",
  },
  description: {
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 18,
  },
  actionRow: {
    marginTop: 8,
  },
});

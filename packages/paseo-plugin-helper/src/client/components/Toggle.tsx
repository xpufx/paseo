import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import { resolveElevation } from "../theme/tokens.js";

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function Toggle({
  value,
  onValueChange,
  label,
  description,
  disabled = false,
  style,
  labelStyle,
}: ToggleProps) {
  const { colors, touchTargetMin, isCompact, alpha } = usePluginTheme();

  const handlePress = () => {
    if (!disabled) {
      onValueChange(!value);
    }
  };

  const trackWidth = 38;
  const trackHeight = 22;
  const thumbSize = 16;
  const thumbPadding = 3;

  const trackColor = value
    ? colors.accent
    : alpha(colors.foregroundMuted, 0.35);

  const thumbPosition = value
    ? trackWidth - thumbSize - thumbPadding
    : thumbPadding;

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={Math.max(0, (touchTargetMin - trackHeight) / 2)}
      style={({ pressed }) => [
        styles.container,
        {
          minHeight: touchTargetMin,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {(label || description) && (
        <View style={styles.textContainer}>
          {label && (
            <Text
              style={[
                styles.label,
                {
                  color: colors.foreground,
                  fontSize: isCompact ? 13 : 14,
                },
                labelStyle,
              ]}
            >
              {label}
            </Text>
          )}
          {description && (
            <Text
              style={[
                styles.description,
                {
                  color: colors.foregroundMuted,
                  fontSize: 11,
                },
              ]}
            >
              {description}
            </Text>
          )}
        </View>
      )}

      <View
        style={[
          styles.track,
          {
            width: trackWidth,
            height: trackHeight,
            borderRadius: trackHeight / 2,
            backgroundColor: trackColor,
          },
        ]}
      >
        <View
          style={[
            styles.thumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              backgroundColor: colors.surface0,
              transform: [{ translateX: thumbPosition }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontWeight: "500",
  },
  description: {
    lineHeight: 15,
  },
  track: {
    justifyContent: "center",
  },
  thumb: {
    ...resolveElevation("sm"),
  },
});

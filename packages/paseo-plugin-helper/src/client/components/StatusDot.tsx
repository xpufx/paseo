import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import type { StatusVariant } from "../../shared/types.js";

export interface StatusDotProps {
  variant?: StatusVariant;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StatusDot({ variant = "neutral", size = "md", pulse = false, style }: StatusDotProps) {
  const { getStatusColor, alpha } = usePluginTheme();
  const color = getStatusColor(variant);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [pulse, pulseAnim]);

  const dimension = size === "sm" ? 6 : size === "lg" ? 10 : 8;

  return (
    <View
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.dot,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: color,
            shadowColor: color,
            opacity: pulseAnim,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
});

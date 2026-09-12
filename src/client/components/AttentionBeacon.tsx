import React, { useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import type { ThemeColors } from "../../shared/types.js";

export type AttentionBeaconMode = "radar" | "ring" | "glow" | "badge" | "bounce";
export type AttentionBeaconTone = "warning" | "accent" | "danger";

export interface AttentionBeaconProps {
  children: ReactNode;
  mode?: AttentionBeaconMode;
  tone?: AttentionBeaconTone;
  color?: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  haloStyle?: StyleProp<ViewStyle>;
  badgeStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function normalizeBeaconMode(mode?: AttentionBeaconMode): "radar" | "glow" | "badge" | "bounce" {
  if (mode === "ring") return "radar";
  if (mode === "glow" || mode === "badge" || mode === "bounce" || mode === "radar") return mode;
  return "radar";
}

export function resolveBeaconToneColor(
  colors: ThemeColors,
  tone: AttentionBeaconTone = "warning",
  customColor?: string,
): string {
  if (customColor) return customColor;
  if (tone === "danger") return colors.statusDanger;
  if (tone === "accent") return colors.accent;
  return colors.statusWarning;
}

function useLoop(driver: Animated.Value, toValue: number, duration: number, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    driver.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(driver, { toValue, duration, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(driver, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [driver, toValue, duration, active]);
}

function usePingPong(driver: Animated.Value, duration: number, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    driver.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(driver, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(driver, { toValue: 0, duration, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [driver, duration, active]);
}

export function AttentionBeacon({
  children,
  mode = "radar",
  tone = "warning",
  color,
  active = true,
  style,
  haloStyle,
  badgeStyle,
  accessibilityLabel,
  testID,
}: AttentionBeaconProps) {
  const { colors } = usePluginTheme();
  const resolved = normalizeBeaconMode(mode);
  const beaconColor = resolveBeaconToneColor(colors, tone, color);

  const radar = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const pip = useRef(new Animated.Value(0)).current;
  const jiggle = useRef(new Animated.Value(0)).current;

  const isRadar = resolved === "radar" && active;
  const isGlow = resolved === "glow" && active;
  const isBadge = resolved === "badge" && active;
  const isBounce = resolved === "bounce" && active;

  useLoop(radar, 1, 1600, isRadar);
  usePingPong(breath, 900, isGlow);
  usePingPong(pip, 900, isBadge);
  usePingPong(jiggle, 350, isBounce);

  if (!active) {
    return <View style={[styles.wrapper, style]}>{children}</View>;
  }

  if (resolved === "glow") {
    const opacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
    return (
      <View style={[styles.wrapper, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
        {children}
        <Animated.View
          pointerEvents="none"
          testID={testID ? `${testID}-glow` : undefined}
          style={[styles.glowHalo, { borderColor: beaconColor, opacity }, haloStyle]}
        />
      </View>
    );
  }

  if (resolved === "badge") {
    const opacity = pip.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
    const scale = pip.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
    return (
      <View style={[styles.wrapper, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
        {children}
        <Animated.View
          pointerEvents="none"
          testID={testID ? `${testID}-badge` : undefined}
          style={[styles.pip, { backgroundColor: beaconColor, opacity, transform: [{ scale }] }, badgeStyle]}
        />
      </View>
    );
  }

  if (resolved === "bounce") {
    const translateY = jiggle.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
    return (
      <View style={[styles.wrapper, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
        <Animated.View style={{ transform: [{ translateY }] }}>{children}</Animated.View>
      </View>
    );
  }

  const scale = radar.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacity = radar.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <View style={[styles.wrapper, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
      <Animated.View
        pointerEvents="none"
        testID={testID ? `${testID}-halo` : undefined}
        style={[
          styles.radarHalo,
          { borderColor: beaconColor, opacity, transform: [{ scale }] },
          haloStyle,
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
  },
  radarHalo: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 2,
    borderRadius: 12,
  },
  glowHalo: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderRadius: 10,
  },
  pip: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});

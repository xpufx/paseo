import React, { type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import { resolveMetricStatus, type MetricThresholds } from "../../shared/formatters.js";

export interface MetricGaugeProps {
  value: number; // 0 - 100
  size?: number;
  strokeWidth?: number;
  thresholds?: MetricThresholds;
  color?: string;
  autoStatusColor?: boolean;
  label?: string;
  showPercent?: boolean;
  centerSlot?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Clean circular metric gauge.
 * Displays a proportional percentage ring with automated threshold coloring and center slot.
 */
export function MetricGauge({
  value,
  size = 76,
  strokeWidth = 7,
  thresholds,
  color,
  autoStatusColor = true,
  label,
  showPercent = true,
  centerSlot,
  style,
}: MetricGaugeProps) {
  const { colors } = usePluginTheme();

  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  let gaugeColor = color || colors.accent;
  if (!color && autoStatusColor) {
    const status = resolveMetricStatus(clamped, thresholds);
    if (status === "danger") {
      gaugeColor = colors.statusDanger;
    } else if (status === "warning") {
      gaugeColor = colors.statusWarning;
    } else {
      gaugeColor = colors.statusSuccess;
    }
  }

  const radius = size / 2;
  const innerSize = Math.max(0, size - strokeWidth * 2);
  const innerRadius = innerSize / 2;
  const trackColor = colors.surface2;

  // Web & React Native Web: Conic gradient provides a pixel-perfect proportional ring arc
  if (Platform.OS === "web") {
    const webBackground = `conic-gradient(${gaugeColor} 0% ${clamped}%, ${trackColor} ${clamped}% 100%)`;

    return (
      <View style={[styles.wrapper, style]}>
        <View
          style={[
            styles.gaugeBox,
            {
              width: size,
              height: size,
              borderRadius: radius,
            },
            ({ background: webBackground } as any),
          ]}
        >
          {/* Inner cutout mask */}
          <View
            style={[
              styles.centerHole,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerRadius,
                backgroundColor: colors.surface0,
              },
            ]}
          >
            {centerSlot ? (
              centerSlot
            ) : showPercent ? (
              <Text style={[styles.percentText, { color: colors.foreground }]}>
                {Math.round(clamped)}%
              </Text>
            ) : null}
          </View>
        </View>

        {label ? (
          <Text style={[styles.labelText, { color: colors.foregroundMuted }]}>
            {label}
          </Text>
        ) : null}
      </View>
    );
  }

  // Native (iOS/Android): Two-semicircle clipping approach
  const firstHalfRotation = Math.min(180, clamped * 3.6);
  const secondHalfRotation = clamped > 50 ? (clamped - 50) * 3.6 : 0;

  return (
    <View style={[styles.wrapper, style]}>
      <View style={[styles.gaugeBox, { width: size, height: size }]}>
        {/* Background track circle */}
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: radius,
              borderWidth: strokeWidth,
              borderColor: trackColor,
            },
          ]}
        />

        {/* First 180 degrees */}
        <View
          style={[
            styles.halfCircleContainer,
            {
              width: size,
              height: size,
              transform: [{ rotate: `${firstHalfRotation}deg` }],
            },
          ]}
        >
          <View
            style={[
              styles.halfCircle,
              {
                width: size,
                height: size,
                borderRadius: radius,
                borderWidth: strokeWidth,
                borderColor: gaugeColor,
                borderBottomColor: "transparent",
                borderLeftColor: "transparent",
              },
            ]}
          />
        </View>

        {/* Second 180 degrees */}
        {clamped > 50 ? (
          <View
            style={[
              styles.halfCircleContainer,
              {
                width: size,
                height: size,
                transform: [{ rotate: `${secondHalfRotation + 180}deg` }],
              },
            ]}
          >
            <View
              style={[
                styles.halfCircle,
                {
                  width: size,
                  height: size,
                  borderRadius: radius,
                  borderWidth: strokeWidth,
                  borderColor: gaugeColor,
                  borderBottomColor: "transparent",
                  borderLeftColor: "transparent",
                },
              ]}
            />
          </View>
        ) : null}

        {/* Center Content Slot */}
        <View
          style={[
            styles.centerHole,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerRadius,
              backgroundColor: colors.surface0,
            },
          ]}
        >
          {centerSlot ? (
            centerSlot
          ) : showPercent ? (
            <Text style={[styles.percentText, { color: colors.foreground }]}>
              {Math.round(clamped)}%
            </Text>
          ) : null}
        </View>
      </View>

      {label ? (
        <Text style={[styles.labelText, { color: colors.foregroundMuted }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  gaugeBox: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  centerHole: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  halfCircleContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
  },
  halfCircle: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  percentText: {
    fontSize: 13,
    fontWeight: "700",
  },
  labelText: {
    fontSize: 11,
    fontWeight: "500",
  },
});

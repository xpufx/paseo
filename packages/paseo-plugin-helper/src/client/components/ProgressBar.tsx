import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import { resolveMetricStatus, type MetricThresholds } from "../../shared/formatters.js";

export interface ProgressBarProps {
  value: number; // 0 to 100
  color?: string;
  autoStatusColor?: boolean;
  thresholds?: MetricThresholds;
  label?: string;
  showValueText?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({
  value,
  color,
  autoStatusColor = true,
  thresholds,
  label,
  showValueText = false,
  height = 8,
  style,
}: ProgressBarProps) {
  const { colors, resolveRadius, isCompact } = usePluginTheme();

  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const radius = resolveRadius("pill");

  let barColor = color || colors.accent;
  if (!color && autoStatusColor) {
    const status = resolveMetricStatus(clamped, thresholds);
    if (status === "danger") {
      barColor = colors.statusDanger;
    } else if (status === "warning") {
      barColor = colors.statusWarning;
    } else {
      barColor = colors.statusSuccess;
    }
  }

  return (
    <View style={[styles.container, style]}>
      {(label || showValueText) && (
        <View style={styles.labelRow}>
          {label ? (
            <Text
              style={[
                styles.labelText,
                { color: colors.foregroundMuted, fontSize: isCompact ? 11 : 12 },
              ]}
            >
              {label}
            </Text>
          ) : null}
          {showValueText ? (
            <Text
              style={[
                styles.valueText,
                { color: colors.foreground, fontSize: isCompact ? 11 : 12 },
              ]}
            >
              {Math.round(clamped)}%
            </Text>
          ) : null}
        </View>
      )}
      <View
        style={[
          styles.track,
          {
            backgroundColor: colors.surface2,
            height,
            borderRadius: radius,
          },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${clamped}%`,
              backgroundColor: barColor,
              borderRadius: radius,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  labelText: {
    fontWeight: "500",
  },
  valueText: {
    fontWeight: "600",
  },
  track: {
    width: "100%",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
  },
});

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import {
  usePluginTheme,
  useRpcQuery,
  useRpcMutation,
  ProgressBar,
} from "paseo-plugin-helper/client";
import {
  statusRpc,
  toggleBedModeRpc,
  snoozeAlertRpc,
  type WellbeingStatus,
  type OperatorPhase,
} from "../shared/contracts.js";

export function WellbeingSurface() {
  const { colors, typography, resolveRadius } = usePluginTheme();
  const { data: status, isLoading, refetch } = useRpcQuery(statusRpc, {}, { refetchInterval: 5000 });
  const toggleMutation = useRpcMutation(toggleBedModeRpc);
  const snoozeMutation = useRpcMutation(snoozeAlertRpc);

  const radiusRounded = resolveRadius("md");
  const radiusPill = resolveRadius("pill");

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface0 }]}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={[styles.subtext, { color: colors.foregroundMuted, ...typography.caption }]}>
          Loading operator presence telemetry...
        </Text>
      </View>
    );
  }

  const s: WellbeingStatus = (status as WellbeingStatus) || {
    phase: "working",
    fleetPosture: "active-focus",
    fleetDirective: "Operator Status: Active / Desk Mode.",
    isBedMode: false,
    activeStretchMinutes: 0,
    longestStretchMinutes: 0,
    breaksTaken: 0,
    idleMinutes: 0,
    dailyUsageMinutes: 0,
    lastActivityAt: null,
    streakStartedAt: null,
    fatigueAlertTriggered: false,
    fatigueAlertCount: 0,
    snoozedUntil: null,
    settings: {
      workingHours: { start: "09:00", end: "18:00" },
      windDownTime: "22:30",
      wakeUpTime: "07:30",
      bedMode: false,
      maxSessionContinuousMinutes: 180,
      idleTimeoutMinutes: 15,
      fatigueAlertCooldownMinutes: 60,
      notifyVia2fado: true,
    },
  };

  const phaseThemeMap: Record<OperatorPhase, { bg: string; text: string; label: string }> = {
    working: { bg: colors.statusSuccess, text: "#ffffff", label: "DESK MODE" },
    "extended-stretch": { bg: colors.statusWarning, text: "#ffffff", label: "FATIGUE ALERT" },
    "wind-down": { bg: colors.accent, text: colors.accentForeground, label: "WIND-DOWN" },
    "bed-mode": { bg: colors.surface2, text: colors.foreground, label: "BED MODE" },
    idle: { bg: colors.surface2, text: colors.foregroundMuted, label: "AWAY" },
  };

  const currentPhase = phaseThemeMap[s.phase] || phaseThemeMap.working;

  const handleToggle = async () => {
    await toggleMutation.mutateAsync({ enabled: !s.isBedMode });
    void refetch();
  };

  const handleSnooze = async (minutes: number) => {
    await snoozeMutation.mutateAsync({ minutes });
    void refetch();
  };

  const stretchThreshold = s.settings.maxSessionContinuousMinutes || 180;
  const stretchProgress = Math.min(100, Math.round((s.activeStretchMinutes / stretchThreshold) * 100));

  return (
    <View style={[styles.container, { backgroundColor: colors.surface0 }]}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.foreground, ...typography.heading }]}>
          Operator Wellbeing
        </Text>
        <View style={[styles.badge, { backgroundColor: currentPhase.bg, borderRadius: radiusPill }]}>
          <Text style={[styles.badgeText, { color: currentPhase.text }]}>{currentPhase.label}</Text>
        </View>
      </View>

      {/* Stretch Progress & Telemetry Card */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface1,
            borderColor: colors.border,
            borderRadius: radiusRounded,
          },
        ]}
      >
        <View style={styles.rowSpace}>
          <Text style={[styles.cardLabel, { color: colors.foregroundMuted, ...typography.label }]}>
            Continuous Active Stretch
          </Text>
          <Text style={[styles.subValue, { color: colors.foregroundMuted, ...typography.caption }]}>
            Limit: {stretchThreshold}m
          </Text>
        </View>

        <Text style={[styles.metricLarge, { color: colors.foreground }]}>
          {s.activeStretchMinutes} <Text style={styles.metricUnit}>min</Text>
        </Text>

        <View style={styles.progressWrap}>
          <ProgressBar
            value={stretchProgress}
            autoStatusColor
            thresholds={{ warning: 75, danger: 100 }}
            height={6}
          />
        </View>

        {s.phase === "extended-stretch" && (
          <View
            style={[
              styles.alertBox,
              {
                backgroundColor: colors.surface2,
                borderColor: colors.statusWarning,
                borderRadius: radiusRounded,
              },
            ]}
          >
            <Text style={[styles.alertText, { color: colors.foreground, ...typography.caption }]}>
              ⚠️ Unbroken focus exceeds healthy limits. Take a macro-break!
            </Text>
            <TouchableOpacity
              style={[styles.snoozeBtn, { backgroundColor: colors.surface1, borderRadius: radiusRounded }]}
              onPress={() => handleSnooze(15)}
              disabled={snoozeMutation.isPending}
            >
              <Text style={[styles.snoozeBtnText, { color: colors.foreground, ...typography.caption }]}>
                💤 Snooze 15m
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 2x2 Daily Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View
          style={[
            styles.metricTile,
            {
              backgroundColor: colors.surface1,
              borderColor: colors.border,
              borderRadius: radiusRounded,
            },
          ]}
        >
          <Text style={[styles.cardLabel, { color: colors.foregroundMuted, ...typography.label }]}>
            Total Active Today
          </Text>
          <Text style={[styles.metricText, { color: colors.foreground }]}>
            {Math.floor(s.dailyUsageMinutes / 60)}h {s.dailyUsageMinutes % 60}m
          </Text>
          <Text style={[styles.microText, { color: colors.foregroundMuted, ...typography.caption }]}>
            Hours: {s.settings.workingHours.start}-{s.settings.workingHours.end}
          </Text>
        </View>

        <View
          style={[
            styles.metricTile,
            {
              backgroundColor: colors.surface1,
              borderColor: colors.border,
              borderRadius: radiusRounded,
            },
          ]}
        >
          <Text style={[styles.cardLabel, { color: colors.foregroundMuted, ...typography.label }]}>
            Breaks Taken
          </Text>
          <Text style={[styles.metricText, { color: colors.foreground }]}>{s.breaksTaken}</Text>
          <Text style={[styles.microText, { color: colors.foregroundMuted, ...typography.caption }]}>
            Peak: {s.longestStretchMinutes}m
          </Text>
        </View>
      </View>

      {/* Fleet Posture Directive Box */}
      <View
        style={[
          styles.postureCard,
          {
            backgroundColor: colors.surface1,
            borderColor: colors.border,
            borderRadius: radiusRounded,
          },
        ]}
      >
        <Text style={[styles.cardLabel, { color: colors.foregroundMuted, ...typography.label }]}>
          Fleet Posture Directive
        </Text>
        <Text style={[styles.directiveText, { color: colors.foreground, ...typography.body }]}>
          {s.fleetDirective}
        </Text>
        <View style={styles.circadianRow}>
          <Text style={[styles.microText, { color: colors.foregroundMuted, ...typography.caption }]}>
            🌙 Wind-Down: {s.settings.windDownTime}
          </Text>
          <Text style={[styles.microText, { color: colors.foregroundMuted, ...typography.caption }]}>
            ☀️ Wake: {s.settings.wakeUpTime}
          </Text>
        </View>
      </View>

      {/* Action Button */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          {
            backgroundColor: s.isBedMode ? colors.accent : colors.surface2,
            borderRadius: radiusRounded,
            borderColor: colors.border,
          },
        ]}
        onPress={handleToggle}
        disabled={toggleMutation.isPending}
      >
        <Text
          style={[
            styles.actionButtonText,
            { color: s.isBedMode ? colors.accentForeground : colors.foreground },
          ]}
        >
          {s.isBedMode ? "🌙 Bed Mode Active (Tap to Resume)" : "🛌 Activate Bed Mode"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
  },
  subtext: {
    marginTop: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  card: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  rowSpace: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  subValue: {
    fontSize: 11,
  },
  metricLarge: {
    fontSize: 26,
    fontWeight: "800",
    marginVertical: 4,
  },
  metricUnit: {
    fontSize: 14,
    fontWeight: "500",
  },
  progressWrap: {
    marginTop: 8,
  },
  alertBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  alertText: {
    fontSize: 11,
    flex: 1,
    marginRight: 8,
  },
  snoozeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  snoozeBtnText: {
    fontSize: 11,
    fontWeight: "600",
  },
  metricsGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  metricTile: {
    flex: 1,
    borderWidth: 1,
    padding: 12,
  },
  metricText: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 2,
    marginBottom: 4,
  },
  microText: {
    fontSize: 10,
  },
  postureCard: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  directiveText: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
    marginBottom: 8,
  },
  circadianRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    borderColor: "rgba(128,128,128,0.2)",
  },
  actionButton: {
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
});

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRpcQuery, useRpcMutation } from "paseo-plugin-helper/client";
import { statusRpc, toggleBedModeRpc, type WellbeingStatus } from "../shared/contracts.js";

export function WellbeingSurface() {
  const { data: status, isLoading, refetch } = useRpcQuery(statusRpc, {}, { refetchInterval: 5000 });
  const toggleMutation = useRpcMutation(toggleBedModeRpc);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color="#3b82f6" />
        <Text style={styles.subtext}>Loading operator presence telemetry...</Text>
      </View>
    );
  }

  const s: WellbeingStatus = (status as WellbeingStatus) || {
    phase: "working",
    isBedMode: false,
    activeStretchMinutes: 0,
    idleMinutes: 0,
    dailyUsageMinutes: 0,
    lastActivityAt: null,
    streakStartedAt: null,
    fatigueAlertTriggered: false,
    fatigueAlertCount: 0,
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

  const phaseColors: Record<string, string> = {
    working: "#10b981",
    "extended-stretch": "#f59e0b",
    "wind-down": "#8b5cf6",
    "bed-mode": "#6366f1",
    idle: "#6b7280",
  };

  const handleToggle = async () => {
    await toggleMutation.mutateAsync({ enabled: !s.isBedMode });
    void refetch();
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Operator Wellbeing</Text>
        <View style={[styles.badge, { backgroundColor: phaseColors[s.phase] || "#6b7280" }]}>
          <Text style={styles.badgeText}>{s.phase.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Continuous Active Stretch</Text>
        <Text style={styles.metricText}>{s.activeStretchMinutes} min</Text>
        <Text style={styles.metricSub}>
          Fatigue alert threshold: {s.settings.maxSessionContinuousMinutes} min
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Total Active Today</Text>
        <Text style={styles.metricText}>
          {Math.floor(s.dailyUsageMinutes / 60)}h {s.dailyUsageMinutes % 60}m
        </Text>
        <Text style={styles.metricSub}>
          Working Hours: {s.settings.workingHours.start} - {s.settings.workingHours.end}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Circadian Schedule</Text>
        <Text style={styles.detailText}>🌙 Wind-Down: {s.settings.windDownTime}</Text>
        <Text style={styles.detailText}>☀️ Wake-Up: {s.settings.wakeUpTime}</Text>
        <Text style={styles.detailText}>
          📱 2fado Notifications: {s.settings.notifyVia2fado ? "Enabled" : "Disabled"}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, s.isBedMode ? styles.buttonActive : styles.buttonInactive]}
        onPress={handleToggle}
        disabled={toggleMutation.isPending}
      >
        <Text style={styles.buttonText}>
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
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  subtext: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4b5563",
    marginBottom: 4,
  },
  metricText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1f2937",
  },
  metricSub: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  detailText: {
    fontSize: 13,
    color: "#374151",
    marginTop: 2,
  },
  button: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonActive: {
    backgroundColor: "#4f46e5",
  },
  buttonInactive: {
    backgroundColor: "#1f2937",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});

import React, { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import {
  Button,
  usePluginTheme,
  useRpcQuery,
  useRpcMutation,
  ProgressBar,
  Row,
  Stack,
} from "paseo-plugin-helper/client";
import {
  statusRpc,
  toggleBedModeRpc,
  snoozeAlertRpc,
  recordActivityRpc,
  type WellbeingStatus,
  type OperatorPhase,
  type ActivitySource,
} from "../shared/contracts.js";

export function WellbeingSurface() {
  const { colors, typography, resolveRadius } = usePluginTheme();
  const { data: status, isLoading, refetch } = useRpcQuery(statusRpc, {}, { refetchInterval: 5000 });
  const toggleMutation = useRpcMutation(toggleBedModeRpc);
  const snoozeMutation = useRpcMutation(snoozeAlertRpc);
  const recordActivityMutation = useRpcMutation(recordActivityRpc);

  const lastHeartbeatRef = useRef<number>(0);

  // Client-side operator presence detection: window events + document visibility heartbeat
  useEffect(() => {
    const reportActivity = (source: ActivitySource = "client_interaction") => {
      const now = Date.now();
      if (now - lastHeartbeatRef.current >= 15000) {
        lastHeartbeatRef.current = now;
        void recordActivityMutation.mutateAsync({ source }).then(() => {
          void refetch();
        });
      }
    };

    // Immediate initial heartbeat when surface opens
    reportActivity("client_surface");

    // React Native defines `window` as an alias of `global` but provides no
    // DOM event API, so `window.addEventListener` is undefined on mobile.
    // Gate on the function itself, not the global's existence.
    if (typeof window?.addEventListener === "function") {
      const handlePointer = () => reportActivity("client_interaction");
      const handleKey = () => reportActivity("client_interaction");
      const handleFocus = () => reportActivity("client_interaction");

      window.addEventListener("pointerdown", handlePointer, { passive: true });
      window.addEventListener("keydown", handleKey, { passive: true });
      window.addEventListener("focus", handleFocus);

      // Heartbeat while surface is active and visible
      const interval = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          reportActivity("client_surface");
        }
      }, 30000);

      return () => {
        window.removeEventListener("pointerdown", handlePointer);
        window.removeEventListener("keydown", handleKey);
        window.removeEventListener("focus", handleFocus);
        clearInterval(interval);
      };
    }
  }, []);

  const radiusRounded = resolveRadius("md");
  const radiusPill = resolveRadius("pill");

  if (isLoading) {
    return (
      <Stack
        gap={0}
        align="center"
        justify="center"
        style={{ flex: 1, padding: 24, backgroundColor: colors.surface0 }}
      >
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={{ marginTop: 2, color: colors.foregroundMuted, ...typography.caption }}>
          Loading operator presence telemetry...
        </Text>
      </Stack>
    );
  }

  const defaults: WellbeingStatus = {
    phase: "working",
    fleetPosture: "active-focus",
    fleetDirective: "Operator Status: Active (Desk Focus).",
    isBedMode: false,
    activeStretchMinutes: 0,
    longestStretchMinutes: 0,
    breaksTaken: 0,
    idleMinutes: 0,
    dailyUsageMinutes: 0,
    lastActivityAt: null,
    lastActivitySource: null,
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
  // Older daemons may omit newer fields (protocol drift), so merge the
  // payload over defaults instead of crashing on a partial `settings`.
  const s: WellbeingStatus = {
    ...defaults,
    ...((status as WellbeingStatus | undefined) ?? {}),
    settings: { ...defaults.settings, ...((status as WellbeingStatus | undefined)?.settings ?? {}) },
  };

  const phaseThemeMap: Record<OperatorPhase, { bg: string; text: string; label: string }> = {
    working: { bg: colors.statusSuccess, text: "#ffffff", label: "DESK FOCUS" },
    "extended-stretch": { bg: colors.statusWarning, text: "#ffffff", label: "FATIGUE ALERT" },
    "wind-down": { bg: colors.accent, text: colors.accentForeground, label: "WIND-DOWN" },
    "bed-mode": { bg: colors.surface2, text: colors.foreground, label: "BED MODE" },
    idle: { bg: colors.surface2, text: colors.foregroundMuted, label: "AWAY" },
  };

  const sourceLabels: Record<ActivitySource, string> = {
    client_surface: "Surface Active",
    client_interaction: "UI Touch/Keyboard",
    interactive_turn: "Prompt Interaction",
    permission_resolved: "Permission Decision",
    manual_override: "Manual Pulse",
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

  const handleManualPulse = async () => {
    await recordActivityMutation.mutateAsync({ source: "manual_override" });
    void refetch();
  };

  const stretchThreshold = s.settings.maxSessionContinuousMinutes || 180;
  const stretchProgress = Math.min(100, Math.round((s.activeStretchMinutes / stretchThreshold) * 100));

  return (
    <Stack gap={0} style={{ flex: 1, padding: 16, backgroundColor: colors.surface0 }}>
      {/* Header Row */}
      <Row gap={0} align="center" justify="space-between" style={{ marginBottom: 16 }}>
        <View>
          <Text style={{ color: colors.foreground, ...typography.heading }}>
            Operator Wellbeing
          </Text>
          <Text style={{ marginTop: 2, color: colors.foregroundMuted, ...typography.caption }}>
            {s.lastActivitySource
              ? `Telemetry: ${sourceLabels[s.lastActivitySource] || s.lastActivitySource}`
              : "Telemetry: Standby"}
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: currentPhase.bg,
            borderRadius: radiusPill,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 0.5, color: currentPhase.text }}>
            {currentPhase.label}
          </Text>
        </View>
      </Row>

      {/* Stretch Progress & Telemetry Card */}
      <View
        style={{
          borderWidth: 1,
          padding: 14,
          marginBottom: 12,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          borderRadius: radiusRounded,
        }}
      >
        <Row gap={0} justify="space-between" align="center">
          <Text
            style={{
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
              color: colors.foregroundMuted,
              ...typography.label,
            }}
          >
            Continuous Active Stretch
          </Text>
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
            Limit: {stretchThreshold}m
          </Text>
        </Row>

        <Text style={{ fontSize: 26, fontWeight: "800", marginVertical: 4, color: colors.foreground }}>
          {s.activeStretchMinutes} <Text style={{ fontSize: 14, fontWeight: "500" }}>min</Text>
        </Text>

        <View style={{ marginTop: 8 }}>
          <ProgressBar
            value={stretchProgress}
            autoStatusColor
            thresholds={{ warning: 75, danger: 100 }}
            height={6}
          />
        </View>

        {s.phase === "extended-stretch" && (
          <Row
            gap={0}
            align="center"
            justify="space-between"
            style={{
              marginTop: 12,
              padding: 10,
              borderWidth: 1,
              backgroundColor: colors.surface2,
              borderColor: colors.statusWarning,
              borderRadius: radiusRounded,
            }}
          >
            <Text style={{ flex: 1, marginRight: 8, color: colors.foreground, ...typography.caption }}>
              ⚠️ Unbroken focus exceeds healthy limits. Take a macro-break!
            </Text>
            <Button
              label="💤 Snooze 15m"
              size="sm"
              variant="secondary"
              loading={snoozeMutation.isPending}
              onPress={() => handleSnooze(15)}
            />
          </Row>
        )}
      </View>

      {/* 2x2 Daily Metrics Grid */}
      <Row gap={10} style={{ marginBottom: 12 }}>
        <View
          style={{
            flex: 1,
            borderWidth: 1,
            padding: 12,
            backgroundColor: colors.surface1,
            borderColor: colors.border,
            borderRadius: radiusRounded,
          }}
        >
          <Text
            style={{
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
              color: colors.foregroundMuted,
              ...typography.label,
            }}
          >
            Total Active Today
          </Text>
          <Text style={{ fontSize: 18, fontWeight: "700", marginTop: 2, marginBottom: 4, color: colors.foreground }}>
            {Math.floor(s.dailyUsageMinutes / 60)}h {s.dailyUsageMinutes % 60}m
          </Text>
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
            Window: {s.settings.workingHours.start}–{s.settings.workingHours.end}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            borderWidth: 1,
            padding: 12,
            backgroundColor: colors.surface1,
            borderColor: colors.border,
            borderRadius: radiusRounded,
          }}
        >
          <Text
            style={{
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
              color: colors.foregroundMuted,
              ...typography.label,
            }}
          >
            Breaks Taken
          </Text>
          <Text style={{ fontSize: 18, fontWeight: "700", marginTop: 2, marginBottom: 4, color: colors.foreground }}>
            {s.breaksTaken}
          </Text>
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
            Longest: {s.longestStretchMinutes}m
          </Text>
        </View>
      </Row>

      {/* Fleet Posture Directive Box */}
      <View
        style={{
          borderWidth: 1,
          padding: 12,
          marginBottom: 16,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          borderRadius: radiusRounded,
        }}
      >
        <Text
          style={{
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 4,
            color: colors.foregroundMuted,
            ...typography.label,
          }}
        >
          Fleet Posture Directive
        </Text>
        <Text style={{ marginTop: 2, marginBottom: 8, color: colors.foreground, ...typography.body }}>
          {s.fleetDirective}
        </Text>
        <Row
          gap={0}
          justify="space-between"
          style={{
            borderTopWidth: 1,
            paddingTop: 6,
            borderColor: "rgba(128,128,128,0.2)",
          }}
        >
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
            🌙 Wind-Down: {s.settings.windDownTime}
          </Text>
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
            ☀️ Wake: {s.settings.wakeUpTime}
          </Text>
        </Row>
      </View>

      {/* Action Controls */}
      <Row gap={8} align="center">
        <Button
          label={s.isBedMode ? "🌙 Bed Mode Active (Resume)" : "🛌 Shift to Bed Mode"}
          size="lg"
          variant={s.isBedMode ? "primary" : "secondary"}
          loading={toggleMutation.isPending}
          style={{ flex: 1 }}
          onPress={handleToggle}
        />
        <Button
          label="⚡ Log Focus"
          size="lg"
          variant="secondary"
          loading={recordActivityMutation.isPending}
          onPress={handleManualPulse}
        />
      </Row>
    </Stack>
  );
}

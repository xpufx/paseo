import React from "react";
import { View, Text } from "react-native";
import {
  AboutSection,
  Card,
  FormRow,
  SectionHeader,
  Stack,
  TextInput,
  Toggle,
  useHostTheme,
} from "../host-ui.js";
import type { PluginSettingsValues } from "../../shared/types.js";
import { PLUGIN_VERSION } from "../../shared/version.js";

export interface SettingsTabProps {
  settings: PluginSettingsValues;
  onUpdateSettings: (patch: Partial<PluginSettingsValues>) => void;
}

export function SettingsTab({ settings, onUpdateSettings }: SettingsTabProps) {
  const { colors } = useHostTheme();

  return (
    <Stack gap={12}>
      <SectionHeader title="Plugin Settings" />

      <Card variant="elevated">
        <View style={{ padding: 12 }}>
          <Stack gap={14}>
            <FormRow
              label="Auto-Refresh Interval (seconds)"
              description="Interval between automatic background status queries (0 to disable)."
            >
              <TextInput
                value={String(settings.autoRefreshInterval)}
                keyboardType="numeric"
                style={{ width: 100 }}
                onChangeText={(text) => {
                  const val = parseInt(text.replace(/[^0-9]/g, ""), 10);
                  if (!isNaN(val)) {
                    onUpdateSettings({ autoRefreshInterval: Math.max(0, Math.min(300, val)) });
                  }
                }}
              />
            </FormRow>

            <FormRow
              label="Log Tail Depth"
              description="Number of recent log lines to fetch from agent-mux routing log."
            >
              <TextInput
                value={String(settings.logTailDepth)}
                keyboardType="numeric"
                style={{ width: 100 }}
                onChangeText={(text) => {
                  const val = parseInt(text.replace(/[^0-9]/g, ""), 10);
                  if (!isNaN(val)) {
                    onUpdateSettings({ logTailDepth: Math.max(5, Math.min(500, val)) });
                  }
                }}
              />
            </FormRow>

            <FormRow
              label="Live Countdown Timer"
              description="Continuously decrement countdown clocks in the Quota & Cooldowns tab."
            >
              <Toggle
                value={settings.showLiveCountdown}
                onValueChange={(val) => onUpdateSettings({ showLiveCountdown: val })}
              />
            </FormRow>

            <FormRow
              label="Auto-Probe Connectivity on Load"
              description="Automatically send server probes when the plugin is opened."
            >
              <Toggle
                value={settings.autoProbeOnLoad}
                onValueChange={(val) => onUpdateSettings({ autoProbeOnLoad: val })}
              />
            </FormRow>
          </Stack>
        </View>
      </Card>

      {/* About Section */}
      <AboutSection
        name="Agent Mux Plugin"
        version={PLUGIN_VERSION}
        description="Paseo surface for agent-mux provider quotas, account profiles, cooldown locks, and router logs."
        links={[
          {
            label: "Issue #1395",
            url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1395",
          },
          {
            label: "agent-mux Repository",
            url: "https://forge.mrs.uppidi.com/xpufx-org/agent-mux",
          },
        ]}
      />
    </Stack>
  );
}

import React from "react";
import { Text } from "react-native";
import {
  ActionBar,
  Button,
  Card,
  FormRow,
  KeyValue,
  KeyValueGroup,
  Toggle,
  triggerHaptic,
  usePluginTheme,
  useSuiteSettings,
} from "paseo-plugin-helper/client";

export function SharedSuiteCard() {
  const { colors, typography } = usePluginTheme();
  const { settings, updateSettings, resetSettings, isUpdating } = useSuiteSettings({
    pollIntervalMs: 2000,
  });

  return (
    <Card variant="elevated">
      <Card.Header
        title="Shared Suite Settings"
        subtitle="Architecture B: one file, every sibling plugin sees it"
      />
      <KeyValueGroup>
        <KeyValue label="Suite" value={settings.suiteTitle} />
        <KeyValue label="Accent" value={settings.accentColor} copyable />
        <KeyValue label="Density" value={settings.density} />
      </KeyValueGroup>
      <FormRow
        label="Show suite tabs"
        description="Toggles the shared tab shell for all suite plugins"
      >
        <Toggle
          value={settings.showSuiteTabs}
          onValueChange={(val) => {
            triggerHaptic("light");
            updateSettings({ showSuiteTabs: val });
          }}
        />
      </FormRow>
      <FormRow label="Density" description={`Active density: "${settings.density}"`}>
        <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
          {(["compact", "comfortable", "spacious"] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              label={d}
              variant={settings.density === d ? "primary" : "ghost"}
              onPress={() => {
                triggerHaptic("light");
                updateSettings({ density: d });
              }}
            />
          ))}
        </ActionBar>
      </FormRow>
      <ActionBar align="space-between">
        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
          {isUpdating ? "Syncing to suite file..." : "Writes land in xpufx-suite/settings.json"}
        </Text>
        <Button
          label="Reset Suite"
          variant="secondary"
          size="sm"
          onPress={async () => {
            triggerHaptic("warning");
            await resetSettings();
          }}
        />
      </ActionBar>
    </Card>
  );
}

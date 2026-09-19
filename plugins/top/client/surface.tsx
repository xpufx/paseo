import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  AboutSection,
  Button,
  Card,
  KeyValue,
  KeyValueGroup,
  MetricGauge,
  ModalBody,
  Row,
  Stack,
  Tabs,
  Toggle,
  CardHeader,
  usePluginSettings,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import { formatBytes, formatUptime } from "paseo-plugin-helper/shared";
import {
  topSettingsContract,
  checkboxesFromTarget,
  targetFromCheckboxes,
  METRIC_DEFINITIONS,
  type PillMode,
  type TopSettings,
} from "../shared/resources";
import { PLUGIN_VERSION } from "../shared/version";
import { notifySettingsChanged } from "./pill";
import { ChoiceChips } from "./settings-ui";
import { useTopResourceQuery } from "./resources-query";

type SurfaceTab = "system" | "settings" | "about";

const TABS = [
  { id: "system", label: "Activity", shortLabel: "Activity", icon: "Activity" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
  { id: "about", label: "About", shortLabel: "About", icon: "Info" },
];

const TIMELINE_CADENCE_OPTIONS = Array.from({ length: 11 }, (_, n) => ({
  id: n,
  label: n === 0 ? "Never" : n === 1 ? "Every turn" : `${n}`,
}));

const CPU_THRESHOLDS = { warning: 60, danger: 85 };
const MEM_THRESHOLDS = { warning: 70, danger: 85 };

// Keep the dashboard a readable centered column instead of stretching
// edge-to-edge on large viewports. The cap lives in the helper
// (`ModalBody maxContentWidth`); this is the only place the surface picks
// the value.
const TOP_CONTENT_MAX_WIDTH = 600;

export function TopDashboardSurface(_props: PluginSurfaceProps) {
  const { colors } = usePluginTheme();
  const [activeTab, setActiveTab] = useState<SurfaceTab>("system");
  // No background settings poll: mount/focus verification plus mutation
  // invalidation keep the dashboard in sync without daemon churn.
  const { settings, updateSettings, resetSettings } = usePluginSettings(
    topSettingsContract,
  );
  // The dashboard surface carries no workspace scope, so it reads the
  // host-wide entry of the same shared snapshot path the pill and modal use
  // per workspace (see useTopResourceQuery).
  const { data, isLoading } = useTopResourceQuery();

  const pillHidden = settings.showComposerPill === false;

  const applySettings = (updates: Partial<TopSettings>) => {
    const changed = Object.entries(updates).some(
      ([key, value]) =>
        !Object.is((settings as Record<string, unknown>)[key], value),
    );
    if (!changed) return;
    const next = { ...settings, ...updates };
    updateSettings(updates);
    notifySettingsChanged(next);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface0 }]}>
      <ModalBody
        headerMode="pinned"
        maxContentWidth={TOP_CONTENT_MAX_WIDTH}
        header={
          <Tabs
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as SurfaceTab)}
          />
        }
        headerStyle={{
          backgroundColor: colors.surface0,
          paddingHorizontal: 12,
          paddingTop: 12,
          paddingBottom: 6,
        }}
        contentContainerStyle={{
          gap: 12,
          paddingHorizontal: 12,
          paddingBottom: 12,
          paddingTop: 6,
        }}
        refreshing={isLoading}
      >
        {activeTab === "system" && (
        <Stack gap={12}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
            Host System Resources
          </Text>

          {pillHidden && (
            <Card variant="elevated">
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foregroundMuted }}>
                Composer pill is hidden in trackbar. You can re-enable it from the Settings tab above.
              </Text>
            </Card>
          )}

          <Card variant="elevated">
            <Row justify="space-around" align="center" style={styles.gaugeContainer}>
              <MetricGauge
                value={data?.cpuUsagePercent ?? 0}
                thresholds={CPU_THRESHOLDS}
                label="CPU Load"
                size={72}
              />
              <MetricGauge
                value={data?.memoryUsedPercent ?? 0}
                thresholds={MEM_THRESHOLDS}
                label="RAM Used"
                size={72}
              />
            </Row>
          </Card>

          <Card variant="elevated">
            <KeyValueGroup>
              <KeyValue
                label="CPU"
                value={data?.cpuUsagePercent !== undefined ? `${data.cpuUsagePercent}%` : "--"}
              />
              <KeyValue
                label="Memory"
                value={
                  data?.memoryUsedBytes !== undefined
                    ? `${formatBytes(data.memoryUsedBytes, { compact: true, decimals: 1 })} (${data.memoryUsedPercent ?? "--"}%)`
                    : "--"
                }
              />
              <KeyValue
                label="Load"
                value={data?.loadAvg?.[0] !== undefined ? data.loadAvg[0].toFixed(2) : "--"}
              />
              <KeyValue
                label="Uptime"
                value={data?.uptimeSeconds ? formatUptime(data.uptimeSeconds) : "--"}
              />
              <KeyValue label="Branch" value={data?.branch ?? "--"} copyable />
              <KeyValue
                label="MCP"
                value={
                  data?.mcp && typeof data.mcp.total === "number"
                    ? `${data.mcp.healthy}/${data.mcp.total} healthy`
                    : "MCP --"
                }
              />
            </KeyValueGroup>
          </Card>
          {isLoading && !data ? (
            <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>
              Loading live snapshot...
            </Text>
          ) : null}
        </Stack>
      )}

      {activeTab === "settings" && (
        <Stack gap={12}>
          <Card variant="elevated">
            <CardHeader
              title="Pill Display Mode"
              icon="LayoutGrid"
              subtitle="How active items appear in the composer trackbar"
            />
            <ChoiceChips
              options={[
                { id: "cycle", label: "Cycle", description: "Rotate one at a time" },
                { id: "all", label: "All in One", description: "Combined into one pill" },
                { id: "multiple", label: "Multiple", description: "Dedicated pills" },
              ]}
              value={settings.pillMode ?? "cycle"}
              showActiveDescription
              onChange={(pillMode: PillMode) => applySettings({ pillMode })}
            />
            <View style={styles.settingsSpacer}>
              <Toggle
                label="Show Composer Pill"
                description="Hide the composer pill entirely; the dashboard stays available from the sidebar"
                value={settings.showComposerPill ?? true}
                onValueChange={(val) => applySettings({ showComposerPill: val })}
              />
            </View>
          </Card>

          <Card variant="elevated">
            <CardHeader
              title="Metric Surfaces"
              icon="Sliders"
              subtitle="Choose where each metric appears (pill vs timeline)"
            />
            <Stack gap={12}>
              {METRIC_DEFINITIONS.map((def) => {
                const boxes = checkboxesFromTarget(settings.metricSurfaces?.[def.id]);
                const setBox = (which: "pill" | "timeline", val: boolean) => {
                  const nextBoxes = { ...boxes, [which]: val };
                  if (def.pillOnly) nextBoxes.timeline = false;
                  applySettings({
                    metricSurfaces: {
                      ...settings.metricSurfaces,
                      [def.id]: targetFromCheckboxes(nextBoxes.pill, nextBoxes.timeline),
                    } as TopSettings["metricSurfaces"],
                  });
                };
                return (
                  <View key={def.id}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.foreground }}>
                      {def.title}
                    </Text>
                    <Row gap={24} align="center" style={styles.metricTargets}>
                      <Row gap={6} align="center">
                        <Text style={[styles.metricTargetLabel, { color: colors.foreground }]}>
                          Pill
                        </Text>
                        <Toggle value={boxes.pill} onValueChange={(val) => setBox("pill", val)} />
                      </Row>
                      <Row gap={6} align="center">
                        <Text style={[styles.metricTargetLabel, { color: colors.foreground }]}>
                          Timeline
                        </Text>
                        <Toggle
                          value={boxes.timeline && !def.pillOnly}
                          disabled={!!def.pillOnly}
                          onValueChange={(val) => setBox("timeline", val)}
                        />
                      </Row>
                    </Row>
                  </View>
                );
              })}
            </Stack>
          </Card>

          <Card variant="elevated">
            <CardHeader
              title="Rotation Speed"
              icon="Clock"
              value={
                <Text style={{ color: colors.accent, fontWeight: "600" }}>
                  {`${settings.intervalSeconds}s`}
                </Text>
              }
            />
            <ChoiceChips
              options={[2, 3, 4, 6].map((sec) => ({ id: sec, label: `${sec}s` }))}
              value={settings.intervalSeconds}
              onChange={(intervalSeconds) => applySettings({ intervalSeconds })}
            />
          </Card>

          <Card variant="elevated">
            <CardHeader
              title="Timeline Cadence"
              icon="Clock"
              value={
                <Text style={{ color: colors.accent, fontWeight: "600" }}>
                  {(settings.timelineCadence ?? 1) === 0
                    ? "Never"
                    : (settings.timelineCadence ?? 1) === 1
                      ? "Every turn"
                      : `Every ${(settings.timelineCadence ?? 1)} turns`}
                </Text>
              }
              subtitle="How often a card is stamped into the timeline view (0 = never)"
            />
            <ChoiceChips
              options={TIMELINE_CADENCE_OPTIONS}
              value={settings.timelineCadence ?? 1}
              onChange={(timelineCadence) => applySettings({ timelineCadence })}
            />
          </Card>

          <Button
            label="Reset to Defaults"
            variant="secondary"
            size="sm"
            onPress={() => {
              void resetSettings().then((defaults) => {
                notifySettingsChanged(defaults ?? topSettingsContract.defaultSettings);
              });
            }}
          />
        </Stack>
      )}

      {activeTab === "about" && (
        <AboutSection
          name="paseo-top"
          description="Live host system and workspace monitor for Paseo composer trackbar."
          version={data?.version ?? PLUGIN_VERSION}
          author="xpufx"
          repository="https://github.com/xpufx/paseo-top"
          issues="https://github.com/xpufx/paseo-top/issues"
          license="MIT"
          density="tiny"
          extraItems={[
            {
              label: "Host Platform",
              value: data?.platform ? `${data.platform} (${data.arch ?? "unknown"})` : "Linux",
              copyable: true,
            },
            { label: "Host Name", value: data?.hostname ?? "localhost", copyable: true },
            { label: "CPU Model", value: data?.cpuModel ?? "unknown", copyable: true },
            { label: "CPU Cores", value: `${data?.cpuCores ?? 0} cores` },
            {
              label: "Total Memory",
              value: data?.memoryTotalBytes ? formatBytes(data.memoryTotalBytes) : "unknown",
            },
            {
              label: "Host Uptime",
              value: data?.uptimeSeconds ? formatUptime(data.uptimeSeconds) : "unknown",
            },
          ]}
        />
      )}
    </ModalBody>
    </View>
  );
}

const styles = {
  root: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  gaugeContainer: {
    paddingVertical: 12,
    width: "100%",
  },
  settingsSpacer: {
    marginTop: 12,
  },
  metricTargets: {
    paddingLeft: 4,
    marginTop: 4,
  },
  metricTargetLabel: {
    fontSize: 9,
    fontWeight: "600",
  },
} as const;

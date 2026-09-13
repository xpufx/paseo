import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  AboutSection,
  Button,
  Card,
  KeyValue,
  KeyValueGroup,
  MetricGauge,
  ModalBody,
  Tabs,
  Toggle,
  CardHeader,
  useRpcQuery,
  usePluginSettings,
  usePluginTheme,
} from "./vendor/paseo-plugin-helper/index";
import { formatBytes, formatUptime } from "../shared/vendor/paseo-plugin-helper/index";
import {
  getSystemResourcesRpc,
  topSettingsContract,
  checkboxesFromTarget,
  targetFromCheckboxes,
  METRIC_DEFINITIONS,
  type PillMode,
  type TopSettings,
} from "../shared/resources";
import { PLUGIN_VERSION } from "../shared/version";
import { notifySettingsChanged } from "./pill";

const EMPTY_PARAMS = {};

type SurfaceTab = "system" | "settings" | "about";

const TABS = [
  { id: "system", label: "Activity", shortLabel: "Activity", icon: "Activity" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
  { id: "about", label: "About", shortLabel: "About", icon: "Info" },
];

const CPU_THRESHOLDS = { warning: 60, danger: 85 };
const MEM_THRESHOLDS = { warning: 70, danger: 85 };

export function TopDashboardSurface(_props: PluginSurfaceProps) {
  const { colors } = usePluginTheme();
  const [activeTab, setActiveTab] = useState<SurfaceTab>("system");
  const { settings, updateSettings, resetSettings } = usePluginSettings(
    topSettingsContract,
    { refetchInterval: 2000 },
  );
  const { data, isLoading } = useRpcQuery(getSystemResourcesRpc, EMPTY_PARAMS, {
    refetchInterval: 5000,
  });

  const pillHidden = settings.showComposerPill === false;

  const applySettings = (updates: Partial<TopSettings>) => {
    const next = { ...settings, ...updates };
    updateSettings(updates);
    notifySettingsChanged(next);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface0 }]}>
      <ModalBody
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
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
            Host System Resources
          </Text>

          {pillHidden && (
            <Card variant="elevated">
              <View style={styles.banner}>
                <Text style={[styles.bannerText, { color: colors.foregroundMuted }]}>
                  Composer pill is hidden in trackbar. You can re-enable it from the Settings tab above.
                </Text>
              </View>
            </Card>
          )}

          <Card variant="elevated">
            <View style={styles.gaugeContainer}>
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
            </View>
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
        </View>
      )}

      {activeTab === "settings" && (
        <View style={{ gap: 12 }}>
          <Card variant="elevated">
            <CardHeader
              title="Pill Display Mode"
              icon="LayoutGrid"
              subtitle="How active items appear in the composer trackbar"
            />
            <View style={styles.modeRow}>
              {[
                { id: "cycle", label: "Cycle", desc: "Rotate one at a time" },
                { id: "all", label: "All in One", desc: "Combined into one pill" },
                { id: "multiple", label: "Multiple", desc: "Dedicated pills" },
              ].map((modeOption) => {
                const isSelected = (settings.pillMode ?? "cycle") === modeOption.id;
                return (
                  <Pressable
                    key={modeOption.id}
                    onPress={() => applySettings({ pillMode: modeOption.id as PillMode })}
                    style={[
                      styles.modeCard,
                      {
                        backgroundColor: isSelected ? colors.surface1 : colors.surface0,
                        borderColor: isSelected ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeTitle,
                        {
                          color: isSelected ? colors.accent : colors.foreground,
                          fontWeight: isSelected ? "700" : "500",
                        },
                      ]}
                    >
                      {modeOption.label}
                    </Text>
                    <Text style={[styles.modeDesc, { color: colors.foregroundMuted }]}>
                      {modeOption.desc}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ marginTop: 12 }}>
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
            <View style={{ gap: 12 }}>
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
                    <View style={{ flexDirection: "row", gap: 24, paddingLeft: 4, marginTop: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 9, fontWeight: "600", color: colors.foregroundMuted }}>
                          Pill
                        </Text>
                        <Toggle value={boxes.pill} onValueChange={(val) => setBox("pill", val)} />
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 9, fontWeight: "600", color: colors.foregroundMuted }}>
                          Timeline
                        </Text>
                        <Toggle
                          value={boxes.timeline && !def.pillOnly}
                          disabled={!!def.pillOnly}
                          onValueChange={(val) => setBox("timeline", val)}
                        />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
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
            <View style={styles.speedRow}>
              {[2, 3, 4, 6].map((sec) => (
                <View
                  key={sec}
                  style={[
                    styles.speedChip,
                    {
                      backgroundColor:
                        settings.intervalSeconds === sec ? colors.accent : colors.surface1,
                      borderColor:
                        settings.intervalSeconds === sec ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text
                    onPress={() => applySettings({ intervalSeconds: sec })}
                    style={[
                      styles.speedChipText,
                      {
                        color:
                          settings.intervalSeconds === sec
                            ? colors.accentForeground
                            : colors.foreground,
                        fontWeight: settings.intervalSeconds === sec ? "700" : "500",
                      },
                    ]}
                  >
                    {`${sec}s`}
                  </Text>
                </View>
              ))}
            </View>
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
        </View>
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  banner: {
    gap: 8,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: "600",
  },
  gaugeContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 12,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 4,
    paddingBottom: 8,
  },
  modeCard: {
    flex: 1,
    minWidth: 90,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    gap: 2,
  },
  modeTitle: {
    fontSize: 10,
  },
  modeDesc: {
    fontSize: 8,
    lineHeight: 10,
  },
  speedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  speedChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  speedChipText: {
    fontSize: 10,
  },
});

import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  HostAboutSection,
  HostButton,
  HostCard,
  HostCardHeader,
  HostGrid,
  HostKeyValue,
  HostLayoutProvider,
  HostMetricGauge,
  HostRow,
  HostScroll,
  HostStack,
  HostTabs,
  HostThemeProvider,
  HostToggle,
} from "./host-ui";
import { usePluginSettings } from "paseo-plugin-helper/core";
import { formatBytes, formatUptime } from "paseo-plugin-helper/shared";
import { PermissionAuditView } from "permission-audit/client";
import {
  topSettingsContract,
  checkboxesFromTarget,
  targetFromCheckboxes,
  METRIC_DEFINITIONS,
  CPU_THRESHOLDS,
  MEM_THRESHOLDS,
  SURFACE_TABS,
  aboutExtraItems,
  type PillMode,
  type TopSettings,
} from "../shared/resources";
import { PLUGIN_VERSION } from "../shared/version";
import { notifySettingsChanged } from "./settings-events";
import { ChoiceChips } from "./settings-ui";
import { useTopResourceQuery } from "./resources-query";
import { FleetView } from "./multi-host-view";

type SurfaceTab = "system" | "fleet" | "permissions" | "settings" | "about";

const TIMELINE_CADENCE_OPTIONS = Array.from({ length: 11 }, (_, n) => ({
  id: n,
  label: n === 0 ? "Never" : n === 1 ? "Every turn" : `${n}`,
}));

export function TopDashboardSurface(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const { colors } = theme;
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
    <HostThemeProvider theme={theme}>
      <HostLayoutProvider layout={layout}>
        <View style={[styles.root, { backgroundColor: colors.surface0 }]}>
          {/*
           * The sidebar host supplies no scroller for plugin surfaces, so the
           * dashboard owns exactly one: HostScroll below the pinned tab
           * strip (the header stays fixed because it sits outside the scroller).
           */}
          <HostTabs
            tabs={[...SURFACE_TABS]}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as SurfaceTab)}
          />
          <HostScroll
            style={styles.scroll}
            contentContainerStyle={{
              gap: 12,
              paddingHorizontal: 12,
              paddingBottom: 12,
              paddingTop: 6,
            }}
          >
            {activeTab === "system" && (
              <HostStack gap={12}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
                  Host System Resources
                </Text>

                {pillHidden && (
                  <HostCard variant="elevated">
                    <Text
                      style={{ fontSize: 12, fontWeight: "600", color: colors.foregroundMuted }}
                    >
                      Composer pill is hidden in trackbar. You can re-enable it from the Settings
                      tab above.
                    </Text>
                  </HostCard>
                )}

                <HostCard variant="elevated">
                  <HostRow justify="between" align="center" style={styles.gaugeContainer}>
                    <HostMetricGauge
                      value={data?.cpuUsagePercent ?? 0}
                      thresholds={CPU_THRESHOLDS}
                      label="CPU Load"
                      size={72}
                    />
                    <HostMetricGauge
                      value={data?.memoryUsedPercent ?? 0}
                      thresholds={MEM_THRESHOLDS}
                      label="RAM Used"
                      size={72}
                    />
                  </HostRow>
                </HostCard>

                <HostCard variant="elevated">
                  <HostGrid columns={2} gap={12}>
                    <HostKeyValue
                      label="CPU"
                      value={data?.cpuUsagePercent !== undefined ? `${data.cpuUsagePercent}%` : "--"}
                    />
                    <HostKeyValue
                      label="Memory"
                      value={
                        data?.memoryUsedBytes !== undefined
                          ? `${formatBytes(data.memoryUsedBytes, { compact: true, decimals: 1 })} (${data.memoryUsedPercent ?? "--"}%)`
                          : "--"
                      }
                    />
                    <HostKeyValue
                      label="Load"
                      value={data?.loadAvg?.[0] !== undefined ? data.loadAvg[0].toFixed(2) : "--"}
                    />
                    <HostKeyValue
                      label="Uptime"
                      value={data?.uptimeSeconds ? formatUptime(data.uptimeSeconds) : "--"}
                    />
                    <HostKeyValue label="Branch" value={data?.branch ?? "--"} copyable />
                    <HostKeyValue
                      label="MCP"
                      value={
                        data?.mcp && typeof data.mcp.total === "number"
                          ? `${data.mcp.healthy}/${data.mcp.total} healthy`
                          : "MCP --"
                      }
                    />
                  </HostGrid>
                </HostCard>
                {isLoading && !data ? (
                  <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>
                    Loading live snapshot...
                  </Text>
                ) : null}
              </HostStack>
            )}

            {activeTab === "fleet" && <FleetView />}

            {activeTab === "permissions" && <PermissionAuditView variant="compact" theme={theme} layout={layout} />}

            {activeTab === "settings" && (
              <HostStack gap={12}>
                <HostCard variant="elevated">
                  <HostCardHeader
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
                    <HostToggle
                      label="Show Composer Pill"
                      description="Hide the composer pill entirely; the dashboard stays available from the sidebar"
                      value={settings.showComposerPill ?? true}
                      onValueChange={(val) => applySettings({ showComposerPill: val })}
                    />
                  </View>
                </HostCard>

                <HostCard variant="elevated">
                  <HostCardHeader
                    title="Metric Surfaces"
                    icon="Sliders"
                    subtitle="Choose where each metric appears (pill vs timeline)"
                  />
                  <HostStack gap={12}>
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
                          <HostRow gap={24} align="center" style={styles.metricTargets}>
                            <HostRow gap={6} align="center">
                              <Text style={[styles.metricTargetLabel, { color: colors.foreground }]}>
                                Pill
                              </Text>
                              <HostToggle
                                value={boxes.pill}
                                onValueChange={(val) => setBox("pill", val)}
                              />
                            </HostRow>
                            <HostRow gap={6} align="center">
                              <Text style={[styles.metricTargetLabel, { color: colors.foreground }]}>
                                Timeline
                              </Text>
                              <HostToggle
                                value={boxes.timeline && !def.pillOnly}
                                disabled={!!def.pillOnly}
                                onValueChange={(val) => setBox("timeline", val)}
                              />
                            </HostRow>
                          </HostRow>
                        </View>
                      );
                    })}
                  </HostStack>
                </HostCard>

                <HostCard variant="elevated">
                  <HostCardHeader
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
                </HostCard>

                <HostCard variant="elevated">
                  <HostCardHeader
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
                </HostCard>

                <HostButton
                  label="Reset to Defaults"
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    void resetSettings().then((defaults) => {
                      notifySettingsChanged(defaults ?? topSettingsContract.defaultSettings);
                    });
                  }}
                />
              </HostStack>
            )}

            {activeTab === "about" && (
              <HostAboutSection
                name="paseo-top"
                description="Live host system and workspace monitor for Paseo composer trackbar."
                version={data?.version ?? PLUGIN_VERSION}
                author="xpufx"
                repository="https://github.com/xpufx/paseo-top"
                issues="https://github.com/xpufx/paseo-top/issues"
                license="MIT"
                extraItems={aboutExtraItems(data)}
              />
            )}
          </HostScroll>
        </View>
      </HostLayoutProvider>
    </HostThemeProvider>
  );
}

const styles = {
  root: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
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

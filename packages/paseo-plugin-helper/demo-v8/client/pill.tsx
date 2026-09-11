import React, { useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsInput,
} from "@getpaseo/plugin/client/ui";
import {
  initClientHelpers,
  type ComposerPillRegistrar,
} from "paseo-plugin-helper/client";

initClientHelpers({ Icon, Modal, useRpc, useToast });
import {
  registerComposerPill,
  registerHelperSettingsScreen,
  type HelperSettingsScreenRegistrar,
  PluginThemeProvider,
  ModalBody,
  ActionBar,
  Card,
  Tabs,
  Badge,
  StatusDot,
  Button,
  KeyValue,
  KeyValueGroup,
  MetricGauge,
  ProgressBar,
  DataTable,
  SearchInput,
  EmptyState,
  CodeBlock,
  Toggle,
  FormRow,
  TextInput,
  AboutSection,
  Responsive,
  triggerHaptic,
  usePluginTheme,
  useResponsive,
  useAutoRefreshQuery,
  useRpcMutation,
  usePluginSettings,
  type RenderModalProps,
  type RenderPillProps,
  type VisualFlair,
} from "paseo-plugin-helper/client";
import { formatBytes, formatUptime } from "paseo-plugin-helper/shared";
import {
  getDemoDataRpc,
  triggerDemoActionRpc,
  demoSettingsContract,
  type DemoData,
} from "../shared/demo.js";
import { PLUGIN_VERSION } from "../shared/version.js";

const EMPTY_PARAMS = {};

function DemoPill({ isOpen }: RenderPillProps) {
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();
  const { settings } = usePluginSettings(demoSettingsContract);
  const { data, isLoading } = useAutoRefreshQuery(getDemoDataRpc, EMPTY_PARAMS, {
    defaultRate: settings.pollingRate,
  });

  const cpu = data?.cpuUsagePercent ?? 0;
  const isAlert = cpu > settings.highCpuThreshold;

  return (
    <View style={styles.pillRow}>
      <StatusDot variant={isAlert ? "danger" : "success"} pulse={isAlert} />
      {isCompact ? (
        // Mobile / Compact track: ultra-compact layout to prevent truncation!
        <Text numberOfLines={1} style={[styles.pillText, isOpen && styles.pillTextActive]}>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>
            {isLoading ? "..." : `${cpu}%`}
          </Text>
        </Text>
      ) : (
        // Desktop wide track: full descriptive label
        <Text numberOfLines={1} style={[styles.pillText, isOpen && styles.pillTextActive]}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>
            {settings.accentPillLabel}
          </Text>
          {settings.showCpuUsage && (
            <>
              <Text style={{ color: colors.foregroundMuted }}>{" · "}</Text>
              <Text style={{ color: colors.foreground }}>{isLoading ? "..." : `${cpu}% CPU`}</Text>
            </>
          )}
        </Text>
      )}
    </View>
  );
}

function DemoModal({ close }: RenderModalProps) {
  const { colors, theme, layout } = usePluginTheme();
  const { isCompact } = useResponsive();
  const [activeTab, setActiveTab] = useState<string>("gauges");
  const [tabMode, setTabMode] = useState<"fit" | "scroll">(isCompact ? "scroll" : "fit");

  const showcaseTabs = [
    { id: "gauges", label: "Gauges & Hardware", shortLabel: "Gauges" },
    { id: "flair", label: "Visual Flair Studio", shortLabel: "Flair" },
    { id: "data", label: "Data Table", shortLabel: "Data" },
    { id: "controls", label: "Interactive Controls", shortLabel: "Controls" },
    { id: "settings", label: "Plugin Settings", shortLabel: "Settings" },
    { id: "network", label: "Network Diagnostics", shortLabel: "Net" },
    { id: "logs", label: "System Logs", shortLabel: "Logs" },
    { id: "about", label: "About Plugin", shortLabel: "About" },
  ];
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [liveStream, setLiveStream] = useState<boolean>(true);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const {
    settings,
    updateSettings,
    resetSettings,
    isUpdating: isSettingsUpdating,
  } = usePluginSettings(demoSettingsContract);

  const {
    data,
    isLoading,
    refetch,
    rate,
    setRate,
    isPolling,
  } = useAutoRefreshQuery(getDemoDataRpc, EMPTY_PARAMS, {
    defaultRate: "2s",
  });

  const { mutate: runAction, isPending: isActionPending } = useRpcMutation(
    triggerDemoActionRpc,
    {
      onSuccess: (res) => {
        triggerHaptic("success");
        setActionFeedback(res.message);
        refetch();
      },
    }
  );

  const items = data?.items ?? [];
  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeFlair: Partial<VisualFlair> = {
    radius: settings.flairRadius,
    density: settings.flairDensity,
    surfaceStyle: settings.flairSurface,
    borderWidth: settings.flairBorderWidth,
    headingTransform: settings.flairUppercase ? "uppercase" : "none",
    accentColor: settings.flairAccentColor,
  };

  return (
    <PluginThemeProvider
      theme={{
        ...theme,
        colors: {
          ...theme.colors,
          accent: settings.flairAccentColor,
        },
      }}
      layout={layout}
      flair={activeFlair}
    >
      <ModalBody
        refreshing={isLoading}
        onRefresh={async () => {
          triggerHaptic("light");
          await refetch();
        }}
      >
      {/* Top Banner Card */}
      <Card variant="elevated">
        <View style={styles.headerRow}>
          <View style={styles.titleCol}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Helper Showcase
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.foregroundMuted }]}>
              v0.2 UI Design System & Daemon Primitives
            </Text>
          </View>
          <Badge
            variant="accent"
            label={`Polling ${rate}`}
          />
        </View>

        {/* Refresh Interval Selector */}
        <View style={styles.rateControlRow}>
          <Text style={[styles.rateLabel, { color: colors.foregroundMuted }]}>
            Auto Refresh:
          </Text>
          {(["1s", "2s", "5s", "paused"] as const).map((r) => (
            <Button
              key={r}
              label={r}
              size="sm"
              variant={rate === r ? "primary" : "ghost"}
              onPress={() => {
                triggerHaptic("light");
                setRate(r);
              }}
            />
          ))}
        </View>

        {/* Tab Display Mode Selector */}
        <View style={styles.rateControlRow}>
          <Text style={[styles.rateLabel, { color: colors.foregroundMuted }]}>
            Tab Mode:
          </Text>
          <Button
            label="Fit (Screen)"
            size="sm"
            variant={tabMode === "fit" ? "primary" : "ghost"}
            onPress={() => {
              triggerHaptic("light");
              setTabMode("fit");
            }}
          />
          <Button
            label="Scroll (Ribbon)"
            size="sm"
            variant={tabMode === "scroll" ? "primary" : "ghost"}
            onPress={() => {
              triggerHaptic("light");
              setTabMode("scroll");
            }}
          />
        </View>
      </Card>

      {/* Tabs */}
      <Tabs
        mode={tabMode}
        activeTab={activeTab}
        onTabChange={(tab) => {
          triggerHaptic("light");
          setActiveTab(tab);
        }}
        tabs={showcaseTabs}
      />

      {/* TAB 1: GAUGES & HARDWARE */}
      {activeTab === "gauges" && (
        <>
          <Card variant="elevated">
            <Card.Header title="Metric Gauges" />
            <View style={styles.gaugesContainer}>
              <MetricGauge
                value={data?.cpuUsagePercent ?? 0}
                label="CPU Load"
                size={74}
              />
              <MetricGauge
                value={data?.memoryUsedPercent ?? 0}
                label="RAM Used"
                size={74}
              />
              <MetricGauge
                value={38}
                label="Disk I/O"
                size={74}
              />
            </View>
          </Card>

          <Card variant="elevated">
            <Card.Header title="Linear Progress" />
            <ProgressBar
              value={data?.cpuUsagePercent ?? 0}
              height={8}
            />
            <ProgressBar
              value={data?.memoryUsedPercent ?? 0}
              height={8}
            />
          </Card>

          <Card variant="elevated">
            <Card.Header title="Host & Network" />
            <KeyValueGroup columns={isCompact ? 1 : 2}>
              <KeyValue
                label="Hostname"
                value={data?.hostname ?? "..."}
                copyable
              />
              <KeyValue
                label="Verified Daemon Port"
                value={data?.daemonPort ? String(data.daemonPort) : "..."}
                copyable
              />
            </KeyValueGroup>
            <KeyValue
              label="Processor"
              value={data?.cpuModel ?? "..."}
              subValue="Multi-line wrap verified"
              copyable
            />
            <KeyValue
              label="System Uptime"
              value={data ? formatUptime(data.uptimeSeconds) : "..."}
            />
          </Card>
        </>
      )}

      {/* TAB: VISUAL FLAIR STUDIO */}
      {activeTab === "flair" && (
        <>
          <Card variant={settings.flairSurface}>
            <Card.Header
              title="Visual Flair Studio"
              subtitle="Live theme & flair customizer backed by atomic settings"
            />

            {/* Corner Radius Selector */}
            <FormRow
              label="Corner Radius"
              description={`Active preset: "${settings.flairRadius}"`}
            >
              <View style={styles.segmentRow}>
                {(["sharp", "rounded", "pill"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    label={r.toUpperCase()}
                    variant={settings.flairRadius === r ? "primary" : "ghost"}
                    onPress={() => {
                      triggerHaptic("light");
                      updateSettings({ flairRadius: r });
                    }}
                  />
                ))}
              </View>
            </FormRow>

            {/* Information Density Selector */}
            <FormRow
              label="Layout Density"
              description={`Active density: "${settings.flairDensity}"`}
            >
              <View style={styles.segmentRow}>
                {(["compact", "comfortable", "spacious"] as const).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    label={d.charAt(0).toUpperCase() + d.slice(1)}
                    variant={settings.flairDensity === d ? "primary" : "ghost"}
                    onPress={() => {
                      triggerHaptic("light");
                      updateSettings({ flairDensity: d });
                    }}
                  />
                ))}
              </View>
            </FormRow>

            {/* Surface Styling Selector */}
            <FormRow
              label="Surface Treatment"
              description={`Active surface: "${settings.flairSurface}"`}
            >
              <View style={styles.segmentRow}>
                {(["flat", "tinted", "elevated"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    label={s.charAt(0).toUpperCase() + s.slice(1)}
                    variant={settings.flairSurface === s ? "primary" : "ghost"}
                    onPress={() => {
                      triggerHaptic("light");
                      updateSettings({ flairSurface: s });
                    }}
                  />
                ))}
              </View>
            </FormRow>

            {/* Border Width Stepper / Selector */}
            <FormRow
              label="Border Width"
              description={`Container outline stroke: ${settings.flairBorderWidth}px`}
            >
              <View style={styles.segmentRow}>
                {[0, 1, 2, 3].map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    label={`${w}px`}
                    variant={settings.flairBorderWidth === w ? "primary" : "ghost"}
                    onPress={() => {
                      triggerHaptic("light");
                      updateSettings({ flairBorderWidth: w });
                    }}
                  />
                ))}
              </View>
            </FormRow>

            {/* Brand Accent Color Swatches */}
            <FormRow
              label="Brand Accent Color"
              description={`Current accent: ${settings.flairAccentColor}`}
            >
              <View style={styles.swatchesRow}>
                {[
                  { label: "Indigo", color: "#6366f1" },
                  { label: "Emerald", color: "#10b981" },
                  { label: "Violet", color: "#8b5cf6" },
                  { label: "Amber", color: "#f59e0b" },
                  { label: "Rose", color: "#f43f5e" },
                  { label: "Cyan", color: "#06b6d4" },
                ].map((swatch) => {
                  const isSelected = settings.flairAccentColor.toLowerCase() === swatch.color.toLowerCase();
                  return (
                    <Pressable
                      key={swatch.color}
                      onPress={() => {
                        triggerHaptic("light");
                        updateSettings({ flairAccentColor: swatch.color });
                      }}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: swatch.color },
                        isSelected && styles.colorSwatchActive,
                      ]}
                      accessibilityLabel={`Select ${swatch.label} accent color`}
                    />
                  );
                })}
              </View>
            </FormRow>

            {/* Uppercase Header Switch */}
            <FormRow
              label="Uppercase Section Headings"
              description="Transform component section titles to uppercase"
            >
              <Toggle
                value={settings.flairUppercase}
                onValueChange={(val) => {
                  triggerHaptic("light");
                  updateSettings({ flairUppercase: val });
                }}
              />
            </FormRow>

            {/* Live Component Preview Card */}
            <Card variant={settings.flairSurface} style={{ marginTop: 8 }}>
              <Card.Header
                title="Live Component Preview"
                subtitle="Reflects your active Visual Flair in real-time"
              />
              <KeyValueGroup columns={isCompact ? 1 : 2}>
                <KeyValue label="Status" value="Production Ready" />
                <KeyValue label="Radius Mode" value={settings.flairRadius} />
              </KeyValueGroup>
              <ActionBar align="flex-start">
                <Button label="Primary Button" variant="primary" size="sm" />
                <Button label="Secondary" variant="secondary" size="sm" />
                <Badge label="Adaptive Badge" variant="accent" />
              </ActionBar>
            </Card>
          </Card>
        </>
      )}

      {/* TAB 2: DATA TABLE */}
      {activeTab === "data" && (
        <Card variant="elevated">
          <Card.Header title={`Services Table (${isCompact ? "Compact 2-Col" : "Desktop 3-Col"})`} />
          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search service name or category..."
          />

          <DataTable
            data={filteredItems}
            keyExtractor={(item) => item.id}
            emptyState={
              <EmptyState
                icon="Search"
                title="No Services Found"
                description="Try clearing your search query."
              />
            }
            columns={
              isCompact
                ? [
                    {
                      key: "name",
                      header: "Service",
                      flex: 2,
                      render: (item) => (
                        <View>
                          <Text style={[styles.tableNameText, { color: colors.foreground }]}>
                            {item.name}
                          </Text>
                          <Text style={[styles.tableSubText, { color: colors.foregroundMuted }]}>
                            {item.category}
                          </Text>
                        </View>
                      ),
                    },
                    {
                      key: "load",
                      header: "Load",
                      align: "right",
                      render: (item) => (
                        <Text style={[styles.tableMetricText, { color: colors.foreground }]}>
                          {item.loadPercent}%
                        </Text>
                      ),
                    },
                  ]
                : [
                    {
                      key: "name",
                      header: "Service",
                      flex: 2,
                      render: (item) => (
                        <View>
                          <Text style={[styles.tableNameText, { color: colors.foreground }]}>
                            {item.name}
                          </Text>
                          <Text style={[styles.tableSubText, { color: colors.foregroundMuted }]}>
                            {item.category}
                          </Text>
                        </View>
                      ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      align: "center",
                      render: (item) => (
                        <Badge
                          label={item.status}
                          variant={item.status === "running" ? "success" : "warning"}
                        />
                      ),
                    },
                    {
                      key: "load",
                      header: "Load",
                      align: "right",
                      render: (item) => (
                        <Text style={[styles.tableMetricText, { color: colors.foreground }]}>
                          {item.loadPercent}%
                        </Text>
                      ),
                    },
                  ]
            }
          />
        </Card>
      )}

      {/* TAB 3: CONTROLS & CODE */}
      {activeTab === "controls" && (
        <>
          <Card variant="elevated">
            <Card.Header title="Toggles & Actions" />
            <Toggle
              label="Live Log Streaming"
              description="Stream background task ticks to console"
              value={liveStream}
              onValueChange={(val) => {
                triggerHaptic("medium");
                setLiveStream(val);
              }}
            />

            <Button
              label={isActionPending ? "Running RPC..." : "Trigger Background RPC Action"}
              variant="primary"
              onPress={() => runAction({ actionName: "Showcase Trigger" })}
            />

            {actionFeedback ? (
              <Text style={[styles.feedbackText, { color: colors.statusSuccess }]}>
                {actionFeedback}
              </Text>
            ) : null}
          </Card>

          <Card variant="elevated">
            <Card.Header title="Sample Code Block" />
            <CodeBlock
              language="typescript"
              code={`import { createPluginPill, MetricGauge } from "paseo-plugin-helper/client";\n\n// Renders circular ring\n<MetricGauge value={75} label="CPU Load" />`}
              copyable
            />
          </Card>
        </>
      )}

      {/* TAB: SETTINGS & STORAGE */}
      {activeTab === "settings" && (
        <Card variant="elevated">
          <Card.Header
            title="Plugin Settings"
            subtitle="Type-safe Zod storage with optimistic React Query updates"
          />
          <FormRow
            label="Show CPU in Pill"
            description="Toggle whether the CPU usage percent is visible in the composer bar"
          >
            <Toggle
              value={settings.showCpuUsage}
              onValueChange={(val) => {
                triggerHaptic("light");
                updateSettings({ showCpuUsage: val });
              }}
            />
          </FormRow>

          <FormRow
            label="Pill Accent Label"
            description="Custom label displayed at the front of the composer pill"
          >
            <TextInput
              value={settings.accentPillLabel}
              onChangeText={(text) => updateSettings({ accentPillLabel: text })}
              placeholder="demo"
            />
          </FormRow>

          <FormRow
            label="Alert Threshold"
            description={`Turns the status dot red when CPU exceeds this percent (Current: ${settings.highCpuThreshold}%)`}
          >
            <TextInput
              value={String(settings.highCpuThreshold)}
              keyboardType="numeric"
              onChangeText={(text) => {
                const val = parseInt(text, 10);
                if (!isNaN(val)) updateSettings({ highCpuThreshold: val });
              }}
            />
          </FormRow>

          <ActionBar align="space-between">
            <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>
              {isSettingsUpdating ? "Saving to disk..." : "Saved to settings.json atomically"}
            </Text>
            <Button
              label="Reset Defaults"
              variant="secondary"
              size="sm"
              onPress={async () => {
                triggerHaptic("warning");
                await resetSettings();
              }}
            />
          </ActionBar>
        </Card>
      )}

      {/* TAB 4: NETWORK DIAGNOSTICS */}
      {activeTab === "network" && (
        <Card variant="elevated">
          <Card.Header
            title="Network & Ports"
            subtitle="Daemon network diagnostics"
          />
          <KeyValueGroup>
            <KeyValue
              label="Daemon TCP Port"
              value={`${data?.daemonPort ?? 4280}`}
              subValue="Local verified socket"
              copyable
            />
            <KeyValue
              label="Network Connectivity"
              value="Active (Loopback)"
            />
          </KeyValueGroup>
        </Card>
      )}

      {/* TAB 5: SYSTEM LOGS */}
      {activeTab === "logs" && (
        <Card variant="elevated">
          <Card.Header
            title="System Logs"
            subtitle={`Background task tick #${data?.backgroundTicks ?? 0}`}
          />
          <CodeBlock
            language="bash"
            code={`[INFO] Server running on ${data?.hostname} (${data?.platform})\n[INFO] Background task alive, uptime: ${Math.round(data?.uptimeSeconds ?? 0)}s\n[INFO] Periodic health check OK`}
          />
        </Card>
      )}

      {/* TAB 6: ABOUT PLUGIN */}
      {activeTab === "about" && (
        <AboutSection
          name="Paseo Helper Demo"
          description="Interactive design system showcase and daemon runtime verification suite for paseo-plugin-helper."
          version={data?.version ?? PLUGIN_VERSION}
          author="xpufx"
          repository="https://github.com/xpufx/paseo-plugin-helper"
          issues="https://github.com/xpufx/paseo-plugin-helper/issues"
          license="MIT"
          extraItems={[
            { label: "Daemon Verified Port", value: `${data?.daemonPort ?? 4280}`, copyable: true },
            { label: "Host Platform", value: `${data?.platform ?? "unknown"}`, copyable: true },
            { label: "Background Uptime", value: `${Math.round(data?.uptimeSeconds ?? 0)}s` },
          ]}
        />
      )}

      {/* Footer */}
      <ActionBar align="flex-end">
        <Button
          label="Close"
          variant="ghost"
          onPress={() => {
            triggerHaptic("light");
            close();
          }}
        />
      </ActionBar>

      <View style={styles.versionFooter}>
        <Text style={[styles.versionText, { color: colors.foregroundMuted }]}>
          helper-demo v{data?.version ?? PLUGIN_VERSION} (tick #{data?.backgroundTicks ?? 0})
        </Text>
      </View>
    </ModalBody>
    </PluginThemeProvider>
  );
}

export function contributeClient(client: ComposerPillRegistrar & HelperSettingsScreenRegistrar) {
  const removePill = registerComposerPill(client, {
    id: "helper-demo",
    title: "demo",
    modalTitle: "Showcase Demo",
    modalIcon: "Sliders",
    flair: {
      radius: "rounded",
      density: "comfortable",
      accentColor: "#6366f1",
    },
    renderPill: (props) => <DemoPill {...props} />,
    renderModal: (props) => <DemoModal {...props} />,
  });
  const removeSettingsScreen = registerHelperSettingsScreen(client, demoSettingsContract, {
    ui: { SettingsCard, SettingsSection, SettingsSwitch, SettingsSelect, SettingsInput },
    id: "helper-demo-settings",
    title: "Demo settings",
    icon: "Sliders",
  });
  return () => {
    removePill();
    removeSettingsScreen();
  };
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  pillText: {
    fontSize: 11,
    flexShrink: 1,
  },
  pillTextActive: {
    opacity: 0.85,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  titleCol: {
    gap: 2,
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: 11,
    opacity: 0.7,
  },
  rateControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    flexWrap: "wrap",
  },
  rateLabel: {
    fontSize: 11,
    marginRight: 4,
  },
  gaugesContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 6,
  },
  tableNameText: {
    fontSize: 13,
    fontWeight: "600",
  },
  tableSubText: {
    fontSize: 11,
  },
  tableMetricText: {
    fontSize: 13,
    fontWeight: "600",
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 6,
  },
  versionFooter: {
    alignItems: "center",
    paddingVertical: 8,
  },
  versionText: {
    fontSize: 10,
    fontFamily: "monospace",
  },
  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  swatchesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    paddingVertical: 4,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSwatchActive: {
    borderColor: "#ffffff",
    transform: [{ scale: 1.15 }],
  },
});

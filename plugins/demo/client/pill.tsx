import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import {
  initClientHelpers,
  type ComposerPillRegistrar,
} from "./vendor/paseo-plugin-helper/index";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });
import {
  registerComposerPill,
  PluginThemeProvider,
  ModalBody,
  ActionBar,
  Card,
  Badge,
  StatusDot,
  Button,
  KeyValue,
  KeyValueGroup,
  MetricGauge,
  ProgressBar,
  DataTable,
  Tabs,
  SearchInput,
  EmptyState,
  CodeBlock,
  Toggle,
  FormRow,
  TextInput,
  AboutSection,
  AttentionBeacon,
  Collapsible,
  SectionHeader,
  triggerHaptic,
  usePluginTheme,
  useResponsive,
  useAutoRefreshQuery,
  useRpcMutation,
  usePluginSettings,
  type RenderModalProps,
  type RenderPillProps,
  type VisualFlair,
  type AttentionBeaconMode,
  type AttentionBeaconTone,
} from "./vendor/paseo-plugin-helper/index";
import { formatBytes, formatUptime } from "../shared/vendor/paseo-plugin-helper/index";
import {
  getDemoDataRpc,
  triggerDemoActionRpc,
  demoAgentIdentityContract,
  demoBeaconSetContract,
  demoBeaconBlinkContract,
  demoBeaconClearContract,
  demoSettingsContract,
  resolveDemoHeaderMode,
  type DemoData,
} from "../shared/demo.js";
import { SharedSuiteCard } from "./suite-settings.js";
import { PLUGIN_VERSION } from "../shared/version.js";

const EMPTY_PARAMS = {};

function DemoPill({ isOpen }: RenderPillProps) {
  const { colors, typography } = usePluginTheme();
  const { isCompact } = useResponsive();
  const { settings } = usePluginSettings(demoSettingsContract);
  const { data, isLoading } = useAutoRefreshQuery(getDemoDataRpc, EMPTY_PARAMS, {
    defaultRate: settings.pollingRate,
  });

  const cpu = data?.cpuUsagePercent ?? 0;
  const isAlert = cpu > settings.highCpuThreshold;

  // Raw View/Text composition: the host composer bar has no helper surface for
  // pill content, so only the compositor row and inline text spans stay local.
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 }}>
      <StatusDot variant={isAlert ? "danger" : "success"} pulse={isAlert} />
      {isCompact ? (
        // Mobile / Compact track: ultra-compact layout to prevent truncation!
        <Text
          numberOfLines={1}
          style={[
            { ...typography.caption, color: colors.foreground, fontWeight: "600", flexShrink: 1 },
            isOpen && { opacity: 0.85 },
          ]}
        >
          {isLoading ? "..." : `${cpu}%`}
        </Text>
      ) : (
        // Desktop wide track: full descriptive label
        <Text
          numberOfLines={1}
          style={[{ ...typography.caption, flexShrink: 1 }, isOpen && { opacity: 0.85 }]}
        >
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

function DemoModal({ close, workspaceId }: RenderModalProps) {
  const { colors, theme, layout, typography, touchTargetMin } = usePluginTheme();
  const { isCompact } = useResponsive();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<string>("gauges");
  const [navigationOpen, setNavigationOpen] = useState<boolean>(false);

  const showcaseTabs = [
    { id: "gauges", label: "Gauges & Hardware", shortLabel: "Gauges" },
    { id: "flair", label: "Visual Flair Studio", shortLabel: "Flair" },
    { id: "data", label: "Data Table", shortLabel: "Data" },
    { id: "controls", label: "Interactive Controls", shortLabel: "Controls" },
    { id: "attention", label: "Attention & Beacons", shortLabel: "Beacon" },
    { id: "settings", label: "Plugin Settings", shortLabel: "Settings" },
    { id: "network", label: "Network Diagnostics", shortLabel: "Net" },
    { id: "logs", label: "System Logs", shortLabel: "Logs" },
    { id: "about", label: "About Plugin", shortLabel: "About" },
  ];
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [liveStream, setLiveStream] = useState<boolean>(true);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [attentionOn, setAttentionOn] = useState<boolean>(true);
  const [beaconMode, setBeaconMode] = useState<AttentionBeaconMode>("radar");
  const [beaconTone, setBeaconTone] = useState<AttentionBeaconTone>("warning");
  const [beaconPresses, setBeaconPresses] = useState<number>(0);

  const {
    settings,
    updateSettings,
    resetSettings,
    isUpdating: isSettingsUpdating,
  } = usePluginSettings(demoSettingsContract);

  // An open in-flow dropdown must not survive a navigation-style switch with
  // stale state; the menu unmounts but the flag would reopen it on return.
  useEffect(() => {
    setNavigationOpen(false);
  }, [settings.navigationStyle]);

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
        toast.show(res.message, { variant: "success" });
        refetch();
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }
  );

  const [beaconFeedback, setBeaconFeedback] = useState<string | null>(null);
  const [showEnvelope, setShowEnvelope] = useState<boolean>(false);

  const { data: agentData, isLoading: isAgentLoading } = useAutoRefreshQuery(
    demoAgentIdentityContract,
    EMPTY_PARAMS,
    { defaultRate: "5s" }
  );
  const agentIdentity = agentData?.identity ?? null;

  const { mutate: setBeacon, isPending: isBeaconSetPending } = useRpcMutation(
    demoBeaconSetContract,
    {
      onSuccess: (res) => {
        triggerHaptic("success");
        setBeaconFeedback(res.message);
        toast.show(res.message, { variant: "success" });
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }
  );

  const { mutate: blinkBeacon, isPending: isBeaconBlinkPending } = useRpcMutation(
    demoBeaconBlinkContract,
    {
      onSuccess: (res) => {
        triggerHaptic("success");
        setBeaconFeedback(res.message);
        toast.show(res.message, { variant: "success" });
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }
  );

  const { mutate: clearBeacon, isPending: isBeaconClearPending } = useRpcMutation(
    demoBeaconClearContract,
    {
      onSuccess: (res) => {
        triggerHaptic("light");
        setBeaconFeedback(res.message);
        toast.show(res.message, { variant: "info" });
      },
      onError: (err) => {
        toast.error(err.message);
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
      <View style={{ flex: 1, minHeight: 0, width: "100%" }}>
        <ModalBody
        header={
          settings.navigationStyle === "dropdown" ? (
            // Dropdown navigation is composed from helper primitives: the
            // helper has no Select/menu primitive, so Collapsible provides the
            // disclosure header and Button rows make the options selectable.
            <Collapsible
              title={showcaseTabs.find((tab) => tab.id === activeTab)?.label ?? activeTab}
              icon="Sliders"
              isExpanded={navigationOpen}
              onToggle={(expanded) => {
                triggerHaptic("light");
                setNavigationOpen(expanded);
              }}
              style={{ width: "100%", marginTop: 10 }}
            >
              <ActionBar direction="column" align="flex-start" style={{ marginTop: 0, gap: 4 }}>
                {showcaseTabs.map((tab) => (
                  <Button
                    key={tab.id}
                    label={tab.label}
                    size="sm"
                    variant={tab.id === activeTab ? "primary" : "ghost"}
                    accessibilityLabel={`Show ${tab.label}`}
                    style={{ width: "100%" }}
                    onPress={() => {
                      triggerHaptic("light");
                      setActiveTab(tab.id);
                      setNavigationOpen(false);
                    }}
                  />
                ))}
              </ActionBar>
            </Collapsible>
          ) : (
            <Tabs
              tabs={showcaseTabs}
              activeTab={activeTab}
              onTabChange={(tab) => {
                triggerHaptic("light");
                setActiveTab(tab);
              }}
              mode="scroll"
            />
          )
        }
        headerMode={resolveDemoHeaderMode(settings.navigationStyle)}
        headerStyle={{
          backgroundColor: colors.surface0,
          paddingHorizontal: 12,
          paddingTop: 12,
          paddingBottom: 6,
        }}
        refreshing={isLoading}
        onRefresh={async () => {
          triggerHaptic("light");
          setNavigationOpen(false);
          await refetch();
        }}
      >
      {/* Top Banner Card */}
      <Card variant="elevated">
        <Card.Header
          title="Helper Showcase"
          subtitle="v0.2 UI Design System & Daemon Primitives"
          badge={<Badge variant="accent" label={`Polling ${rate}`} />}
        />

        {/* Refresh Interval Selector */}
        <FormRow label="Auto Refresh" description={`Polling ${rate}`}>
          <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
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
          </ActionBar>
        </FormRow>
      </Card>

      {/* TAB 1: GAUGES & HARDWARE */}
      {activeTab === "gauges" && (
        <>
          <Card variant="elevated">
            <Card.Header title="Metric Gauges" />
            <ActionBar align="center" direction="row" style={{ marginTop: 0 }}>
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
            </ActionBar>
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
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
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
              </ActionBar>
            </FormRow>

            {/* Information Density Selector */}
            <FormRow
              label="Layout Density"
              description={`Active density: "${settings.flairDensity}"`}
            >
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
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
              </ActionBar>
            </FormRow>

            {/* Surface Styling Selector */}
            <FormRow
              label="Surface Treatment"
              description={`Active surface: "${settings.flairSurface}"`}
            >
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
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
              </ActionBar>
            </FormRow>

            {/* Border Width Stepper / Selector */}
            <FormRow
              label="Border Width"
              description={`Container outline stroke: ${settings.flairBorderWidth}px`}
            >
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
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
              </ActionBar>
            </FormRow>

            {/* Brand Accent Color Swatches */}
            <FormRow
              label="Brand Accent Color"
              description={`Current accent: ${settings.flairAccentColor}`}
            >
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
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
                    <Button
                      key={swatch.color}
                      size="sm"
                      accessibilityLabel={`Select ${swatch.label} accent color`}
                      onPress={() => {
                        triggerHaptic("light");
                        updateSettings({ flairAccentColor: swatch.color });
                      }}
                      style={{
                        backgroundColor: swatch.color,
                        borderColor: isSelected ? colors.foreground : "transparent",
                        borderWidth: 2,
                        borderRadius: 9999,
                        width: touchTargetMin,
                        height: touchTargetMin,
                        minWidth: touchTargetMin,
                        minHeight: touchTargetMin,
                        paddingHorizontal: 0,
                        paddingVertical: 0,
                      }}
                    />
                  );
                })}
              </ActionBar>
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
                        // Raw View/Text: DataTable column render slots have no
                        // helper cell-text primitive, so this composite stays local.
                        <View>
                          <Text style={[{ color: colors.foreground, ...typography.bodyStrong }]}>
                            {item.name}
                          </Text>
                          <Text style={[{ color: colors.foregroundMuted, ...typography.caption }]}>
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
                        <Text style={[{ color: colors.foreground, ...typography.bodyStrong }]}>
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
                        // Raw View/Text: DataTable column render slots have no
                        // helper cell-text primitive, so this composite stays local.
                        <View>
                          <Text style={[{ color: colors.foreground, ...typography.bodyStrong }]}>
                            {item.name}
                          </Text>
                          <Text style={[{ color: colors.foregroundMuted, ...typography.caption }]}>
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
                        <Text style={[{ color: colors.foreground, ...typography.bodyStrong }]}>
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
              <Text style={{ color: colors.statusSuccess, ...typography.bodyStrong, marginTop: 6 }}>
                {actionFeedback}
              </Text>
            ) : null}
          </Card>

          <Card variant="elevated">
            <Card.Header title="Sample Code Block" />
            <CodeBlock
              language="typescript"
              code={`import { createPluginPill, MetricGauge } from "./vendor/paseo-plugin-helper/index";\n\n// Renders circular ring\n<MetricGauge value={75} label="CPU Load" />`}
              copyable
            />
          </Card>
        </>
      )}

      {/* TAB: ATTENTION & BEACONS */}
      {activeTab === "attention" && (
        <>
          <Card variant="elevated">
            <Card.Header
              title="Workspace Beacon"
              subtitle="Live workspace-row status ticker driven by createWorkspaceBeacon()"
            />
            {/* Raw Text: the helper has no standalone caption/paragraph
                primitive, so explanatory copy stays local and uses typography. */}
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, marginTop: 8 }}>
              Targets this workspace ({workspaceId}). Watch the workspace row chip and title while
              triggering.
            </Text>
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <Button
                label={isBeaconSetPending ? "Setting..." : "Set Status Beacon"}
                variant="primary"
                size="sm"
                onPress={() => {
                  triggerHaptic("medium");
                  setBeacon({ workspaceId, name: "DEMO:ACTIVE", color: "sky" });
                }}
              />
              <Button
                label={isBeaconBlinkPending ? "Blinking..." : "Blink Beacon (5 rounds)"}
                variant="secondary"
                size="sm"
                onPress={() => {
                  triggerHaptic("medium");
                  blinkBeacon({ workspaceId, rounds: 5 });
                }}
              />
              <Button
                label={isBeaconClearPending ? "Clearing..." : "Clear Beacon"}
                variant="ghost"
                size="sm"
                onPress={() => {
                  triggerHaptic("light");
                  clearBeacon({ workspaceId, name: "DEMO:ACTIVE" });
                }}
              />
            </ActionBar>
            {beaconFeedback ? (
              <Text style={{ color: colors.statusSuccess, ...typography.bodyStrong, marginTop: 6 }}>
                {beaconFeedback}
              </Text>
            ) : null}
          </Card>

          <Card variant="elevated">
            <Card.Header
              title="Attention Playground"
              subtitle="Live toggles for beacon animation, mode, and tone"
            />
            <FormRow
              label="Attention Active"
              description={attentionOn ? "Beacons animating" : "Static wrappers (reduced-motion safe)"}
            >
              <Toggle
                value={attentionOn}
                onValueChange={(val) => {
                  triggerHaptic("light");
                  setAttentionOn(val);
                }}
              />
            </FormRow>

            <FormRow
              label="Beacon Mode"
              description={`Active mode: "${beaconMode}"`}
            >
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
                {(["radar", "glow", "badge", "bounce"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    label={m}
                    variant={beaconMode === m ? "primary" : "ghost"}
                    onPress={() => {
                      triggerHaptic("light");
                      setBeaconMode(m);
                    }}
                  />
                ))}
              </ActionBar>
            </FormRow>

            <FormRow
              label="Beacon Tone"
              description={`Active tone token: "${beaconTone === "warning" ? "statusWarning" : beaconTone}"`}
            >
              <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
                {(
                  [
                    { token: "statusWarning", tone: "warning" },
                    { token: "accent", tone: "accent" },
                    { token: "statusDanger", tone: "danger" },
                  ] as const
                ).map(({ token, tone }) => (
                  <Button
                    key={token}
                    size="sm"
                    label={token}
                    variant={beaconTone === tone ? "primary" : "ghost"}
                    onPress={() => {
                      triggerHaptic("light");
                      setBeaconTone(tone);
                    }}
                  />
                ))}
              </ActionBar>
            </FormRow>
          </Card>

          <Card variant="elevated">
            <Card.Header
              title="Button attention prop"
              subtitle="Direct attention across button variants"
            />
            <SectionHeader title="Primary" />
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <Button label="Radar" variant="primary" size="sm" attention={attentionOn ? "radar" : undefined} />
              <Button label="Glow" variant="primary" size="sm" attention={attentionOn ? "glow" : undefined} />
              <Button label="Bounce" variant="primary" size="sm" attention={attentionOn ? "bounce" : undefined} />
            </ActionBar>
            <SectionHeader title="Danger" />
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <Button label="Radar" variant="danger" size="sm" attention={attentionOn ? "radar" : undefined} />
              <Button label="Glow" variant="danger" size="sm" attention={attentionOn ? "glow" : undefined} />
              <Button label="Bounce" variant="danger" size="sm" attention={attentionOn ? "bounce" : undefined} />
            </ActionBar>
            <SectionHeader title="Secondary / Ghost" />
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <Button label="Radar" variant="secondary" size="sm" attention={attentionOn ? "radar" : undefined} />
              <Button label="Default (true)" variant="ghost" size="sm" attention={attentionOn ? true : undefined} />
            </ActionBar>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, marginTop: 8 }}>
              Button accepts boolean | radar | glow | bounce. badge and ring are wrapper-only via AttentionBeacon.
            </Text>
          </Card>

          <Card variant="elevated">
            <Card.Header
              title="Beacon Wrappers"
              subtitle="AttentionBeacon around arbitrary components (playground-driven)"
            />
            <AttentionBeacon mode={beaconMode} tone={beaconTone} active={attentionOn}>
              <Card>
                <Card.Header
                  title="Urgent Review Required"
                  subtitle="Simulated verdict awaiting operator"
                />
                <KeyValue
                  label="Awaiting"
                  value="Command execution verdict"
                  subValue="twofado-style urgent prompt"
                />
                <ActionBar align="flex-start">
                  <Button label="Approve" variant="primary" size="sm" />
                  <Button label="Deny" variant="danger" size="sm" />
                </ActionBar>
              </Card>
            </AttentionBeacon>
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <AttentionBeacon mode={beaconMode} tone={beaconTone} active={attentionOn}>
                <Badge label="Wrapped Badge" variant="warning" />
              </AttentionBeacon>
              <AttentionBeacon mode={beaconMode} tone={beaconTone} active={attentionOn}>
                <Button
                  label={`Custom clickable (${beaconPresses})`}
                  variant="secondary"
                  size="sm"
                  accessibilityLabel="Custom beacon-wrapped clickable"
                  onPress={() => {
                    triggerHaptic("medium");
                    setBeaconPresses((n) => n + 1);
                  }}
                />
              </AttentionBeacon>
            </ActionBar>
          </Card>

          <Card variant="elevated">
            <Card.Header
              title="Mode x Tone Matrix"
              subtitle="All four modes side by side in the playground tone"
            />
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              {(["radar", "glow", "badge", "bounce"] as const).map((m) => (
                <AttentionBeacon key={m} mode={m} tone={beaconTone} active={attentionOn}>
                  <Badge label={m} variant="accent" />
                </AttentionBeacon>
              ))}
            </ActionBar>
            <SectionHeader title="Tones in playground mode" />
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              {(["warning", "accent", "danger"] as const).map((t) => (
                <AttentionBeacon key={t} mode={beaconMode} tone={t} active={attentionOn}>
                  <Badge label={t === "warning" ? "statusWarning" : t} variant={t} />
                </AttentionBeacon>
              ))}
            </ActionBar>
            <SectionHeader title="Ring alias equivalence" />
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <AttentionBeacon mode="radar" tone={beaconTone} active={attentionOn}>
                <Badge label="radar" variant="accent" />
              </AttentionBeacon>
              <AttentionBeacon mode="ring" tone={beaconTone} active={attentionOn}>
                <Badge label="ring" variant="accent" />
              </AttentionBeacon>
            </ActionBar>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, marginTop: 8 }}>
              ring normalizes to radar; both halos pulse identically.
            </Text>
            <SectionHeader title="Badge with icon" />
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, marginTop: 8 }}>
              Badge accepts string host icons and custom emoji/graphic nodes via the icon prop, plus a dot variant.
            </Text>
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <Badge icon="Bell" label="Bell Icon" variant="danger" />
              <Badge icon="Flame" label="Flame Icon" variant="warning" />
              <Badge
                icon={<Text style={{ fontSize: typography.caption.fontSize }}>🚀</Text>}
                label="Emoji Graphic"
                variant="accent"
              />
              <Badge
                icon={<Text style={{ fontSize: typography.caption.fontSize }}>⚡</Text>}
                label="Zap Graphic"
                variant="success"
              />
              <Badge dot label="Status Dot" variant="info" />
            </ActionBar>
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <AttentionBeacon mode="badge" tone="danger" active={attentionOn}>
                <Badge icon="Bell" label="Bell Icon" variant="danger" />
              </AttentionBeacon>
              <AttentionBeacon mode="badge" tone="warning" active={attentionOn}>
                <Badge icon="Flame" label="Flame Icon" variant="warning" />
              </AttentionBeacon>
              <AttentionBeacon mode="badge" tone="accent" active={attentionOn}>
                <Badge
                  icon={<Text style={{ fontSize: typography.caption.fontSize }}>🚀</Text>}
                  label="Emoji Graphic"
                  variant="accent"
                />
              </AttentionBeacon>
              <AttentionBeacon mode="badge" tone="accent" active={attentionOn}>
                <Badge
                  icon={<Text style={{ fontSize: typography.caption.fontSize }}>⚡</Text>}
                  label="Zap Graphic"
                  variant="success"
                />
              </AttentionBeacon>
              <AttentionBeacon mode="badge" tone={beaconTone} active={attentionOn}>
                <Badge dot label="Status Dot" variant="info" />
              </AttentionBeacon>
            </ActionBar>
          </Card>
        </>
      )}

      {/* TAB: SETTINGS & STORAGE */}
      {activeTab === "settings" && (
        <>
          <SharedSuiteCard />
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
            label="Navigation Style"
            description="Choose tabs or a readable dropdown for the showcase navbar"
          >
            <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
              <Button
                label="Tabs"
                size="sm"
                variant={settings.navigationStyle === "tabs" ? "primary" : "secondary"}
                onPress={() => {
                  triggerHaptic("light");
                  updateSettings({ navigationStyle: "tabs" });
                }}
              />
              <Button
                label="Dropdown"
                size="sm"
                variant={settings.navigationStyle === "dropdown" ? "primary" : "secondary"}
                onPress={() => {
                  triggerHaptic("light");
                  updateSettings({ navigationStyle: "dropdown" });
                }}
              />
            </ActionBar>
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
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
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
        </>
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
        <>
        <Card variant="elevated">
          <Card.Header
            title="Agent Identity & Session"
            subtitle="Self-inspection via getAgentIdentity()"
          />
          {isAgentLoading ? (
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, marginTop: 8 }}>
              Resolving agent identity...
            </Text>
          ) : !agentIdentity ? (
            <EmptyState
              icon="Bot"
              title="No Active Agent Session"
              description="Running outside an active agent session. Identity resolves via getAgentIdentity() when a session envelope is present."
            />
          ) : (
            <>
              <KeyValueGroup columns={isCompact ? 1 : 2}>
                <KeyValue
                  label="Active Agent ID"
                  value={agentIdentity.id ?? "—"}
                  copyable={Boolean(agentIdentity.id)}
                />
                <KeyValue
                  label="Session Name"
                  value={agentIdentity.name ?? "—"}
                  copyable={Boolean(agentIdentity.name)}
                />
                <KeyValue
                  label="Model"
                  value={agentIdentity.model ?? "—"}
                  copyable={Boolean(agentIdentity.model)}
                />
                <KeyValue
                  label="Provider"
                  value={agentIdentity.provider ?? "—"}
                  copyable={Boolean(agentIdentity.provider)}
                />
                <KeyValue
                  label="Repo"
                  value={agentIdentity.repo ?? "—"}
                  copyable={Boolean(agentIdentity.repo)}
                />
                <KeyValue
                  label="Branch"
                  value={agentIdentity.branch ?? "—"}
                  copyable={Boolean(agentIdentity.branch)}
                />
              </KeyValueGroup>
              {agentIdentity.envelopeText ? (
                <>
                  <ActionBar align="flex-start" direction="row" style={{ marginTop: 0 }}>
                    <Badge label="Audit envelope present" variant="success" />
                    <Button
                      label={showEnvelope ? "Hide Envelope" : "Inspect Envelope"}
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        triggerHaptic("light");
                        setShowEnvelope((v) => !v);
                      }}
                    />
                  </ActionBar>
                  {showEnvelope ? (
                    <CodeBlock
                      language="bash"
                      code={agentIdentity.envelopeText}
                      copyable
                    />
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </Card>
        <AboutSection
          name="Paseo Helper Demo"
          description="Interactive design system showcase and daemon runtime verification suite for paseo-plugin-helper."
          version={data?.version ?? PLUGIN_VERSION}
          author="xpufx"
          repository="https://github.com/xpufx/paseo-helper-demo"
          issues="https://github.com/xpufx/paseo-helper-demo/issues"
          license="MIT"
          extraItems={[
            { label: "Daemon Verified Port", value: `${data?.daemonPort ?? 4280}`, copyable: true },
            { label: "Host Platform", value: `${data?.platform ?? "unknown"}`, copyable: true },
            { label: "Background Uptime", value: `${Math.round(data?.uptimeSeconds ?? 0)}s` },
          ]}
        />
        </>
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

      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontFamily: "monospace" }}>
          helper-demo v{data?.version ?? PLUGIN_VERSION} (tick #{data?.backgroundTicks ?? 0})
        </Text>
      </View>
        </ModalBody>
      </View>
    </PluginThemeProvider>
  );
}

export function contributeClient(client: ComposerPillRegistrar) {
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
  return () => {
    removePill();
  };
}

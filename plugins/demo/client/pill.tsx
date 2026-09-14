import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import {
  initClientHelpers,
  type ComposerPillRegistrar,
} from "./vendor/paseo-plugin-helper/index";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });
import {
  registerComposerPill,
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
  Tabs,
  Toggle,
  FormRow,
  TextInput,
  AboutSection,
  triggerHaptic,
  usePluginTheme,
  useResponsive,
  useAutoRefreshQuery,
  useRpcMutation,
  usePluginSettings,
  type RenderModalProps,
  type RenderPillProps,
} from "./vendor/paseo-plugin-helper/index";
import { formatBytes, formatUptime } from "../shared/vendor/paseo-plugin-helper/index";
import {
  getDemoDataRpc,
  triggerDemoActionRpc,
  demoSettingsContract,
  resolveDemoHeaderMode,
} from "../shared/demo.js";
import { PLUGIN_VERSION } from "../shared/version.js";

const EMPTY_PARAMS = {};

/**
 * Responsive composer pill with a meaningful live value: the host CPU
 * reading drives both the label and the status dot, so the trackbar itself
 * demonstrates live polling without opening anything.
 */
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

type DemoTab = "metrics" | "action" | "settings" | "about";

const SHOWCASE_TABS: { id: DemoTab; label: string; shortLabel: string }[] = [
  { id: "metrics", label: "System Metrics", shortLabel: "Metrics" },
  { id: "action", label: "Run Action", shortLabel: "Action" },
  { id: "settings", label: "Plugin Settings", shortLabel: "Settings" },
  { id: "about", label: "About Plugin", shortLabel: "About" },
];

/**
 * Focused helper reference: one live pill, one metrics card, one typed RPC
 * action, one persisted settings section, and an about reference. Each tab
 * below teaches a single preferred pattern instead of cataloguing every
 * helper primitive.
 */
function DemoModal({ close }: RenderModalProps) {
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<DemoTab>("metrics");
  const [navigationOpen, setNavigationOpen] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

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

  const header =
    settings.navigationStyle === "dropdown" ? (
      <View style={styles.dropdownWrap}>
        <Pressable
          onPress={() => {
            triggerHaptic("light");
            setNavigationOpen((open) => !open);
          }}
          accessibilityLabel="Select showcase view"
          accessibilityRole="button"
          style={[
            styles.dropdownTrigger,
            { backgroundColor: colors.surface1, borderColor: colors.border },
          ]}
        >
          <Text
            style={[styles.dropdownTriggerLabel, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {SHOWCASE_TABS.find((tab) => tab.id === activeTab)?.label ?? activeTab}
          </Text>
          <Text style={[styles.dropdownChevron, { color: colors.foregroundMuted }]}>
            {navigationOpen ? "▴" : "▾"}
          </Text>
        </Pressable>
        {navigationOpen ? (
          <View
            style={[
              styles.dropdownMenu,
              { backgroundColor: colors.surface1, borderColor: colors.border },
            ]}
          >
            {SHOWCASE_TABS.map((tab) => {
              const selected = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    triggerHaptic("light");
                    setActiveTab(tab.id);
                    setNavigationOpen(false);
                  }}
                  accessibilityLabel={`Show ${tab.label}`}
                  accessibilityRole="button"
                  style={[
                    styles.dropdownItem,
                    selected && { backgroundColor: colors.surface2 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dropdownItemLabel,
                      { color: selected ? colors.accent : colors.foreground },
                      selected && styles.dropdownItemLabelActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    ) : (
      <Tabs
        tabs={SHOWCASE_TABS}
        activeTab={activeTab}
        onTabChange={(tab) => {
          triggerHaptic("light");
          setActiveTab(tab as DemoTab);
        }}
        mode="scroll"
      />
    );

  return (
    <ModalBody
      header={header}
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
        await refetch();
      }}
    >
      {activeTab === "metrics" && (
        <>
          <Card variant="elevated">
            <Card.Header
              title="Live System Snapshot"
              subtitle="Status, gauges, and refresh behavior in one card"
            />
            <View style={styles.statusRow}>
              <StatusDot variant="success" pulse={false} />
              <Text style={[styles.statusText, { color: colors.foreground }]}>
                {data?.hostname ?? "..."}
              </Text>
              <Badge label={`Polling ${rate}`} variant="accent" />
            </View>
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
            </View>
            <ProgressBar
              value={data?.memoryUsedPercent ?? 0}
              height={8}
            />
          </Card>

          <Card variant="elevated">
            <Card.Header title="Host Details" />
            <KeyValueGroup columns={isCompact ? 1 : 2}>
              <KeyValue
                label="Hostname"
                value={data?.hostname ?? "..."}
                copyable
              />
              <KeyValue
                label="Memory"
                value={
                  data
                    ? `${formatBytes(data.memoryUsedBytes, { compact: true, decimals: 1 })} / ${formatBytes(data.memoryTotalBytes)}`
                    : "..."
                }
              />
            </KeyValueGroup>
            <KeyValue
              label="Processor"
              value={data?.cpuModel ?? "..."}
              copyable
            />
            <KeyValue
              label="System Uptime"
              value={data ? formatUptime(data.uptimeSeconds) : "..."}
            />
          </Card>

          <Card variant="elevated">
            <Card.Header
              title="Refresh Behavior"
              subtitle="Pull to refresh, or pick a polling cadence"
            />
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
          </Card>
        </>
      )}

      {activeTab === "action" && (
        <Card variant="elevated">
          <Card.Header
            title="Typed RPC Action"
            subtitle="Mutation, feedback, and haptics/toast handling"
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
      )}

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
            label="Navigation Style"
            description="Choose tabs or a readable dropdown for the showcase navbar"
          >
            <View style={styles.navigationStyleOptions}>
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
            </View>
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

      {activeTab === "about" && (
        <AboutSection
          name="Paseo Helper Demo"
          description="Focused reference for building plugins with paseo-plugin-helper: live pill, metrics card, typed action, and persisted settings."
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
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  rateControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    flexWrap: "wrap",
  },
  navigationStyleOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
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
  dropdownWrap: {
    width: "100%",
    marginTop: 10,
    zIndex: 10,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: "100%",
  },
  dropdownTriggerLabel: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  dropdownChevron: {
    fontSize: 14,
    marginLeft: 8,
  },
  dropdownMenu: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 6,
    overflow: "hidden",
    width: "100%",
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: "100%",
  },
  dropdownItemLabel: {
    fontSize: 13,
  },
  dropdownItemLabelActive: {
    fontWeight: "700",
  },
});

import React, { useState } from "react";
import { View, Text } from "react-native";
import {
  usePluginSettings,
  useRpcMutation,
  useRpcQuery,
} from "paseo-plugin-helper/core";
import {
  Button,
  HostScroll,
  ModalBody,
  Row,
  StatusDot,
  Tabs,
  type TabItem,
  useHostTheme,
} from "./host-ui.js";
import {
  agentMuxClearCooldownRpc,
  agentMuxConfigRpc,
  agentMuxCooldownsRpc,
  agentMuxLogsRpc,
  agentMuxProbeRpc,
  agentMuxProfilesRpc,
  agentMuxStatusRpc,
  agentMuxToggleProfileRpc,
} from "../shared/contracts.js";
import { agentMuxSettings } from "../shared/settings.js";
import type { ProbePayload } from "../shared/types.js";
import { DashboardTab } from "./tabs/dashboard-tab.js";
import { ProfilesTab } from "./tabs/profiles-tab.js";
import { CooldownsTab } from "./tabs/cooldowns-tab.js";
import { LogsTab } from "./tabs/logs-tab.js";
import { ConfigTab } from "./tabs/config-tab.js";
import { SettingsTab } from "./tabs/settings-tab.js";

const TABS: TabItem[] = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Dash", icon: "Activity" },
  { id: "profiles", label: "Profiles", shortLabel: "Profiles", icon: "Users" },
  { id: "cooldowns", label: "Cooldowns", shortLabel: "Cooldowns", icon: "Clock" },
  { id: "logs", label: "Logs", shortLabel: "Logs", icon: "Terminal" },
  { id: "config", label: "Config", shortLabel: "Config", icon: "Sliders" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Settings" },
];

export interface AgentMuxSurfaceProps {
  onClose?: () => void;
}

export function AgentMuxSurface({ onClose }: AgentMuxSurfaceProps) {
  const { colors } = useHostTheme();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [tailDepth, setTailDepth] = useState(50);
  const [logFilter, setLogFilter] = useState("ALL");
  const [probeResults, setProbeResults] = useState<Record<string, ProbePayload>>({});

  // Plugin Settings
  const { settings, updateSettings } = usePluginSettings(agentMuxSettings);
  const refreshIntervalMs =
    settings.autoRefreshInterval > 0 ? settings.autoRefreshInterval * 1000 : false;

  // RPC Queries
  const statusQuery = useRpcQuery(
    agentMuxStatusRpc,
    {},
    {
      refetchInterval: refreshIntervalMs,
    }
  );

  const profilesQuery = useRpcQuery(
    agentMuxProfilesRpc,
    {},
    {
      enabled: activeTab === "profiles" || activeTab === "dashboard",
      refetchInterval: refreshIntervalMs,
    }
  );

  const cooldownsQuery = useRpcQuery(
    agentMuxCooldownsRpc,
    {},
    {
      enabled: activeTab === "cooldowns" || activeTab === "dashboard",
      refetchInterval: refreshIntervalMs,
    }
  );

  const logsQuery = useRpcQuery(
    agentMuxLogsRpc,
    { tail: tailDepth, filterType: logFilter },
    {
      enabled: activeTab === "logs",
      refetchInterval: refreshIntervalMs,
    }
  );

  const configQuery = useRpcQuery(
    agentMuxConfigRpc,
    {},
    {
      enabled: activeTab === "config",
    }
  );

  // Mutations
  const probeMutation = useRpcMutation(agentMuxProbeRpc, {
    onSuccess: (data) => {
      setProbeResults((prev) => ({ ...prev, [data.provider]: data }));
      statusQuery.refetch();
    },
  });

  const toggleMutation = useRpcMutation(agentMuxToggleProfileRpc, {
    onSuccess: () => {
      profilesQuery.refetch();
    },
  });

  const clearCooldownMutation = useRpcMutation(agentMuxClearCooldownRpc, {
    onSuccess: () => {
      cooldownsQuery.refetch();
      statusQuery.refetch();
    },
  });

  const handleRefresh = () => {
    statusQuery.refetch();
    if (activeTab === "profiles") profilesQuery.refetch();
    if (activeTab === "cooldowns") cooldownsQuery.refetch();
    if (activeTab === "logs") logsQuery.refetch();
    if (activeTab === "config") configQuery.refetch();
  };

  const handleProbe = (providerId: string) => {
    probeMutation.mutate({ provider: providerId });
  };

  const handleToggle = (provider: string, profile: string, enabled: boolean) => {
    toggleMutation.mutate({ provider, profile, enabled });
  };

  const handleClearCooldown = (provider?: string, profile?: string, pool?: string) => {
    clearCooldownMutation.mutate({ provider, profile, pool });
  };

  const isProbingProviderId = probeMutation.isPending
    ? (probeMutation.variables as { provider?: string })?.provider
    : null;

  const togglingKey = toggleMutation.isPending
    ? `${(toggleMutation.variables as { provider: string })?.provider}:${
        (toggleMutation.variables as { profile: string })?.profile
      }`
    : null;

  const quotaHealthVariant =
    statusQuery.data?.quotaHealth === "green"
      ? "success"
      : statusQuery.data?.quotaHealth === "yellow"
        ? "warning"
        : "danger";

  return (
    <ModalBody>
      <Row
        align="center"
        justify="space-between"
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Row align="center" gap={10}>
          <StatusDot variant={quotaHealthVariant} size="md" />
          <View>
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}>
              Agent Mux
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              Multi-Account Multiplexer & Quota Supervisor
            </Text>
          </View>
        </Row>
        <Row align="center" gap={6}>
          <Button
            label={statusQuery.isFetching ? "Refreshing..." : "Refresh"}
            size="sm"
            variant="ghost"
            disabled={statusQuery.isFetching}
            onPress={handleRefresh}
          />
          {onClose ? (
            <Button label="Close" size="sm" variant="secondary" onPress={onClose} />
          ) : null}
        </Row>
      </Row>

      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(tabId) => setActiveTab(tabId)}
      />

      <HostScroll style={{ flex: 1 }}>
        <View style={{ padding: 12 }}>
          {activeTab === "dashboard" && (
            <DashboardTab
              status={statusQuery.data}
              isLoading={statusQuery.isLoading}
              onRefresh={handleRefresh}
              onProbeProvider={handleProbe}
              onNavigateTab={(tab) => setActiveTab(tab)}
              probingProviderId={isProbingProviderId}
              probeResults={probeResults}
            />
          )}

          {activeTab === "profiles" && (
            <ProfilesTab
              profilesData={profilesQuery.data}
              isLoading={profilesQuery.isLoading}
              onRefresh={() => profilesQuery.refetch()}
              onToggleProfile={handleToggle}
              togglingKey={togglingKey}
            />
          )}

          {activeTab === "cooldowns" && (
            <CooldownsTab
              cooldownsData={cooldownsQuery.data}
              isLoading={cooldownsQuery.isLoading}
              onRefresh={() => cooldownsQuery.refetch()}
              onClearCooldown={handleClearCooldown}
              isClearing={clearCooldownMutation.isPending}
              showLiveCountdown={settings.showLiveCountdown}
            />
          )}

          {activeTab === "logs" && (
            <LogsTab
              logsData={logsQuery.data}
              isLoading={logsQuery.isLoading}
              onRefresh={() => logsQuery.refetch()}
              tailDepth={tailDepth}
              onChangeTailDepth={(depth) => setTailDepth(depth)}
              filterType={logFilter}
              onChangeFilterType={(filter) => setLogFilter(filter)}
            />
          )}

          {activeTab === "config" && (
            <ConfigTab
              configData={configQuery.data}
              isLoading={configQuery.isLoading}
              onRefresh={() => configQuery.refetch()}
            />
          )}

          {activeTab === "settings" && (
            <SettingsTab
              settings={settings}
              onUpdateSettings={updateSettings}
            />
          )}
        </View>
      </HostScroll>
    </ModalBody>
  );
}

import React from "react";
import { View, Text } from "react-native";
import type {
  PluginPopoverProps,
  PluginScreenProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import {
  Icon,
  StatusDot,
  InteractiveRow,
  Responsive,
} from "./host-ui.js";
import { useRpcQuery } from "paseo-plugin-helper/core";
import { HostThemeProvider, useFleetTheme } from "./theme.js";
import {
  uppidiAgentsContract,
  getDeterministicStateConfig,
  type UppidiAgent,
} from "../shared/contracts.js";
import { mapAgentSwitcherData } from "./agent-switcher-data.js";

/** Screen the switcher opens to hand a selection to `navigation.openAgent`. */
export const AGENT_SWITCHER_JUMP_SCREEN_ID = "uppidi-fleet-agent-switcher-jump";

export function AgentSwitcherSidebarIcon({ size, color }: { size: number; color: string }) {
  return <Icon name="RadioTower" size={size} color={color} />;
}

export interface AgentSwitcherDropdownProps {
  frontDesk: UppidiAgent | null;
  orchestratorsByRepo: Array<{ repo: string; orchestrator: UppidiAgent }>;
  onSelectAgent: (agentId: string) => void;
  close?: () => void;
}

export function AgentRowItem({
  agent,
  title,
  subtitle,
  disabled = false,
  onPress,
}: {
  agent?: UppidiAgent | null;
  title: string;
  subtitle?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const { colors, typography } = useFleetTheme();
  const stateConfig = agent
    ? getDeterministicStateConfig(agent.deterministicState, agent.category)
    : null;

  return (
    <InteractiveRow
      testID={agent?.id ? `agent-row-${agent.id}` : undefined}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hoverTint={!disabled}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,

        borderRadius: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? ` - ${subtitle}` : ""}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
        <StatusDot
          variant={stateConfig ? stateConfig.dotVariant : "neutral"}
          pulse={stateConfig ? stateConfig.pulse : false}
          size="md"
        />
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              color: disabled ? colors.foregroundMuted : colors.foreground,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{
                color: colors.foregroundMuted,
                fontSize: 11,
                marginTop: 2,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {agent?.deterministicState ? (
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
          }}
        >
          {stateConfig?.label ?? agent.status}
        </Text>
      ) : null}
    </InteractiveRow>
  );
}

export function AgentSwitcherDropdown({
  frontDesk,
  orchestratorsByRepo,
  onSelectAgent,
  close,
}: AgentSwitcherDropdownProps) {
  const { colors, typography } = useFleetTheme();

  return (
    <View
      style={{
        flexDirection: "column",
        gap: 12,
        padding: 8,
      }}
      testID="agent-switcher-dropdown"
    >
      {/* Front Desk Section */}
      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            paddingHorizontal: 4,
          }}
        >
          Front Desk
        </Text>
        {frontDesk ? (
          <AgentRowItem
            agent={frontDesk}
            title={frontDesk.name || "Front Desk"}
            subtitle={frontDesk.id}
            onPress={() => {
              onSelectAgent(frontDesk.id);
              close?.();
            }}
          />
        ) : (
          <View
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 6,
              backgroundColor: colors.surface1,
            }}
          >
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              No live Front Desk
            </Text>
          </View>
        )}
      </View>

      {/* Orchestrators Section */}
      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            paddingHorizontal: 4,
          }}
        >
          Orchestrators
        </Text>
        {orchestratorsByRepo.length > 0 ? (
          orchestratorsByRepo.map(({ repo, orchestrator }) => (
            <AgentRowItem
              key={orchestrator.id}
              agent={orchestrator}
              title={orchestrator.name || repo}
              subtitle={repo}
              onPress={() => {
                onSelectAgent(orchestrator.id);
                close?.();
              }}
            />
          ))
        ) : (
          <View
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 6,
              backgroundColor: colors.surface1,
            }}
          >
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              No orchestrators registered
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Sidebar-header entry for the switcher.
 *
 * `addHeaderButton` popovers receive `PluginButtonContentProps`, which carries
 * no `navigation`; the SDK hands `navigation` only to navigable registrations
 * (`PluginSurfaceProps`, `PluginScreenProps`, panels). This item opens the
 * dropdown through `openPopover`, and each row hands its selection to a
 * registered screen through `openScreen` — the screen is what carries
 * `navigation.openAgent`.
 */
export function AgentSwitcherSidebarItem(props: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon={AgentSwitcherSidebarIcon}
      label="Agent Switcher"
      onPress={() => props.openPopover(AgentSwitcherPopoverHost)}
    />
  );
}

function AgentSwitcherPopoverHost(props: PluginPopoverProps) {
  return (
    <HostThemeProvider theme={props.theme}>
      <AgentSwitcherPopover {...props} />
    </HostThemeProvider>
  );
}

export function AgentSwitcherPopover(props: PluginPopoverProps) {
  const { data: agentsData } = useRpcQuery(
    uppidiAgentsContract,
    {},
    { refetchInterval: 5000 },
  );

  const { frontDesk, orchestratorsByRepo } = mapAgentSwitcherData(agentsData);

  const handleSelectAgent = (agentId: string) => {
    props.openScreen({
      screenId: AGENT_SWITCHER_JUMP_SCREEN_ID,
      params: { agentId, serverId: props.host.id },
    });
  };

  const content = (
    <AgentSwitcherDropdown
      frontDesk={frontDesk}
      orchestratorsByRepo={orchestratorsByRepo}
      onSelectAgent={handleSelectAgent}
      close={props.close}
    />
  );

  return (
    <Responsive
      desktop={
        <View style={{ width: 320 }}>
          {content}
        </View>
      }
      compact={
        <View style={{ width: "100%" }}>
          {content}
        </View>
      }
      mobile={
        <View style={{ width: "100%" }}>
          {content}
        </View>
      }
    >
      <View style={{ width: 320 }}>
        {content}
      </View>
    </Responsive>
  );
}

/**
 * In-client hand-off. The popover itself cannot navigate (no `navigation`), so
 * it opens this registered screen, which receives `navigation` and forwards the
 * selection to `openAgent` on mount. The host replaces this route with the agent
 * timeline; nothing reloads the client or leaves the app.
 */
export function AgentSwitcherJumpScreen(props: PluginScreenProps) {
  const { colors } = useFleetTheme();
  const agentId = props.params.agentId;
  const openAgent = props.navigation?.openAgent;
  const didNavigate = React.useRef(false);

  React.useLayoutEffect(() => {
    if (didNavigate.current || !agentId || !openAgent) return;
    didNavigate.current = true;
    openAgent({ agentId, serverId: props.params.serverId || props.host.id });
  }, [agentId, openAgent, props.params.serverId, props.host.id]);

  return (
    <View
      testID="agent-switcher-jump"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        {openAgent ? "Opening agent…" : "In-client navigation is unavailable on this host."}
      </Text>
    </View>
  );
}

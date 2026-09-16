import React, { useState, useEffect, useMemo, useRef } from "react";
import { Text, View } from "react-native";
import type { PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import {
  useWorkspace,
  useAgent,
  useRpc,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import {
  PluginThemeProvider,
  registerComposerPill,
  type ComposerPillRegistrar,
  type PillLiveContext,
  type RegisterComposerPillOptions,
  ModalBody,
  Card,
  CardHeader,
  Button,
  Row,
  KeyValue,
  KeyValueGroup,
  ProgressBar,
  MetricGauge,
  Tabs,
  Toggle,
  Badge,
  Icon,
  AboutSection,
  CustomPillBody,
  CustomPillModalContent,
  useRpcQuery,
  usePluginSettings,
  usePluginTheme,
  getStatusColor,
  triggerHaptic,
  shouldEmitSnapshotUpdate,
  type RenderModalProps,
  type RenderPillProps,
  type KeyValueProps,
  type CardHeaderProps,
  type BadgeProps,
} from "paseo-plugin-helper/client";
import {
  formatBytes,
  formatUptime,
  resolveMetricStatus,
  type MetricThresholds,
  type CustomPillState,
} from "paseo-plugin-helper/shared";
import {
  getSystemResourcesRpc,
  topSettingsContract,
  getCustomPillsRpc,
  listCustomPillsRpc,
  runCustomPillModalCommandRpc,
  isPillEnabled,
  isProviderDependent,
  legacyFlagView,
  isMcpSurfaceEnabled,
  customPillEffectiveEnabled,
  METRIC_DEFINITIONS,
  DEFAULT_METRIC_SURFACES,
  checkboxesFromTarget,
  targetFromCheckboxes,
  type SystemResources,
  type TopSettings,
  type CustomPillStateOutput,
  type MetricId,
  type SurfaceTarget,
} from "../shared/resources";
import { PLUGIN_VERSION } from "../shared/version";
import { TopDashboardSurface } from "./surface";
import { useTopResourceQuery, useCustomPillsQuery } from "./resources-query";
import { ChoiceChips } from "./settings-ui";
import {
  buildAllLabel,
  describeSegment,
  enabledItemsForSettings,
  extractTokenMetrics,
  formatCompactTokens,
  formatSegmentIcon,
  formatSegmentLabel,
  nextCycleItem,
  type PillItemType,
  type SegmentSnapshot,
  type SegmentTone,
  type TopAgentSnapshot,
} from "./pill-labels";

const EMPTY_PARAMS = {};

function formatWorktreeLocation(dir: string | null | undefined): string {
  if (!dir) return "";
  // Check for Paseo-managed worktree: ~/.paseo/worktrees/<hash>/<slug>
  const wtMatch = dir.match(/[/\\]\.paseo[/\\]worktrees[/\\][^/\\]+[/\\]([^/\\]+)$/);
  if (wtMatch && wtMatch[1]) {
    return wtMatch[1];
  }
  const clean = dir.replace(/[/\\]+$/, "");
  const segments = clean.split(/[/\\]/);
  return segments[segments.length - 1] || clean;
}

function formatTimeAgo(isoString: string | null | undefined): string {
  if (!isoString) return "--";
  const time = new Date(isoString).getTime();
  if (isNaN(time)) return "--";
  const diffMs = Math.max(0, Date.now() - time);
  const secs = Math.floor(diffMs / 1000);
  if (secs < 30) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatIdleDuration(isoString: string | null | undefined): string {
  if (!isoString) return "--";
  const time = new Date(isoString).getTime();
  if (isNaN(time)) return "--";
  const diffMs = Math.max(0, Date.now() - time);
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const CPU_THRESHOLDS: MetricThresholds = { warning: 60, danger: 85 };
const MEM_THRESHOLDS: MetricThresholds = { warning: 70, danger: 85 };

const TABS = [
  { id: "system", label: "System", shortLabel: "System", icon: "Activity" },
  { id: "context", label: "Workspace", shortLabel: "Workspace", icon: "GitBranch" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
  { id: "about", label: "About", shortLabel: "About", icon: "Info" },
];

const TIMELINE_CADENCE_OPTIONS = Array.from({ length: 11 }, (_, n) => ({
  id: n,
  label: n === 0 ? "Never" : n === 1 ? "Every turn" : `${n}`,
}));

function getMetricColors(
  data: SystemResources | undefined,
  colors: ReturnType<typeof usePluginTheme>["colors"],
) {
  if (
    !data ||
    data.cpuUsagePercent === undefined ||
    data.memoryUsedPercent === undefined
  ) {
    return {
      cpuColor: colors.foregroundMuted,
      memColor: colors.foregroundMuted,
    };
  }

  const cpuStatus = resolveMetricStatus(data.cpuUsagePercent, CPU_THRESHOLDS);
  const memStatus = resolveMetricStatus(data.memoryUsedPercent, MEM_THRESHOLDS);

  return {
    cpuColor: getStatusColor(cpuStatus, colors),
    memColor: getStatusColor(memStatus, colors),
  };
}

// Canonical metric union lives in pill-labels (no RN imports); re-exported here
// so pill call sites keep a single import path.
export type { PillItemType } from "./pill-labels";

export type ModalTab = "system" | "context" | "settings" | "about";

export function getItemTab(item: PillItemType): "system" | "context" {
  switch (item) {
    case "cpu_ram":
    case "load":
    case "uptime":
    case "mcp":
    case "changes":
    case "tokens":
    case "tools":
    case "turns":
      return "system";
    case "branch":
    case "worktree":
    case "agent_title":
    case "agent":
    case "agent_provider":
    case "agent_activity":
    case "agent_id":
      return "context";
  }
}

const currentCycleTabByAgent = new Map<string, ModalTab>();

// The 0.8 host popover is a narrow column, so every helper text component in
// the modal path renders through these compact wrappers (2-3pt under helper
// defaults). Call-site props still win via spread order.
function CompactKeyValue(props: KeyValueProps) {
  return (
    <KeyValue
      labelStyle={styles.compactKvLabel}
      valueStyle={styles.compactKvValue}
      {...props}
    />
  );
}

function CompactCardHeader(props: CardHeaderProps) {
  return (
    <CardHeader titleStyle={styles.compactCardTitle} {...props} />
  );
}

function CompactBadge(props: BadgeProps) {
  return <Badge textStyle={styles.compactBadgeText} {...props} />;
}

interface LiveSnapshot extends SegmentSnapshot {
  workspaceDirectory?: string | null;
  updatedAt?: number;
}

/** Host resources are identical for every agent in a workspace; scope the shared fetch by directory. */
function resourceScope(directory?: string | null): string {
  return typeof directory === "string" ? directory.trim() : "";
}

const liveSnapshots = new Map<string, LiveSnapshot>();
const sharedResourceSnapshots = new Map<string, { data: SystemResources; at: number }>();
const liveSnapshotInflight = new Map<string, Promise<SystemResources | null>>();
let rpcInvoker: ((contract: any, input: any) => Promise<any>) | null = null;

export function updateLiveSnapshot(agentId: string, partial: Partial<LiveSnapshot>) {
  const prev = liveSnapshots.get(agentId) ?? {};
  const next = { ...prev, ...partial, updatedAt: Date.now() };
  liveSnapshots.set(agentId, next);
  // A mounted pill's fresh query result also fills the workspace-scoped cache,
  // so every other agent in that workspace reads it instead of fetching again.
  if (partial.data) {
    sharedResourceSnapshots.set(resourceScope(next.workspaceDirectory), {
      data: partial.data,
      at: Date.now(),
    });
  }
}

const LIVE_SNAPSHOT_TTL_MS = 2500;

/**
 * Shared full-snapshot fetch for button-host live labels.
 *
 * The snapshot is host/workspace data, and `branch` is the only per-workspace
 * field in it, so it is cached and single-flighted by workspace directory
 * rather than by agent. Keying on the agent gave every agent its own copy of
 * the same resources, so a host with N agents polled `system-resources.get`
 * N times per refresh.
 */
async function liveSnapshotFor(ctx: PillLiveContext): Promise<SegmentSnapshot> {
  const cached = liveSnapshots.get(ctx.agentId);
  const scope = resourceScope(cached?.workspaceDirectory);
  const shared = sharedResourceSnapshots.get(scope);
  let data = cached?.data ?? shared?.data;
  const sharedAge = shared ? Date.now() - shared.at : Infinity;
  try {
    if (rpcInvoker) {
      const params: Record<string, unknown> = {};
      if (cached?.workspaceDirectory) params.directory = cached.workspaceDirectory;
      let inflight = liveSnapshotInflight.get(scope);
      if (!inflight && sharedAge > LIVE_SNAPSHOT_TTL_MS) {
        inflight = (async () => {
          try {
            return (await rpcInvoker!(getSystemResourcesRpc, params)) as SystemResources | null;
          } catch {
            return null;
          } finally {
            liveSnapshotInflight.delete(scope);
          }
        })();
        liveSnapshotInflight.set(scope, inflight);
      }
      const fresh = inflight ? await inflight : null;
      if (fresh) {
        data = { ...(data ?? {}), ...fresh } as SystemResources;
        sharedResourceSnapshots.set(scope, { data: fresh, at: Date.now() });
        updateLiveSnapshot(ctx.agentId, { data });
      }
    }
  } catch {
    // Keep cached data when the live fetch fails
  }
  const worktreeLocationText =
    cached?.worktreeLocationText ??
    (cached?.workspaceDirectory ? formatWorktreeLocation(cached.workspaceDirectory) : undefined);
  return { data, agent: cached?.agent ?? null, agentId: ctx.agentId, worktreeLocationText };
}

function singleItemLabelResolver(item: PillItemType) {
  return async (ctx: PillLiveContext) => {
    const snap = await liveSnapshotFor(ctx);
    return {
      label: formatSegmentLabel(item, snap),
      icon: formatSegmentIcon(item, snap),
    };
  };
}

/**
 * Custom-pill states are host-wide (not workspace data), so they get the same
 * treatment as the resource snapshot: one TTL-cached, single-flighted fetch
 * shared by every custom pill. Resolving each pill's label used to call
 * `top.custom-pills.get` itself, so a host with N visible custom pills issued N
 * identical RPCs per label tick.
 */
const CUSTOM_PILL_TTL_MS = 3000;
let customPillCache: { pills: CustomPillStateOutput[]; at: number } | null = null;
let customPillInflight: Promise<CustomPillStateOutput[]> | null = null;

async function customPillSnapshot(): Promise<CustomPillStateOutput[]> {
  if (customPillCache && Date.now() - customPillCache.at < CUSTOM_PILL_TTL_MS) {
    return customPillCache.pills;
  }
  if (customPillInflight) return customPillInflight;
  if (!rpcInvoker) return customPillCache?.pills ?? [];
  customPillInflight = (async () => {
    try {
      const res = await rpcInvoker!(getCustomPillsRpc, EMPTY_PARAMS);
      const pills: CustomPillStateOutput[] = res?.pills ?? [];
      customPillCache = { pills, at: Date.now() };
      return pills;
    } catch {
      return customPillCache?.pills ?? [];
    } finally {
      customPillInflight = null;
    }
  })();
  return customPillInflight;
}

/**
 * Single registration path for every Top pill variant (main cycle/all pill,
 * per-metric pills, custom metric pills) so the presentation model cannot
 * diverge: all are centered surfaces with a pinned popover width. Call sites
 * only describe what is pill-specific.
 */
function registerTopPill(
  client: ComposerPillRegistrar | PluginClientContext,
  options: Omit<RegisterComposerPillOptions<ModalTab>, "presentation" | "popoverWidth"> & {
    presentation?: "popover" | "centered";
    popoverWidth?: number;
  },
) {
  return registerComposerPill<ModalTab>(client as ComposerPillRegistrar, {
    popoverWidth: 360,
    ...options,
    presentation: options.presentation ?? "centered",
  });
}

interface PillItemContentProps {
  item: PillItemType;
  data?: SystemResources;
  agent?: {
    title?: string | null;
    model?: string | null;
    provider?: string;
    status?: string;
    lastActivityAt?: string;
  } | null;
  agentId?: string;
  worktreeLocationText?: string;
  isOpen?: boolean;
}

function PillItemContent({
  item,
  data,
  agent,
  agentId,
  worktreeLocationText,
  isOpen,
}: PillItemContentProps) {
  const { colors } = usePluginTheme();
  const { cpuColor, memColor } = getMetricColors(data, colors);
  const descriptor = describeSegment(item, { data, agent, agentId, worktreeLocationText });
  const toneColor = (tone: SegmentTone): string => {
    switch (tone) {
      case "muted":
        return colors.foregroundMuted;
      case "accent":
        return colors.accent;
      case "success":
        return colors.statusSuccess;
      case "danger":
        return colors.statusDanger;
      case "warning":
        return colors.statusWarning;
      case "cpu":
        return cpuColor;
      case "mem":
        return memColor;
      default:
        return colors.foreground;
    }
  };

  return (
    <Row gap={4} align="center" style={styles.pillContainer}>
      {descriptor.iconTone !== "none" ? (
        <Icon name={descriptor.icon} size={12} color={toneColor(descriptor.iconTone)} />
      ) : null}
      <Text numberOfLines={1} style={[styles.pillText, isOpen && styles.pillTextActive]}>
        {descriptor.leading ? (
          <Text style={{ color: toneColor(descriptor.leadingTone ?? "muted"), fontWeight: "700" }}>
            {`${descriptor.leading} `}
          </Text>
        ) : null}
        {descriptor.prefix ? (
          <Text style={{ color: toneColor(descriptor.prefixTone ?? "muted") }}>
            {descriptor.prefix}
          </Text>
        ) : null}
        <Text style={{ color: toneColor(descriptor.tone), fontWeight: "600" }}>
          {descriptor.text}
        </Text>
        {descriptor.separator ? (
          <Text style={{ color: colors.foregroundMuted }}>{descriptor.separator}</Text>
        ) : null}
        {descriptor.trailing ? (
          <Text
            style={{ color: toneColor(descriptor.trailingTone ?? "foreground"), fontWeight: "600" }}
          >
            {descriptor.trailing}
          </Text>
        ) : null}
      </Text>
    </Row>
  );
}

type SettingsListener = (settings: TopSettings) => void;
const settingsListeners = new Set<SettingsListener>();
let lastNotifiedSettings: TopSettings | null = null;

export function notifySettingsChanged(settings: TopSettings) {
  if (!shouldEmitSnapshotUpdate(
    lastNotifiedSettings as unknown as Record<string, unknown> | null,
    settings as unknown as Record<string, unknown>,
  )) {
    return;
  }
  lastNotifiedSettings = settings;
  for (const listener of settingsListeners) {
    try {
      listener(settings);
    } catch {
      // Ignore listener errors
    }
  }
}

function PillOffline() {
  const { colors } = usePluginTheme();
  return (
    <Row gap={4} align="center" style={styles.pillContainer}>
      <Icon name="Ghost" size={13} color={colors.statusDanger} />
      <Text numberOfLines={1} style={[styles.pillText, { color: colors.foregroundMuted }]}>
        Offline
      </Text>
    </Row>
  );
}

function PillLoading() {
  const { colors } = usePluginTheme();
  return (
    <Text numberOfLines={1} style={[styles.pillText, { color: colors.foregroundMuted }]}>
      top...
    </Text>
  );
}

function PillEmpty() {
  const { colors } = usePluginTheme();
  return (
    <Row gap={4} align="center" style={styles.pillContainer}>
      <Icon name="Activity" size={12} color={colors.accent} />
      <Text numberOfLines={1} style={[styles.pillText, { color: colors.foregroundMuted }]}>
        top
      </Text>
    </Row>
  );
}

function McpLoadingPill() {
  const { colors } = usePluginTheme();
  return (
    <Text numberOfLines={1} style={[styles.pillText, { color: colors.foregroundMuted }]}>
      MCP…
    </Text>
  );
}

interface PillSegmentProps {
  item: PillItemType;
  data?: SystemResources;
  agent?: PillItemContentProps["agent"];
  agentId?: string;
  worktreeLocationText?: string;
  isOpen?: boolean;
}

/**
 * The composer pill body is host-pressed: legacy hosts wrap `renderPill` in
 * their own pressable and route the tap through `resolveDefaultPayload`, so the
 * segment must not nest a second interaction handler.
 */
function PillSegment({
  item,
  data,
  agent,
  agentId,
  worktreeLocationText,
  isOpen,
}: PillSegmentProps) {
  return (
    <PillItemContent
      item={item}
      data={data}
      agent={agent}
      agentId={agentId}
      worktreeLocationText={worktreeLocationText}
      isOpen={isOpen}
    />
  );
}

interface AllInOnePillProps {
  items: PillItemType[];
  data?: SystemResources;
  agent?: PillItemContentProps["agent"];
  agentId?: string;
  worktreeLocationText?: string;
  isOpen?: boolean;
}

function AllInOnePill({
  items,
  data,
  agent,
  agentId,
  worktreeLocationText,
  isOpen,
}: AllInOnePillProps) {
  const { colors } = usePluginTheme();
  return (
    <Row gap={6} align="center" style={styles.allInOneContainer}>
      {items.map((item, idx) => (
        <React.Fragment key={item}>
          {idx > 0 && (
            <Text style={[styles.dividerText, { color: colors.foregroundMuted }]}>│</Text>
          )}
          <PillSegment
            item={item}
            data={data}
            agent={agent}
            agentId={agentId}
            worktreeLocationText={worktreeLocationText}
            isOpen={isOpen}
          />
        </React.Fragment>
      ))}
    </Row>
  );
}

export interface SingleItemPillViewProps extends RenderPillProps<ModalTab> {
  item: PillItemType;
  defaultTab?: ModalTab;
}

export function SingleItemPillView({
  item,
  workspaceId,
  agentId,
  isOpen,
}: SingleItemPillViewProps) {
  const workspaceDirectory = useWorkspace(workspaceId, (w: PluginWorkspaceSnapshot) => w?.directory);
  const agent = useAgent(agentId, (a: TopAgentSnapshot) => ({
    title: a?.title,
    model: a?.model,
    provider: a?.provider,
    status: a?.status,
    lastActivityAt: a?.lastActivityAt,
    lastUsage: a?.lastUsage,
  }));

  const needsResource = useMemo(() => {
    switch (item) {
      case "cpu_ram":
      case "load":
      case "uptime":
      case "mcp":
        return true;
      case "branch":
        return Boolean(workspaceDirectory);
      default:
        return false;
    }
  }, [item, workspaceDirectory]);

  const shouldPoll = needsResource;
  const { data, isError, isLoading } = useTopResourceQuery(workspaceDirectory, {
    enabled: shouldPoll,
    staleTime: 2500,
  });

  const worktreeLocationText = useMemo(
    () => formatWorktreeLocation(workspaceDirectory),
    [workspaceDirectory],
  );

  useEffect(() => {
    updateLiveSnapshot(agentId, {
      data,
      agent,
      agentId,
      workspaceDirectory,
      worktreeLocationText,
    });
  }, [agentId, data, agent, workspaceDirectory, worktreeLocationText]);

  if (item === "mcp") {
    if (data && !data.mcpInstalled) {
      return null;
    }
    if (isLoading || !data) {
      return <McpLoadingPill />;
    }
  }

  if (shouldPoll && isError) {
    return <PillOffline />;
  }

  if (shouldPoll && (isLoading || !data)) {
    return <PillLoading />;
  }

  return (
    <PillSegment
      item={item}
      data={data}
      agent={agent}
      agentId={agentId}
      worktreeLocationText={worktreeLocationText}
      isOpen={isOpen}
    />
  );
}

function PillView({ isOpen, open, workspaceId, agentId }: RenderPillProps<ModalTab>) {
  // No background settings poll here: the hook re-verifies on mount and
  // window focus, and mutations invalidate the shared settings cache.
  // Polling from every mounted pill/modal/surface multiplied daemon reads
  // with no value change; fan-out stays guarded by notifySettingsChanged.
  const { settings, updateSettings } = usePluginSettings(topSettingsContract);
  const flags = legacyFlagView(settings);

  useEffect(() => {
    notifySettingsChanged(settings);
  }, [settings]);

  const workspaceDirectory = useWorkspace(workspaceId, (w: PluginWorkspaceSnapshot) => w?.directory);
  const agent = useAgent(agentId, (a: TopAgentSnapshot) => ({
    title: a?.title,
    model: a?.model,
    provider: a?.provider,
    status: a?.status,
    lastActivityAt: a?.lastActivityAt,
    lastUsage: a?.lastUsage,
  }));

  const hasAnyEnabled =
    flags.showCpuRam ||
    flags.showBranch ||
    flags.showWorktree ||
    flags.showAgentTitle ||
    flags.showAgent ||
    flags.showAgentProvider ||
    flags.showAgentActivity ||
    flags.showAgentId ||
    flags.showLoad ||
    flags.showUptime ||
    (flags.showMcp);

  // If no items are selected, fallback to CPU & RAM without mutating saved settings
  const effectiveShowCpuRam = flags.showCpuRam || !hasAnyEnabled;

  const shouldPoll = true;
  const { data, isError, isLoading } = useTopResourceQuery(workspaceDirectory, {
    staleTime: 2500,
  });

  const isMcpEnabled = isMcpSurfaceEnabled(settings, "pill", data?.mcpInstalled, data?.mcpRunning);

  useEffect(() => {
    const found = new Set<MetricId>();
    const live = data?.liveUsage;
    if (live && (live.inputTokens != null || live.outputTokens != null)) {
      found.add("tokens");
    }
    const last = data?.lastTurn;
    if (last && (last.inputTokens != null || last.outputTokens != null)) {
      found.add("tokens");
    }
    const agentUsage = agent?.lastUsage;
    if (
      agentUsage &&
      (agentUsage.inputTokens != null ||
        agentUsage.outputTokens != null ||
        agentUsage.contextWindowUsedTokens != null)
    ) {
      found.add("tokens");
    }
    if (agent?.model || agent?.provider) {
      found.add("agent");
      found.add("agent_provider");
    }
    if (found.size > 0) {
      const have = new Set(settings.provisionedMetrics ?? []);
      const additions = [...found].filter((id) => !have.has(id));
      if (additions.length > 0) {
        updateSettings({ provisionedMetrics: [...have, ...additions] });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.lastTurn, data?.liveUsage, agent?.model, agent?.provider, agent?.lastUsage]);

  const worktreeLocationText = useMemo(
    () => formatWorktreeLocation(workspaceDirectory),
    [workspaceDirectory],
  );

  useEffect(() => {
    updateLiveSnapshot(agentId, {
      data,
      agent,
      agentId,
      workspaceDirectory,
      worktreeLocationText,
    });
  }, [agentId, data, agent, workspaceDirectory, worktreeLocationText]);

  // Collect available items enabled by user settings (or fallback to cpu_ram).
  // Visibility is selector-only: components render placeholders when data is
  // absent, so every mode agrees on what is shown.
  const items: PillItemType[] = [];
  if (effectiveShowCpuRam) items.push("cpu_ram");
  if (flags.showBranch) items.push("branch");
  if (flags.showWorktree) items.push("worktree");
  if (flags.showAgentTitle) items.push("agent_title");
  if (flags.showAgent) items.push("agent");
  if (flags.showAgentProvider) items.push("agent_provider");
  if (flags.showAgentActivity) items.push("agent_activity");
  if (flags.showAgentId) items.push("agent_id");
  if (flags.showLoad) items.push("load");
  if (flags.showUptime) items.push("uptime");
  if (isMcpEnabled) items.push("mcp");
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.changes)) {
    items.push("changes");
  }
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.tokens)) {
    items.push("tokens");
  }
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.tools)) {
    items.push("tools");
  }
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.turns)) {
    items.push("turns");
  }

  // Legacy render fallback only. On the supported 0.8 host the pill is
  // host-rendered from `resolveLabel`, which advances the cycle on the shared
  // visibility-gated timer; a per-agent React interval here duplicated that
  // ticker with no RPC value.
  const activeMode = items.length > 0 ? items[0] : "cpu_ram";

  useEffect(() => {
    currentCycleTabByAgent.set(agentId, getItemTab(activeMode));
    return () => {
      currentCycleTabByAgent.delete(agentId);
    };
  }, [agentId, activeMode]);

  if (shouldPoll && isError) {
    return <PillOffline />;
  }

  if (shouldPoll && (isLoading || !data)) {
    return <PillLoading />;
  }

  if (items.length === 0) {
    return <PillEmpty />;
  }

  if (settings.pillMode === "all") {
    return (
      <AllInOnePill
        items={items}
        data={data}
        agent={agent}
        agentId={agentId}
        worktreeLocationText={worktreeLocationText}
        isOpen={isOpen}
      />
    );
  }

  return (
    <PillSegment
      item={activeMode}
      data={data}
      agent={agent}
      agentId={agentId}
      worktreeLocationText={worktreeLocationText}
      isOpen={isOpen}
    />
  );
}

interface ResourceModalProps extends RenderModalProps<ModalTab> {
  initialTab?: ModalTab;
}

function MetricSurfaceMatrix({
  settings,
  updateSettings,
  notifySettingsChanged,
  mcpInstalled,
  mcpRunning,
  customPills,
  customOverrides,
  onCustomToggle,
}: {
  settings: TopSettings;
  updateSettings: (updates: Partial<TopSettings>) => void;
  notifySettingsChanged: (s: TopSettings) => void;
  mcpInstalled: boolean;
  mcpRunning?: boolean | null;
  customPills: Array<{ id: string; title: string; sourceFile?: string; enabled: boolean }>;
  customOverrides: Record<string, boolean> | undefined;
  onCustomToggle: (id: string, val: boolean) => void;
}) {
  const { colors, isCompact } = usePluginTheme();
  const surfaces = settings.metricSurfaces ?? DEFAULT_METRIC_SURFACES;
  const provisioned = new Set(settings.provisionedMetrics ?? []);
  const matrixRowMinHeight = isCompact ? 44 : 32;
  const setTarget = (id: MetricId, target: SurfaceTarget) => {
    const next = { ...surfaces, [id]: target };
    const s = { ...settings, metricSurfaces: next };
    updateSettings({ metricSurfaces: next });
    notifySettingsChanged(s);
  };
  return (
    <View style={[styles.metricMatrix, isCompact && styles.metricMatrixCompact]}>
      <View style={[styles.metricMatrixHeader, isCompact && styles.metricMatrixHeaderCompact]}>
        <Text style={[styles.metricMatrixHeaderText, { color: colors.foregroundMuted }]}>
          Metric
        </Text>
        <View style={[styles.metricMatrixTargetHeader, isCompact && styles.metricMatrixTargetHeaderCompact]}>
          <Text style={[styles.metricMatrixHeaderText, { color: colors.foregroundMuted }]}>
            Pill
          </Text>
          <Text style={[styles.metricMatrixHeaderText, { color: colors.foregroundMuted }]}>
            Timeline
          </Text>
        </View>
      </View>
      {METRIC_DEFINITIONS.map((def, index) => {
        const boxes = checkboxesFromTarget(surfaces[def.id]);
        const unprovisioned =
          isProviderDependent(def.id) && !provisioned.has(def.id);
        const timelineDisabled = !!def.pillOnly;
        const disabled = def.id === "mcp" && !mcpInstalled;
        const note =
          def.pillOnly
            ? "live only"
            : def.id === "mcp" && !mcpInstalled
              ? "mcp-tools not installed"
              : def.id === "mcp" && mcpRunning === false
                ? "mcp-tools disabled"
                : unprovisioned
                  ? "waiting for provider"
                  : null;
        const setBox = (which: "pill" | "timeline", val: boolean) => {
          const nextBoxes = { ...boxes, [which]: val };
          if (def.pillOnly) nextBoxes.timeline = false;
          setTarget(
            def.id,
            targetFromCheckboxes(nextBoxes.pill, nextBoxes.timeline),
          );
        };
        return (
          <View
            key={def.id}
            style={[
              styles.metricMatrixRow,
              isCompact && styles.metricMatrixRowCompact,
              { minHeight: matrixRowMinHeight },
              index < METRIC_DEFINITIONS.length - 1
                ? {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }
                : undefined,
            ]}
          >
            <View style={styles.metricMatrixLabel}>
              <Text style={[styles.metricMatrixTitle, { color: colors.foreground }]}>
                {def.title}
              </Text>
              {note ? (
                <Text style={[styles.metricMatrixNote, { color: colors.foregroundMuted }]}>
                  {note}
                </Text>
              ) : null}
            </View>
            <View style={[styles.metricMatrixTargets, isCompact && styles.metricMatrixTargetsCompact]}>
              <Toggle
                value={boxes.pill}
                disabled={disabled}
                onValueChange={(val) => setBox("pill", val)}
                style={styles.matrixToggle}
              />
              <Toggle
                value={boxes.timeline && !def.pillOnly}
                disabled={disabled || timelineDisabled}
                onValueChange={(val) => setBox("timeline", val)}
                style={styles.matrixToggle}
              />
            </View>
          </View>
        );
      })}
      {customPills.map((pill) => {
        const masterOn = settings.showCustomPills ?? true;
        const enabled = customPillEffectiveEnabled(masterOn, customOverrides, pill);
        return (
          <View
            key={`custom-${pill.id}`}
            style={styles.metricMatrixRow}
          >
            <View style={styles.metricMatrixLabel}>
              <Text style={[styles.metricMatrixTitle, { color: colors.foreground }]}>
                {pill.title}
              </Text>
              <Text style={[styles.metricMatrixNote, { color: colors.foregroundMuted }]}>
                custom pill
              </Text>
            </View>
            <View style={[styles.metricMatrixTargets, isCompact && styles.metricMatrixTargetsCompact]}>
              <Toggle
                value={enabled}
                disabled={!masterOn}
                onValueChange={(val) => onCustomToggle(pill.id, val)}
                style={styles.matrixToggle}
              />
              <Toggle
                value={false}
                disabled={true}
                onValueChange={() => {}}
                style={styles.matrixToggle}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ResourceModal({ theme, workspaceId, agentId, initialTab, payload }: ResourceModalProps) {
  const { colors, padding } = usePluginTheme();
  // Settings re-verify on mount/focus via hook defaults; the settings tab
  // refetches explicitly below. No background poll: the modal only lives
  // while open. Custom-pill definitions are a separate data source and keep
  // their own lightweight poll while the modal is mounted.
  const { settings, updateSettings, resetSettings, refetch: refetchSettings } = usePluginSettings(
    topSettingsContract,
  );
  const { data: customPillList } = useRpcQuery(listCustomPillsRpc, EMPTY_PARAMS, {
    refetchInterval: 5000,
  });
  const flags = legacyFlagView(settings);
  const [selectedTab, setSelectedTab] = useState<ModalTab | null>(null);
  const activeTab = selectedTab ?? payload ?? initialTab ?? settings.defaultTab ?? "system";

  useEffect(() => {
    if (payload) {
      setSelectedTab(payload);
    }
  }, [payload]);

  // Ensure freshest settings are fetched whenever user views settings
  useEffect(() => {
    if (activeTab === "settings") {
      void refetchSettings();
    }
  }, [activeTab, refetchSettings]);

  const workspace = useWorkspace(workspaceId, (w: PluginWorkspaceSnapshot) => ({
    name: w?.name,
    title: w?.title,
    projectDisplayName: w?.projectDisplayName,
    directory: w?.directory,
    kind: w?.kind,
    status: w?.status,
    statusEnteredAt: w?.statusEnteredAt,
    diffStat: w?.diffStat,
  }));

  const agent = useAgent(agentId, (a: TopAgentSnapshot) => ({
    title: a?.title,
    model: a?.model,
    provider: a?.provider,
    status: a?.status,
    cwd: a?.cwd,
    lastActivityAt: a?.lastActivityAt,
    lastUsage: a?.lastUsage,
  }));

  const { data, isError, error, isLoading, isRefetching, refetch } = useTopResourceQuery(
    workspace?.directory,
  );

  const tokenMetrics = useMemo(() => {
    return extractTokenMetrics({ data, agent });
  }, [data, agent]);

  const contextPercent = useMemo(() => {
    if (!tokenMetrics?.contextMaxTokens || tokenMetrics.contextMaxTokens <= 0) return null;
    return Math.round(((tokenMetrics.contextUsedTokens ?? 0) / tokenMetrics.contextMaxTokens) * 100);
  }, [tokenMetrics]);

  const isMcpEnabled = isMcpSurfaceEnabled(settings, "pill", data?.mcpInstalled, data?.mcpRunning);

  useEffect(() => {
    updateLiveSnapshot(agentId, {
      data,
      agent,
      agentId,
      workspaceDirectory: workspace?.directory,
      worktreeLocationText: workspace?.directory
        ? formatWorktreeLocation(workspace.directory)
        : undefined,
    });
  }, [agentId, data, agent, workspace?.directory]);

  const hasAnyPillEnabled =
    flags.showCpuRam ||
    flags.showBranch ||
    flags.showWorktree ||
    flags.showAgentTitle ||
    flags.showAgent ||
    flags.showAgentProvider ||
    flags.showAgentActivity ||
    flags.showAgentId ||
    flags.showLoad ||
    flags.showUptime ||
    isMcpEnabled;

  const handleRefresh = () => {
    triggerHaptic("light");
    refetch();
    void refetchSettings();
  };

  const handleTabChange = (tabId: string) => {
    triggerHaptic("light");
    setSelectedTab(tabId as ModalTab);
  };

  const navbar = (
    <Tabs
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={handleTabChange}
    />
  );
  const navbarStyle = {
    backgroundColor: colors.surface0,
    paddingHorizontal: padding.horizontal,
    paddingTop: padding.vertical,
    paddingBottom: Math.round(padding.gap / 2),
  };

  if (isError && !data) {
    return (
      <ModalBody
        style={{ backgroundColor: colors.surface0 }}
        headerMode="pinned"
        refreshing={isRefetching}
        onRefresh={handleRefresh}
        header={navbar}
        headerStyle={navbarStyle}
        contentContainerStyle={[{ paddingTop: Math.round(padding.gap / 2) }]}
      >
        <Card variant="elevated">
          <View style={styles.errorBox}>
            <Icon name="Ghost" size={24} color={colors.statusDanger} />
            <Text style={[styles.errorText, { color: colors.statusDanger }]}>
              {error instanceof Error ? error.message : "Failed to load metrics"}
            </Text>
          </View>
        </Card>
      </ModalBody>
    );
  }

  const { cpuColor, memColor } = getMetricColors(data, colors);

  return (
    <ModalBody
      style={{ backgroundColor: colors.surface0 }}
      headerMode="pinned"
      refreshing={isLoading || isRefetching}
      onRefresh={handleRefresh}
      header={navbar}
      headerStyle={navbarStyle}
      contentContainerStyle={[
        { paddingTop: Math.round(padding.gap / 2) },
      ]}
    >
      {activeTab === "system" && (
      <>
        {/* Dual Metric Gauges Hero */}
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

        {/* Host Meta Card */}
        <Card variant="elevated">
          <KeyValueGroup columns={1}>
            <CompactKeyValue label="Host" value={data?.hostname ?? "Unknown"} copyable />
            <CompactKeyValue
              label="Uptime"
              value={data?.uptimeSeconds ? formatUptime(data?.uptimeSeconds) : "--"}
            />
          </KeyValueGroup>
          <CompactKeyValue
            label="Processor"
            value={data?.cpuModel ?? "--"}
            subValue={data?.cpuCores ? `(${data?.cpuCores} cores)` : undefined}
          />
        </Card>

        {/* CPU Utilization Card */}
        <Card variant="elevated">
          <CompactCardHeader
            title="CPU Details"
            value={
              <Text style={[styles.metricHighlight, { color: cpuColor }]}>
                {data?.cpuUsagePercent ?? 0}%
              </Text>
            }
          />

          <ProgressBar
            value={data?.cpuUsagePercent ?? 0}
            thresholds={CPU_THRESHOLDS}
            height={8}
          />

          <CompactKeyValue
            label="Load Average (1m, 5m, 15m)"
            value={data?.loadAvg ? data?.loadAvg.map((n) => n.toFixed(2)).join("  ") : "--  --  --"}
            mono
          />
        </Card>

        {/* Memory Card */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Memory Details"
            value={
              <Text style={[styles.metricHighlight, { color: memColor }]}>
                {data?.memoryUsedPercent ?? 0}%
              </Text>
            }
          />

          <ProgressBar
            value={data?.memoryUsedPercent ?? 0}
            thresholds={MEM_THRESHOLDS}
            height={8}
          />

          <CompactKeyValue
            label="Used / Total"
            value={`${formatBytes(data?.memoryUsedBytes ?? 0)} / ${formatBytes(data?.memoryTotalBytes ?? 0)}`}
          />
        </Card>

        {/* MCP Servers Card */}
        {Boolean(data?.mcpInstalled) && (
          <Card variant="elevated">
            <CompactCardHeader
              title="MCP Servers"
              subtitle="Source: paseo-mcp-tools"
              icon="Server"
              value={
                data?.mcp ? (
                  <CompactBadge
                    label={data?.mcp.isStale ? "Stale Snapshot" : "Live"}
                    variant={data?.mcp.isStale ? "warning" : "success"}
                    dot
                  />
                ) : (
                  <CompactBadge label="No Data" variant="neutral" />
                )
              }
            />

            {data?.mcp ? (
              <>
                <KeyValueGroup columns={1}>
                  <CompactKeyValue
                    label="Health"
                    value={`${data?.mcp.healthy} healthy / ${data?.mcp.total} total`}
                  />
                  <CompactKeyValue
                    label="Snapshot Updated"
                    value={formatTimeAgo(data?.mcp.updatedAt)}
                  />
                  <CompactKeyValue
                    label="Data Provider"
                    value="paseo-mcp-tools"
                  />
                </KeyValueGroup>

                {data?.mcp.servers && data?.mcp.servers.length > 0 ? (
                  <View style={styles.mcpList}>
                    {data?.mcp.servers.map((srv) => {
                      const badgeVariant: "success" | "warning" | "danger" | "neutral" =
                        srv.status === "healthy"
                          ? "success"
                          : srv.status === "degraded"
                            ? "warning"
                            : srv.status === "down"
                              ? "danger"
                              : "neutral";
                      return (
                        <View key={srv.name} style={styles.mcpRow}>
                          <View style={styles.mcpInfo}>
                            <Text
                              numberOfLines={1}
                              style={[styles.mcpName, { color: colors.foreground }]}
                            >
                              {srv.name}
                            </Text>
                            <Text style={[styles.mcpLatency, { color: colors.foregroundMuted }]}>
                              {srv.latencyMs >= 0 ? `${srv.latencyMs}ms` : "timeout"}
                            </Text>
                          </View>
                          <CompactBadge label={srv.status} variant={badgeVariant} />
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={[styles.mcpEmpty, { color: colors.foregroundMuted }]}>
                    No MCP servers configured
                  </Text>
                )}
              </>
            ) : (
              <Text style={[styles.mcpEmpty, { color: colors.foregroundMuted }]}>
                Waiting for status snapshot from paseo-mcp-tools...
              </Text>
            )}
          </Card>
        )}

        {/* Custom Metric Pills Card */}
        {Boolean(data?.customPills && data?.customPills.length > 0) && (
          <Card variant="elevated">
            <CompactCardHeader
              title="Custom Metric Pills"
              subtitle="Discovered from ~/.paseo/top/pills"
              icon="Sliders"
              value={
                <CompactBadge
                  label={`${data?.customPills?.length ?? 0} active`}
                  variant="accent"
                />
              }
            />
            <KeyValueGroup columns={1}>
              {(data?.customPills ?? []).map((cp) => (
                <CompactKeyValue
                  key={cp.id}
                  label={cp.title}
                  value={cp.displayValue}
                  subValue={cp.status !== "neutral" ? `(${cp.status})` : undefined}
                />
              ))}
            </KeyValueGroup>
          </Card>
        )}
      </>
    )}

    {activeTab === "context" && (
      <>
        {/* Workspace Information */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Workspace & Git"
            icon="GitBranch"
            value={
              workspace?.status ? (
                <CompactBadge label={workspace.status} variant="info" />
              ) : undefined
            }
          />
          <KeyValueGroup columns={1}>
            <CompactKeyValue label="Git Branch" value={data?.branch || "Unknown"} />
            <CompactKeyValue label="Kind" value={workspace?.kind || "Unknown"} />
          </KeyValueGroup>
          {workspace?.directory ? (
            <CompactKeyValue label="Worktree Location" value={workspace.directory} copyable mono />
          ) : null}
          {workspace?.name ? (
            <CompactKeyValue label="Workspace Name" value={workspace.name} />
          ) : null}
          {workspace?.title && workspace.title !== workspace.name ? (
            <CompactKeyValue label="Workspace Title" value={workspace.title} />
          ) : null}
          {workspace?.projectDisplayName ? (
            <CompactKeyValue label="Project" value={workspace.projectDisplayName} />
          ) : null}
          {workspace?.diffStat ? (
            <CompactKeyValue
              label="Git Changes"
              value={`+${workspace.diffStat.additions}  -${workspace.diffStat.deletions}`}
            />
          ) : null}
        </Card>

        {/* Agent Information */}
        <Card variant="elevated">
          <CompactCardHeader
            title={agent?.title ? `Agent: ${agent.title}` : "Agent Session"}
            icon="Bot"
            value={
              agent?.status ? (
                <CompactBadge
                  label={agent.status}
                  variant={agent.status === "running" ? "success" : "info"}
                />
              ) : undefined
            }
          />
          {agent?.title ? (
            <CompactKeyValue label="Agent Tab" value={agent.title} />
          ) : null}
          {agentId ? (
            <CompactKeyValue label="Agent ID" value={agentId} copyable mono />
          ) : null}
          <KeyValueGroup columns={1}>
            <CompactKeyValue label="Model" value={agent?.model || "Standard"} />
            <CompactKeyValue label="Provider" value={agent?.provider || "Default"} />
          </KeyValueGroup>
          <KeyValueGroup columns={1}>
            <CompactKeyValue
              label="Last Worked"
              value={
                agent?.status === "running"
                  ? "Active now"
                  : formatTimeAgo(agent?.lastActivityAt)
              }
            />
            <CompactKeyValue
              label="Inactivity"
              value={
                agent?.status === "running"
                  ? "0s (active)"
                  : formatIdleDuration(agent?.lastActivityAt)
              }
            />
          </KeyValueGroup>
          {agent?.cwd ? (
            <CompactKeyValue label="Working Directory" value={agent.cwd} copyable mono />
          ) : null}
        </Card>

        {/* Token Usage & Context Window */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Tokens & Context Window"
            icon="Coins"
            value={
              contextPercent != null ? (
                <CompactBadge
                  label={`${contextPercent}% ctx`}
                  variant={contextPercent >= 85 ? "danger" : contextPercent >= 70 ? "warning" : "success"}
                />
              ) : tokenMetrics?.totalTokens != null ? (
                <CompactBadge
                  label={`${formatCompactTokens(tokenMetrics.totalTokens)} tok`}
                  variant="neutral"
                />
              ) : undefined
            }
          />

          {tokenMetrics?.contextMaxTokens != null && tokenMetrics.contextMaxTokens > 0 ? (
            <View style={styles.contextUsageBlock}>
              <View style={styles.contextUsageRow}>
                <Text style={[styles.compactKvLabel, { color: colors.foregroundMuted }]}>Context Utilization</Text>
                <Text style={[styles.compactKvValue, { color: colors.foreground, fontWeight: "600" }]}>
                  {formatCompactTokens(tokenMetrics.contextUsedTokens ?? 0)} / {formatCompactTokens(tokenMetrics.contextMaxTokens)} ({contextPercent}%)
                </Text>
              </View>
              <ProgressBar
                value={contextPercent ?? 0}
                thresholds={{ warning: 70, danger: 85 }}
                height={8}
              />
            </View>
          ) : tokenMetrics?.contextUsedTokens != null ? (
            <CompactKeyValue
              label="Context Used"
              value={`${tokenMetrics.contextUsedTokens.toLocaleString()} (${formatCompactTokens(tokenMetrics.contextUsedTokens)})`}
            />
          ) : null}

          <KeyValueGroup columns={1}>
            <CompactKeyValue
              label="Input Tokens"
              value={tokenMetrics?.inputTokens != null ? tokenMetrics.inputTokens.toLocaleString() : "--"}
              subValue={tokenMetrics?.inputTokens != null ? formatCompactTokens(tokenMetrics.inputTokens) : undefined}
            />
            <CompactKeyValue
              label="Output Tokens"
              value={tokenMetrics?.outputTokens != null ? tokenMetrics.outputTokens.toLocaleString() : "--"}
              subValue={tokenMetrics?.outputTokens != null ? formatCompactTokens(tokenMetrics.outputTokens) : undefined}
            />
            {tokenMetrics?.cachedTokens != null && (
              <CompactKeyValue
                label="Cached Tokens"
                value={tokenMetrics.cachedTokens.toLocaleString()}
                subValue={formatCompactTokens(tokenMetrics.cachedTokens)}
              />
            )}
            {tokenMetrics?.costUsd != null && (
              <CompactKeyValue
                label="Session / Turn Cost"
                value={`$${tokenMetrics.costUsd < 0.01 ? tokenMetrics.costUsd.toFixed(4) : tokenMetrics.costUsd.toFixed(2)}`}
              />
            )}
          </KeyValueGroup>
          {!tokenMetrics && (
            <Text style={[styles.mcpEmpty, { color: colors.foregroundMuted, marginTop: 4 }]}>
              No token usage recorded for this agent session yet
            </Text>
          )}
        </Card>
      </>
    )}

    {activeTab === "settings" && (
      <>
        {/* Pill Display Mode */}
        <Card variant="elevated">
          <CompactCardHeader
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
            onChange={(nextMode) => {
              triggerHaptic("light");
              updateSettings({ pillMode: nextMode });
              notifySettingsChanged({ ...settings, pillMode: nextMode });
            }}
          />
          <View style={styles.settingsSpacer}>
            <Toggle
              label="Show Composer Pill"
              description="Hide the composer pill entirely; the dashboard stays available from the sidebar"
              style={styles.toggleFullWidth}
              value={settings.showComposerPill ?? true}
              onValueChange={(val) => {
                const next = { ...settings, showComposerPill: val };
                updateSettings({ showComposerPill: val });
                notifySettingsChanged(next);
              }}
            />
          </View>
        </Card>

        {/* Active Pill Items Selectors */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Active Pill Items"
            icon="Sliders"
            subtitle={
              !hasAnyPillEnabled
                ? "None selected -- automatically showing CPU & RAM"
                : (settings.pillMode ?? "cycle") === "multiple"
                  ? "Choose which items appear as dedicated pills"
                  : (settings.pillMode ?? "cycle") === "all"
                    ? "Choose which items appear together in the pill"
                    : "Choose which items cycle in the composer pill"
            }
          />
          <View style={styles.settingsToggles}>
            <MetricSurfaceMatrix
              settings={settings}
              updateSettings={updateSettings}
              notifySettingsChanged={notifySettingsChanged}
              mcpInstalled={Boolean(data?.mcpInstalled)}
              mcpRunning={data?.mcpRunning ?? null}
              customPills={(customPillList?.pills ?? []).map((pill) => ({
                id: pill.id,
                title: pill.title,
                sourceFile: pill.sourceFile,
                enabled: pill.enabled,
              }))}
              customOverrides={settings.customPillEnabled}
              onCustomToggle={(id, val) => {
                const next = { ...settings.customPillEnabled, [id]: val };
                const nextSettings = { ...settings, customPillEnabled: next };
                updateSettings({ customPillEnabled: next });
                notifySettingsChanged(nextSettings);
              }}
            />
          </View>
        </Card>

        {/* Custom Metric Pills */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Custom Metric Pills"
            icon="Sliders"
            subtitle="Standalone pills discovered from ~/.paseo/top/pills"
          />
          <View style={styles.settingsToggles}>
            <Toggle
              label="Show Custom Metric Pills"
              description="Display pills defined in ~/.paseo/top/pills as standalone composer pills"
              style={styles.toggleFullWidth}
              labelStyle={styles.compactToggleLabel}
              value={settings.showCustomPills ?? true}
              onValueChange={(val) => {
                const s = { ...settings, showCustomPills: val };
                updateSettings({ showCustomPills: val });
                notifySettingsChanged(s);
              }}
            />

          </View>
        </Card>

        {/* Rotation Speed Setting (Cycle mode only) */}
        {(settings.pillMode ?? "cycle") === "cycle" && (
          <Card variant="elevated">
            <CompactCardHeader
              title="Rotation Speed"
              icon="Clock"
              value={
                <Text style={[styles.accentValueText, { color: colors.accent }]}>
                  {`${settings.intervalSeconds}s`}
                </Text>
              }
            />
            <ChoiceChips
              options={[2, 3, 4, 6].map((sec) => ({ id: sec, label: `${sec}s` }))}
              value={settings.intervalSeconds}
              onChange={(intervalSeconds) => {
                triggerHaptic("light");
                updateSettings({ intervalSeconds });
              }}
            />
          </Card>
        )}

        {/* Timeline Cadence Setting */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Timeline Cadence"
            icon="Clock"
            value={
              <Text style={[styles.accentValueText, { color: colors.accent }]}>
                {(settings.timelineCadence ?? 1) === 0
                  ? "Never"
                  : (settings.timelineCadence ?? 1) === 1
                    ? "Every turn"
                    : `Every ${(settings.timelineCadence ?? 1)} turns`}
              </Text>
            }
            subtitle="How often a card is stamped into the timeline view"
          />
          <ChoiceChips
            options={TIMELINE_CADENCE_OPTIONS}
            value={settings.timelineCadence ?? 1}
            onChange={(timelineCadence) => {
              triggerHaptic("light");
              updateSettings({ timelineCadence });
              notifySettingsChanged({ ...settings, timelineCadence });
            }}
          />
          <Text style={[styles.modeDesc, styles.modeDescSpaced, { color: colors.foregroundMuted }]}>
            0 behaves as never; N above 1 stamps every Nth turn
          </Text>
        </Card>

        {/* Default Modal Tab Setting */}
        <Card variant="elevated">
          <CompactCardHeader
            title="Default Modal Tab"
            icon="Sliders"
            value={
              <Text style={[styles.accentValueText, { color: colors.accent }]}>
                {TABS.find((t) => t.id === settings.defaultTab)?.label || "System"}
              </Text>
            }
          />
          <ChoiceChips
            options={TABS.map((tab) => ({ id: tab.id as ModalTab, label: tab.label }))}
            value={settings.defaultTab ?? "system"}
            onChange={(defaultTab) => {
              triggerHaptic("light");
              updateSettings({ defaultTab });
            }}
          />
        </Card>

        <Button
          label="Reset to Defaults"
          variant="secondary"
          size="sm"
          onPress={() => {
            triggerHaptic("medium");
            resetSettings();
            notifySettingsChanged(topSettingsContract.defaultSettings);
            setSelectedTab(null);
          }}
        />
      </>
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
            value: data?.platform ? `${data?.platform} (${data?.arch ?? "unknown"})` : "Linux",
            copyable: true,
          },
          { label: "Host Name", value: data?.hostname ?? "localhost", copyable: true },
          { label: "CPU Model", value: data?.cpuModel ?? "unknown", copyable: true },
          {
            label: "CPU Cores",
            value: `${data?.cpuCores ?? 0} cores`,
          },
          {
            label: "Total Memory",
            value: data?.memoryTotalBytes ? formatBytes(data?.memoryTotalBytes) : "unknown",
          },
          {
            label: "Host Uptime",
            value: data?.uptimeSeconds ? formatUptime(data?.uptimeSeconds) : "unknown",
          },
        ]}
      />
    )}

    {/* Discrete Version Footer */}
    {activeTab !== "about" && (
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.foregroundMuted }]}>
          top v{data?.version ?? PLUGIN_VERSION}
        </Text>
      </View>
    )}
  </ModalBody>
  );
}

interface LiveCustomPillViewProps {
  pillId: string;
  initial: CustomPillState;
}

function LiveCustomPillView({ pillId, initial }: LiveCustomPillViewProps) {
  const { data } = useCustomPillsQuery();
  const liveState = data?.pills.find((p) => p.id === pillId) ?? initial;
  return <CustomPillBody state={liveState} />;
}

interface LiveCustomPillModalProps {
  pillId: string;
  initial: CustomPillStateOutput;
}

function LiveCustomPillModal({ pillId, initial }: LiveCustomPillModalProps) {
  const { colors } = usePluginTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [outputOverride, setOutputOverride] = useState<string | undefined>(undefined);
  const { data, refetch } = useCustomPillsQuery();
  const liveState = data?.pills.find((p) => p.id === pillId) ?? initial;
  const runModalCommand = useRpc(runCustomPillModalCommandRpc);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await runModalCommand({ pillId });
      if (res?.output) {
        setOutputOverride(res.output);
      }
      void refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Run the drilldown command once when the modal opens so it never shows stale pill output
  const didInitialRun = useRef(false);
  useEffect(() => {
    if (didInitialRun.current) return;
    didInitialRun.current = true;
    void handleRefresh();
  }, [pillId]);

  const effectiveState: CustomPillStateOutput = {
    ...liveState,
    modalOutput: outputOverride ?? liveState.modalOutput,
  };

  return (
    <View style={styles.modalRoot}>
      <CustomPillModalContent
        state={effectiveState}
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
      />
      <View style={styles.customPillHint}>
        <Text style={[styles.footerText, { color: colors.foregroundMuted }]}>
          Custom metric pill from paseo-top
          {effectiveState.sourceFile ? ` - defined in ${effectiveState.sourceFile}` : ""}
        </Text>
      </View>
    </View>
  );
}

// The host may mount the client contribution more than once without an
// intervening cleanup (multi-pane, StrictMode, hot reload). Pill, surface,
// and sidebar ids are global per plugin, so two live mounts double-register
// every pill and a single tap fires two openers - the modal opens in both
// locations at once. Last mount wins: mounting retires the previous mount.
let liveContributionCleanup: (() => void) | null = null;

export function contributeClient(client: ComposerPillRegistrar | PluginClientContext) {
  if (liveContributionCleanup) {
    liveContributionCleanup();
    liveContributionCleanup = null;
  }
  let cleanupSidebar: (() => void) | null = null;
  if ("addSurface" in client && "addSidebarItem" in client) {
    const removeSurface = client.addSurface("paseo-top-dashboard", (props) => (
      <PluginThemeProvider
        theme={props.theme}
        layout={props.layout}
      >
        <TopDashboardSurface {...props} />
      </PluginThemeProvider>
    ));
    const removeItem = client.addSidebarItem({
      id: "paseo-top-dashboard",
      title: "Top Dashboard",
      icon: "Activity",
      surface: "paseo-top-dashboard",
    });
    cleanupSidebar = () => {
      removeSurface();
      removeItem();
    };
  }
  const activePills = new Map<string, () => void>();
  let latestSettings: TopSettings = topSettingsContract.defaultSettings;
  let mountDisposed = false;

  function syncPills(settings: TopSettings) {
    if (mountDisposed) return;
    latestSettings = settings;
    if (settings.showComposerPill === false) {
      for (const [, cleanup] of activePills.entries()) {
        cleanup();
      }
      activePills.clear();
      return;
    }
    const flags = legacyFlagView(settings);
    const mode = settings.pillMode ?? "cycle";

    if (mode === "cycle" || mode === "all") {
      // Remove all single-item pills
      for (const [key, cleanup] of activePills.entries()) {
        if (key !== "paseo-top") {
          cleanup();
          activePills.delete(key);
        }
      }

      // Ensure main pill is registered
      if (!activePills.has("paseo-top")) {
        const cleanup = registerTopPill(client, {
          id: "paseo-top",
          title: "top",
          modalTitle: "Host System Resources",
          modalIcon: "Activity",
          icon: "Cpu",
          resolveDefaultPayload: ({ agentId }) => {
            if (latestSettings.pillMode === "all") {
              return latestSettings.defaultTab;
            }
            return currentCycleTabByAgent.get(agentId) ?? latestSettings.defaultTab;
          },
          resolveLabel: async (ctx) => {
            const snap = await liveSnapshotFor(ctx);
            const items = enabledItemsForSettings(latestSettings);
            if (items.length === 0) return { label: "top", icon: "Activity" };
            if ((latestSettings.pillMode ?? "cycle") === "all") {
              return { label: buildAllLabel(items, snap), icon: "Activity" };
            }
            const item = nextCycleItem(ctx.agentId, items);
            if (!item) return { label: "top", icon: "Activity" };
            currentCycleTabByAgent.set(ctx.agentId, getItemTab(item));
            return {
              label: formatSegmentLabel(item, snap),
              icon: formatSegmentIcon(item, snap),
            };
          },
          refreshIntervalMs: 3000,
          renderPill: (props) => <PillView {...props} />,
          renderModal: (props) => <ResourceModal {...props} />,
        });
        activePills.set("paseo-top", cleanup);
      }
    } else if (mode === "multiple") {
      // Remove main pill
      if (activePills.has("paseo-top")) {
        activePills.get("paseo-top")!();
        activePills.delete("paseo-top");
      }

      const hasAny =
        flags.showCpuRam ||
        flags.showBranch ||
        flags.showWorktree ||
        flags.showAgentTitle ||
        flags.showAgent ||
        flags.showAgentProvider ||
        flags.showAgentActivity ||
        flags.showAgentId ||
        flags.showLoad ||
        flags.showUptime;

      const effectiveCpu = flags.showCpuRam || !hasAny;

      const desiredPills: {
        id: string;
        item: PillItemType;
        title: string;
        modalTitle: string;
        defaultTab: "system" | "context";
        icon: string;
      }[] = [];

      if (effectiveCpu) {
        desiredPills.push({
          id: "paseo-top-cpu",
          item: "cpu_ram",
          icon: "Cpu",
          title: "CPU & RAM",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }
      if (flags.showBranch) {
        desiredPills.push({
          id: "paseo-top-branch",
          item: "branch",
          icon: "GitBranch",
          title: "Git Branch",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showWorktree) {
        desiredPills.push({
          id: "paseo-top-worktree",
          item: "worktree",
          icon: "FolderGit2",
          title: "Worktree",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showAgentTitle) {
        desiredPills.push({
          id: "paseo-top-agent-title",
          item: "agent_title",
          icon: "Bot",
          title: "Agent Tab",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showAgent) {
        desiredPills.push({
          id: "paseo-top-agent",
          item: "agent",
          icon: "Bot",
          title: "Agent Model",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showAgentProvider) {
        desiredPills.push({
          id: "paseo-top-agent-provider",
          item: "agent_provider",
          icon: "Sparkles",
          title: "Provider",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showAgentActivity) {
        desiredPills.push({
          id: "paseo-top-agent-activity",
          item: "agent_activity",
          icon: "Activity",
          title: "Activity",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showAgentId ?? true) {
        desiredPills.push({
          id: "paseo-top-agent-id",
          item: "agent_id",
          icon: "Hash",
          title: "Agent ID",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (flags.showLoad) {
        desiredPills.push({
          id: "paseo-top-load",
          item: "load",
          icon: "Gauge",
          title: "Load",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }
      if (flags.showUptime) {
        desiredPills.push({
          id: "paseo-top-uptime",
          item: "uptime",
          icon: "Clock",
          title: "Uptime",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }
      if (flags.showMcp) {
        desiredPills.push({
          id: "paseo-top-mcp",
          item: "mcp",
          icon: "Server",
          title: "MCP Health",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }
      if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.changes)) {
        desiredPills.push({
          id: "paseo-top-changes",
          item: "changes",
          icon: "GitCompare",
          title: "Git Changes",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }
      if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.tokens)) {
        desiredPills.push({
          id: "paseo-top-tokens",
          item: "tokens",
          icon: "Coins",
          title: "Token Usage",
          modalTitle: "Host System Resources",
          defaultTab: "context",
        });
      }
      if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.tools)) {
        desiredPills.push({
          id: "paseo-top-tools",
          item: "tools",
          icon: "Sigma",
          title: "Tool Calls",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }
      if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.turns)) {
        desiredPills.push({
          id: "paseo-top-turns",
          item: "turns",
          icon: "RotateCw",
          title: "Turn Count",
          modalTitle: "Host System Resources",
          defaultTab: "system",
        });
      }

      const desiredIds = new Set(desiredPills.map((p) => p.id));

      // Remove pills no longer desired
      for (const [key, cleanup] of activePills.entries()) {
        if (!desiredIds.has(key)) {
          cleanup();
          activePills.delete(key);
        }
      }

      // Register newly desired pills
      for (const pillDef of desiredPills) {
        if (!activePills.has(pillDef.id)) {
          const cleanup = registerTopPill(client, {
            id: pillDef.id,
            title: pillDef.title,
            modalTitle: pillDef.modalTitle,
            icon: pillDef.icon,
            modalIcon: pillDef.icon,
            resolveDefaultPayload: () => pillDef.defaultTab,
            resolveLabel: singleItemLabelResolver(pillDef.item),
            refreshIntervalMs: 5000,
            renderPill: (props) => (
              <SingleItemPillView
                item={pillDef.item}
                defaultTab={pillDef.defaultTab}
                {...props}
              />
            ),
            renderModal: (props) => (
              <ResourceModal initialTab={pillDef.defaultTab} {...props} />
            ),
          });
          activePills.set(pillDef.id, cleanup);
        }
      }
    }
  }

  // Register settings listener
  settingsListeners.add(syncPills);

  // Initial sync synchronously
  syncPills(topSettingsContract.defaultSettings);

  // Query settings from daemon if client supports rpc
  const clientWithRpc = client as {
    rpc?: (contract: any, input: any) => Promise<any>;
  };
  if (typeof clientWithRpc.rpc === "function") {
    const rawRpc = clientWithRpc.rpc.bind(clientWithRpc);
    rpcInvoker = (contract, input) => rawRpc(contract, input);
  }
  if (typeof clientWithRpc.rpc === "function") {
    void clientWithRpc
      .rpc(topSettingsContract.get, {})
      .then((fetchedSettings: any) => {
        if (mountDisposed) return;
        if (fetchedSettings) {
          syncPills(fetchedSettings as TopSettings);
        }
      })
      .catch(() => {
        // Ignore initial get errors
      });
  }

  // Dynamic discovery and lifecycle management for user custom metric pills
  const activeCustomPills = new Map<string, () => void>();

  async function syncCustomPills() {
    if (mountDisposed) return;
    if (latestSettings.showComposerPill === false) {
      for (const [id, cleanup] of activeCustomPills.entries()) {
        cleanup();
        activeCustomPills.delete(id);
      }
      return;
    }
    const showCustom = latestSettings.showCustomPills ?? true;
    if (!showCustom) {
      // Master toggle off: unregister all custom pills
      for (const [id, cleanup] of activeCustomPills.entries()) {
        cleanup();
        activeCustomPills.delete(id);
      }
      return;
    }

    try {
      if (typeof clientWithRpc.rpc !== "function") return;
      const pills = await customPillSnapshot();
      if (mountDisposed) return;
      const pillIds = new Set(pills.map((p: CustomPillStateOutput) => p.id));

      // Remove pills that are no longer configured
      for (const [id, cleanup] of activeCustomPills.entries()) {
        if (!pillIds.has(id)) {
          cleanup();
          activeCustomPills.delete(id);
        }
      }

      // Register newly discovered custom metric pills
      for (const pill of pills) {
        if (!activeCustomPills.has(pill.id)) {
          const cleanup = registerTopPill(client, {
            id: `top-custom-${pill.id}`,
            title: pill.title,
            compactTitle: pill.compactTitle,
            icon: pill.icon,
            compactIcon: pill.compactIcon,
            modalTitle: pill.modalTitle ?? pill.title,
            resolveLabel: async () => {
              const states = await customPillSnapshot();
              return (
                states.find((p: CustomPillStateOutput) => p.id === pill.id)?.displayValue ??
                pill.displayValue
              );
            },
            refreshIntervalMs: 5000,
            renderPill: () => <LiveCustomPillView pillId={pill.id} initial={pill} />,
            renderModal: () => (
              <LiveCustomPillModal pillId={pill.id} initial={pill} />
            ),
          });
          activeCustomPills.set(pill.id, cleanup);
        }
      }
    } catch {
      // Ignore initial get errors
    }
  }

  void syncCustomPills();
  // Discovery only: labels refresh through `customPillSnapshot` on the shared
  // pill timer, so this host-wide timer can be slow without stale values. It is
  // one timer per plugin contribution, independent of agent count.
  const customPillInterval = setInterval(syncCustomPills, 15000);
  const onSettingsChanged = () => {
    void syncCustomPills();
  };
  settingsListeners.add(onSettingsChanged);

  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    mountDisposed = true;
    if (cleanupSidebar) {
      cleanupSidebar();
      cleanupSidebar = null;
    }
    clearInterval(customPillInterval);
    settingsListeners.delete(syncPills);
    settingsListeners.delete(onSettingsChanged);
    for (const cleanup of activePills.values()) {
      cleanup();
    }
    activePills.clear();
    for (const cleanup of activeCustomPills.values()) {
      cleanup();
    }
    activeCustomPills.clear();
  };
  liveContributionCleanup = cleanup;
  return () => {
    if (liveContributionCleanup === cleanup) liveContributionCleanup = null;
    cleanup();
  };
}

// Residual composition styles only (no RN StyleSheet): helper Row/Stack own
// the flex layout, these are the tiny per-element text/spacing tweaks no helper
// primitive covers.
const styles = {
  modalRoot: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    overflow: "hidden",
    flexShrink: 1,
    minWidth: 0,
  },
  pillText: {
    fontSize: 11,
    flexShrink: 1,
  },
  pillTextActive: {
    opacity: 0.85,
  },
  metricHighlight: {
    fontSize: 12,
    fontWeight: "700",
  },
  compactKvLabel: {
    fontSize: 9,
  },
  compactKvValue: {
    fontSize: 10,
  },
  compactCardTitle: {
    fontSize: 11,
  },
  compactBadgeText: {
    fontSize: 9,
  },
  compactToggleLabel: {
    fontSize: 11,
  },
  footer: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  customPillHint: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 12,
  },
  footerText: {
    fontSize: 8,
    opacity: 0.65,
    fontFamily: "monospace",
  },
  errorBox: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  errorText: {
    fontSize: 11,
    fontWeight: "500",
  },
  gaugeContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 12,
    width: "100%",
    flexShrink: 1,
    minWidth: 0,
  },
  settingsToggles: {
    gap: 8,
    width: "100%",
  },
  toggleFullWidth: {
    width: "100%",
    alignSelf: "stretch",
  },
  settingsSpacer: {
    marginTop: 12,
  },
  contextUsageBlock: {
    marginVertical: 4,
  },
  contextUsageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  accentValueText: {
    fontWeight: "600",
  },
  metricMatrix: {
    gap: 0,
    width: "100%",
  },
  metricMatrixCompact: {
    minWidth: 0,
  },
  metricMatrixHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 4,
    paddingRight: 4,
    paddingBottom: 2,
  },
  metricMatrixHeaderCompact: {
    paddingLeft: 2,
    paddingRight: 2,
  },
  metricMatrixHeaderText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metricMatrixTargetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
    paddingRight: 10,
  },
  metricMatrixTargetHeaderCompact: {
    gap: 16,
    paddingRight: 8,
  },
  metricMatrixRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 4,
    paddingRight: 4,
  },
  metricMatrixRowCompact: {
    paddingLeft: 2,
    paddingRight: 2,
  },
  metricMatrixLabel: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
  },
  metricMatrixTitle: {
    fontSize: 11,
    fontWeight: "600",
  },
  metricMatrixNote: {
    fontSize: 9,
    lineHeight: 12,
    marginTop: 1,
  },
  metricMatrixTargets: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingLeft: 8,
  },
  metricMatrixTargetsCompact: {
    gap: 8,
    paddingLeft: 4,
  },
  matrixToggle: {
    width: 38,
    minHeight: 44,
  },
  allInOneContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    flexShrink: 1,
    minWidth: 0,
  },
  dividerText: {
    fontSize: 10,
    opacity: 0.6,
  },
  modeDesc: {
    fontSize: 8,
    lineHeight: 10,
  },
  modeDescSpaced: {
    marginTop: 8,
  },
  mcpList: {
    gap: 8,
    marginTop: 4,
  },
  mcpRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  mcpInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  mcpName: {
    fontSize: 11,
    fontWeight: "500",
  },
  mcpLatency: {
    fontSize: 9,
    fontFamily: "monospace",
  },
  mcpEmpty: {
    fontSize: 10,
    fontStyle: "italic",
    paddingVertical: 4,
  },
} as const;

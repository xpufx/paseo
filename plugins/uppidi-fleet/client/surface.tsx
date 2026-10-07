import React, { useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal, useToast, Icon } from "@getpaseo/plugin/client/react-native";
import {
  ActionBar,
  AttentionBeacon,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  Collapsible,
  CommandBox,
  DataTable,
  EmptyState,
  Grid,
  ForgeIcon,
  InteractiveRow,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  ModalContent,
  Row,
  SearchInput,
  Select,
  type SelectOption,
  Stack,
  StatusDot,
  Tabs,
  TextInput,
  TicketLifecycleView,
  NewIssueComposer,
} from "./host-ui.js";
import { ModalBodyScrollOwnerContext } from "paseo-plugin-helper/lifecycle";
import { useRpcQuery, useRpcMutation, usePluginSettings } from "paseo-plugin-helper/core";
import { useFleetTheme } from "./theme.js";
import { MetricsBar } from "./metrics-bar.js";
import {
  uppidiFleetSettingsContract,
  uppidiIssuesContract,
  uppidiHookStatusContract,
  uppidiHookQueuesContract,
  uppidiHookPauseContract,
  uppidiHookResumeContract,
  uppidiHookDrainContract,
  uppidiHookServiceStatusContract,
  uppidiHookServiceActionContract,
  uppidiHookConfigureContract,
  uppidiHookLogTailContract,
  uppidiAgentsContract,
  uppidiRoleModelsContract,
  uppidiSetRoleModelContract,
  uppidiFleetAlertsContract,
  uppidiSkillsContract,
  uppidiSetSkillContract,
  uppidiRunnersContract,
  uppidiFleetMetricsContract,
  uppidiArchiveAgentContract,
  uppidiArchiveInactiveAgentsContract,
  uppidiFleetTeardownContract,
  uppidiFleetResetStateContract,
  uppidiFleetHaltContract,
  uppidiFleetResumeContract,
  uppidiTransitionIssueContract,
  uppidiReposContract,
  uppidiEnrollRepoContract,
  uppidiUnenrollRepoContract,
  type UppidiRepo,
  type UppidiAgent,
  type UppidiIssue,
  type KanbanColumnId,
  type AttentionLabel,
  type RoleModelConfig,
  type FleetModelAlert,
  type FleetSkill,
  type UppidiRunner,
  type UppidiFleetStatus,
  type UppidiLocalRunner,
  type UppidiRunnerSource,
  type CandidateModelMetrics,
  type TaskProfileMetrics,
  getPendingPermissionAction,
  getPermissionAdjudicationCommand,
  getAgentAttentionReason,
  getRunnerStatusConfig,
} from "../shared/contracts.js";
import {
  filterIssues,
  sortIssues,
  filterQueues,
  sortQueues,
  filterRunners,
  sortRunners,
  filterBulkArchiveCandidates,
  filterMetricCandidates,
  sortMetricCandidates,
  isRepoMatching,
  collectAttentionAgents,
  countPermissionAgents,
  type IssuePreset,
  type IssueSortField,
  type QueuePreset,
  type QueueSortField,
  type RunnerPreset,
  type RunnerSortField,
  type MetricPreset,
  type MetricSortField,
  type SortDirection,
} from "../shared/sort-filter.js";
import {
  UppidiFleetTreeView,
  UppidiForgeTreeView,
} from "./tree-view.js";
import { UppidiFleetToolingView } from "./tooling.js";
import { UppidiFleetKanbanBoard } from "./kanban-board.js";
import { ForgeIssuesView } from "./forges-tab.js";
import { canonicalForgeUrl, resolveForgeSelection } from "./forges-tab.js";
import { canonicalRepoName, resolveCanonicalRepo } from "../shared/repo-identity.js";

export type SurfaceTab = "tree" | "dashboard" | "tooling" | "settings" | "board" | "forges";

/**
 * Narrows a possibly-partial RPC collection to an array. A truncated or legacy
 * payload can deliver a non-array where the server types promise one; mapping
 * or iterating it blanks the surface (#510).
 */
function toList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

/** Enrolled repos are plain strings; reject null/empty entries defensively. */
function toRepoList(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((r): r is string => typeof r === "string" && r.length > 0) : [];
}

const issuePresetFilters: Array<{ id: IssuePreset; label: string }> = [
  { id: "all", label: "All work" },
  { id: "needs-you", label: "Needs You" },
  { id: "needs-attention", label: "Needs Attention" },
  { id: "triage-review", label: "Triage / Review" },
  { id: "in-progress", label: "In Progress" },
  { id: "verify", label: "Verify" },
];

/**
 * Presets shown in the metrics bar that it did not already cover (#645).
 * "all", "needs-you" and "triage-review" have had their own metric chips since
 * the bar was introduced; these three only existed on the separate filter row.
 */
const EXTRA_METRIC_PRESETS: Array<{
  id: IssuePreset;
  label: string;
  icon: string;
  tone: "statusWarning" | "statusSuccess" | "statusDanger" | "accent";
}> = [
  { id: "needs-attention", label: "Needs attention", icon: "AlertCircle", tone: "statusWarning" },
  { id: "in-progress", label: "In progress", icon: "Loader", tone: "accent" },
  { id: "verify", label: "Verify", icon: "CheckCircle2", tone: "statusSuccess" },
];

const tabs = [
  { id: "tree", label: "Agents & Fleet", shortLabel: "Fleet", icon: "FolderTree" },
  { id: "dashboard", label: "Work Queue", shortLabel: "Queue", icon: "LayoutDashboard" },
  { id: "tooling", label: "Tooling", shortLabel: "Tools", icon: "Terminal" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
  { id: "board", label: "Board", shortLabel: "Board", icon: "Kanban" },
  { id: "forges", label: "Forge Issues", shortLabel: "Forges", icon: "GitPullRequest" },
];

const attentionMap: Record<AttentionLabel, string> = {
  "attention/orchestrator": "Orchestrator",
  "attention/agent": "Agent",
  "attention/user": "You",
  "attention/0-orchestrator": "Orchestrator",
  "attention/1-agent": "Agent",
  "attention/2-user": "You",
};

function statusVariant(status: UppidiIssue["status"]): "neutral" | "warning" | "info" | "success" {
  switch (status) {
    case "Review":
      return "warning";
    case "In progress":
      return "info";
    case "Done":
      return "success";
    default:
      return "neutral";
  }
}

const FLEET_STATUS_NOTICE: Record<
  Exclude<UppidiFleetStatus, "ok">,
  { message: string; variant: "warning" | "danger" }
> = {
  empty: {
    message: "Forgejo reports no registered runners — CI capacity is zero.",
    variant: "warning",
  },
  unreachable: {
    message: "Forgejo runner API unreachable — CI capacity is unknown.",
    variant: "danger",
  },
  forbidden: {
    message: "Forgejo rejected the API token — CI capacity is unknown.",
    variant: "danger",
  },
};

/**
 * States the reachability of the runner query. `empty` is an authoritative API
 * answer; `unreachable` / `forbidden` mean the panel does not know, and no
 * placeholder runner is drawn in their place (#632).
 */
function FleetStatusNotice({
  fleetStatus,
  error,
}: {
  fleetStatus?: UppidiFleetStatus;
  error?: string;
}) {
  const { colors, typography, getStatusColor } = useFleetTheme();
  if (!fleetStatus || fleetStatus === "ok") return null;
  const notice = FLEET_STATUS_NOTICE[fleetStatus];
  return (
    <View style={{ gap: 2 }}>
      <Row align="center" gap="xs">
        <StatusDot variant={notice.variant} />
        <Text style={{ color: getStatusColor(notice.variant), ...typography.caption }}>
          {notice.message}
        </Text>
      </Row>
      {error ? (
        <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Per-query provenance, so a red or partial fleet can be diagnosed from the panel. */
function RunnerSourceList({ sources }: { sources: UppidiRunnerSource[] }) {
  const { colors, typography } = useFleetTheme();
  if (sources.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      {sources.map((source) => (
        <Text
          key={`${source.kind}:${source.key}`}
          style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}
        >
          {source.endpoint ?? source.key}: {source.ok ? `${source.runnerCount ?? 0} runners` : (source.error ?? "unavailable")}
        </Text>
      ))}
    </View>
  );
}

/**
 * Local container runners, kept out of the CI list and out of the capacity
 * count (#632). A developer's workstation container is not fleet capacity, so
 * the group is labelled as such wherever it renders.
 */
function LocalRunnerGroup({
  runners,
  sourceError,
}: {
  runners: UppidiLocalRunner[];
  sourceError?: string;
}) {
  const { colors, typography } = useFleetTheme();
  return (
    <View style={{ gap: "xxs", marginTop: 4 }}>
      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
        {`Local containers on this host (not CI capacity): ${runners.length}`}
      </Text>
      {sourceError ? (
        <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
          {`Local container source unavailable: ${sourceError}`}
        </Text>
      ) : null}
      {runners.map((runner) => (
        <Row key={runner.id} align="center" gap="xs" wrap>
          <Badge label={runner.status} variant="neutral" size="sm" />
          <Text style={{ color: colors.foreground, ...typography.caption }}>{runner.name}</Text>
          {runner.image ? (
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
              {runner.image}
            </Text>
          ) : null}
        </Row>
      ))}
    </View>
  );
}

export function UppidiBrandMark({ size = 20, color }: { size?: number; color?: string }) {
  const { colors } = useFleetTheme();
  return (
    <ForgeIcon
      host="forge.mrs.uppidi.com"
      kind="forgejo"
      size={size}
      color={color ?? colors.accent}
      accessibilityLabel="Uppidi Fleet"
    />
  );
}

export interface RouterStatusBadge {
  label: string;
  variant: "success" | "warning" | "danger";
  pulse: boolean;
}

/**
 * Single source of truth for the router status indicator (#464). Prevents the
 * header from rendering contradictory connect + service badges side by side.
 */
export function resolveRouterStatusBadge(
  isConnected: boolean,
  isServiceRunning: boolean,
): RouterStatusBadge {
  if (isConnected) {
    return { label: "Router Active", variant: "success", pulse: true };
  }
  if (isServiceRunning) {
    return { label: "Router Starting", variant: "warning", pulse: false };
  }
  return { label: "Router Disconnected", variant: "danger", pulse: false };
}

export interface UppidiTopHeaderBarProps {
  isConnected: boolean;
  isServiceRunning: boolean;
  selectedRepo: string;
  repoOptions: SelectOption[];
  onRepoChange: (repo: string) => void;
  onRefresh: () => void;
  onTeardown?: () => void;
  onResetState?: () => void;
  isResetting?: boolean;
  /** Engage the canonical ALL HALT (#1013). */
  onHalt?: () => void;
  /** True once the canonical ALL HALT is engaged; disables the HALT action. */
  isHalted?: boolean;
  /** Number of agents blocked on a pending permission prompt (#534). */
  permissionAttentionCount?: number;
  /** Number of agents awaiting operator input (#534). */
  inputAttentionCount?: number;
}

/**
 * Compact Unified Header Bar (#424, #425)
 * Merges brand mark, Cockpit title, Uppidi Fleet badge, router status,
 * global repo selector, and refresh button into a single tight row.
 * Multi-line subtitle descriptions are eliminated to reduce vertical footprint by >50%.
 */
export function UppidiTopHeaderBar({
  isConnected,
  isServiceRunning,
  selectedRepo,
  repoOptions,
  onRepoChange,
  onRefresh,
  onTeardown,
  onResetState,
  isResetting = false,
  onHalt,
  isHalted = false,
  permissionAttentionCount = 0,
  inputAttentionCount = 0,
}: UppidiTopHeaderBarProps) {
  const { colors, typography } = useFleetTheme();
  const routerBadge = resolveRouterStatusBadge(isConnected, isServiceRunning);
  const attentionCount = permissionAttentionCount + inputAttentionCount;

  return (
    <Row
      justify="space-between"
      align="center"
      wrap
      gap="xs"
      style={{ paddingVertical: 2, position: "relative", zIndex: 100 }}
    >
      {/* Left: Brand mark, title, status dots & badges */}
      <Row align="center" gap="xs" wrap>
        <UppidiBrandMark size={18} />
        <StatusDot variant={routerBadge.variant} pulse={routerBadge.pulse} />
        <Text
          style={{
            color: colors.foreground,
            ...typography.title,
            fontSize: 15,
            fontWeight: "700",
          }}
        >
          Cockpit
        </Text>
        <Badge label="Uppidi Fleet" variant="accent" size="sm" textStyle={{ fontSize: 10 }} />
        <Badge
          label={routerBadge.label}
          variant={routerBadge.variant}
          size="sm"
          dot
          textStyle={{ fontSize: 10 }}
        />
        {attentionCount > 0 && (
          <AttentionBeacon mode="radar" tone="warning">
            <Badge
              label={`⚠️ ${attentionCount} Need Attention`}
              variant="warning"
              size="sm"
              dot
              textStyle={{ fontSize: 10, fontWeight: "700" }}
            />
          </AttentionBeacon>
        )}
      </Row>

      {/* Right: Repo Selector, Refresh, Reset State, & Teardown buttons (#449, #466, #764) */}
      <Row align="center" gap="xs" wrap>
        {/* Global Repo Selector */}
        <View style={{ minWidth: 150, maxWidth: 220 }}>
          <Select
            value={selectedRepo}
            options={repoOptions}
            onValueChange={onRepoChange}
            size="sm"
          />
        </View>

        <Button
          label="Refresh"
          icon="RefreshCw"
          size="sm"
          variant="secondary"
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            minHeight: 22,
          }}
          onPress={onRefresh}
        />
        {onResetState && (
          <Button
            label={isResetting ? "Resetting..." : "Reset State"}
            icon="RotateCcw"
            size="sm"
            variant="secondary"
            loading={isResetting}
            disabled={isResetting}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              minHeight: 22,
            }}
            onPress={onResetState}
          />
        )}
        {onHalt && (
          <Button
            label={isHalted ? "Halted" : "HALT"}
            icon="Ban"
            size="sm"
            variant="danger"
            disabled={isHalted}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              minHeight: 22,
            }}
            onPress={onHalt}
          />
        )}
        {onTeardown && (
          <Button
            label="Teardown Fleet"
            icon="Trash2"
            size="sm"
            variant="danger"
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              minHeight: 22,
            }}
            onPress={onTeardown}
          />
        )}
      </Row>
    </Row>
  );
}

export interface AttentionAgentCardProps {
  agent: UppidiAgent;
  onOpen?: (agentId: string) => void;
}

/**
 * Cockpit fleet attention card (#534): a prominent `AttentionBeacon`-wrapped row
 * for an agent blocked at a permission prompt or awaiting operator input, with
 * the Front Desk adjudication command rendered for one-click copy.
 */
export function AttentionAgentCard({ agent, onOpen }: AttentionAgentCardProps) {
  const { colors, typography } = useFleetTheme();
  const permissions = agent.pendingPermissions ?? [];
  const hasPermission = permissions.length > 0;
  const reason = getAgentAttentionReason(agent);
  const tone: "warning" | "danger" = hasPermission ? "danger" : "warning";
  const accentColor = hasPermission
    ? colors.statusDanger
    : colors.statusWarning;

  return (
    <AttentionBeacon
      mode="radar"
      tone={tone}
      testID={`cockpit-attention-beacon-${agent.id}`}
      accessibilityLabel={
        hasPermission ? `Permission needed for ${agent.name}` : `Awaiting input for ${agent.name}`
      }
    >
      <Card variant="flat" style={{ borderColor: accentColor, borderWidth: 1 }}>
        <Row justify="space-between" align="center" wrap gap="xs">
          <Stack gap="xxs" style={{ flexShrink: 1 }}>
            <Row align="center" gap="xs" wrap>
              <Badge
                label={
                  hasPermission
                    ? `⚠️ Permission Needed: ${getPendingPermissionAction(permissions[0]!)}`
                    : `⏸ Awaiting Input${reason ? `: ${reason}` : ""}`
                }
                variant={tone}
                size="sm"
                dot
                style={{ borderColor: accentColor }}
                textStyle={{ fontSize: 10, fontWeight: "700" }}
              />
              <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
                {agent.name}
              </Text>
              <Badge
                label={agent.shortId}
                variant="neutral"
                size="sm"
                textStyle={{ fontFamily: "monospace", fontSize: 10 }}
              />
            </Row>
            {hasPermission && permissions.length > 1 && (
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                +{permissions.length - 1} more pending permission request
                {permissions.length - 1 === 1 ? "" : "s"}
              </Text>
            )}
          </Stack>
          {onOpen && (
            <Button
              label="Open agent"
              icon="ExternalLink"
              size="sm"
              variant="ghost"
              onPress={() => onOpen(agent.id)}
            />
          )}
        </Row>
        {hasPermission && (
          <Row style={{ marginTop: 4 }}>
            <CommandBox
              command={getPermissionAdjudicationCommand(agent.id, permissions[0])}
              copyLabel={`Copy adjudication command for ${agent.name}`}
              style={{ flexShrink: 1 }}
            />
          </Row>
        )}
      </Card>
    </AttentionBeacon>
  );
}

// --- Fleet Teardown Modal (#742) ---

interface TeardownModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (targets: Array<"workers" | "orchestrators" | "frontdesk">) => void;
  isProcessing: boolean;
}

const TEARDOWN_TARGETS: Array<{
  id: "workers" | "orchestrators" | "frontdesk";
  label: string;
  description: string;
}> = [
  { id: "workers", label: "Coding Agents", description: "Terminates running coding subagents and archives their sessions" },
  { id: "orchestrators", label: "Orchestrators", description: "Terminates active project orchestrator agents" },
  { id: "frontdesk", label: "Front Desk / Total Destruction", description: "Terminates the Front Desk agent and all supervisory daemons" },
];

/**
 * Multi-level approval modal for fleet teardown (#742). Requires explicit
 * checkbox selection of target categories and typing "TEARDOWN" to arm the
 * final confirmation button.
 */
export function TeardownModal({ visible, onClose, onConfirm, isProcessing }: TeardownModalProps) {
  const { colors, typography } = useFleetTheme();
  const [selectedTargets, setSelectedTargets] = useState<Set<"workers" | "orchestrators" | "frontdesk">>(new Set());
  const [confirmText, setConfirmText] = useState("");

  const isArmed = confirmText.trim().toUpperCase() === "TEARDOWN" && selectedTargets.size > 0;
  const dangerColor = colors.statusDanger;

  const toggleTarget = (id: "workers" | "orchestrators" | "frontdesk") => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!isArmed || isProcessing) return;
    onConfirm(Array.from(selectedTargets));
    setSelectedTargets(new Set());
    setConfirmText("");
  };

  const handleClose = () => {
    setSelectedTargets(new Set());
    setConfirmText("");
    onClose();
  };

  return (
    <Modal
      open={visible}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      title="Teardown Fleet"
    >
      <ModalContent>
        <Stack gap="sm">
          <Card variant="flat" style={{ borderColor: dangerColor, borderWidth: 1 }}>
            <Stack gap="xs">
              <Row align="center" gap="xs">
                <Icon name="AlertTriangle" size={16} color={dangerColor} />
                <Text style={{ color: dangerColor, ...typography.heading }}>
                  Destructive Operation
                </Text>
              </Row>
              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                This will permanently archive the selected agent categories. This action cannot be undone.
              </Text>
            </Stack>
          </Card>

          <Text style={{ color: colors.foreground, ...typography.caption, fontWeight: "600" }}>
            Select agents to teardown:
          </Text>

          {TEARDOWN_TARGETS.map((target) => (
            <Card
              key={target.id}
              variant="flat"
              style={{
                borderColor: selectedTargets.has(target.id) ? dangerColor : colors.border,
                borderWidth: selectedTargets.has(target.id) ? 2 : 1,
              }}
            >
              <Row align="center" gap="sm">
                <Button
                  label={selectedTargets.has(target.id) ? "✓" : ""}
                  size="sm"
                  variant={selectedTargets.has(target.id) ? "danger" : "ghost"}
                  style={{ width: 28, height: 28, padding: 0 }}
                  onPress={() => toggleTarget(target.id)}
                />
                <Stack gap="xxs" style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
                    {target.label}
                  </Text>
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                    {target.description}
                  </Text>
                </Stack>
              </Row>
            </Card>
          ))}

          <Text style={{ color: colors.foreground, ...typography.caption, fontWeight: "600" }}>
            Type TEARDOWN to confirm:
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="TEARDOWN"
            autoCapitalize="characters"
          />

          <Row justify="flex-end" gap="xs">
            <Button
              label="Cancel"
              size="sm"
              variant="secondary"
              onPress={handleClose}
              disabled={isProcessing}
            />
            <Button
              label={isProcessing ? "Tearing down..." : "Teardown Fleet"}
              size="sm"
              variant="danger"
              disabled={!isArmed || isProcessing}
              onPress={handleConfirm}
            />
          </Row>
        </Stack>
      </ModalContent>
    </Modal>
  );
}

export interface ResetStateModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isProcessing?: boolean;
}

/**
 * Confirmation modal for resetting fleet state (#764).
 * Purges stale board state, issue cache, and queue files, and notifies orchestrators.
 */
export function ResetStateModal({ visible, onClose, onConfirm, isProcessing = false }: ResetStateModalProps) {
  const { colors, typography } = useFleetTheme();
  const warningColor = colors.statusWarning;

  return (
    <Modal
      open={visible}
      onOpenChange={(open) => {
        if (!open && !isProcessing) onClose();
      }}
      title="Reset Fleet State"
    >
      <ModalContent>
        <Stack gap="sm">
          <Card variant="flat" style={{ borderColor: warningColor, borderWidth: 1 }}>
            <Stack gap="xs">
              <Row align="center" gap="xs">
                <Icon name="RotateCcw" size={16} color={warningColor} />
                <Text style={{ color: warningColor, ...typography.heading }}>
                  Purge Stale Fleet State & Queues
                </Text>
              </Row>
              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                This will clear local board state caches, stale issue tracking in ~/.cache, and pending hook event queues in plugin storage. Registered orchestrators will be notified via steer message so they do not rely on stale context. Running agents will remain active.
              </Text>
            </Stack>
          </Card>

          <Row justify="flex-end" gap="xs">
            <Button
              label="Cancel"
              size="sm"
              variant="secondary"
              onPress={onClose}
              disabled={isProcessing}
            />
            <Button
              label={isProcessing ? "Resetting..." : "Confirm Reset"}
              icon="RotateCcw"
              size="sm"
              variant="secondary"
              disabled={isProcessing}
              loading={isProcessing}
              onPress={onConfirm}
            />
          </Row>
        </Stack>
      </ModalContent>
    </Modal>
  );
}

// --- Fleet HALT / RESUME (#1013) ---

export interface HaltedBannerProps {
  isHalted: boolean;
  teardownInProgress?: boolean;
  isResuming?: boolean;
  onResume?: () => void;
}

/**
 * Persistent halted-state indicator (#1013). Rendered inside the pinned header
 * so it stays visible on every surface tab while the canonical ALL HALT is
 * engaged. RESUME is disabled while a teardown is mid-flight because the halt
 * must remain in force until archiving completes (#994).
 */
export function HaltedBanner({
  isHalted,
  teardownInProgress = false,
  isResuming = false,
  onResume,
}: HaltedBannerProps) {
  const { colors, typography } = useFleetTheme();
  if (!isHalted) return null;

  return (
    <View testID="fleet-halted-banner">
      <Card variant="flat" style={{ borderColor: colors.statusDanger, borderWidth: 1 }}>
        <Row justify="space-between" align="center" wrap gap="xs">
          <Row align="center" gap="xs" wrap>
            <Icon name="Ban" size={16} color={colors.statusDanger} />
            <Badge label="HALTED" variant="danger" size="sm" />
            <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
              Canonical ALL HALT engaged
            </Text>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              {teardownInProgress
                ? "Teardown in progress — RESUME unlocks when it completes."
                : "Ingress paused, background loops stopped, auto-provisioning disabled."}
            </Text>
          </Row>
          {onResume && (
            <Button
              label={isResuming ? "Resuming..." : "Resume"}
              icon="Play"
              size="sm"
              variant="primary"
              disabled={teardownInProgress || isResuming}
              accessibilityLabel="Resume fleet from halt"
              onPress={onResume}
            />
          )}
        </Row>
      </Card>
    </View>
  );
}

// --- Fleet model-resolution alerts (#1011) ---

export interface ModelAlertBannerProps {
  alerts: FleetModelAlert[];
}

/**
 * Persistent banner shown while any repository's configured orchestrator model
 * chain is fully exhausted (#1011). It names the configured chain, the dead
 * entries and the live provider set so the operator can see why a spawn failed
 * loudly instead of a hidden hardcoded model taking over. The banner clears
 * automatically the next time that repo resolves a satisfiable model.
 */
export function ModelAlertBanner({ alerts }: ModelAlertBannerProps) {
  const { colors, typography } = useFleetTheme();
  if (!alerts || alerts.length === 0) return null;

  return (
    <View testID="fleet-model-alert-banner">
      <Card variant="flat" style={{ borderColor: colors.statusDanger, borderWidth: 1 }}>
        <Stack gap="xxs">
          <Row align="center" gap="xs" wrap>
            <Icon name="AlertTriangle" size={16} color={colors.statusDanger} />
            <Badge label="MODEL CHAIN EXHAUSTED" variant="danger" size="sm" />
            <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
              {alerts.length} repo{alerts.length === 1 ? "" : "s"} cannot provision an orchestrator
            </Text>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              No hidden default will be substituted; fix the provider set or the fallback group.
            </Text>
          </Row>
          {alerts.map((alert) => (
            <Text
              key={alert.repo}
              style={{ color: colors.foregroundMuted, ...typography.caption, fontFamily: "monospace" }}
            >
              {alert.repo}: chain [{alert.configuredChain.join(", ")}]; dead [
              {alert.dropped.map((d) => `${d.key} (${d.reason})`).join(", ") || "none"}]; live [
              {(alert.availableProviders ?? []).join(", ") || "unknown"}]
            </Text>
          ))}
        </Stack>
      </Card>
    </View>
  );
}

export interface HaltConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isProcessing?: boolean;
  /** True when the router already reports halted; the confirm action is inert. */
  isHalted?: boolean;
}

/**
 * Confirmation for engaging the canonical ALL HALT (#1013). HALT is reversible
 * enough that a single explicit confirm is used rather than the type-to-arm
 * teardown flow, but it still requires a deliberate second action.
 */
export function HaltConfirmModal({
  visible,
  onClose,
  onConfirm,
  isProcessing = false,
  isHalted = false,
}: HaltConfirmModalProps) {
  const { colors, typography } = useFleetTheme();
  const dangerColor = colors.statusDanger;

  return (
    <Modal
      open={visible}
      onOpenChange={(open) => {
        if (!open && !isProcessing) onClose();
      }}
      title="Engage Fleet HALT"
    >
      <ModalContent>
        <Stack gap="sm">
          <Card variant="flat" style={{ borderColor: dangerColor, borderWidth: 1 }}>
            <Stack gap="xs">
              <Row align="center" gap="xs">
                <Icon name="Ban" size={16} color={dangerColor} />
                <Text style={{ color: dangerColor, ...typography.heading }}>
                  Canonical ALL HALT
                </Text>
              </Row>
              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                Engages the same halt used by fleet teardown: webhook ingress and queue
                processing pause, background watchdog/board loops stop, and auto-provisioning
                is suppressed. Already-running agents keep running. Reversible with RESUME.
              </Text>
            </Stack>
          </Card>

          <Row justify="flex-end" gap="xs">
            <Button
              label="Cancel"
              size="sm"
              variant="secondary"
              onPress={onClose}
              disabled={isProcessing}
            />
            <Button
              label={isProcessing ? "Halting..." : "Engage HALT"}
              icon="Ban"
              size="sm"
              variant="danger"
              disabled={isProcessing || isHalted}
              loading={isProcessing}
              accessibilityLabel="Confirm HALT"
              onPress={onConfirm}
            />
          </Row>
        </Stack>
      </ModalContent>
    </Modal>
  );
}

export function UppidiFleetSurface(props: PluginSurfaceProps) {
  const { colors, typography } = useFleetTheme();
  const toast = useToast();
  const { settings, updateSettings, isUpdating: isUpdatingSettings } = usePluginSettings(uppidiFleetSettingsContract);
  const [activeTab, setActiveTab] = useState<SurfaceTab>("tree");
  const [selectedRepo, setSelectedRepo] = useState<string>("all");

  // Section 1: Issues sort & filter state
  const [filter, setFilter] = useState<IssuePreset>("all");
  const [query, setQuery] = useState("");
  const [issueSortField, setIssueSortField] = useState<IssueSortField>("number");
  const [issueSortDir, setIssueSortDir] = useState<SortDirection>("desc");
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);

  // Section 2: Hook Queues sort & filter state
  const [hookServiceExpanded, setHookServiceExpanded] = useState(false);
  const [hookQueuesExpanded, setHookQueuesExpanded] = useState(false);
  const [repoEnrollmentExpanded, setRepoEnrollmentExpanded] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [queuePreset, setQueuePreset] = useState<QueuePreset>("all");
  const [queueQuery, setQueueQuery] = useState("");
  const [queueSortField, setQueueSortField] = useState<QueueSortField>("repo");
  const [queueSortDir, setQueueSortDir] = useState<SortDirection>("asc");
  const [hookLogExpanded, setHookLogExpanded] = useState(false);
  const [roleModelsExpanded, setRoleModelsExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  // Section 4: CI Runners sort & filter state
  const [runnersExpanded, setRunnersExpanded] = useState(false);
  const [runnerPreset, setRunnerPreset] = useState<RunnerPreset>("all");
  const [runnerQuery, setRunnerQuery] = useState("");
  const [runnerSortField, setRunnerSortField] = useState<RunnerSortField>("name");
  const [runnerSortDir, setRunnerSortDir] = useState<SortDirection>("asc");

  // Section 5: Fleet Capability & Benchmark Matrix sort & filter state
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const [metricPreset, setMetricPreset] = useState<MetricPreset>("all");
  const [metricQuery, setMetricQuery] = useState("");
  const [metricSortField, setMetricSortField] = useState<MetricSortField>("passRate");
  const [metricSortDir, setMetricSortDir] = useState<SortDirection>("desc");
  const [queueViewMode, setQueueViewMode] = useState<"table" | "board">("table");

  // Live RPC queries with polling
  // The selected repo goes with the request (#724). Before the fix this input
  // never carried `repo`, so the server kept answering the default repository
  // and any other selection filtered a list the server never served — blank by
  // construction.
  const issuesState = activeTab === "board" || queueViewMode === "board" ? "all" : "open";
  const {
    data: issuesData,
    isLoading: issuesLoading,
    refetch: refetchIssues,
  } = useRpcQuery(
    uppidiIssuesContract,
    { state: issuesState, repo: selectedRepo === "all" ? undefined : selectedRepo },
    { refetchInterval: 10000 },
  );

  const {
    data: hookStatus,
    refetch: refetchHookStatus,
  } = useRpcQuery(uppidiHookStatusContract, {}, { refetchInterval: 5000 });

  const {
    data: hookQueues,
    refetch: refetchHookQueues,
  } = useRpcQuery(uppidiHookQueuesContract, {}, { refetchInterval: 5000 });

  const {
    data: serviceStatus,
    refetch: refetchServiceStatus,
  } = useRpcQuery(uppidiHookServiceStatusContract, {}, { refetchInterval: 10000 });

  const {
    data: logTail,
    refetch: refetchLogTail,
  } = useRpcQuery(uppidiHookLogTailContract, { lines: 40 }, { refetchInterval: 5000 });

  const {
    data: agentsData,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useRpcQuery(uppidiAgentsContract, {}, { refetchInterval: 5000 });

  const {
    data: roleModelsData,
    refetch: refetchRoleModels,
  } = useRpcQuery(uppidiRoleModelsContract, {}, { refetchInterval: 10000 });

  // Persistent model-chain exhaustion banners (#1011).
  const {
    data: fleetAlertsData,
    refetch: refetchFleetAlerts,
  } = useRpcQuery(uppidiFleetAlertsContract, {}, { refetchInterval: 10000 });

  const {
    data: skillsData,
    isLoading: skillsLoading,
    error: skillsQueryError,
    refetch: refetchSkills,
  } = useRpcQuery(uppidiSkillsContract, {}, { refetchInterval: 15000 });

  const {
    data: runnersData,
    refetch: refetchRunners,
  } = useRpcQuery(uppidiRunnersContract, {}, { refetchInterval: 15000 });

  const {
    data: metricsData,
    refetch: refetchMetrics,
  } = useRpcQuery(uppidiFleetMetricsContract, {}, { refetchInterval: 15000 });

  const {
    data: reposData,
    isLoading: reposLoading,
    error: reposQueryError,
    refetch: refetchRepos,
  } = useRpcQuery(uppidiReposContract, {}, { refetchInterval: 15000 });

  // Mutations
  const enrollRepoMutation = useRpcMutation(uppidiEnrollRepoContract);
  const unenrollRepoMutation = useRpcMutation(uppidiUnenrollRepoContract);
  const [enrollingRepoKey, setEnrollingRepoKey] = useState<string | null>(null);
  const [unenrollingRepoKey, setUnenrollingRepoKey] = useState<string | null>(null);

  const pauseMutation = useRpcMutation(uppidiHookPauseContract);
  const resumeMutation = useRpcMutation(uppidiHookResumeContract);
  const drainMutation = useRpcMutation(uppidiHookDrainContract);
  const serviceActionMutation = useRpcMutation(uppidiHookServiceActionContract);
  const configureMutation = useRpcMutation(uppidiHookConfigureContract);
  const setRoleModelMutation = useRpcMutation(uppidiSetRoleModelContract);
  const setSkillMutation = useRpcMutation(uppidiSetSkillContract);
  const archiveAgentMutation = useRpcMutation(uppidiArchiveAgentContract);
  const archiveBulkMutation = useRpcMutation(uppidiArchiveInactiveAgentsContract);

  const [archivingAgentId, setArchivingAgentId] = useState<string | null>(null);
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);

  // Fleet Teardown (#742)
  const teardownMutation = useRpcMutation(uppidiFleetTeardownContract);
  const [isTeardownModalOpen, setIsTeardownModalOpen] = useState(false);
  const [isTearingDown, setIsTearingDown] = useState(false);

  // Fleet Reset State (#764)
  const resetStateMutation = useRpcMutation(uppidiFleetResetStateContract);
  const [isResetStateModalOpen, setIsResetStateModalOpen] = useState(false);
  const [isResettingState, setIsResettingState] = useState(false);

  // Fleet HALT / RESUME (#1013)
  const haltMutation = useRpcMutation(uppidiFleetHaltContract);
  const resumeHaltMutation = useRpcMutation(uppidiFleetResumeContract);
  const [isHaltModalOpen, setIsHaltModalOpen] = useState(false);
  const [isHalting, setIsHalting] = useState(false);
  const [isResumingHalt, setIsResumingHalt] = useState(false);
  const isHalted = hookStatus?.halted ?? false;
  const isTeardownInProgress = hookStatus?.teardownInProgress ?? false;

  // Issue Kanban state transition (#755)
  const transitionIssueMutation = useRpcMutation(uppidiTransitionIssueContract);

  // Fleet Skills editor (#883)
  const [skillDrafts, setSkillDrafts] = useState<Record<string, string>>({});
  const [skillSaved, setSkillSaved] = useState<Record<string, boolean>>({});
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);

  React.useEffect(() => {
    const skills = skillsData?.skills;
    if (!skills) return;
    setSkillDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      // Seed a draft the first time a skill is seen. A draft that already
      // exists is left alone so a refetch never clobbers in-progress edits.
      for (const skill of skills) {
        if (next[skill.id] === undefined) {
          next[skill.id] = skill.content;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [skillsData]);

  const handleTransitionIssue = async (
    issue: UppidiIssue,
    targetState: KanbanColumnId,
  ) => {
    try {
      const targetRepo = selectedRepo !== "all" ? selectedRepo : issue.repo;
      const resolvedRepo = resolveCanonicalRepo(targetRepo);
      if (!resolvedRepo) {
        toast.error(`Unknown repository: ${targetRepo ?? "(none)"}`);
        return;
      }
      const res = await transitionIssueMutation.mutateAsync({
        repo: resolvedRepo.compact,
        number: issue.number,
        targetState,
      });
      if (res.ok) {
        toast.show(res.message || `Moved #${issue.number} to ${targetState}`);
        void refetchIssues();
      } else {
        toast.error(res.error || `Failed to move #${issue.number}`);
      }
    } catch (err: any) {
      toast.error(err?.message || `Failed to move #${issue.number}`);
    }
  };

  // Hook service listen address configuration (#427)
  const [hostSelection, setHostSelection] = useState<string>("127.0.0.1");
  const [customHost, setCustomHost] = useState<string>("");
  const [isCustomHost, setIsCustomHost] = useState<boolean>(false);
  const [configuredPortInput, setConfiguredPortInput] = useState<string>("8099");
  const [isConfiguring, setIsConfiguring] = useState<boolean>(false);
  const configInitializedRef = React.useRef(false);

  React.useEffect(() => {
    if ((serviceStatus || settings) && !configInitializedRef.current) {
      configInitializedRef.current = true;
      const cfgHost = settings?.hookHost || serviceStatus?.configuredHost || serviceStatus?.host || "127.0.0.1";
      const cfgPort = settings?.hookPort || serviceStatus?.configuredPort || serviceStatus?.port || 8099;
      setConfiguredPortInput(String(cfgPort));

      const isDetected = (serviceStatus?.availableInterfaces ?? []).includes(cfgHost);
      if (cfgHost === "127.0.0.1" || cfgHost === "0.0.0.0" || isDetected) {
        setHostSelection(cfgHost);
        setIsCustomHost(false);
      } else {
        setHostSelection("custom");
        setCustomHost(cfgHost);
        setIsCustomHost(true);
      }
    }
  }, [serviceStatus, settings]);

  const detectedIps = useMemo(() => {
    const list = serviceStatus?.availableInterfaces ?? [];
    return list.filter((ip) => ip !== "127.0.0.1" && ip !== "0.0.0.0");
  }, [serviceStatus?.availableInterfaces]);

  const handleApplyConfig = async () => {
    const targetHost = isCustomHost ? customHost.trim() : hostSelection;
    const parsedPort = parseInt(configuredPortInput.trim(), 10);
    if (!targetHost) {
      toast.error("Host cannot be empty");
      return;
    }
    if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      toast.error("Please specify a valid port (1-65535)");
      return;
    }

    try {
      setIsConfiguring(true);
      const res = await configureMutation.mutateAsync({
        host: targetHost,
        port: parsedPort,
        restart: true,
      });
      void updateSettings({ hookHost: targetHost, hookPort: parsedPort });
      if (res.ok) {
        toast.show(res.message || `Hook service listening on ${res.activeHost}:${res.activePort}`);
        void refetchServiceStatus();
      } else {
        toast.error(res.error || "Failed to configure hook service");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Configuration error: ${msg}`);
    } finally {
      setIsConfiguring(false);
    }
  };

  const refetchAll = () => {
    void refetchIssues();
    void refetchHookStatus();
    void refetchHookQueues();
    void refetchServiceStatus();
    void refetchLogTail();
    void refetchAgents();
    void refetchRoleModels();
    void refetchFleetAlerts();
    void refetchSkills();
    void refetchRunners();
    void refetchMetrics();
    void refetchRepos();
    toast.show("Dashboard refreshed");
  };

  const handleEnrollRepo = async (repoKey: string) => {
    try {
      setEnrollingRepoKey(repoKey);
      const res = await enrollRepoMutation.mutateAsync({ repo: repoKey });
      if (res.ok) {
        toast.show(res.message || `Enrolled ${repoKey}`);
        void refetchRepos();
        void refetchAgents();
      } else {
        toast.error(res.error || `Failed to enroll ${repoKey}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnrollingRepoKey(null);
    }
  };

  const handleUnenrollRepo = async (repoKey: string) => {
    try {
      setUnenrollingRepoKey(repoKey);
      const res = await unenrollRepoMutation.mutateAsync({ repo: repoKey });
      if (res.ok) {
        toast.show(res.message || `Unenrolled ${repoKey}`);
        void refetchRepos();
        void refetchAgents();
      } else {
        toast.error(res.error || `Failed to unenroll ${repoKey}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUnenrollingRepoKey(null);
    }
  };


  const handleRoleModelChange = async (role: string, primaryModel: string, fallbackGroup?: string[]) => {
    try {
      const res = await setRoleModelMutation.mutateAsync({ role, primaryModel, fallbackGroup });
      if (res.ok) {
        toast.show(res.message || `Updated model for ${role}`);
        void refetchRoleModels();
        void refetchFleetAlerts();
      } else {
        toast.error(res.error || "Failed to update role model");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveSkill = async (skill: FleetSkill) => {
    const draft = skillDrafts[skill.id];
    if (draft === undefined || draft === skill.content) return;
    try {
      setSavingSkillId(skill.id);
      const res = await setSkillMutation.mutateAsync({ id: skill.id, content: draft });
      if (res.ok && res.skill) {
        setSkillDrafts((prev) => ({ ...prev, [skill.id]: res.skill!.content }));
        setSkillSaved((prev) => ({ ...prev, [skill.id]: true }));
        toast.show(res.message || `Saved ${skill.title}`);
        void refetchSkills();
      } else {
        toast.error(res.error || `Failed to save ${skill.title}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSkillId(null);
    }
  };

  const handleResetSkill = async (skill: FleetSkill) => {
    try {
      setSavingSkillId(skill.id);
      const res = await setSkillMutation.mutateAsync({ id: skill.id, content: null });
      if (res.ok && res.skill) {
        setSkillDrafts((prev) => ({ ...prev, [skill.id]: res.skill!.content }));
        setSkillSaved((prev) => ({ ...prev, [skill.id]: false }));
        toast.show(res.message || `Reset ${skill.title}`);
        void refetchSkills();
      } else {
        toast.error(res.error || `Failed to reset ${skill.title}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSkillId(null);
    }
  };

  const handleServiceAction = async (action: "start" | "stop" | "restart") => {
    try {
      const res = await serviceActionMutation.mutateAsync({ action });
      if (res.ok) {
        toast.show(`Hook service ${action}ed`);
        void refetchServiceStatus();
        void refetchHookStatus();
      } else {
        toast.error(res.error || `Failed to ${action} service`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQueuePause = async (repo?: string) => {
    try {
      const res = await pauseMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Paused queue for ${repo}` : "Paused all queues");
        void refetchHookQueues();
        void refetchHookStatus();
      } else {
        toast.error(res.error || "Failed to pause");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQueueResume = async (repo?: string) => {
    try {
      const res = await resumeMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Resumed queue for ${repo}` : "Resumed all queues");
        void refetchHookQueues();
        void refetchHookStatus();
      } else {
        toast.error(res.error || "Failed to resume");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQueueDrain = async (repo: string) => {
    try {
      const res = await drainMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(`Drained queue for ${repo}`);
        void refetchHookQueues();
        void refetchHookStatus();
      } else {
        toast.error(res.error || "Failed to drain");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const availableRepos = useMemo(() => {
    const raw = new Set<string>();
    if (issuesData?.repo) raw.add(issuesData.repo);
    for (const r of toRepoList(agentsData?.enrolledRepos)) raw.add(r);
    for (const q of toList(hookQueues?.queues)) if (q?.key) raw.add(q.key);
    for (const i of toList(issuesData?.issues)) if (i?.repo) raw.add(i.repo);
    const known = Array.from(raw);
    const canonical = new Set<string>();
    for (const r of known) {
      const name = canonicalRepoName(r, { knownRepos: known });
      if (name) canonical.add(name);
    }
    const defaultRepo =
      canonicalRepoName(issuesData?.repo ?? "xpufx-org/paseo", { knownRepos: known }) ??
      "forge.mrs.uppidi.com/xpufx-org/paseo";
    canonical.add(defaultRepo);
    // Stable presentation order (#796): defaultRepo first, remaining sorted.
    const list = Array.from(canonical);
    const others = list.filter((r) => r !== defaultRepo).sort((a, b) => a.localeCompare(b));
    return [defaultRepo, ...others];
  }, [issuesData?.repo, issuesData?.issues, agentsData?.enrolledRepos, hookQueues?.queues]);

  const repoOptions = useMemo<SelectOption[]>(() => [
    { label: "All Repositories", value: "all" },
    ...availableRepos.map((r) => ({
      label: r,
      value: r,
      display: resolveForgeSelection(r, availableRepos)?.compact ?? r,
    })),
  ], [availableRepos]);

  const rawIssues = useMemo(() => {
    const all = toList(issuesData?.issues);
    if (selectedRepo === "all") return all;
    return all.filter((i) => isRepoMatching(i?.repo, selectedRepo) || String(i?.repo ?? "").toLowerCase() === selectedRepo.toLowerCase());
  }, [issuesData?.issues, selectedRepo]);

  const visible = useMemo(() => {
    const filtered = filterIssues(rawIssues, filter, query);
    return sortIssues(filtered, issueSortField, issueSortDir);
  }, [rawIssues, filter, query, issueSortField, issueSortDir]);

  const selected = useMemo(() => {
    if (selectedNumber !== null) {
      return rawIssues.find((i) => i.number === selectedNumber) ?? null;
    }
    return null;
  }, [selectedNumber, rawIssues]);

  // The modal's forge target is derived from the one canonical identity, never
  // from a hand-parsed remote (#888).
  const selectedRepoIdentity = useMemo(
    () => (selected ? resolveForgeSelection(selected.repo, availableRepos) : null),
    [selected, availableRepos],
  );

  const isConnected = hookStatus?.ok ?? false;
  const isServiceRunning = serviceStatus?.active ?? false;
  const totalQueued = hookStatus?.totalQueued ?? 0;
  const queuesList = toList(hookQueues?.queues);

  /**
   * Models the daemon reports, as Select options (#635).
   *
   * Deduplicated and sorted so the list does not reshuffle between polls, and
   * guarded with toList() per the partial-payload contract (#510) — a stale
   * payload can carry roles with no availableModels at all.
   */
  const roleModelOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    const options: SelectOption[] = [];
    for (const model of toList(roleModelsData?.availableModels)) {
      const name = String(model ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      options.push({ label: name, value: name });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [roleModelsData?.availableModels]);

  const visibleQueues = useMemo(() => {
    const filtered = filterQueues(queuesList, queuePreset, queueQuery);
    return sortQueues(filtered, queueSortField, queueSortDir);
  }, [queuesList, queuePreset, queueQuery, queueSortField, queueSortDir]);

  /**
   * Per-preset issue counts (#645).
   *
   * Previously inlined in the filter button row that this change removed. It
   * lives here now because the metrics bar renders every preset, and a second
   * copy of these predicates is how the two rows started disagreeing.
   */
  const presetCounts = useMemo(() => {
    const all = rawIssues;
    return {
      all: all.length,
      "needs-you": all.filter((i) => i.attention === "attention/2-user").length,
      "needs-attention": all.filter(
        (i) =>
          i.attention.startsWith("attention/0-") ||
          i.attention.startsWith("attention/1-") ||
          i.attention.startsWith("attention/2-")
      ).length,
      // toList(), not i.labels directly: the partial-payload contract (#510) allows
      // an issue with no labels, and the previous inline copy only survived that
      // because `status === "Review"` short-circuited the `||` before labels was
      // touched. Sorting by an unrelated field reached the unguarded access.
      "triage-review": all.filter(
        (i) =>
          i.status === "Review" ||
          toList(i.labels).some((l) => l.includes("state/0-triage") || l.includes("state/2-review"))
      ).length,
      "in-progress": all.filter(
        (i) => i.status === "In progress" || toList(i.labels).some((l) => l.includes("state/1-wip"))
      ).length,
      verify: all.filter((i) => toList(i.labels).some((l) => l.includes("state/3-verify"))).length,
    } satisfies Record<IssuePreset, number>;
  }, [rawIssues]);

  const allAgents = useMemo(() => {
    return [      ...toList(agentsData?.frontDesk),
      ...toList(agentsData?.orchestrators),
      ...toList(agentsData?.workers),
    ];
  }, [agentsData]);

  const eligibleBulkAgents = useMemo(() => {
    return filterBulkArchiveCandidates(allAgents);
  }, [allAgents]);

  const attentionAgents = useMemo(() => collectAttentionAgents(allAgents), [allAgents]);
  const permissionAgentCount = useMemo(() => countPermissionAgents(allAgents), [allAgents]);

  const activeWorkspaceId = useMemo(() => {
    if ((props as any).workspaceId) return (props as any).workspaceId as string;
    if (selectedRepo !== "all") {
      const match = allAgents.find(
        (a) =>
          a.project &&
          (isRepoMatching(a.project, selectedRepo) || a.project.toLowerCase() === selectedRepo.toLowerCase()) &&
          a.workspaceId,
      );
      if (match?.workspaceId) return match.workspaceId;
    }
    const agentWithWorkspace = allAgents.find((a) => a.workspaceId);
    return agentWithWorkspace?.workspaceId ?? "";
  }, [(props as any).workspaceId, selectedRepo, allAgents]);

  const activeWorkspaceDirectory =
    (props as any)?.directory ??
    (props as any)?.workspaceDirectory ??
    undefined;

  const handleOpenAgent = (agentId: string) => {
    if (props.navigation?.openAgent) {
      props.navigation.openAgent({ agentId });
      return;
    }
    Linking.openURL(`paseo://agent/${agentId}`).catch(() => {});
  };

  const handleArchiveAgent = async (agentId: string) => {
    try {
      setArchivingAgentId(agentId);
      const res = await archiveAgentMutation.mutateAsync({ agentId });
      if (res.ok) {
        toast.show(res.message || "Agent archived");
      } else {
        toast.error(res.error || "Failed to archive agent");
      }
      void refetchAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setArchivingAgentId(null);
    }
  };

  const handleArchiveBulk = async () => {
    if (eligibleBulkAgents.length === 0 || isBulkArchiving) return;
    try {
      setIsBulkArchiving(true);
      const agentIds = eligibleBulkAgents.map((a) => a.id);
      const res = await archiveBulkMutation.mutateAsync({ agentIds });
      if (res.ok) {
        toast.show(res.message || `Archived ${res.archivedCount ?? agentIds.length} inactive agent(s)`);
      } else {
        toast.error(res.error || "Failed to archive inactive agents");
      }
      void refetchAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsBulkArchiving(false);
    }
  };

  const handleTeardown = async (targets: Array<"workers" | "orchestrators" | "frontdesk">) => {
    try {
      setIsTearingDown(true);
      const res = await teardownMutation.mutateAsync({ targets, confirm: true });
      if (res.ok) {
        toast.show(res.message || `Torn down ${res.tornDown.workers + res.tornDown.orchestrators + res.tornDown.frontdesk} agent(s)`);
        setIsTeardownModalOpen(false);
      } else {
        toast.error(res.error || "Failed to teardown fleet");
      }
      void refetchAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsTearingDown(false);
    }
  };

  const handleHalt = async () => {
    try {
      setIsHalting(true);
      const res = await haltMutation.mutateAsync({ confirm: true });
      if (res.ok) {
        toast.show(res.message || (res.alreadyHalted ? "Fleet already halted" : "Canonical ALL HALT engaged"));
        setIsHaltModalOpen(false);
      } else {
        toast.error(res.error || "Failed to engage halt");
      }
      void refetchHookStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsHalting(false);
    }
  };

  const handleResumeHalt = async () => {
    try {
      setIsResumingHalt(true);
      const res = await resumeHaltMutation.mutateAsync({ confirm: true });
      if (res.ok) {
        toast.show(res.message || "Fleet resumed");
      } else {
        toast.error(res.error || "Failed to resume fleet");
      }
      void refetchHookStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsResumingHalt(false);
    }
  };

  const handleResetState = async () => {
    try {
      setIsResettingState(true);
      const res = await resetStateMutation.mutateAsync({ confirm: true, notifyOrchestrators: true });
      if (res.ok) {
        toast.show(res.message || "Fleet state reset successfully");
        setIsResetStateModalOpen(false);
      } else {
        toast.error(res.error || "Failed to reset fleet state");
      }
      refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsResettingState(false);
    }
  };


  const rawRunners = toList(runnersData?.runners);
  const visibleRunners = useMemo(() => {
    const filtered = filterRunners(rawRunners, runnerPreset, runnerQuery);
    return sortRunners(filtered, runnerSortField, runnerSortDir);
  }, [rawRunners, runnerPreset, runnerQuery, runnerSortField, runnerSortDir]);

  const rawCandidates = toList(metricsData?.candidates);
  const visibleCandidates = useMemo(() => {
    const filtered = filterMetricCandidates(rawCandidates, metricPreset, metricQuery);
    return sortMetricCandidates(filtered, metricSortField, metricSortDir);
  }, [rawCandidates, metricPreset, metricQuery, metricSortField, metricSortDir]);

  return (
    <ModalBody
      headerMode="pinned"
      header={
        <Stack gap={4}>
          <UppidiTopHeaderBar
            isConnected={isConnected}
            isServiceRunning={isServiceRunning}
            selectedRepo={selectedRepo}
            repoOptions={repoOptions}
            onRepoChange={setSelectedRepo}
            onRefresh={refetchAll}
            onResetState={() => setIsResetStateModalOpen(true)}
            isResetting={isResettingState}
            onTeardown={() => setIsTeardownModalOpen(true)}
            onHalt={() => setIsHaltModalOpen(true)}
            isHalted={isHalted}
            permissionAttentionCount={permissionAgentCount}
            inputAttentionCount={attentionAgents.length - permissionAgentCount}
          />
          <HaltedBanner
            isHalted={isHalted}
            teardownInProgress={isTeardownInProgress}
            isResuming={isResumingHalt}
            onResume={handleResumeHalt}
          />
          <ModelAlertBanner alerts={fleetAlertsData?.alerts ?? []} />
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as SurfaceTab)} />
        </Stack>
      }
      headerStyle={{
        backgroundColor: colors.surface0,
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: 4,
      }}
      contentContainerStyle={{
        gap: 6,
        paddingHorizontal: 8,
        paddingTop: 4,
      }}
    >
      {activeTab === "settings" ? (
        <Stack gap={6}>
          {/* Collapsible Section: Hook Service Management (#368) */}
          <Collapsible
            title={`Hook Service Management (${serviceStatus?.state ?? "checking"})`}
            icon="Server"
            isExpanded={hookServiceExpanded}
            onToggle={(exp) => setHookServiceExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="sm">
                  <Row align="center" gap="xs">
                    <StatusDot variant={isServiceRunning ? "success" : "danger"} />
                    <Text style={{ color: colors.foreground, ...typography.heading }}>
                      Bundled router: {serviceStatus?.state ?? "unknown"}
                    </Text>
                  </Row>
                  <Row gap="xs">
                    <Button
                      label="Start"
                      size="sm"
                      variant="primary"
                      disabled={isServiceRunning}
                      onPress={() => handleServiceAction("start")}
                    />
                    <Button
                      label="Restart"
                      size="sm"
                      variant="secondary"
                      onPress={() => handleServiceAction("restart")}
                    />
                    <Button
                      label="Stop"
                      size="sm"
                      variant="danger"
                      disabled={!isServiceRunning}
                      onPress={() => handleServiceAction("stop")}
                    />
                  </Row>
                </Row>
                <KeyValueGroup>
                  <KeyValue
                    label="Unit name"
                    value={`Bundled router (port ${serviceStatus?.port ?? serviceStatus?.configuredPort ?? 8099})`}
                  />
                  <KeyValue
                    label="Router endpoint"
                    value={`http://${serviceStatus?.host ?? "127.0.0.1"}:${serviceStatus?.port ?? 8099}`}
                  />
                  <KeyValue
                    label="Active host"
                    value={serviceStatus?.host ?? (isServiceRunning ? (serviceStatus?.configuredHost ?? "127.0.0.1") : "Not listening")}
                  />
                  <KeyValue
                    label="Active port"
                    value={serviceStatus?.port ? String(serviceStatus.port) : "Not listening"}
                  />
                  <KeyValue
                    label="Configured address"
                    value={`${serviceStatus?.configuredHost ?? "127.0.0.1"}:${serviceStatus?.configuredPort ?? 8099}`}
                  />
                  <KeyValue
                    label="Front desk agent"
                    value={hookStatus?.frontDesk?.agentId ?? "None assigned"}
                    copyable={!!hookStatus?.frontDesk?.agentId}
                  />
                  <KeyValue label="Total queued across repos" value={String(totalQueued)} />
                </KeyValueGroup>

                <Card variant="flat">
                  <Stack gap="xs">
                    <Text style={{ color: colors.foreground, ...typography.caption, fontWeight: "600" }}>
                      Configure Listen Address & Port
                    </Text>
                    <Row gap="xs" wrap align="center">
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Host:</Text>
                      <Button
                        label="127.0.0.1 (Loopback)"
                        size="sm"
                        variant={!isCustomHost && hostSelection === "127.0.0.1" ? "primary" : "ghost"}
                        onPress={() => {
                          setIsCustomHost(false);
                          setHostSelection("127.0.0.1");
                        }}
                      />
                      <Button
                        label="0.0.0.0 (All interfaces)"
                        size="sm"
                        variant={!isCustomHost && hostSelection === "0.0.0.0" ? "primary" : "ghost"}
                        onPress={() => {
                          setIsCustomHost(false);
                          setHostSelection("0.0.0.0");
                        }}
                      />
                      {detectedIps.map((ip) => (
                        <Button
                          key={ip}
                          label={ip}
                          size="sm"
                          variant={!isCustomHost && hostSelection === ip ? "primary" : "ghost"}
                          onPress={() => {
                            setIsCustomHost(false);
                            setHostSelection(ip);
                          }}
                        />
                      ))}
                      <Button
                        label="Custom"
                        size="sm"
                        variant={isCustomHost ? "primary" : "ghost"}
                        onPress={() => {
                          setIsCustomHost(true);
                          setHostSelection("custom");
                        }}
                      />
                    </Row>
                    <Row gap="sm" wrap align="flex-end">
                      {isCustomHost && (
                        <View style={{ flex: 1, minWidth: 160 }}>
                          <TextInput
                            label="Custom Host"
                            value={customHost}
                            onChangeText={setCustomHost}
                            placeholder="127.0.0.1 or IP"
                          />
                        </View>
                      )}
                      <View style={{ width: 120 }}>
                        <TextInput
                          label="Port"
                          value={configuredPortInput}
                          onChangeText={setConfiguredPortInput}
                          keyboardType="number-pad"
                          placeholder="8099"
                        />
                      </View>
                      <Button
                        label={isConfiguring ? "Applying..." : "Apply & Restart"}
                        size="sm"
                        variant="primary"
                        disabled={isConfiguring}
                        onPress={handleApplyConfig}
                      />
                    </Row>
                  </Stack>
                </Card>
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Hook Queues (#364, #368, #376) */}
          <Collapsible
            title={`Hook Queues (${visibleQueues.length}/${queuesList.length} repos, ${totalQueued} messages)`}
            icon="ListOrdered"
            isExpanded={hookQueuesExpanded}
            onToggle={(exp) => setHookQueuesExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={queuePreset === "all" ? "primary" : "ghost"}
                      onPress={() => setQueuePreset("all")}
                    />
                    <Button
                      label="Pending / Busy"
                      size="sm"
                      variant={queuePreset === "pending-processing" ? "primary" : "ghost"}
                      onPress={() => setQueuePreset("pending-processing")}
                    />
                    <Button
                      label="Paused / Dead"
                      size="sm"
                      variant={queuePreset === "dead-failed" ? "primary" : "ghost"}
                      onPress={() => setQueuePreset("dead-failed")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["repo", "depth", "status"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "repo" ? "Repo" : field === "depth" ? "Depth" : "Status"}${queueSortField === field ? (queueSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={queueSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (queueSortField === field) {
                            setQueueSortDir(queueSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setQueueSortField(field);
                            setQueueSortDir(field === "depth" ? "desc" : "asc");
                          }
                        }}
                      />
                    ))}
                    <Button label="Pause all" size="sm" variant="ghost" onPress={() => handleQueuePause()} />
                    <Button label="Resume all" size="sm" variant="ghost" onPress={() => handleQueueResume()} />
                  </Row>
                </Row>
                <SearchInput
                  value={queueQuery}
                  onChangeText={setQueueQuery}
                  onClear={() => setQueueQuery("")}
                  placeholder="Filter queues by repo or orchestrator..."
                  height={26}
                />
                {visibleQueues.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    {queuesList.length === 0 ? "No active queues." : "No queues match the selected filter."}
                  </Text>
                ) : (
                  visibleQueues.map((q) => (
                    <Card key={q?.key} variant="elevated">
                      <Row justify="space-between" align="center" wrap gap="xs">
                        <Stack gap="xxs" style={{ flex: 1 }}>
                          <Row align="center" gap="xs">
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{q?.key}</Text>
                            <Badge
                              label={q?.paused ? "Paused" : q?.isBusy ? "Busy" : "Ready"}
                              variant={q?.paused ? "warning" : q?.isBusy ? "info" : "success"}
                              size="sm"
                            />
                            {(q?.depth ?? 0) > 0 && <Badge label={`${q.depth} queued`} variant="info" size="sm" />}
                          </Row>
                          {q?.orchestrator?.agentId && (
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                              Orchestrator: {q.orchestrator.agentId.slice(0, 8)}...
                            </Text>
                          )}
                        </Stack>
                        <Row gap="xs">
                          {q?.paused ? (
                            <Button label="Resume" size="sm" variant="ghost" onPress={() => handleQueueResume(q?.key)} />
                          ) : (
                            <Button label="Pause" size="sm" variant="ghost" onPress={() => handleQueuePause(q?.key)} />
                          )}
                          <Button label="Drain" size="sm" variant="danger" onPress={() => handleQueueDrain(q?.key)} />
                        </Row>
                      </Row>
                      {toList(q?.messages).length > 0 && (
                        <Stack gap="xxs" style={{ marginTop: 6 }}>
                          {toList(q?.messages).slice(0, 3).map((m) => (
                            <Text
                              key={m.id}
                              numberOfLines={1}
                              style={{ color: colors.foregroundMuted, fontFamily: "monospace", ...typography.caption, fontSize: 11 }}
                            >
                              • {m.preview}
                            </Text>
                          ))}
                        </Stack>
                      )}
                    </Card>
                  ))
                )}
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Repository Enrollment (#867) */}
          {(() => {
            const allReposList: UppidiRepo[] = toList(reposData?.repos);
            const queryClean = repoSearchQuery.trim().toLowerCase();
            const filtered = queryClean
              ? allReposList.filter((r) =>
                  r.name.toLowerCase().includes(queryClean) ||
                  r.fullName.toLowerCase().includes(queryClean) ||
                  r.key.toLowerCase().includes(queryClean) ||
                  r.owner.toLowerCase().includes(queryClean),
                )
              : allReposList;
            const enrolledList = filtered.filter((r) => r.enrolled);
            const availableList = filtered.filter((r) => !r.enrolled);
            const totalEnrolledCount = allReposList.filter((r) => r.enrolled).length;

            return (
              <Collapsible
                title={`Repository Enrollment (${totalEnrolledCount} enrolled)`}
                icon="GitFork"
                isExpanded={repoEnrollmentExpanded}
                onToggle={(exp) => setRepoEnrollmentExpanded(exp)}
              >
                <Card variant="flat">
                  <Stack gap="sm">
                    <Row justify="space-between" align="center" wrap gap="xs">
                      <Row align="center" gap="xs">
                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                          Manage repositories enrolled in the fleet roster.
                        </Text>
                      </Row>
                      <Button
                        label="Refresh"
                        size="sm"
                        variant="ghost"
                        icon="RefreshCw"
                        disabled={reposLoading}
                        onPress={() => void refetchRepos()}
                      />
                    </Row>

                    <SearchInput
                      value={repoSearchQuery}
                      onChangeText={setRepoSearchQuery}
                      onClear={() => setRepoSearchQuery("")}
                      placeholder="Filter repositories by name or owner..."
                      height={26}
                    />

                    {reposLoading ? (
                      <Card variant="flat">
                        <Stack gap="xs" align="center" style={{ paddingVertical: 16 }}>
                          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                            Loading repositories from Forgejo...
                          </Text>
                        </Stack>
                      </Card>
                    ) : (reposData && !reposData.ok) || reposQueryError ? (
                      <Card variant="elevated" style={{ borderColor: colors.statusDanger }}>
                        <Row justify="space-between" align="center" wrap gap="xs">
                          <Row align="center" gap="xs">
                            <StatusDot variant="danger" />
                            <Text style={{ color: colors.statusDanger, ...typography.body }}>
                              {reposData?.error || (reposQueryError instanceof Error ? reposQueryError.message : "Failed to load repositories from Forgejo")}
                            </Text>
                          </Row>
                          <Button
                            label="Retry"
                            size="sm"
                            variant="primary"
                            icon="RefreshCw"
                            onPress={() => void refetchRepos()}
                          />
                        </Row>
                      </Card>
                    ) : filtered.length === 0 ? (
                      <EmptyState
                        title="No repositories match"
                        description={queryClean ? `No repositories matching "${repoSearchQuery}"` : "No repositories discovered on Forgejo."}
                      />
                    ) : (
                      <Row gap="md" wrap style={{ alignItems: "flex-start" }}>
                        {/* Enrolled Repositories */}
                        <Stack gap="xs" style={{ flex: 1, minWidth: 280 }}>
                          <Row justify="space-between" align="center">
                            <Text style={{ color: colors.foreground, ...typography.heading }}>
                              Enrolled ({enrolledList.length})
                            </Text>
                          </Row>
                          {enrolledList.length === 0 ? (
                            <Card variant="flat">
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontStyle: "italic" }}>
                                No enrolled repositories.
                              </Text>
                            </Card>
                          ) : (
                            enrolledList.map((r) => {
                              const isUnenrolling = unenrollingRepoKey === r.key;
                              return (
                                <Card key={r.key} variant="elevated">
                                  <Row justify="space-between" align="center" wrap gap="xs">
                                    <Stack gap="xxs" style={{ flex: 1, minWidth: 160 }}>
                                      <Row align="center" gap="xs" wrap>
                                        <Text
                                          style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}
                                          numberOfLines={1}
                                        >
                                          {r.key}
                                        </Text>
                                        {r.private && <Badge label="Private" variant="neutral" size="sm" />}
                                        {r.paused && <Badge label="Paused" variant="warning" size="sm" />}
                                        {r.hasOrchestrator && <Badge label="Orchestrator" variant="info" size="sm" />}
                                        {(r.queueDepth ?? 0) > 0 && (
                                          <Badge label={`${r.queueDepth} queued`} variant="info" size="sm" />
                                        )}
                                      </Row>
                                      {r.owner && (
                                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                          Owner: {r.owner}
                                        </Text>
                                      )}
                                    </Stack>
                                    <Button
                                      label={isUnenrolling ? "Unenrolling..." : "Unenroll"}
                                      size="sm"
                                      variant="danger"
                                      disabled={isUnenrolling}
                                      loading={isUnenrolling}
                                      onPress={() => void handleUnenrollRepo(r.key)}
                                    />
                                  </Row>
                                </Card>
                              );
                            })
                          )}
                        </Stack>

                        {/* Available from Forgejo */}
                        <Stack gap="xs" style={{ flex: 1, minWidth: 280 }}>
                          <Row justify="space-between" align="center">
                            <Text style={{ color: colors.foreground, ...typography.heading }}>
                              Available from Forgejo ({availableList.length})
                            </Text>
                          </Row>
                          {availableList.length === 0 ? (
                            <Card variant="flat">
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontStyle: "italic" }}>
                                All discovered repositories are enrolled.
                              </Text>
                            </Card>
                          ) : (
                            availableList.map((r) => {
                              const isEnrolling = enrollingRepoKey === r.key;
                              return (
                                <Card key={r.key} variant="elevated">
                                  <Row justify="space-between" align="center" wrap gap="xs">
                                    <Stack gap="xxs" style={{ flex: 1, minWidth: 160 }}>
                                      <Row align="center" gap="xs" wrap>
                                        <Text
                                          style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}
                                          numberOfLines={1}
                                        >
                                          {r.key}
                                        </Text>
                                        {r.private && <Badge label="Private" variant="neutral" size="sm" />}
                                      </Row>
                                      {r.owner && (
                                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                          Owner: {r.owner}
                                        </Text>
                                      )}
                                    </Stack>
                                    <Button
                                      label={isEnrolling ? "Enrolling..." : "Enroll"}
                                      size="sm"
                                      variant="primary"
                                      disabled={isEnrolling}
                                      loading={isEnrolling}
                                      onPress={() => void handleEnrollRepo(r.key)}
                                    />
                                  </Row>
                                </Card>
                              );
                            })
                          )}
                        </Stack>
                      </Row>
                    )}
                  </Stack>
                </Card>
              </Collapsible>
            );
          })()}

          {/* Collapsible Section: Hook Log Section (#365) */}
          <Collapsible
            title={`Hook Log Tail (${logTail?.lines.length ?? 0} lines)`}
            icon="Terminal"
            isExpanded={hookLogExpanded}
            onToggle={(exp) => setHookLogExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="xs">
                <Row justify="space-between" align="center">
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    Live log tail from bundled hook router:
                  </Text>
                  <Button label="Refresh logs" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchLogTail()} />
                </Row>
                <CodeBlock
                  code={(logTail?.lines ?? []).join("\n") || "No log entries available."}
                  maxHeight={220}
                  copyable={true}
                />
              </Stack>
            </Card>
          </Collapsible>


          {/* Collapsible Section: Agent Role Models (#371) */}
          <Collapsible
            title="Agent Role Models & Fallback Groups"
            icon="Cpu"
            isExpanded={roleModelsExpanded}
            onToggle={(exp) => setRoleModelsExpanded(exp)}
          >
            <Card variant="flat">
                {/* Built once per render rather than per role: every role
                    offers the same daemon model list, and rebuilding it inside
                    the map made the list look role-specific. */}
                {roleModelOptions.length === 0 && (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    No models reported by the daemon.
                  </Text>
                )}
              <Stack gap="sm">
                <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                  Configure primary model and fallback tiers for each agent role type:
                </Text>
                {Object.entries(roleModelsData?.roles ?? {}).map(([roleKey, cfg]) => {
                  // A role entry can be missing/partial in a stale payload; skip
                  // it rather than dereferencing undefined fields (#510).
                  if (!cfg || typeof cfg !== "object") return null;
                  const fallbackGroup = Array.isArray(cfg.fallbackGroup) ? cfg.fallbackGroup : [];
                  // Keep an off-list saved model selectable so a dead entry stays
                  // visible and removable rather than silently blanking out.
                  const optionsFor = (current?: string): SelectOption[] => {
                    if (current && !roleModelOptions.some((o) => o.value === current)) {
                      return [{ label: current, value: current }, ...roleModelOptions];
                    }
                    return roleModelOptions;
                  };
                  const removableOptions = optionsFor();
                  return (
                  <Card key={roleKey} variant="elevated">
                    <Stack gap="xs">
                    <Row justify="space-between" align="center" wrap gap="xs">
                      <Stack gap="xxs" style={{ flex: 1 }}>
                        <Row align="center" gap="xs">
                          <Text style={{ color: colors.foreground, ...typography.heading }}>
                            {roleKey}
                          </Text>
                          <Badge label="Active tier" variant="info" size="sm" />
                        </Row>
                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                          Primary: <Text style={{ color: colors.foreground, fontFamily: "monospace" }}>{cfg.primaryModel}</Text>
                        </Text>
                      </Stack>
                      {/* Explicit model selection (#635). This was a
                          "Switch model" button that computed
                          (available.indexOf(primary) + 1) % available.length —
                          it cycled to whatever came next and never said what
                          that was, so the control was a click-and-pray. A
                          Select names the current model, lists the real
                          choices, and makes the no-op case visible: with one
                          model available there is nothing to switch to, which
                          the old button silently did nothing about. */}
                      <Select
                        value={cfg.primaryModel}
                        label={`${roleKey} model`}
                        options={roleModelOptions}
                        onValueChange={(model) => {
                          if (model !== cfg.primaryModel) {
                            void handleRoleModelChange(roleKey, model, fallbackGroup);
                          }
                        }}
                        disabled={roleModelOptions.length < 2}
                        placeholder="Select a model"
                        size="sm"
                        style={{ minWidth: 180 }}
                      />
                    </Row>

                    {/* Full fallback chain, editable in place (#1011). Before
                        this the UI only wrote `primaryModel`; the saved
                        `fallbackGroup` rotted invisibly. */}
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                      Fallback chain (evaluated in order after the primary):
                    </Text>
                    {fallbackGroup.length === 0 ? (
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                        No fallbacks configured.
                      </Text>
                    ) : (
                      <Stack gap="xxs">
                        {fallbackGroup.map((model, index) => (
                          <Row
                            key={`${roleKey}-fallback-${index}`}
                            justify="space-between"
                            align="center"
                            gap="xs"
                            wrap
                          >
                            <Text style={{ color: colors.foreground, fontFamily: "monospace", ...typography.caption }}>
                              {index + 1}. {model}
                            </Text>
                            <Row gap="xs">
                              <Button
                                label="Make primary"
                                size="sm"
                                variant="ghost"
                                onPress={() =>
                                  void handleRoleModelChange(
                                    roleKey,
                                    model,
                                    fallbackGroup.filter((_, i) => i !== index),
                                  )
                                }
                              />
                              <Button
                                label="Remove"
                                size="sm"
                                variant="ghost"
                                onPress={() =>
                                  void handleRoleModelChange(
                                    roleKey,
                                    cfg.primaryModel,
                                    fallbackGroup.filter((_, i) => i !== index),
                                  )
                                }
                              />
                            </Row>
                          </Row>
                        ))}
                      </Stack>
                    )}
                    <Select
                      value=""
                      label={`Add ${roleKey} fallback`}
                      options={removableOptions.filter(
                        (o) => o.value !== cfg.primaryModel && !fallbackGroup.includes(o.value),
                      )}
                      onValueChange={(model) => {
                        if (!model || model === cfg.primaryModel || fallbackGroup.includes(model)) return;
                        void handleRoleModelChange(roleKey, cfg.primaryModel, [...fallbackGroup, model]);
                      }}
                      disabled={removableOptions.length === 0}
                      placeholder="Add a fallback tier"
                      size="sm"
                      style={{ minWidth: 180 }}
                    />
                    </Stack>
                  </Card>
                  );
                })}
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Fleet Skills (#883) */}
          <Collapsible
            title={`Fleet Skills${skillsData?.skills?.length ? ` (${skillsData.skills.length})` : ""}`}
            icon="BookOpen"
            isExpanded={skillsExpanded}
            onToggle={(exp) => setSkillsExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, flex: 1 }}>
                    Edit the skill text fleet agents load. Overrides live under
                    ~/.paseo/plugin-data/xpufx/uppidi-fleet/skills/; Reset restores the bundled default.
                  </Text>
                  <Button
                    label="Refresh"
                    size="sm"
                    variant="ghost"
                    icon="RefreshCw"
                    disabled={skillsLoading}
                    onPress={() => void refetchSkills()}
                  />
                </Row>

                {skillsLoading && !skillsData ? (
                  <Card variant="flat">
                    <Stack gap="xs" align="center" style={{ paddingVertical: 16 }}>
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                        Loading fleet skills...
                      </Text>
                    </Stack>
                  </Card>
                ) : (skillsData && !skillsData.ok) || skillsQueryError ? (
                  <Card variant="elevated" style={{ borderColor: colors.statusDanger }}>
                    <Row justify="space-between" align="center" wrap gap="xs">
                      <Row align="center" gap="xs">
                        <StatusDot variant="danger" />
                        <Text style={{ color: colors.statusDanger, ...typography.body }}>
                          {skillsData?.error ||
                            (skillsQueryError instanceof Error
                              ? skillsQueryError.message
                              : "Failed to load fleet skills")}
                        </Text>
                      </Row>
                      <Button
                        label="Retry"
                        size="sm"
                        variant="primary"
                        icon="RefreshCw"
                        onPress={() => void refetchSkills()}
                      />
                    </Row>
                  </Card>
                ) : (skillsData?.skills ?? []).length === 0 ? (
                  <EmptyState
                    title="No fleet skills"
                    description="The plugin reported no skills to edit."
                  />
                ) : (
                  (skillsData?.skills ?? []).map((skill) => {
                    const draft = skillDrafts[skill.id] ?? skill.content;
                    const isDirty = draft !== skill.content;
                    const isSaving = savingSkillId === skill.id;
                    const wasSaved = skillSaved[skill.id] === true && !isDirty;
                    return (
                      <Card key={skill.id} variant="elevated">
                        <Stack gap="xs">
                          <Row justify="space-between" align="center" wrap gap="xs">
                            <Stack gap="xxs" style={{ flex: 1, minWidth: 200 }}>
                              <Row align="center" gap="xs" wrap>
                                <Text style={{ color: colors.foreground, ...typography.heading }}>
                                  {skill.title}
                                </Text>
                                <Badge
                                  label={skill.origin === "override" ? "Override" : "Bundled"}
                                  variant={skill.origin === "override" ? "warning" : "neutral"}
                                  size="sm"
                                />
                                {isDirty && <Badge label="Unsaved" variant="info" size="sm" />}
                                {wasSaved && <Badge label="Saved" variant="success" size="sm" />}
                              </Row>
                              {skill.description ? (
                                <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                  {skill.description}
                                </Text>
                              ) : null}
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                                {skill.id}
                                {skill.updatedAt
                                  ? ` \u00b7 updated ${new Date(skill.updatedAt).toLocaleString()}`
                                  : ""}
                              </Text>
                            </Stack>
                            <Row gap="xs">
                              <Button
                                label={isSaving ? "Saving..." : "Save"}
                                size="sm"
                                variant="primary"
                                disabled={!isDirty || isSaving}
                                loading={isSaving}
                                onPress={() => void handleSaveSkill(skill)}
                              />
                              <Button
                                label="Reset"
                                size="sm"
                                variant="secondary"
                                disabled={isSaving || skill.origin === "bundled"}
                                onPress={() => void handleResetSkill(skill)}
                              />
                            </Row>
                          </Row>
                          <TextInput
                            value={draft}
                            onChangeText={(text) => {
                              setSkillDrafts((prev) => ({ ...prev, [skill.id]: text }));
                              setSkillSaved((prev) => ({ ...prev, [skill.id]: false }));
                            }}
                            multiline
                            numberOfLines={14}
                            mono
                            inputStyle={{ minHeight: 220, textAlignVertical: "top" }}
                            placeholder={`${skill.title} markdown`}
                          />
                        </Stack>
                      </Card>
                    );
                  })
                )}
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: CI Runners (#366, #376; Forgejo-sourced #632) */}
          <Collapsible
            title={`CI Runner Fleet (${visibleRunners.length}/${runnersData?.totalCount ?? 0} runners · ${runnersData?.onlineCount ?? 0} available)`}
            icon="Server"
            isExpanded={runnersExpanded}
            onToggle={(exp) => setRunnersExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <FleetStatusNotice fleetStatus={runnersData?.fleetStatus} error={runnersData?.error} />
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={runnerPreset === "all" ? "primary" : "ghost"}
                      onPress={() => setRunnerPreset("all")}
                    />
                    <Button
                      label="Available"
                      size="sm"
                      variant={runnerPreset === "available" ? "primary" : "ghost"}
                      onPress={() => setRunnerPreset("available")}
                    />
                    <Button
                      label="Unavailable"
                      size="sm"
                      variant={runnerPreset === "unavailable" ? "primary" : "ghost"}
                      onPress={() => setRunnerPreset("unavailable")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["name", "status", "available"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "name" ? "Name" : field === "status" ? "Status" : "Available"}${runnerSortField === field ? (runnerSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={runnerSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (runnerSortField === field) {
                            setRunnerSortDir(runnerSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setRunnerSortField(field);
                            setRunnerSortDir("asc");
                          }
                        }}
                      />
                    ))}
                    <Button label="Refresh runners" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchRunners()} />
                  </Row>
                </Row>
                <SearchInput
                  value={runnerQuery}
                  onChangeText={setRunnerQuery}
                  onClear={() => setRunnerQuery("")}
                  placeholder="Filter runners by name, status, or labels..."
                  height={26}
                />
                {visibleRunners.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    {toList(runnersData?.runners).length === 0 ? "Forgejo reports no registered runners." : "No runners match the selected filter."}
                  </Text>
                ) : (
                  visibleRunners.map((r) => {
                    const statusConfig = getRunnerStatusConfig(r?.status);
                    return (
                      <Card key={r?.id} variant="elevated">
                        <Row justify="space-between" align="center" wrap gap="xs">
                          <Stack gap="xxs">
                            <Row align="center" gap="xs">
                              <StatusDot variant={statusConfig.badgeVariant} />
                              <Text style={{ color: colors.foreground, ...typography.heading }}>{r?.name}</Text>
                              <Badge label={r?.status} variant={statusConfig.badgeVariant} size="sm" />
                              <Badge label={r?.scope} variant="neutral" size="sm" />
                            </Row>
                            <Row gap="xs" wrap style={{ marginTop: 4 }}>
                              {toList(r?.labels).map((lbl) => (
                                <Badge key={lbl} label={lbl} variant="neutral" size="sm" />
                              ))}
                            </Row>
                            {r?.description && (
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11, marginTop: 4 }}>
                                {r.description}
                              </Text>
                            )}
                          </Stack>
                          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                            {r?.version ? `v${r.version}` : "version unknown"}
                          </Text>
                        </Row>
                      </Card>
                    );
                  })
                )}
                <RunnerSourceList sources={toList(runnersData?.sources)} />
                <LocalRunnerGroup
                  runners={toList(runnersData?.localRunners)}
                  sourceError={toList(runnersData?.sources).find((s) => s.kind === "local-containers")?.error}
                />
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Fleet Capability & Benchmark Matrix (#373 / platform#18, #376) */}
          <Collapsible
            title={`Fleet Capability & Benchmark Matrix (${visibleCandidates.length}/${rawCandidates.length} candidates, ${metricsData?.totalEvaluatedTrials ?? 0} trials)`}
            icon="Activity"
            isExpanded={metricsExpanded}
            onToggle={(exp) => setMetricsExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Stack gap="xxs" style={{ flex: 1 }}>
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                      Empirical task benchmark evaluation matrix comparing candidate models against repeatable task profiles (platform#18).
                    </Text>
                    <Row align="center" gap="xs" wrap>
                      <Badge
                        label={
                          metricsData?.dataSource === "empirical"
                            ? `${metricsData?.totalEvaluatedTrials ?? 0} empirical trials across ${metricsData?.modelCount ?? 0} models`
                            : "no empirical data yet"
                        }
                        variant={metricsData?.dataSource === "empirical" ? "success" : "neutral"}
                        size="sm"
                      />
                    </Row>
                  </Stack>
                  <Button label="Refresh metrics" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchMetrics()} />
                </Row>

                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={metricPreset === "all" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("all")}
                    />
                    <Button
                      label="High Pass (≥85%)"
                      size="sm"
                      variant={metricPreset === "high-pass" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("high-pass")}
                    />
                    <Button
                      label="Worker Suitable"
                      size="sm"
                      variant={metricPreset === "bugfix-suitable" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("bugfix-suitable")}
                    />
                    <Button
                      label="Liaison Suitable"
                      size="sm"
                      variant={metricPreset === "liaison-suitable" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("liaison-suitable")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["passRate", "latency", "trials", "model"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "passRate" ? "Pass rate" : field === "latency" ? "Latency" : field === "trials" ? "Trials" : "Model"}${metricSortField === field ? (metricSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={metricSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (metricSortField === field) {
                            setMetricSortDir(metricSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setMetricSortField(field);
                            setMetricSortDir(field === "latency" || field === "model" ? "asc" : "desc");
                          }
                        }}
                      />
                    ))}
                  </Row>
                </Row>

                <SearchInput
                  value={metricQuery}
                  onChangeText={setMetricQuery}
                  onClear={() => setMetricQuery("")}
                  placeholder="Filter models by name, role, or profile advisory..."
                  height={26}
                />

                {metricsData?.privacyNotice && (
                  <Card variant="tinted">
                    <Row align="center" gap="xs">
                      <Badge label="Privacy Boundary" variant="info" size="sm" />
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption, flex: 1 }}>
                        {metricsData.privacyNotice}
                      </Text>
                    </Row>
                  </Card>
                )}

                {visibleCandidates.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    {rawCandidates.length === 0
                      ? "No empirical benchmark data yet — receipts accumulate from live fleet turns."
                      : "No model candidates match the selected filter."}
                  </Text>
                ) : (
                  visibleCandidates.map((candidate) => (
                    <Card key={candidate?.model} variant="elevated">
                      <Stack gap="xs">
                        <Row justify="space-between" align="center" wrap gap="xs">
                          <Row align="center" gap="xs">
                            <StatusDot variant={candidate?.overallPassRate >= 90 ? "success" : candidate?.overallPassRate >= 80 ? "info" : "warning"} />
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{candidate?.model}</Text>
                            <Badge label={`${candidate?.overallPassRate}% pass`} variant={candidate?.overallPassRate >= 90 ? "success" : "neutral"} size="sm" />
                            <Badge label={`${Math.round((candidate?.medianWallMs ?? 0) / 1000)}s median`} variant="neutral" size="sm" />
                            <Badge label={`${candidate?.totalTrials} trials`} variant="neutral" size="sm" />
                          </Row>
                          <Row align="center" gap="xs" wrap>
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Recommended roles:</Text>
                            {toList(candidate?.recommendedRoles).map((role) => (
                              <Badge key={role} label={role} variant="info" size="sm" />
                            ))}
                          </Row>
                        </Row>

                        {/* Task Profile breakdown */}
                        <Stack gap="xs" style={{ marginTop: 4 }}>
                          {toList(candidate?.profiles).map((p) => {
                            // A profile can arrive without its failure breakdown in
                            // a partial payload; default it so the label reads (#510).
                            const fb = p?.failureBreakdown ?? { quota: 0, timeout: 0, toolFailure: 0, checkFailure: 0 };
                            return (
                            <Card key={p?.taskProfile} variant="flat">
                              <Row justify="space-between" align="center" wrap gap="xs">
                                <Stack gap="xxs" style={{ flex: 1, minWidth: 200 }}>
                                  <Row align="center" gap="xs">
                                    <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
                                      {p?.taskProfileLabel}
                                    </Text>
                                    <Badge label={`${p?.passRate}% pass`} variant={p?.passRate >= 90 ? "success" : p?.passRate >= 80 ? "info" : "warning"} size="sm" />
                                    <Badge label={`${p?.reworkRate}% rework`} variant="neutral" size="sm" />
                                    <Badge label={p?.confidence} variant={p?.confidence === "high" ? "success" : "neutral"} size="sm" />
                                  </Row>
                                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                    {p?.advisory}
                                  </Text>
                                </Stack>
                                <Row align="center" gap="xs">
                                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                                    Failures: Q:{fb.quota} | T:{fb.timeout} | Tool:{fb.toolFailure} | Check:{fb.checkFailure}
                                  </Text>
                                </Row>
                              </Row>
                            </Card>
                            );
                          })}
                        </Stack>
                      </Stack>
                    </Card>
                  ))
                )}
              </Stack>
            </Card>
          </Collapsible>

        </Stack>
      ) : activeTab === "tooling" ? (
        <UppidiFleetToolingView />
      ) : activeTab === "tree" ? (
        <UppidiFleetTreeView
          agentsData={agentsData}
          isLoading={agentsLoading}
          onRefresh={refetchAgents}
          navigation={props.navigation}
          onArchiveAgent={handleArchiveAgent}
          onArchiveBulk={handleArchiveBulk}
          isArchiving={isBulkArchiving}
          selectedRepo={selectedRepo}
          registeredFrontDeskAgentId={hookStatus?.frontDesk?.agentId ?? null}
        />
      ) : activeTab === "board" ? (
        <Card variant="elevated" style={{ width: "100%" }}>
          <CardHeader
            title="Kanban Board"
            subtitle={`${rawIssues.length} issues across states`}
            icon="Kanban"
            action={
              <Button
                label="Refresh"
                size="sm"
                icon="RefreshCw"
                variant="ghost"
                onPress={() => {
                  void refetchIssues();
                }}
              />
            }
          />
          <UppidiFleetKanbanBoard
            issues={rawIssues}
            selectedRepo={selectedRepo}
            onSelectIssue={(num) => setSelectedNumber(num)}
            onTransitionIssue={handleTransitionIssue}
            isLoading={issuesLoading}
          />
        </Card>
      ) : activeTab === "forges" ? (
        <ModalBodyScrollOwnerContext.Provider value="host">
          <ForgeIssuesView
            workspaceId={activeWorkspaceId}
            directory={activeWorkspaceDirectory}
            selectedRepo={selectedRepo}
            onSelectRepo={setSelectedRepo}
            enrolledRepos={availableRepos}
            activeRepo={issuesData?.repo ?? undefined}
          />
        </ModalBodyScrollOwnerContext.Provider>
      ) : (
        <Stack gap={6}>
          {/* Fleet Attention Board (#534): blocked agents need immediate clearance */}
          {attentionAgents.length > 0 && (
            <Card variant="tinted" style={{ borderColor: colors.statusWarning, borderWidth: 1 }}>
              <CardHeader
                title={`Fleet Needs Attention (${attentionAgents.length})`}
                subtitle={
                  permissionAgentCount > 0
                    ? `${permissionAgentCount} agent${
                        permissionAgentCount === 1 ? "" : "s"
                      } awaiting permission clearance`
                    : "Agents blocked awaiting operator input"
                }
                icon="BellRing"
              />
              <Stack gap="xs">
                {attentionAgents.slice(0, 5).map((agent) => (
                  <AttentionAgentCard
                    key={agent.id}
                    agent={agent}
                    onOpen={handleOpenAgent}
                  />
                ))}
                {attentionAgents.length > 5 && (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                    +{attentionAgents.length - 5} more blocked agents — see the Agents &amp; Fleet tab.
                  </Text>
                )}
              </Stack>
            </Card>
          )}

          {/* Dense Metrics Bar (#424) */}
          <MetricsBar
            chips={[
              {
                id: "all",
                label: "Open issues",
                count: issuesData?.openCount ?? rawIssues.length,
                icon: "CircleDot",
                tone: "accent",
                alwaysToned: true,
              },
              {
                id: "needs-you",
                label: "Needs your attention",
                count: issuesData?.needsYouCount ?? 0,
                icon: "Bot",
                tone: "statusWarning",
                countTone: "statusWarning",
              },
              {
                id: "triage-review",
                label: "Awaiting review",
                count: issuesData?.reviewCount ?? 0,
                icon: "GitPullRequest",
                tone: "accent",
                countTone: "accent",
              },
              ...EXTRA_METRIC_PRESETS.map(({ id, label, icon, tone }) => ({
                id,
                label,
                count: presetCounts[id],
                icon,
                tone,
              })),
            ]}
            selectedId={filter}
            onSelect={(id) => setFilter(id as IssuePreset)}
            colors={colors}
            typography={typography}
          >
            <View style={{ flex: 1 }} />
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 10 }}>
              {selectedRepo === "all" ? "All Repositories" : `Repo: ${selectedRepo}`}
            </Text>
          </MetricsBar>

          {/* Work Queue (Full Width) (#425) */}
          <Card variant="elevated" style={{ width: "100%" }}>
            <CardHeader
              title="Work queue"
              subtitle={`${visible.length} issues in view`}
              icon="ListTodo"
              action={
                <Row gap="xs" align="center">
                  <Row
                    gap="xxs"
                    align="center"
                    style={{
                      backgroundColor: colors.surface1,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 6,
                      padding: 2,
                    }}
                  >
                    <Button
                      label="Table"
                      size="sm"
                      icon="List"
                      variant={queueViewMode === "table" ? "secondary" : "ghost"}
                      onPress={() => setQueueViewMode("table")}
                    />
                    <Button
                      label="Board"
                      size="sm"
                      icon="Kanban"
                      variant={queueViewMode === "board" ? "secondary" : "ghost"}
                      onPress={() => setQueueViewMode("board")}
                    />
                  </Row>
                  <Button
                    label="Dispatch work"
                    size="sm"
                    icon="ArrowRight"
                    iconPosition="right"
                    variant="ghost"
                    onPress={() => {
                      if (visible[0]) {
                        toast.show(`Worktree dispatch requested for #${visible[0].number}`);
                      }
                    }}
                  />
                </Row>
              }
            />
            {queueViewMode === "board" ? (
              <UppidiFleetKanbanBoard
                issues={visible}
                selectedRepo={selectedRepo}
                onSelectIssue={(num) => setSelectedNumber(num)}
                onTransitionIssue={handleTransitionIssue}
                filterQuery={query}
                onFilterQueryChange={setQuery}
                isLoading={issuesLoading}
              />
            ) : (
              <>
            <NewIssueComposer
              directory={activeWorkspaceDirectory}
              onCreated={() => {
                void refetchIssues?.();
              }}
            />
            <Row justify="space-between" align="center" wrap gap="xs">
              <View style={{ flex: 1, minWidth: 200 }}>
                <SearchInput
                  value={query}
                  onChangeText={setQuery}
                  onClear={() => setQuery("")}
                  placeholder="Filter by title, number, or label..."
                  height={26}
                />
              </View>
              <Row gap="xs" align="center" wrap>
                <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                {(["number", "title", "status", "comments", "repo"] as const).map((field) => (
                  <Button
                    key={field}
                    label={`${field === "number" ? "#" : field === "title" ? "Title" : field === "status" ? "Status" : field === "comments" ? "Comments" : "Repo"}${issueSortField === field ? (issueSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                    size="sm"
                    variant={issueSortField === field ? "secondary" : "ghost"}
                    onPress={() => {
                      if (issueSortField === field) {
                        setIssueSortDir(issueSortDir === "asc" ? "desc" : "asc");
                      } else {
                        setIssueSortField(field);
                        setIssueSortDir(field === "number" || field === "comments" ? "desc" : "asc");
                      }
                    }}
                  />
                ))}
              </Row>
            </Row>
            <DataTable
              data={visible}
              keyExtractor={(issue) => String(issue.number)}
              emptyState={
                <EmptyState
                  title={
                    issuesData?.ok === false && issuesData?.error
                      ? "Could not load issues"
                      : selectedRepo !== "all" && issuesData?.ok && issuesData?.issues.length === 0
                        ? `No open issues in ${selectedRepo}`
                        : "No issues match this filter"
                  }
                  description={
                    issuesData?.ok === false && issuesData?.error
                      ? issuesData.error
                      : "Try changing the filter or search query."
                  }
                  actionLabel="Clear filters"
                  onAction={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                />
              }
              columns={[
                {
                  key: "issue",
                  header: "Issue",
                  flex: 3,
                  render: (issue) => (
                    <Button
                      label={`#${issue.number} · ${issue.title}`}
                      variant="ghost"
                      size="sm"
                      onPress={() => setSelectedNumber(issue.number)}
                    />
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  flex: 1,
                  render: (issue) => <Badge label={issue.status} variant={statusVariant(issue.status)} size="sm" />,
                },
                {
                  key: "attention",
                  header: "Owner",
                  flex: 1,
                  render: (issue) => (
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                      {attentionMap[issue.attention]}
                    </Text>
                  ),
                },
                {
                  key: "forge",
                  header: "Forge",
                  flex: 1,
                  render: (issue) =>
                    issue.url ? (
                      <Button
                        label="Open"
                        icon={<UppidiBrandMark size={14} />}
                        variant="ghost"
                        size="sm"
                        accessibilityLabel={`Open #${issue.number} in Forgejo`}
                        onPress={() => Linking.openURL(issue.url!)}
                      />
                    ) : null,
                },
              ]}
            />
            </>
            )}
          </Card>

          {/* Center Modal for Selected Work (#425) */}
          {selected && (
            <Modal
              title={`#${selected.number} · ${selected.title}`}
              open={selectedNumber !== null}
              onOpenChange={(open) => {
                if (!open) setSelectedNumber(null);
              }}
            >
              <ModalContent size="large">
                <Stack gap="xs">
                  <Row justify="space-between" align="center" wrap gap="xs">
                    <Text
                      style={{
                        color: colors.accent,
                        ...typography.caption,
                        fontWeight: "600",
                        minWidth: 0,
                        flexShrink: 1,
                      }}
                    >
                      {selectedRepoIdentity?.key ?? selected.repo} #{selected.number}
                    </Text>
                    <Row wrap gap="xs">
                      <Badge label={selected.status} variant={statusVariant(selected.status)} size="sm" />
                      <Badge label={attentionMap[selected.attention]} variant="neutral" size="sm" />
                      {selected.comments > 0 && (
                        <Badge label={`${selected.comments} comments`} variant="neutral" size="sm" />
                      )}
                    </Row>
                  </Row>

                  <Text
                    style={{
                      color: colors.foreground,
                      ...typography.heading,
                      fontSize: 16,
                      fontWeight: "700",
                      minWidth: 0,
                      flexShrink: 1,
                    }}
                  >
                    {selected.title}
                  </Text>

                  {toList(selected.labels).length > 0 && (
                    <Row wrap gap="xxs">
                      {toList(selected.labels).map((l) => (
                        <Badge key={l} label={l} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
                      ))}
                    </Row>
                  )}

                  <TicketLifecycleView
                    issueNumber={selected.number}
                    workspaceId={activeWorkspaceId}
                    directory={activeWorkspaceDirectory}
                    repo={selectedRepoIdentity?.compact ?? selected.repo}
                    remoteUrl={
                      (selected as any).remoteUrl ||
                      (selectedRepoIdentity ? canonicalForgeUrl(selectedRepoIdentity) : undefined)
                    }
                    onRefresh={() => {
                      void refetchIssues?.();
                    }}
                  >
                    <KeyValue
                      label="Worktree branch"
                      value={selected.branch ?? "No worktree dispatched yet"}
                      copyable={!!selected.branch}
                    />

                    {/* Actions: Dispatch Worktree, Open in Forgejo, Close */}
                    <Row justify="flex-end" align="center" wrap gap="xs" style={{ marginTop: 8 }}>
                      <Button
                        label="Close"
                        variant="ghost"
                        size="sm"
                        onPress={() => setSelectedNumber(null)}
                      />
                      {selected.url && (
                        <Button
                          label="Open in Forgejo"
                          icon="ExternalLink"
                          variant="secondary"
                          size="sm"
                          onPress={() => Linking.openURL(selected.url!)}
                        />
                      )}
                      <Button
                        label="Dispatch Worktree"
                        icon="ArrowRight"
                        variant="primary"
                        size="sm"
                        onPress={() => {
                          toast.show(`Worktree dispatch requested for #${selected.number}`);
                        }}
                      />
                    </Row>
                  </TicketLifecycleView>
                </Stack>
              </ModalContent>
            </Modal>
          )}
        </Stack>
      )}
      <TeardownModal
        visible={isTeardownModalOpen}
        onClose={() => setIsTeardownModalOpen(false)}
        onConfirm={handleTeardown}
        isProcessing={isTearingDown}
      />
      <ResetStateModal
        visible={isResetStateModalOpen}
        onClose={() => setIsResetStateModalOpen(false)}
        onConfirm={handleResetState}
        isProcessing={isResettingState}
      />
      <HaltConfirmModal
        visible={isHaltModalOpen}
        onClose={() => setIsHaltModalOpen(false)}
        onConfirm={handleHalt}
        isProcessing={isHalting}
        isHalted={isHalted}
      />
    </ModalBody>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  const { colors, typography } = useFleetTheme();
  return (
    <Card variant="elevated">
      <CardHeader title={label} value={value} icon={icon} />
      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{detail}</Text>
    </Card>
  );
}

export const UppidiForgeSurface = UppidiFleetSurface;

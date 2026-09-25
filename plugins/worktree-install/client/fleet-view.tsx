import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { AgentNode, FleetAgent, FleetOutput, Ticket } from "../shared/contracts.js";
import {
  STATE_FILTERS,
  adjudicationCommand,
  attentionReasonLabel,
  blockedAgents,
  blockedSummary,
  bulkArchiveCandidates,
  buildProjectGroups,
  buildTree,
  durationText,
  elapsedSince,
  flattenTree,
  healthGauge,
  displayableLabels,
  matchesStateFilter,
  agentMatchesQuery,
  filterTree,
  isBlocked,
  parentPillLabel,
  permissionAction,
  relativeTime,
  repoMatches,
  statePresentation,
  worktreeSlug,
  type ProjectGroup,
  type StateFilter,
} from "../shared/derive.js";
import {
  Banner,
  Beacon,
  Chip,
  Cluster,
  Command,
  Empty,
  Field,
  Guide,
  Hairline,
  LiveDot,
  Press,
  ScopeChips,
  SearchField,
  Stack,
  Stat,
  Type,
  openAgent,
  stateTone,
  toneColorOf,
  useSkin,
} from "./kit.js";

export interface FleetActions {
  onArchive: (agentId: string) => Promise<void> | void;
  onArchiveBulk: (agentIds: string[]) => Promise<void> | void;
  onCreateFrontDesk: () => Promise<void> | void;
  onReplaceFrontDesk: (existingAgentId?: string) => Promise<void> | void;
  onAddOrchestrator: (repo: string) => Promise<void> | void;
  onReplaceOrchestrator: (repo: string, existingAgentId?: string) => Promise<void> | void;
  onMuteRepo: (repo: string, muted: boolean) => Promise<void> | void;
  busyAgentId?: string | null;
  busyRepo?: string | null;
  busyFrontDesk?: boolean;
}

export function FleetView({
  data,
  tickets,
  loading,
  repoScope,
  onRepoScope,
  actions,
  navigation,
}: {
  data?: FleetOutput;
  tickets: Ticket[];
  loading?: boolean;
  repoScope: string;
  onRepoScope: (repo: string) => void;
  actions: FleetActions;
  navigation?: PluginSurfaceProps["navigation"];
}) {
  const { palette, narrow } = useSkin();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [orchCollapsed, setOrchCollapsed] = useState<Record<string, boolean>>({});
  const [expandedMetrics, setExpandedMetrics] = useState<Record<string, boolean>>({});

  const agents = useMemo(
    () => [...(data?.frontDesk ?? []), ...(data?.orchestrators ?? []), ...(data?.workers ?? [])],
    [data],
  );

  const summary = useMemo(() => blockedSummary(agents), [agents]);
  const blocked = useMemo(() => blockedAgents(agents), [agents]);
  const bulkCandidates = useMemo(() => bulkArchiveCandidates(agents), [agents]);

  const fullTree = useMemo(() => buildTree(agents), [agents]);
  const registeredFrontDeskId =
    tickets.find((t) => t.branch && t.attention === "attention/2-user")?.branch ?? null;

  const filteredTree = useMemo(
    () =>
      filterTree(fullTree, (agent) => {
        if (!matchesStateFilter(agent, stateFilter)) return false;
        return agentMatchesQuery(agent, query);
      }),
    [fullTree, stateFilter, query],
  );

  const groups = useMemo(
    () =>
      buildProjectGroups(filteredTree, {
        enrolledRepos: data?.enrolledRepos,
        mutedRepos: data?.mutedRepos,
        repoQueuedHooks: data?.repoQueuedHooks,
        registeredFrontDeskAgentId: registeredFrontDeskId,
      }),
    [filteredTree, data, registeredFrontDeskId],
  );

  const visible = (list: ProjectGroup[]) =>
    repoScope === "all" ? list : list.filter((g) => repoMatches(g.projectName, repoScope));

  const enrolled = visible(groups.enrolled);
  const detached = visible(groups.detached);
  const allProjects = [...enrolled, ...detached];
  const allCollapsed = allProjects.length > 0 && allProjects.every((g) => collapsed[g.projectName]);

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    for (const group of allProjects) next[group.projectName] = !allCollapsed;
    setCollapsed(next);
  };

  const frontDeskNode = groups.frontDesk[0] ?? null;
  const orchestrators = flattenTree(groups.enrolled.concat(groups.detached).flatMap((g) => g.orchestrators));

  const repoOptions = useMemo(() => {
    const set = new Set<string>(data?.enrolledRepos ?? []);
    for (const group of allProjects) set.add(group.projectName);
    return [
      { label: "All repositories", value: "all" },
      ...Array.from(set).sort().map((r) => ({ label: r, value: r })),
    ];
  }, [data?.enrolledRepos, allProjects]);

  const filtered = query.trim() !== "" || stateFilter !== "all";

  return (
    <Stack gap={8} testID="fleet-view">
      {/* Counts. Every number here is also on the row it describes. */}
      <Cluster gap={2} wrap={false} testID="fleet-stats">
        <LiveDot tone={data?.runningCount ? "ok" : "muted"} pulse={Boolean(data?.runningCount)} />
        <Type size={13} weight="700">
          Fleet
        </Type>
        <Stat label="total" value={data?.totalCount ?? 0} testID="stat-total" />
        <Stat label="running" value={data?.runningCount ?? 0} tone="ok" testID="stat-running" />
        <Stat label="idle" value={data?.idleCount ?? 0} testID="stat-idle" />
        {data?.errorCount ? (
          <Stat label="failed" value={data.errorCount} tone="critical" testID="stat-failed" />
        ) : null}
        {summary.total > 0 ? (
          <Stat label="blocked" value={summary.total} tone="warn" testID="stat-blocked" />
        ) : null}
        <View style={{ flex: 1 }} />
        <Press
          testID="bulk-archive"
          onPress={() => actions.onArchiveBulk(bulkCandidates.map((a) => a.id))}
          disabled={bulkCandidates.length === 0}
          tone="muted"
          accessibilityLabel={`Archive ${bulkCandidates.length} terminal agents`}
        >
          <Type size={10} weight="600" color={palette.textDim}>
            archive closed · {bulkCandidates.length}
          </Type>
        </Press>
        <Press
          testID="collapse-all"
          onPress={toggleAll}
          disabled={allProjects.length === 0}
          tone="accent"
          accessibilityLabel={allCollapsed ? "Expand all projects" : "Collapse all projects"}
        >
          <Type size={10} weight="600" color={palette.accent}>
            {allCollapsed ? "expand all" : "collapse all"}
          </Type>
        </Press>
      </Cluster>

      <Hairline />

      {/* Filters */}
      <Cluster gap={6} testID="fleet-filters">
        <Cluster gap={2} wrap={false}>
          {STATE_FILTERS.map((filter) => (
            <Press
              key={filter.id}
              testID={`state-filter-${filter.id}`}
              selected={stateFilter === filter.id}
              onPress={() => setStateFilter(filter.id)}
              tone="accent"
              style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3 }}
            >
              <Type size={10} weight={stateFilter === filter.id ? "700" : "500"} color={stateFilter === filter.id ? palette.accent : palette.textDim}>
                {filter.label}
              </Type>
            </Press>
          ))}
        </Cluster>
        <SearchField
          testID="fleet-search"
          value={query}
          onChange={setQuery}
          placeholder="name, id, state, model, worktree, project, #issue"
        />
        <ScopeChips testID="fleet-scope" options={repoOptions} value={repoScope} onChange={onRepoScope} />
      </Cluster>

      {blocked.length > 0 ? (
        <Banner
          testID="fleet-blocked"
          tone="warn"
          title={`${summary.total} blocked · ${summary.permissions} on a permission · ${summary.awaitingInput} awaiting input`}
          detail={blocked
            .slice(0, 4)
            .map((a) => `${a.name} (${statePresentation(a.deterministicState).label})`)
            .join(" · ")}
          actions={
            <Press
              testID="fleet-blocked-open"
              onPress={() => openAgent(blocked[0]!, navigation?.openAgent)}
              tone="warn"
              accessibilityLabel={`Open ${blocked[0]!.name}`}
            >
              <Type size={9} weight="700" color={palette.warn} upper>
                open
              </Type>
            </Press>
          }
        />
      ) : null}

      {/* Liaison */}
      <FrontDeskCard
        node={frontDeskNode}
        orchestrators={orchestrators}
        metricsOpen={Boolean(frontDeskNode && expandedMetrics[frontDeskNode.agent.id])}
        onToggleMetrics={() =>
          frontDeskNode &&
          setExpandedMetrics((prev) => ({ ...prev, [frontDeskNode.agent.id]: !prev[frontDeskNode.agent.id] }))
        }
        actions={actions}
        navigation={navigation}
      />

      {enrolled.length === 0 && detached.length === 0 ? (
        <Empty
          testID="fleet-empty"
          title={loading ? "Reading the roster…" : frontDeskNode ? "No repositories match" : "No agents yet"}
          detail={
            loading
              ? "Asking the daemon for its agent list."
              : filtered
                ? `Nothing matches ${stateFilter !== "all" ? `state "${stateFilter}"` : ""}${
                    query.trim() ? ` and "${query.trim()}"` : ""
                  }.`
                : "No Paseo agent sessions are visible to this plugin."
          }
          action={
            filtered ? (
              <Press
                testID="fleet-clear"
                tone="accent"
                onPress={() => {
                  setQuery("");
                  setStateFilter("all");
                }}
                accessibilityLabel="Clear filters"
              >
                <Type size={10} weight="700" color={palette.accent} upper>
                  clear filters
                </Type>
              </Press>
            ) : undefined
          }
        />
      ) : (
        <Stack gap={6} testID="fleet-projects">
          {enrolled.map((group) => (
            <ProjectBlock
              key={`enrolled-${group.projectName}`}
              group={group}
              collapsed={Boolean(collapsed[group.projectName]) && !filtered}
              onToggle={() =>
                setCollapsed((prev) => ({ ...prev, [group.projectName]: !prev[group.projectName] }))
              }
              orchCollapsed={orchCollapsed}
              onToggleOrch={(id) => setOrchCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
              expandedMetrics={expandedMetrics}
              onToggleMetrics={(id) => setExpandedMetrics((prev) => ({ ...prev, [id]: !prev[id] }))}
              actions={actions}
              navigation={navigation}
            />
          ))}
          {detached.length > 0 ? (
            <Stack gap={4} testID="fleet-detached">
              <Cluster gap={5}>
                <Type size={9} weight="700" color={palette.textFaint} upper>
                  detached / local · {detached.length}
                </Type>
                <View style={{ flex: 1 }}>
                  <Hairline />
                </View>
              </Cluster>
              {detached.map((group) => (
                <ProjectBlock
                  key={`detached-${group.projectName}`}
                  group={group}
                  collapsed={Boolean(collapsed[group.projectName]) && !filtered}
                  onToggle={() =>
                    setCollapsed((prev) => ({ ...prev, [group.projectName]: !prev[group.projectName] }))
                  }
                  orchCollapsed={orchCollapsed}
                  onToggleOrch={(id) => setOrchCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
                  expandedMetrics={expandedMetrics}
                  onToggleMetrics={(id) => setExpandedMetrics((prev) => ({ ...prev, [id]: !prev[id] }))}
                  actions={actions}
                  navigation={navigation}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      )}

      {groups.staleFrontDesk.length > 0 ? (
        <Stack gap={4} testID="fleet-stale">
          <Cluster gap={5}>
            <Type size={9} weight="700" color={palette.textFaint} upper>
              orphaned liaison sessions · {groups.staleFrontDesk.length}
            </Type>
            <View style={{ flex: 1 }}>
              <Hairline />
            </View>
          </Cluster>
          <Type size={10} color={palette.textFaint}>
            The liaison is a singleton. These duplicates are not registered with the router and can be archived.
          </Type>
          {groups.staleFrontDesk.map((node, index) => (
            <AgentRow
              key={node.agent.id}
              node={node}
              last={index === groups.staleFrontDesk.length - 1}
              compact
              metricsOpen={Boolean(expandedMetrics[node.agent.id])}
              onToggleMetrics={() =>
                setExpandedMetrics((prev) => ({ ...prev, [node.agent.id]: !prev[node.agent.id] }))
              }
              actions={actions}
              navigation={navigation}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

// --- Liaison --------------------------------------------------------------

function FrontDeskCard({
  node,
  orchestrators,
  metricsOpen,
  onToggleMetrics,
  actions,
  navigation,
}: {
  node: AgentNode | null;
  orchestrators: FleetAgent[];
  metricsOpen: boolean;
  onToggleMetrics: () => void;
  actions: FleetActions;
  navigation?: PluginSurfaceProps["navigation"];
}) {
  const { palette } = useSkin();

  return (
    <View
      testID="front-desk"
      style={{
        borderWidth: 1,
        borderColor: palette.rule,
        borderLeftWidth: 3,
        borderLeftColor: node ? toneColorOf(palette, stateTone(node.agent.deterministicState)) : palette.ruleStrong,
        backgroundColor: palette.panel,
        borderRadius: 4,
        padding: 8,
        gap: 6,
      }}
    >
      <Cluster gap={6} justify="between" align="start">
        <Cluster gap={6} align="center">
          <LiveDot
            testID="front-desk-dot"
            tone={node ? stateTone(node.agent.deterministicState) : "muted"}
            pulse={node ? statePresentation(node.agent.deterministicState).active : false}
            size={8}
          />
          <Stack gap={2}>
            <Cluster gap={5}>
              <Type size={9} weight="700" color={palette.textFaint} upper>
                liaison
              </Type>
              <Chip label={node ? "active" : "standby"} tone={node ? "ok" : "muted"} testID="front-desk-status" />
            </Cluster>
            {node ? (
              <AgentIdentity agent={node.agent} navigation={navigation} size="md" />
            ) : (
              <Type size={12} color={palette.textDim}>
                No liaison session running. Webhook events route to standbys.
              </Type>
            )}
          </Stack>
        </Cluster>

        <Cluster gap={4}>
          {node ? (
            <>
              <Press
                testID="front-desk-replace"
                tone="accent"
                disabled={actions.busyFrontDesk}
                onPress={() => actions.onReplaceFrontDesk(node.agent.id)}
                accessibilityLabel="Replace liaison session"
              >
                <Type size={10} weight="600" color={palette.accent}>
                  replace
                </Type>
              </Press>
              <Press
                testID="front-desk-archive"
                tone="muted"
                disabled={actions.busyAgentId === node.agent.id}
                onPress={() => actions.onArchive(node.agent.id)}
                accessibilityLabel={`Archive ${node.agent.name}`}
              >
                <Type size={10} weight="600" color={palette.textDim}>
                  archive
                </Type>
              </Press>
            </>
          ) : (
            <Press
              testID="front-desk-create"
              tone="accent"
              disabled={actions.busyFrontDesk}
              onPress={() => actions.onCreateFrontDesk()}
              accessibilityLabel="Create liaison session"
              style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: palette.accent, borderRadius: 3 }}
            >
              <Type size={10} weight="700" color={palette.accentText} upper>
                create
              </Type>
            </Press>
          )}
        </Cluster>
      </Cluster>

      {node ? (
        <>
          <Cluster gap={5} testID="front-desk-facts">
            <StateChip agent={node.agent} />
            {node.agent.model ? <Chip label={node.agent.model} tone="muted" mono /> : null}
            {node.agent.worktree ? <Chip label={node.agent.worktree} tone="muted" mono /> : null}
            <Chip
              label={relativeTime(node.agent.lastActivityAt) || "no activity yet"}
              tone="muted"
            />
            {node.agent.metrics ? (
              <Press
                testID="front-desk-gauge"
                tone={healthGauge(node.agent).overall}
                onPress={onToggleMetrics}
                accessibilityLabel={`${node.agent.name} health. Show metrics`}
                style={{ padding: 2, margin: 0, gap: 2 }}
              >
                <Gauge gauge={healthGauge(node.agent)} active={metricsOpen} />
              </Press>
            ) : null}
            <Press
              testID="front-desk-metrics"
              tone="muted"
              onPress={onToggleMetrics}
              accessibilityLabel="Toggle agent metrics"
            >
              <Type size={9} weight="700" color={palette.textFaint} upper>
                metrics
              </Type>
            </Press>
          </Cluster>
          <LabelStrip agent={node.agent} />
          {isBlocked(node.agent) ? <AttentionStrip agent={node.agent} navigation={navigation} /> : null}
          {metricsOpen ? <MetricsSheet agent={node.agent} /> : null}
        </>
      ) : null}

      {orchestrators.length > 0 ? (
        <Cluster gap={5} testID="front-desk-orchestrators">
          <Type size={9} weight="700" color={palette.textFaint} upper>
            orchestrators · {orchestrators.length}
          </Type>
          <View style={{ flex: 1 }}>
            <Hairline />
          </View>
          <Cluster gap={4}>
            {orchestrators.map((agent) => (
              <Press
                key={agent.id}
                testID={`orchestrator-light-${agent.id}`}
                tone={stateTone(agent.deterministicState)}
                onPress={() => openAgent(agent, navigation?.openAgent)}
                accessibilityLabel={`Open ${agent.name}, ${statePresentation(agent.deterministicState).label}`}
                style={{ padding: 2 }}
              >
                <LiveDot
                  tone={stateTone(agent.deterministicState)}
                  pulse={statePresentation(agent.deterministicState).active}
                  size={7}
                />
              </Press>
            ))}
          </Cluster>
        </Cluster>
      ) : null}
    </View>
  );
}

// --- Project --------------------------------------------------------------

function ProjectBlock({
  group,
  collapsed,
  onToggle,
  orchCollapsed,
  onToggleOrch,
  expandedMetrics,
  onToggleMetrics,
  actions,
  navigation,
}: {
  group: ProjectGroup;
  collapsed: boolean;
  onToggle: () => void;
  orchCollapsed: Record<string, boolean>;
  onToggleOrch: (id: string) => void;
  expandedMetrics: Record<string, boolean>;
  onToggleMetrics: (id: string) => void;
  actions: FleetActions;
  navigation?: PluginSurfaceProps["navigation"];
}) {
  const { palette } = useSkin();
  const workers = group.totalCount - group.orchestrators.length;
  const childNodes = group.orchestrators.flatMap((o) => o.children);

  return (
    <View
      testID={`project-${group.projectName}`}
      style={{
        borderWidth: 1,
        borderColor: group.isMuted ? palette.wash("warn", 0.4) : palette.rule,
        borderRadius: 4,
        backgroundColor: palette.panel,
        opacity: group.isMuted ? 0.8 : 1,
        overflow: "hidden",
      }}
    >
      <Press
        testID={`project-header-${group.projectName}`}
        onPress={onToggle}
        tone="accent"
        hover
        align="center"
        justify="between"
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${group.projectName}`}
        style={{ paddingHorizontal: 8, paddingVertical: 6, gap: 8 }}
      >
        <Cluster gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Type size={10} mono color={palette.textFaint}>
            {collapsed ? "▸" : "▾"}
          </Type>
          <Type size={12} weight="700" numberOfLines={1} testID={`project-name-${group.projectName}`}>
            {group.projectName}
          </Type>
          <Chip label={`${group.orchestrators.length} orch`} tone="muted" />
          <Chip label={`${workers} worker${workers === 1 ? "" : "s"}`} tone="muted" />
          {group.runningCount > 0 ? <Chip label={`${group.runningCount} active`} tone="ok" dot /> : null}
          {group.isMuted ? <Chip label="muted" tone="warn" dot strong /> : null}
          {group.isEnrolled && !group.hasOrchestrator ? <Chip label="no orchestrator" tone="warn" /> : null}
          {group.queuedHooksCount > 0 ? <Chip label={`${group.queuedHooksCount} queued`} tone="accent" dot /> : null}
          {group.isDetached ? <Chip label="detached" tone="muted" /> : null}
          {collapsed ? <Chip label={`${group.totalCount} total`} tone="muted" /> : null}
        </Cluster>
        <Cluster gap={4} wrap={false}>
          {group.isEnrolled ? (
            <>
              <Press
                testID={`project-mute-${group.projectName}`}
                tone="warn"
                disabled={actions.busyRepo === group.projectName}
                onPress={() => actions.onMuteRepo(group.projectName, !group.isMuted)}
                accessibilityLabel={group.isMuted ? `Unmute ${group.projectName}` : `Mute ${group.projectName}`}
              >
                <Type size={9} weight="700" color={group.isMuted ? palette.warn : palette.textFaint} upper>
                  {group.isMuted ? "unmute" : "mute"}
                </Type>
              </Press>
              {!group.hasOrchestrator ? (
                <Press
                  testID={`project-add-orch-${group.projectName}`}
                  tone="accent"
                  disabled={actions.busyRepo === group.projectName}
                  onPress={() => actions.onAddOrchestrator(group.projectName)}
                  accessibilityLabel={`Add an orchestrator for ${group.projectName}`}
                >
                  <Type size={9} weight="700" color={palette.accent} upper>
                    + orchestrator
                  </Type>
                </Press>
              ) : (
                <Press
                  testID={`project-replace-orch-${group.projectName}`}
                  tone="accent"
                  disabled={actions.busyRepo === group.projectName}
                  onPress={() => actions.onReplaceOrchestrator(group.projectName, group.orchestrators[0]?.agent.id)}
                  accessibilityLabel={`Replace the orchestrator for ${group.projectName}`}
                >
                  <Type size={9} weight="700" color={palette.accent} upper>
                    replace
                  </Type>
                </Press>
              )}
            </>
          ) : null}
        </Cluster>
      </Press>

      {!collapsed ? (
        <Stack gap={0} testID={`project-body-${group.projectName}`}>
          <Hairline />
          {group.totalCount === 0 ? (
            <Type size={11} color={palette.textFaint} style={{ padding: 8, fontStyle: "italic" } as never}>
              Enrolled repository is unstaffed.
            </Type>
          ) : (
            <Stack gap={0} style={{ paddingVertical: 4 }}>
              {group.orchestrators.map((node, index) => (
                <Stack key={node.agent.id} gap={0}>
                  <AgentRow
                    node={node}
                    last={index === group.orchestrators.length - 1 && group.unparentedWorkers.length === 0}
                    orchestrator
                    collapsible={childNodes.length > 0}
                    expanded={!orchCollapsed[node.agent.id]}
                    childCount={childNodes.length}
                    onToggleExpand={() => onToggleOrch(node.agent.id)}
                    metricsOpen={Boolean(expandedMetrics[node.agent.id])}
                    onToggleMetrics={() => onToggleMetrics(node.agent.id)}
                    actions={actions}
                    navigation={navigation}
                  />
                  {!orchCollapsed[node.agent.id] &&
                    childNodes.map((child, childIndex) => (
                      <AgentRow
                        key={child.agent.id}
                        node={child}
                        last={childIndex === childNodes.length - 1}
                        depth={1}
                        compact
                        metricsOpen={Boolean(expandedMetrics[child.agent.id])}
                        onToggleMetrics={() => onToggleMetrics(child.agent.id)}
                        actions={actions}
                        navigation={navigation}
                      />
                    ))}
                </Stack>
              ))}
              {group.unparentedWorkers.map((node, index) => (
                <AgentRow
                  key={node.agent.id}
                  node={node}
                  last={index === group.unparentedWorkers.length - 1}
                  depth={1}
                  compact
                  metricsOpen={Boolean(expandedMetrics[node.agent.id])}
                  onToggleMetrics={() => onToggleMetrics(node.agent.id)}
                  actions={actions}
                  navigation={navigation}
                />
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}
    </View>
  );
}

// --- Agent rows -----------------------------------------------------------

function AgentIdentity({
  agent,
  navigation,
  size,
}: {
  agent: FleetAgent;
  navigation?: PluginSurfaceProps["navigation"];
  size?: "sm" | "md";
}) {
  const { palette, narrow } = useSkin();
  const parent = parentPillLabel(agent);
  return (
    <Cluster gap={5} style={{ minWidth: 0 }}>
      <Press
        testID={`agent-link-${agent.id}`}
        accessibilityRole="link"
        accessibilityLabel={`Open ${agent.name}`}
        onPress={() => openAgent(agent, navigation?.openAgent)}
        tone="accent"
        style={{ padding: 0, margin: 0 }}
      >
        <Type size={size === "sm" ? 11 : 12} weight="700" numberOfLines={1} testID={`agent-name-${agent.id}`}>
          {agent.name}
        </Type>
      </Press>
      <Chip label={agent.shortId} tone="muted" mono />
      {agent.category !== "worker" ? <Chip label={agent.category} tone="accent" /> : null}
      {parent ? (
        <Press
          testID={`agent-parent-${agent.id}`}
          tone="muted"
          disabled={!agent.parentId}
          onPress={() => agent.parentId && navigation?.openAgent?.({ agentId: agent.parentId })}
          accessibilityLabel={`Open parent ${parent}`}
        >
          <Type size={9} color={palette.textFaint} mono>
            {parent}
          </Type>
        </Press>
      ) : null}
      {agent.provider && !narrow ? <Chip label={agent.provider} tone="muted" /> : null}
    </Cluster>
  );
}

function StateChip({ agent }: { agent: FleetAgent }) {
  const { palette } = useSkin();
  const presentation = statePresentation(agent.deterministicState);
  const tone = stateTone(agent.deterministicState);
  const label = agent.stateDetail
    ? `${presentation.label} · ${agent.stateDetail}`
    : presentation.label;
  return (
    <Chip
      testID={`agent-state-${agent.id}`}
      label={label}
      tone={tone}
      dot
      strong
      title={`${agent.deterministicState} → ${agent.lifecycleState ?? "idle"}`}
    />
  );
}

function LabelStrip({ agent }: { agent: FleetAgent }) {
  const labels = displayableLabels(agent.labels);
  if (labels.length === 0) return null;
  return (
    <Cluster gap={3} testID={`agent-labels-${agent.id}`}>
      {labels.slice(0, 5).map((label) => (
        <Chip key={label.key} label={label.display} tone="muted" mono size={9} />
      ))}
      {labels.length > 5 ? <Chip label={`+${labels.length - 5}`} tone="muted" size={9} /> : null}
    </Cluster>
  );
}

function AttentionStrip({
  agent,
  navigation,
  compact,
}: {
  agent: FleetAgent;
  navigation?: PluginSurfaceProps["navigation"];
  compact?: boolean;
}) {
  const { palette, onCopy } = useSkin();
  const permissions = agent.pendingPermissions ?? [];
  const first = permissions[0];
  const reason = attentionReasonLabel(agent.attentionReason);
  const hasPermission = permissions.length > 0;
  const tone = hasPermission ? "critical" : "warn";
  const command = hasPermission ? adjudicationCommand(agent.id, first) : undefined;
  const scope = first ? agent.blockDetail?.scope : undefined;

  return (
    <View
      testID={`attention-${agent.id}`}
      style={{
        borderWidth: 1,
        borderColor: palette.wash(tone, 0.45),
        backgroundColor: palette.wash(tone, 0.08),
        borderRadius: 3,
        padding: 5,
        gap: 4,
      }}
    >
      <Cluster gap={5}>
        {compact ? null : (
          <Beacon testID={`attention-beacon-${agent.id}`} tone={tone}>
            <Type size={1} color="transparent">
              .
            </Type>
          </Beacon>
        )}
        <Chip
          testID={`attention-label-${agent.id}`}
          label={hasPermission ? `permission · ${permissionAction(first)}` : `awaiting input${reason ? ` · ${reason}` : ""}`}
          tone={tone}
          dot
          strong
        />
        {permissions.length > 1 ? <Chip label={`+${permissions.length - 1}`} tone={tone} size={9} /> : null}
        {scope ? <Chip label={scope} tone="muted" mono size={9} testID={`attention-scope-${agent.id}`} /> : null}
        <View style={{ flex: 1 }} />
        <Press
          testID={`attention-open-${agent.id}`}
          tone={tone}
          onPress={() => openAgent(agent, navigation?.openAgent)}
          accessibilityLabel={`Open ${agent.name}`}
        >
          <Type size={9} weight="700" color={toneColorOf(palette, tone)} upper>
            open
          </Type>
        </Press>
      </Cluster>
      {command && !compact ? (
        <Command testID={`attention-command-${agent.id}`} value={command} label={`Copy the permit command for ${agent.name}`} />
      ) : null}
      {command && compact ? (
        <Press
          testID={`attention-copy-${agent.id}`}
          tone={tone}
          onPress={() => onCopy(command)}
          accessibilityLabel={`Copy the permit command for ${agent.name}`}
        >
          <Type size={9} color={toneColorOf(palette, tone)} mono numberOfLines={1}>
            copy permit command
          </Type>
        </Press>
      ) : null}
    </View>
  );
}

function AgentRow({
  node,
  last,
  depth = 0,
  compact,
  orchestrator,
  collapsible,
  expanded = true,
  childCount = 0,
  onToggleExpand,
  metricsOpen,
  onToggleMetrics,
  actions,
  navigation,
}: {
  node: AgentNode;
  last: boolean;
  depth?: number;
  compact?: boolean;
  orchestrator?: boolean;
  collapsible?: boolean;
  expanded?: boolean;
  childCount?: number;
  onToggleExpand?: () => void;
  metricsOpen: boolean;
  onToggleMetrics: () => void;
  actions: FleetActions;
  navigation?: PluginSurfaceProps["navigation"];
}) {
  const { palette, narrow } = useSkin();
  const agent = node.agent;
  const gauge = healthGauge(agent);
  const hasMetrics = Boolean(agent.metrics);
  const worktree = agent.worktree || worktreeSlug(agent);
  const indent = Math.min(depth * 14, 56);

  return (
    <View testID={`agent-row-${agent.id}`} style={{ paddingLeft: indent }}>
      <Press
        testID={`agent-row-press-${agent.id}`}
        tone={stateTone(agent.deterministicState)}
        align="center"
        justify="between"
        onPress={() => openAgent(agent, navigation?.openAgent)}
        accessibilityLabel={`${agent.name}, ${statePresentation(agent.deterministicState).label}`}
        style={{ paddingHorizontal: 8, paddingVertical: 3, gap: 8 }}
      >
        <Cluster gap={5} style={{ flex: 1, minWidth: 0 }}>
          {depth > 0 ? <Guide last={last} compact={compact} /> : null}
          {orchestrator && collapsible ? (
            <Press
              testID={`agent-expand-${agent.id}`}
              tone="muted"
              onPress={onToggleExpand}
              accessibilityLabel={`${expanded ? "Collapse" : "Expand"} subagents of ${agent.name}`}
              style={{ padding: 2, margin: 0 }}
            >
              <Type size={9} mono color={palette.textFaint}>
                {expanded ? "▾" : "▸"}
              </Type>
            </Press>
          ) : null}
          <LiveDot
            testID={`agent-dot-${agent.id}`}
            tone={stateTone(agent.deterministicState)}
            pulse={statePresentation(agent.deterministicState).active}
            size={compact ? 6 : 7}
          />
          <AgentIdentity agent={agent} navigation={navigation} size={compact ? "sm" : "md"} />
          {!orchestrator && !narrow ? <LabelStrip agent={agent} /> : null}
          {orchestrator && agent.isMainDirty ? (
            <Chip
              label={`main dirty${agent.mainDirtySummary ? ` · ${agent.mainDirtySummary}` : ""}`}
              tone="warn"
              dot
            />
          ) : null}
          {orchestrator && !expanded && childCount > 0 ? (
            <Chip label={`${childCount} subagent${childCount === 1 ? "" : "s"}`} tone="muted" />
          ) : null}
        </Cluster>

        <Cluster gap={4} wrap={false} align="center">
          <StateChip agent={agent} />
          {agent.attributedWork?.issue !== undefined ? (
            <Chip
              testID={`agent-issue-${agent.id}`}
              label={`#${agent.attributedWork.issue}`}
              tone="accent"
              mono
              strong
            />
          ) : null}
          {!narrow && worktree ? <Chip label={worktree} tone="muted" mono /> : null}
          {!narrow ? (
            <Type size={9} color={palette.textFaint} testID={`agent-age-${agent.id}`}>
              {relativeTime(agent.lastActivityAt) || "—"}
            </Type>
          ) : null}
          {hasMetrics ? (
            <Press
              testID={`agent-gauge-${agent.id}`}
              tone={gauge.overall}
              onPress={onToggleMetrics}
              accessibilityLabel={`${agent.name} health: ${gauge.overall}. Show metrics`}
              style={{ padding: 2, margin: 0, gap: 2 }}
            >
              <Gauge gauge={gauge} active={metricsOpen} compact={compact} />
            </Press>
          ) : null}
          <Press
            testID={`agent-archive-${agent.id}`}
            tone="muted"
            disabled={actions.busyAgentId === agent.id}
            onPress={() => actions.onArchive(agent.id)}
            accessibilityLabel={`Archive ${agent.name}`}
            style={{ padding: 2, margin: 0 }}
          >
            <Type size={9} color={palette.textFaint} upper>
              {actions.busyAgentId === agent.id ? "…" : "rm"}
            </Type>
          </Press>
        </Cluster>
      </Press>

      {isBlocked(agent) ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 3 }}>
          <AttentionStrip agent={agent} navigation={navigation} compact={compact} />
        </View>
      ) : null}
      {metricsOpen && hasMetrics ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 5 }}>
          <MetricsSheet agent={agent} />
        </View>
      ) : null}
    </View>
  );
}

/** Stacked context/turn/error bar, or a clock arc while a turn is live. */
function Gauge({
  gauge,
  active,
  compact,
}: {
  gauge: ReturnType<typeof healthGauge>;
  active: boolean;
  compact?: boolean;
}) {
  const { palette } = useSkin();
  const width = compact ? 22 : 34;
  const height = 4;
  if (gauge.runningTurn) {
    return (
      <View
        testID="gauge-turn"
        style={{
          width: height * 3,
          height: height * 3,
          borderRadius: height * 1.5,
          borderWidth: 1.2,
          borderColor: palette.ruleStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 1.2,
            height: height * 1.2,
            backgroundColor: toneColorOf(palette, gauge.overall),
            transform: [{ rotate: `${Math.round(gauge.sweep * 360)}deg` }],
            transformOrigin: "bottom center",
          }}
        />
      </View>
    );
  }
  return (
    <View testID="gauge-bar" style={{ width, height, flexDirection: "row", gap: 1.5 }}>
      {gauge.segments.map((segment) => (
        <View
          key={segment.kind}
          testID={`gauge-${segment.kind}`}
          style={{
            flex: 1,
            height,
            borderRadius: 1,
            backgroundColor: palette.rule,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.round(segment.ratio * 100)}%`,
              height: "100%",
              backgroundColor: toneColorOf(palette, segment.tone),
            }}
          />
        </View>
      ))}
    </View>
  );
}

function MetricsSheet({ agent }: { agent: FleetAgent }) {
  const { palette } = useSkin();
  const now = Date.now();
  const metrics = agent.metrics;
  if (!metrics) return null;

  const contextPct =
    metrics.contextUsedTokens !== undefined && metrics.contextMaxTokens
      ? Math.round((metrics.contextUsedTokens / metrics.contextMaxTokens) * 100)
      : undefined;
  const cacheDenom = (metrics.cachedTokens ?? 0) + (metrics.inputTokens ?? 0);
  const cachePct = metrics.cachedTokens !== undefined && cacheDenom > 0 ? Math.round((metrics.cachedTokens / cacheDenom) * 100) : undefined;

  let lifetime = "—";
  if (agent.created && agent.updatedAt) {
    const created = Date.parse(agent.created);
    const updated = Date.parse(agent.updatedAt);
    if (Number.isFinite(created) && Number.isFinite(updated) && updated >= created) {
      lifetime = durationText(updated - created);
    }
  }

  return (
    <View
      testID={`metrics-${agent.id}`}
      style={{
        borderWidth: 1,
        borderColor: palette.rule,
        backgroundColor: palette.raised,
        borderRadius: 3,
        padding: 7,
        gap: 6,
      }}
    >
      <Cluster gap={4} wrap={false} style={{ minWidth: 0 }}>
        <Type size={9} weight="700" color={palette.textFaint} upper>
          metrics
        </Type>
        <View style={{ flex: 1 }}>
          <Hairline />
        </View>
      </Cluster>
      <Cluster gap={10} align="start" style={{ minWidth: 0 }}>
        <Field
          testID={`metrics-context-${agent.id}`}
          label="context"
          value={contextPct !== undefined ? `${contextPct}%` : "—"}
          tone={contextPct !== undefined && contextPct >= 90 ? "critical" : contextPct !== undefined && contextPct >= 75 ? "warn" : undefined}
        />
        <Field
          testID={`metrics-cache-${agent.id}`}
          label="cached"
          value={cachePct !== undefined ? `${cachePct}%` : "—"}
        />
        <Field
          testID={`metrics-cost-${agent.id}`}
          label="cost"
          value={metrics.costUsd !== undefined ? `$${metrics.costUsd.toFixed(2)}` : "—"}
          mono
        />
        <Field
          testID={`metrics-turn-${agent.id}`}
          label="turn"
          value={durationText(elapsedSince(metrics.activeTurnStartedAt, now))}
        />
        <Field testID={`metrics-lifetime-${agent.id}`} label="lifetime" value={lifetime} />
        <Field
          testID={`metrics-permission-wait-${agent.id}`}
          label="perm wait"
          value={durationText(elapsedSince(metrics.attentionTimestamp, now))}
        />
        <Field
          testID={`metrics-in-${agent.id}`}
          label="in"
          value={metrics.inputTokens?.toLocaleString() ?? "—"}
          mono
        />
        <Field
          testID={`metrics-out-${agent.id}`}
          label="out"
          value={metrics.outputTokens?.toLocaleString() ?? "—"}
          mono
        />
        <Field
          testID={`metrics-errors-${agent.id}`}
          label="errors"
          value={agent.lastError?.trim() || "none"}
          tone={agent.lastError?.trim() ? "critical" : undefined}
        />
        {/* Not in the legacy sheet, but the daemon already hands it over. */}
        {agent.usage?.totalCostUsd !== undefined ? (
          <Field
            testID={`metrics-usage-cost-${agent.id}`}
            label="session cost"
            value={`$${agent.usage.totalCostUsd.toFixed(2)}`}
            mono
          />
        ) : null}
        {agent.usage?.cachedInputTokens !== undefined ? (
          <Field
            testID={`metrics-usage-cached-${agent.id}`}
            label="session cached"
            value={agent.usage.cachedInputTokens.toLocaleString()}
            mono
          />
        ) : null}
        {agent.cwd ? <Field testID={`metrics-cwd-${agent.id}`} label="cwd" value={agent.cwd} mono /> : null}
        {agent.workspaceId ? (
          <Field testID={`metrics-workspace-${agent.id}`} label="workspace" value={agent.workspaceId} mono />
        ) : null}
        {agent.url ? <Field testID={`metrics-url-${agent.id}`} label="url" value={agent.url} mono copyable /> : null}
        <Field testID={`metrics-lifecycle-${agent.id}`} label="lifecycle" value={agent.lifecycleState ?? "idle"} />
      </Cluster>
    </View>
  );
}

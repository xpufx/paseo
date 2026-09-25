import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  addOrchestratorContract,
  archiveAgentContract,
  archiveInactiveAgentsContract,
  createFrontDeskContract,
  fleetContract,
  muteRepoContract,
  queueContract,
  queueDrainContract,
  queuePauseContract,
  queueResumeContract,
  replaceFrontDeskContract,
  replaceOrchestratorContract,
  routerStatusContract,
  ticketBoardContract,
  type Ticket,
} from "../shared/contracts.js";
import { bulkArchiveCandidates, routerBadge } from "../shared/derive.js";
import { useRpcMutation, useRpcQuery } from "./data.js";
import { Cluster, Hairline, Press, SectionTabs, SkinProvider, Stack, Type, useSkin } from "./kit.js";
import { FleetView, type FleetActions } from "./fleet-view.js";
import { QueueView } from "./queue-view.js";
import { TicketsView } from "./tickets-view.js";

type Section = "fleet" | "queue" | "tickets";

const SECTIONS = [
  { id: "fleet" as Section, label: "Fleet" },
  { id: "queue" as Section, label: "Queue" },
  { id: "tickets" as Section, label: "Tickets" },
];

/** Poll cadences, in ms. The fleet view is the one an operator watches live. */
const FLEET_POLL = 5000;
const QUEUE_POLL = 5000;
const TICKET_POLL = 15000;

/**
 * Copies through the host clipboard and confirms in a toast. The legacy surface
 * offered copy affordances on ids, paths, and permit commands; keeping them
 * means keeping this.
 */
function useCopy(): (value: string) => void {
  const toast = useToast();
  return useCallback(
    (value: string) => {
      copyText(value)
        .then(() => toast.show("Copied"))
        .catch(() => toast.error("Clipboard unavailable"));
    },
    [toast],
  );
}

export function WorktreeInstallSurface(props: PluginSurfaceProps) {
  const { palette } = useSkin();
  const toast = useToast();
  const [section, setSection] = useState<Section>("fleet");
  const [repoScope, setRepoScope] = useState("all");
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [busyFrontDesk, setBusyFrontDesk] = useState(false);
  const [busyQueue, setBusyQueue] = useState(false);

  const fleet = useRpcQuery(fleetContract, {}, { refetchInterval: FLEET_POLL });
  const router = useRpcQuery(routerStatusContract, {}, { refetchInterval: QUEUE_POLL });
  const queues = useRpcQuery(queueContract, {}, { refetchInterval: QUEUE_POLL });
  const tickets = useRpcQuery(ticketBoardContract, { state: "open" }, { refetchInterval: TICKET_POLL });

  const refetchAll = useCallback(() => {
    void fleet.refetch();
    void router.refetch();
    void queues.refetch();
    void tickets.refetch();
    toast.show("Refreshed");
  }, [fleet, router, queues, tickets, toast]);

  const refreshSection = useCallback(() => {
    if (section === "fleet") void fleet.refetch();
    if (section === "queue") {
      void router.refetch();
      void queues.refetch();
    }
    if (section === "tickets") void tickets.refetch();
  }, [section, fleet, router, queues, tickets]);

  /**
   * One path for every mutation: run it, toast the server's own message (or
   * the error), and refresh whatever the mutation could have changed. Actions
   * that report a structured `ok: false` are treated as failures even though
   * the RPC itself resolved.
   */
  const run = useCallback(
    async (
      label: string,
      invoke: () => Promise<{ ok: boolean; message?: string; error?: string } | undefined>,
    ) => {
      try {
        const result = await invoke();
        if (!result || result.ok) {
          toast.show(result?.message || `${label} done`);
        } else {
          toast.error(result.error || `${label} failed`);
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        refreshSection();
      }
    },
    [toast, refreshSection],
  );

  const archive = useRpcMutation(archiveAgentContract);
  const archiveMany = useRpcMutation(archiveInactiveAgentsContract);
  const createDesk = useRpcMutation(createFrontDeskContract);
  const replaceDesk = useRpcMutation(replaceFrontDeskContract);
  const addOrch = useRpcMutation(addOrchestratorContract);
  const replaceOrch = useRpcMutation(replaceOrchestratorContract);
  const mute = useRpcMutation(muteRepoContract);
  const pause = useRpcMutation(queuePauseContract);
  const resume = useRpcMutation(queueResumeContract);
  const drain = useRpcMutation(queueDrainContract);

  const fleetActions: FleetActions = useMemo(
    () => ({
      busyAgentId,
      busyRepo,
      busyFrontDesk,
      onArchive: async (agentId) => {
        setBusyAgentId(agentId);
        await run("Archive agent", () => archive.mutateAsync({ agentId }));
        setBusyAgentId(null);
      },
      onArchiveBulk: async (agentIds) => {
        if (agentIds.length === 0) return;
        await run("Archive agents", () => archiveMany.mutateAsync({ agentIds }));
      },
      onCreateFrontDesk: async () => {
        setBusyFrontDesk(true);
        await run("Create liaison", () => createDesk.mutateAsync({}));
        setBusyFrontDesk(false);
      },
      onReplaceFrontDesk: async (existingAgentId) => {
        setBusyFrontDesk(true);
        await run("Replace liaison", () => replaceDesk.mutateAsync({ existingAgentId }));
        setBusyFrontDesk(false);
      },
      onAddOrchestrator: async (repo) => {
        setBusyRepo(repo);
        await run("Add orchestrator", () => addOrch.mutateAsync({ repo }));
        setBusyRepo(null);
      },
      onReplaceOrchestrator: async (repo, existingAgentId) => {
        setBusyRepo(repo);
        await run("Replace orchestrator", () => replaceOrch.mutateAsync({ repo, existingAgentId }));
        setBusyRepo(null);
      },
      onMuteRepo: async (repo, muted) => {
        setBusyRepo(repo);
        await run(muted ? "Mute repo" : "Unmute repo", () => mute.mutateAsync({ repo, muted }));
        setBusyRepo(null);
      },
    }),
    [
      busyAgentId,
      busyRepo,
      busyFrontDesk,
      run,
      archive,
      archiveMany,
      createDesk,
      replaceDesk,
      addOrch,
      replaceOrch,
      mute,
    ],
  );

  const queueActions = useMemo(
    () => ({
      busy: busyQueue,
      onPause: async (repo?: string) => {
        setBusyQueue(true);
        await run(repo ? `Pause ${repo}` : "Pause all queues", () => pause.mutateAsync({ repo }));
        setBusyQueue(false);
      },
      onResume: async (repo?: string) => {
        setBusyQueue(true);
        await run(repo ? `Resume ${repo}` : "Resume all queues", () => resume.mutateAsync({ repo }));
        setBusyQueue(false);
      },
      onDrain: async (repo: string) => {
        setBusyQueue(true);
        await run(`Drain ${repo}`, () => drain.mutateAsync({ repo }));
        setBusyQueue(false);
      },
    }),
    [busyQueue, run, pause, resume, drain],
  );

  const ticketActions = useMemo(
    () => ({
      onRepoScope: setRepoScope,
      onDispatch: (ticket: Ticket) => {
        toast.show(`Worktree dispatch requested for #${ticket.number}`);
      },
    }),
    [toast],
  );

  const badge = routerBadge(Boolean(router.data?.ok), Boolean(router.data?.active));
  const blockedPreview = useMemo(() => {
    const agents = [
      ...(fleet.data?.frontDesk ?? []),
      ...(fleet.data?.orchestrators ?? []),
      ...(fleet.data?.workers ?? []),
    ];
    return bulkArchiveCandidates(agents).length;
  }, [fleet.data]);

  return (
    <Stack gap={0} grow style={{ backgroundColor: palette.canvas }} testID="worktree-install">
      <View
        style={{
          paddingHorizontal: 10,
          paddingTop: 8,
          paddingBottom: 6,
          gap: 7,
          backgroundColor: palette.panel,
        }}
      >
        <Cluster gap={6} justify="between" align="center" testID="header">
          <Cluster gap={6}>
            <Type size={14} weight="700" testID="product-title">
              Worktree Install
            </Type>
            <Press
              testID="router-badge"
              onPress={() => {
                setSection("queue");
                void router.refetch();
              }}
              tone={badge.tone === "ok" ? "ok" : badge.tone === "warn" ? "warn" : "critical"}
              accessibilityLabel={`${badge.label}. Open the queue view.`}
            >
              <Type
                size={9}
                weight="700"
                upper
                color={
                  badge.tone === "ok" ? palette.ok : badge.tone === "warn" ? palette.warn : palette.critical
                }
              >
                {badge.label}
              </Type>
            </Press>
            {(fleet.data?.errorCount ?? 0) > 0 ? (
              <Press
                testID="header-failed"
                tone="critical"
                onPress={() => setSection("fleet")}
                accessibilityLabel={`${fleet.data?.errorCount} failed agents`}
              >
                <Type size={9} weight="700" color={palette.critical} upper>
                  {fleet.data?.errorCount} failed
                </Type>
              </Press>
            ) : null}
          </Cluster>
          <Cluster gap={6} wrap={false}>
            <Type size={9} color={palette.textFaint} testID="header-repo-scope">
              {repoScope === "all" ? "all repositories" : repoScope}
            </Type>
            <Press testID="refresh" tone="accent" onPress={refetchAll} accessibilityLabel="Refresh every view">
              <Type size={10} weight="700" color={palette.accent} upper>
                refresh
              </Type>
            </Press>
          </Cluster>
        </Cluster>

        <Cluster gap={8} justify="between" align="center" testID="header-nav">
          <SectionTabs
            testID="sections"
            tabs={SECTIONS}
            active={section}
            onChange={setSection}
            counts={{
              fleet: fleet.data?.totalCount ?? 0,
              queue: router.data?.totalQueued ?? 0,
              tickets: tickets.data?.openCount ?? 0,
            }}
          />
          {section === "fleet" && blockedPreview > 0 ? (
            <Type size={9} color={palette.textFaint}>
              {blockedPreview} archivable
            </Type>
          ) : null}
        </Cluster>
      </View>

      <Hairline color={palette.ruleStrong} />

      <View style={{ flex: 1, minHeight: 0, padding: 10 }}>
        {section === "fleet" ? (
          <FleetView
            data={fleet.data}
            tickets={tickets.data?.tickets ?? []}
            loading={fleet.isLoading}
            repoScope={repoScope}
            onRepoScope={setRepoScope}
            actions={fleetActions}
            navigation={props.navigation}
          />
        ) : section === "queue" ? (
          <QueueView status={router.data} queues={queues.data} loading={queues.isLoading} actions={queueActions} />
        ) : (
          <TicketsView
            data={tickets.data}
            loading={tickets.isLoading}
            repoScope={repoScope}
            actions={ticketActions}
          />
        )}
      </View>
    </Stack>
  );
}

/**
 * The shell every host surface mounts through: resolves the two-palette theme
 * from the host's own background and exposes the clipboard. Both the sidebar
 * surface and the workspace panel use it, so there is one place where the theme
 * decision is made.
 */
export function WorktreeInstallRoot({
  theme,
  layout,
  children,
}: {
  theme: PluginSurfaceProps["theme"];
  layout: PluginSurfaceProps["layout"];
  children: React.ReactNode;
}) {
  const copy = useCopy();
  return (
    <SkinProvider theme={theme} layout={layout} onCopy={copy}>
      {children}
    </SkinProvider>
  );
}

export function WorktreeInstallPanel(props: PluginWorkspacePanelProps) {
  return (
    <WorktreeInstallRoot theme={props.theme} layout={props.layout}>
      <WorktreeInstallSurface {...props} />
    </WorktreeInstallRoot>
  );
}

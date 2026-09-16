import type { PluginServerContext } from "@getpaseo/plugin/server";
import { guardRpcHandler } from "paseo-plugin-helper/server";
import {
  getSystemResourcesRpc,
  getCustomPillsRpc,
  listCustomPillsRpc,
  runCustomPillModalCommandRpc,
  topSettingsContract,
  TOP_TIMELINE_KIND,
  TOP_TIMELINE_VERSION,
  type LiveUsage,
  type SystemResources,
} from "./shared/resources";
import {
  handleGetSystemResources,
  handleGetCustomPills,
  handleListCustomPills,
  handleRunCustomPillModalCommand,
  handleGetSettings,
  handleUpdateSettings,
  handleResetSettings,
  customPillPoller,
  collectTurnTelemetry,
  collectGitDiffStat,
  countTurns,
  getLastLiveUsage,
  isInterruptEcho,
  isStaleTurnEnd,
  setLastLiveUsage,
  log,
} from "./server/resources";
import { resolveTimelineCadence, shouldAppendTimelineForTurn } from "./shared/resources";

export default function contribute(server: PluginServerContext) {
  void customPillPoller.start();

  // Shed load instead of hanging the daemon RPC: saturated or slow handlers
  // answer from the last good snapshot (system-resources) or fail fast.
  // WARNs are rate-limited (one per minute per cause): saturation fires once
  // per poll tick per caller while the modal is open, which flooded the log.
  let lastSystemResources: SystemResources | null = null;
  const lastWarnAt = { timeout: 0, saturated: 0 };
  const WARN_COOLDOWN_MS = 60_000;
  const guardedSystemResources = guardRpcHandler(
    async (input: Parameters<typeof handleGetSystemResources>[0]) => {
      const resources = await handleGetSystemResources(input);
      lastSystemResources = resources;
      return resources;
    },
    {
      timeoutMs: 5000,
      maxInflight: 4,
      getStale: () => lastSystemResources,
      onTimeout: ({ timeoutMs }) => {
        const now = Date.now();
        if (now - lastWarnAt.timeout < WARN_COOLDOWN_MS) return;
        lastWarnAt.timeout = now;
        log.warn("system-resources handler timed out", { timeoutMs });
      },
      onSaturated: ({ maxInflight }) => {
        const now = Date.now();
        if (now - lastWarnAt.saturated < WARN_COOLDOWN_MS) return;
        lastWarnAt.saturated = now;
        log.warn("system-resources handler saturated, serving stale", { maxInflight });
      },
    },
  );

  server.handle(topSettingsContract.get, handleGetSettings);
  server.handle(topSettingsContract.update, handleUpdateSettings);
  server.handle(topSettingsContract.reset, handleResetSettings);
  server.handle(getSystemResourcesRpc, guardedSystemResources);
  server.handle(getCustomPillsRpc, handleGetCustomPills);
  server.handle(listCustomPillsRpc, handleListCustomPills);
  server.handle(runCustomPillModalCommandRpc, handleRunCustomPillModalCommand);

  const turnStartTimes = new Map<string, number>();
  const turnGitBefore = new Map<string, { insertions: number; deletions: number; filesChanged: number }>();
  // Live turn per agent, set on turn_started and consumed by its terminal, used
  // to drop terminals that cannot belong to it (see isStaleTurnEnd).
  const activeTurnIds = new Map<string, string | null>();
  // Time and timeline user_message count of the last canceled terminal, used to
  // drop the daemon's extra interrupt terminal (see isInterruptEcho).
  const lastCanceledAt = new Map<string, number>();
  const lastCanceledUserMessages = new Map<string, number>();
  // Per-agent turn counter for the timeline cadence option (0 = never,
  // 1 = every turn, N>1 = every Nth turn). Counts deduped turn_ended events.
  const turnCounters = new Map<string, number>();

  const unsubscribeTurnStarted = server.on("agent.turn_started", (event, context) => {
    turnStartTimes.set(event.agent.id, Date.now());
    activeTurnIds.set(event.agent.id, event.turnId ?? null);
    if ((event.agent as any)?.lastUsage) {
      setLastLiveUsage((event.agent as any).lastUsage);
    }
    void context.paseo.agents
      .ref(event.agent.id)
      .refresh()
      .then((refetched) => {
        if (refetched && (refetched.agent as any)?.lastUsage) {
          setLastLiveUsage((refetched.agent as any).lastUsage);
        }
      })
      .catch(() => {});
    void collectGitDiffStat(event.agent.cwd).then(
      (before) => {
        if (before) {
          turnGitBefore.set(event.agent.id, before);
        } else {
          turnGitBefore.delete(event.agent.id);
        }
      },
      () => {
        turnGitBefore.delete(event.agent.id);
      },
    );
  });

  const unsubscribeAgentCreated = server.on("agent.created", (event) => {
    if ((event.agent as any)?.lastUsage) {
      setLastLiveUsage((event.agent as any).lastUsage);
    }
  });

  async function appendTurnCard(
    event: any,
    context: any,
    startTime: number | undefined,
    gitBefore: { insertions: number; deletions: number; filesChanged: number } | undefined,
    turnIndex: number,
  ): Promise<void> {
    try {
      const settings = await handleGetSettings();
      const cadence = resolveTimelineCadence(settings);
      if (!shouldAppendTimelineForTurn(cadence, turnIndex)) {
        return;
      }
      const durationMs = startTime ? Date.now() - startTime : undefined;

      let agentModel: string | null = null;
      let agentProvider: string | null = event.agent.provider ?? null;
      let agentTitle: string | null = event.agent.title ?? null;
      try {
        const refetched = await context.paseo.agents.ref(event.agent.id).refresh();
        agentModel = refetched?.agent?.model ?? agentModel;
        agentProvider = refetched?.agent?.provider ?? agentProvider;
        agentTitle = refetched?.agent?.title ?? agentTitle;
        let liveUsage =
          (refetched?.agent?.lastUsage as LiveUsage | null | undefined) ??
          ((event.agent as any)?.lastUsage as LiveUsage | null | undefined) ??
          null;
        const lacksTokens =
          liveUsage?.inputTokens == null &&
          liveUsage?.outputTokens == null &&
          (liveUsage as any)?.contextWindowUsedTokens == null;
        if (lacksTokens) {
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          await sleep(150);
          try {
            const retry1 = await context.paseo.agents.ref(event.agent.id).refresh();
            liveUsage =
              (retry1?.agent?.lastUsage as LiveUsage | null | undefined) ?? liveUsage;
          } catch {}
          const stillLacks =
            liveUsage?.inputTokens == null &&
            liveUsage?.outputTokens == null &&
            (liveUsage as any)?.contextWindowUsedTokens == null;
          if (stillLacks) {
            await sleep(250);
            try {
              const retry2 = await context.paseo.agents.ref(event.agent.id).refresh();
              liveUsage =
                (retry2?.agent?.lastUsage as LiveUsage | null | undefined) ?? liveUsage;
            } catch {}
          }
        }
        setLastLiveUsage(liveUsage);
      } catch {
        // Model, provider, and title stay at event snapshot values; the card renders placeholders
      }

      const telemetry = await collectTurnTelemetry(
        event.turnId,
        event.agent.id,
        event.outcome,
        durationMs,
        {
          cwd: event.agent.cwd,
          provider: agentProvider,
          title: agentTitle,
          model: agentModel,
          timeline: event.timeline,
          gitBefore: gitBefore ?? null,
          liveUsage: getLastLiveUsage(),
        },
      );

      await context.paseo.agents.ref(event.agent.id).timeline.append({
        type: "plugin",
        id: `top-turn-${event.turnId ?? Date.now()}`,
        kind: TOP_TIMELINE_KIND,
        version: TOP_TIMELINE_VERSION,
        data: telemetry,
      });

      log.info("Appended turn telemetry to timeline", {
        agentId: event.agent.id,
        turnId: event.turnId,
        outcome: event.outcome.kind,
        durationMs,
        cpuPercent: telemetry.cpuPercent,
        memPercent: telemetry.memPercent,
      });
    } catch (err) {
      log.warn("Failed to record turn telemetry", {
        agentId: event.agent.id,
        turnId: event.turnId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const unsubscribeTurnEnded = server.on("agent.turn_ended", (event, context) => {
    const settingsPromise = handleGetSettings();
    void settingsPromise.then((settings) => {
      if (settings.recordTurnTelemetry === false) {
        turnStartTimes.delete(event.agent.id);
        turnGitBefore.delete(event.agent.id);
        activeTurnIds.delete(event.agent.id);
        lastCanceledAt.delete(event.agent.id);
        lastCanceledUserMessages.delete(event.agent.id);
        return;
      }

      // On interrupt the daemon emits a second terminal for the turn the cancel
      // already ended. Skip it so the interrupt renders as one card.
      const activeTurnId = activeTurnIds.get(event.agent.id);
      const eventTurnId = event.turnId ?? null;
      const eventUserMessages = countTurns(event.timeline) ?? 0;
      const duplicate =
        isStaleTurnEnd(activeTurnId, eventTurnId) ||
        isInterruptEcho({
          lastCanceledAt: lastCanceledAt.get(event.agent.id) ?? null,
          lastCanceledUserMessages: lastCanceledUserMessages.get(event.agent.id) ?? null,
          eventUserMessages,
          now: Date.now(),
        });
      if (duplicate) {
        log.info("Skipped duplicate turn-end telemetry", {
          agentId: event.agent.id,
          turnId: event.turnId,
          activeTurnId: activeTurnId ?? null,
        });
        return;
      }
      activeTurnIds.delete(event.agent.id);
      if (event.outcome.kind === "canceled") {
        lastCanceledAt.set(event.agent.id, Date.now());
        lastCanceledUserMessages.set(event.agent.id, eventUserMessages);
      } else {
        lastCanceledAt.delete(event.agent.id);
        lastCanceledUserMessages.delete(event.agent.id);
      }

      const startTime = turnStartTimes.get(event.agent.id);
      turnStartTimes.delete(event.agent.id);
      const gitBefore = turnGitBefore.get(event.agent.id);
      turnGitBefore.delete(event.agent.id);
      const turnIndex = (turnCounters.get(event.agent.id) ?? 0) + 1;
      turnCounters.set(event.agent.id, turnIndex);
      void appendTurnCard(event, context, startTime, gitBefore, turnIndex);
    }).catch((err) => {
      log.warn("Failed to record turn telemetry", {
        agentId: event.agent.id,
        turnId: event.turnId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  return () => {
    activeTurnIds.clear();
    lastCanceledAt.clear();
    lastCanceledUserMessages.clear();
    customPillPoller.stop();
    unsubscribeTurnStarted();
    unsubscribeAgentCreated();
    unsubscribeTurnEnded();
  };
}

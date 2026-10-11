import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger, installStorageGuard } from "paseo-plugin-helper/server";
import {
  statusRpc,
  toggleBedModeRpc,
  snoozeAlertRpc,
  recordActivityRpc,
  DEFAULT_SETTINGS,
  type ActivitySource,
} from "./shared/contracts.js";
import { PresenceTracker } from "./server/presence.js";
import { registerWellbeingServerSettings } from "./server/settings.js";

const log = createPluginLogger("wellbeing");

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({ pluginId: "wellbeing" });
  const tracker = new PresenceTracker(DEFAULT_SETTINGS);
  const settingsHandle = registerWellbeingServerSettings(server, tracker, DEFAULT_SETTINGS);

  // Register wellbeing RPC handlers
  server.handle(statusRpc, () => {
    return tracker.getStatus();
  });

  server.handle(toggleBedModeRpc, async (input: { enabled?: boolean }) => {
    const result = tracker.toggleBedMode(input.enabled);
    log.info("bed mode toggled", result);
    if (result.isBedMode && tracker.getSettings().notifyVia2fado) {
      void tracker.send2fadoNotice(
        "🌙 Bed Mode Activated: Fleet in custodial off-hours posture. Interactive queries deferred to morning.",
        "http://localhost:3000"
      );
    }
    return result;
  });

  server.handle(snoozeAlertRpc, async (input: { minutes: number }) => {
    const result = tracker.snooze(input.minutes);
    log.info("fatigue alert snoozed", result);
    return result;
  });

  server.handle(recordActivityRpc, async (input: { source?: ActivitySource }) => {
    const source = input.source ?? "client_interaction";
    const { activeStretchMinutes, fatigueAlertTriggered } = tracker.recordActivity(source);
    if (fatigueAlertTriggered && tracker.getSettings().notifyVia2fado) {
      log.warn("fatigue alert triggered", { activeStretchMinutes, source });
      void tracker.send2fadoNotice(
        `⚠️ Operator Wellbeing: Continuous high-intensity session reached ${activeStretchMinutes}m. Consider taking a break or enabling Bed Mode.`,
        "http://localhost:3000"
      );
    }
    return { ok: true, activeStretchMinutes, source };
  });

  // Automatically track presence ONLY on interactive human actions
  server.on("agent.turn_ended", (event) => {
    const hasInteractiveUserMessage = event.timeline?.some(
      (item) => item.type === "user_message" && (!item.clientMessageId || !item.clientMessageId.startsWith("cron_"))
    );
    if (hasInteractiveUserMessage) {
      tracker.recordActivity("interactive_turn");
    }
  });

  server.on("agent.permission_resolved", () => {
    tracker.recordActivity("permission_resolved");
  });

  // Periodic heartbeat / fatigue check every 60s.
  // Read-only evaluation: it must NOT record presence, otherwise it refreshes
  // lastActivityTs every minute and the idle timeout never elapses (#562).
  const timer = setInterval(() => {
    const status = tracker.getStatus();
    if (status.phase === "extended-stretch" && tracker.getSettings().notifyVia2fado) {
      const { fatigueAlertTriggered } = tracker.evaluateFatigue();
      if (fatigueAlertTriggered) {
        void tracker.send2fadoNotice(
          `⚠️ Operator Wellbeing: Continuous high-intensity session reached ${status.activeStretchMinutes}m. Consider taking a break or enabling Bed Mode.`,
          "http://localhost:3000"
        );
      }
    }
  }, 60000);

  log.info("wellbeing plugin contributed: operator presence tracking & circadian wind-down live");

  return () => {
    clearInterval(timer);
    settingsHandle.dispose();
    uninstallStorageGuard();
  };
}

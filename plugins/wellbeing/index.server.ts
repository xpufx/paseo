import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PluginStorage, createPluginLogger, registerSettingsRpc } from "paseo-plugin-helper/server";
import {
  wellbeingSettingsContract,
  statusRpc,
  toggleBedModeRpc,
  recordActivityRpc,
  snoozeAlertRpc,
  type WellbeingSettings,
} from "./shared/contracts.js";
import { PresenceTracker } from "./server/presence.js";

const log = createPluginLogger("wellbeing");

const DEFAULT_SETTINGS: WellbeingSettings = {
  workingHours: { start: "09:00", end: "18:00" },
  windDownTime: "22:30",
  wakeUpTime: "07:30",
  bedMode: false,
  maxSessionContinuousMinutes: 180,
  idleTimeoutMinutes: 15,
  fatigueAlertCooldownMinutes: 60,
  notifyVia2fado: true,
};

export default function contribute(server: PluginServerContext) {
  const storage = new PluginStorage<WellbeingSettings>("wellbeing", "settings.json", {
    defaultData: DEFAULT_SETTINGS,
    schema: wellbeingSettingsContract.schema,
  });

  const initialSettings = storage.read() ?? DEFAULT_SETTINGS;
  const tracker = new PresenceTracker(initialSettings);

  // Register settings RPCs
  registerSettingsRpc(server, wellbeingSettingsContract, storage, {
    onUpdate: (next) => {
      tracker.updateSettings(next);
      log.info("wellbeing settings updated", { bedMode: next.bedMode, windDown: next.windDownTime });
    },
  });

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

  server.handle(recordActivityRpc, async (_input: { source?: string }) => {
    const { activeStretchMinutes, fatigueAlertTriggered } = tracker.recordActivity();
    if (fatigueAlertTriggered && tracker.getSettings().notifyVia2fado) {
      log.warn("fatigue alert triggered", { activeStretchMinutes });
      void tracker.send2fadoNotice(
        `⚠️ Operator Wellbeing: Continuous high-intensity session reached ${activeStretchMinutes}m. Consider taking a break or enabling Bed Mode.`,
        "http://localhost:3000"
      );
    }
    return { ok: true, activeStretchMinutes };
  });

  server.handle(snoozeAlertRpc, async (input: { minutes: number }) => {
    const result = tracker.snoozeAlert(input.minutes);
    log.info("fatigue alert snoozed", result);
    return result;
  });

  // Automatically track presence on server events
  const onTurnEnded = () => {
    tracker.recordActivity();
  };
  server.on("agent.turn_ended", onTurnEnded);

  // Periodic heartbeat / fatigue check every 60s
  const timer = setInterval(() => {
    const status = tracker.getStatus();
    if (status.phase === "extended-stretch" && tracker.getSettings().notifyVia2fado) {
      const { fatigueAlertTriggered } = tracker.recordActivity();
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
  };
}

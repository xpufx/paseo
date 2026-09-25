import fs from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PluginStorage, createPluginLogger, registerSettingsRpc } from "paseo-plugin-helper/server";
import {
  approvalAck,
  approvalSelect,
  approvalSettings,
  approvalStatus,
  approvalTelegramInfo,
  approvalTelegramSetConfig,
  daemonHealth,
  migrateLegacyNotificationTarget,
  parseApprovers,
  pendingList,
  policyAddRule,
  recentList,
  verdict,
} from "./shared/approval";
import type { ApprovalSettingsValues } from "./shared/approval";
import {
  daemonInstall,
  daemonLogs,
  daemonRestart,
  daemonStart,
  daemonStatus,
  daemonStop,
} from "./shared/companion";
import { createCompanionController } from "./server/companion";
import {
  addPolicyRule,
  getHealth,
  getStatus,
  getTelegramInfo,
  listPending,
  listRecent,
  setTelegramConfig,
  submitAck,
  submitSelection,
  submitVerdict,
} from "./server/twofado";

const log = createPluginLogger("twofado");

function migrateLegacySettingsFile(storage: PluginStorage<ApprovalSettingsValues>): void {
  try {
    const raw = fs.readFileSync(storage.filePath, "utf8");
    const { data, changed } = migrateLegacyNotificationTarget(JSON.parse(raw));
    if (!changed) return;
    fs.writeFileSync(storage.filePath, JSON.stringify(data, null, 2));
    log.info("migrated legacy telegramFallback to notificationTarget");
  } catch (err) {
    // Missing or unreadable file: schema defaults apply.
    log.warn("legacy settings migration skipped", { error: err });
  }
}

export default function contribute(server: PluginServerContext) {
  const storage = new PluginStorage("twofado", "settings.json", {
    defaultData: approvalSettings.defaultSettings,
    schema: approvalSettings.schema,
  });
  migrateLegacySettingsFile(storage);
  const companion = createCompanionController({
    binDir: join(storage.pluginDir, "bin"),
  });

  const maybeAutoStart = (autoStart: boolean, socketPath: string) => {
    if (!autoStart) {
      log.info("companion auto-start disabled by settings");
      return;
    }
    // Socket-first: an already-serving daemon (systemd/standalone) is adopted,
    // not duplicated; a missing socket means the supervisor spawns one.
    void companion
      .start({ socketPath })
      .then((result) => {
        log.info("companion daemon ensure attempted", {
          success: result.success,
          managed: result.managed,
          pid: result.pid,
        });
      })
      .catch((err) => log.warn("companion auto-start failed", { error: err }));
  };

  registerSettingsRpc(server, approvalSettings, storage, {
    onUpdate: (next, prev) => {
      log.info("settings updated", {
        socketPath: next.socketPath,
        notificationTarget: next.notificationTarget,
      });
      if (prev && next.autoStartDaemon && !prev.autoStartDaemon) {
        maybeAutoStart(true, next.socketPath);
      }
      if (next.telegramBotToken || next.telegramChatId || next.telegramApprovers) {
        const approvers = parseApprovers(next.telegramApprovers);
        void setTelegramConfig({
          botToken: next.telegramBotToken || undefined,
          chatId: next.telegramChatId || undefined,
          approvers,
          notificationTarget: next.notificationTarget,
          socketPath: next.socketPath,
        }).catch((err) => log.warn("failed to sync telegram config to daemon", { error: err }));
      } else if (prev && next.notificationTarget !== prev.notificationTarget) {
        void (async () => {
          const info = await getTelegramInfo({ socketPath: next.socketPath }).catch((err) => {
            log.warn("telegram info fetch failed during target sync", { error: err });
            return undefined;
          });
          await setTelegramConfig({
            chatId: info?.chatId,
            approvers: info?.approvers,
            notificationTarget: next.notificationTarget,
            socketPath: next.socketPath,
          });
        })().catch((err) => log.warn("failed to sync notification target to daemon", { error: err }));
      }
    },
  });
  server.handle(pendingList, (input) => listPending(input));
  server.handle(verdict, (input) => submitVerdict(input));
  server.handle(approvalSelect, (input) => submitSelection(input));
  server.handle(approvalAck, (input) => submitAck(input));
  server.handle(recentList, (input) => listRecent(input));
  server.handle(approvalStatus, (input) => getStatus(input));
  server.handle(daemonHealth, (input) => getHealth(input));
  server.handle(approvalTelegramInfo, (input) => getTelegramInfo(input));
  server.handle(approvalTelegramSetConfig, (input) => setTelegramConfig(input));
  server.handle(policyAddRule, (input) => addPolicyRule(input));
  server.handle(daemonStatus, (input) => companion.status(input));
  server.handle(daemonStart, (input) => companion.start(input));
  server.handle(daemonStop, () => companion.stop());
  server.handle(daemonRestart, (input) => companion.restart(input));
  server.handle(daemonLogs, (input) => companion.logs(input));
  server.handle(daemonInstall, (input) => companion.install(input));

  const initial = storage.read();
  maybeAutoStart(initial.autoStartDaemon, initial.socketPath);

  return () => {
    // Only a child this plugin spawned is stopped; an adopted external daemon
    // is left running for its own supervisor (systemd or standalone).
    void companion.shutdown();
  };
}

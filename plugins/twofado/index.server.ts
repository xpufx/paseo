import fs from "node:fs";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PluginStorage, createPluginLogger, registerSettingsRpc } from "paseo-plugin-helper/server";
import {
  approvalAck,
  approvalSettings,
  approvalStatus,
  approvalTelegramInfo,
  approvalTelegramSetConfig,
  daemonHealth,
  migrateLegacyNotificationTarget,
  pendingList,
  policyAddRule,
  recentList,
  verdict,
} from "./shared/approval";
import type { ApprovalSettingsValues } from "./shared/approval";
import {
  addPolicyRule,
  getHealth,
  getStatus,
  getTelegramInfo,
  listPending,
  listRecent,
  setTelegramConfig,
  submitAck,
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
  registerSettingsRpc(server, approvalSettings, storage, {
    onUpdate: (next, prev) => {
      log.info("settings updated", {
        socketPath: next.socketPath,
        notificationTarget: next.notificationTarget,
      });
      if (next.telegramBotToken || next.telegramChatId || next.telegramApprovers) {
        const approvers = next.telegramApprovers
          ? next.telegramApprovers
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
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
  server.handle(approvalAck, (input) => submitAck(input));
  server.handle(recentList, (input) => listRecent(input));
  server.handle(approvalStatus, (input) => getStatus(input));
  server.handle(daemonHealth, (input) => getHealth(input));
  server.handle(approvalTelegramInfo, (input) => getTelegramInfo(input));
  server.handle(approvalTelegramSetConfig, (input) => setTelegramConfig(input));
  server.handle(policyAddRule, (input) => addPolicyRule(input));
  return () => {};
}

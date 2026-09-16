import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger } from "./server/vendor/paseo-plugin-helper/index.ts";
import {
  addCommentContract,
  forgeContextContract,
  forgeSettingsContract,
  installLabelsContract,
  issueDetailContract,
  openIssuesContract,
  setLabelContract,
} from "./shared/issues.js";
import {
  handleAddComment,
  handleForgeContext,
  handleInstallLabels,
  handleIssueDetail,
  handleOpenIssues,
  handleSetLabel,
} from "./server/issues.js";
import { settingsHandlers } from "./server/settings.js";

const log = createPluginLogger("forges");

export default function contribute(server: PluginServerContext) {
  server.handle(openIssuesContract, handleOpenIssues);
  server.handle(forgeContextContract, handleForgeContext);
  server.handle(issueDetailContract, handleIssueDetail);
  server.handle(setLabelContract, handleSetLabel);
  server.handle(addCommentContract, handleAddComment);
  server.handle(installLabelsContract, handleInstallLabels);
  server.handle(forgeSettingsContract.get, settingsHandlers.get);
  server.handle(forgeSettingsContract.update, settingsHandlers.update);
  server.handle(forgeSettingsContract.reset, settingsHandlers.reset);
  log.info("forges server handlers registered");
  return () => {};
}

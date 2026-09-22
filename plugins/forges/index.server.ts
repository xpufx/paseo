import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger } from "paseo-plugin-helper/server";
import {
  addCommentContract,
  createIssueContract,
  forgeContextContract,
  forgeSettingsContract,
  issueDetailContract,
  openIssuesContract,
  searchIssuesContract,
  setLabelContract,
} from "./shared/issues.js";
import {
  handleAddComment,
  handleCreateIssue,
  handleForgeContext,
  handleIssueDetail,
  handleOpenIssues,
  handleSearchIssues,
  handleSetLabel,
} from "./server/issues.js";
import { settingsHandlers } from "./server/settings.js";

const log = createPluginLogger("forges");

export default function contribute(server: PluginServerContext) {
  server.handle(openIssuesContract, handleOpenIssues);
  server.handle(searchIssuesContract, handleSearchIssues);
  server.handle(forgeContextContract, handleForgeContext);
  server.handle(issueDetailContract, handleIssueDetail);
  server.handle(setLabelContract, handleSetLabel);
  server.handle(addCommentContract, handleAddComment);
  server.handle(createIssueContract, handleCreateIssue);

  // forge.install-labels is operator-only: the optional label-set install is
  // hidden from the release surface (issue #163). handleInstallLabels stays in
  // server/issues.ts for our own board; the RPC is deliberately not registered.
  server.handle(forgeSettingsContract.get, settingsHandlers.get);
  server.handle(forgeSettingsContract.update, settingsHandlers.update);
  server.handle(forgeSettingsContract.reset, settingsHandlers.reset);
  log.info("forges server handlers registered");
  return () => {};
}

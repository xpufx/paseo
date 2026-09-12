import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger } from "paseo-plugin-helper/server";
import {
  addCommentContract,
  issueDetailContract,
  openIssuesContract,
  setLabelContract,
} from "./shared/issues.js";
import {
  handleAddComment,
  handleIssueDetail,
  handleOpenIssues,
  handleSetLabel,
} from "./server/issues.js";

const log = createPluginLogger("paseo-forgejo");

export default function contribute(server: PluginServerContext) {
  server.handle(openIssuesContract, handleOpenIssues);
  server.handle(issueDetailContract, handleIssueDetail);
  server.handle(setLabelContract, handleSetLabel);
  server.handle(addCommentContract, handleAddComment);
  log.info("paseo-forgejo server handlers registered");
  return () => {};
}

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger } from "paseo-plugin-helper/server";
import { openIssuesContract } from "./shared/issues.js";
import { handleOpenIssues } from "./server/issues.js";

const log = createPluginLogger("paseo-forgejo");

export default function contribute(server: PluginServerContext) {
  server.handle(openIssuesContract, handleOpenIssues);
  log.info("paseo-forgejo server handlers registered");
  return () => {};
}

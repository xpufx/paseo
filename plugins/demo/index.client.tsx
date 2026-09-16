import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeClient } from "./client/pill.js";

export default function contribute(client: PluginClientContext) {
  return contributeClient(client);
}

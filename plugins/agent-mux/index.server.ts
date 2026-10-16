import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerAgentMuxHandlers } from "./server/handlers.js";

export default function contribute(server: PluginServerContext) {
  registerAgentMuxHandlers(server);
  return () => {};
}

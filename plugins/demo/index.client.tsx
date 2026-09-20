import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeClient } from "./client/pill.js";
import { registerServerSettingsDemoSurface } from "./client/server-settings.js";

export default function contribute(client: PluginClientContext) {
  const cleanupPill = contributeClient(client);
  // TEMP DEMO (issue #62): a sidebar page showing the upstream server
  // settings handle. Not wired into the production pill/modal surfaces.
  const cleanupSettingsSurface = registerServerSettingsDemoSurface(client);
  return () => {
    cleanupPill();
    cleanupSettingsSurface?.();
  };
}

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger, installStorageGuard } from "paseo-plugin-helper/server";
import { composeFeatureModules } from "paseo-plugin-helper/shared";
import { createPermissionAuditFeature } from "permission-audit/server";

const log = createPluginLogger("permission-logger");

let logStorePath: string | undefined;
const permissionAuditModule = createPermissionAuditFeature<PluginServerContext>({
  logger: log,
  onMount: ({ store }) => {
    logStorePath = store.filePath;
  },
});

const features = composeFeatureModules<PluginServerContext>([
  permissionAuditModule,
]);

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({ pluginId: "permission-logger" });
  const dispose = features.contributeServer(server);
  log.info("permission-logger plugin contributed: audit log live", { path: logStorePath });
  return () => {
    if (typeof dispose === "function") {
      dispose();
    }
    uninstallStorageGuard();
  };
}


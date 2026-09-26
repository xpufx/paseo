import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  uppidiIssuesContract,
  uppidiHookStatusContract,
  uppidiHookInfoContract,
  uppidiHookQueuesContract,
  uppidiHookPauseContract,
  uppidiHookResumeContract,
  uppidiHookDrainContract,
  uppidiHookServiceStatusContract,
  uppidiHookServiceActionContract,
  uppidiHookConfigureContract,
  uppidiHookLogTailContract,
  uppidiAgentsContract,
  uppidiRoleModelsContract,
  uppidiSetRoleModelContract,
  uppidiRunnersContract,
  uppidiFleetMetricsContract,
  uppidiArchiveAgentContract,
  uppidiArchiveInactiveAgentsContract,
  uppidiCreateFrontDeskContract,
  uppidiReplaceFrontDeskContract,
  uppidiAddOrchestratorContract,
  uppidiReplaceOrchestratorContract,
  uppidiToggleRepoMuteContract,
  uppidiFleetSettingsContract,
} from "./shared/contracts.js";
import { handleUppidiIssues } from "./server/issues.js";
import {
  handleHookStatus,
  handleHookInfo,
  handleHookQueues,
  handleHookPause,
  handleHookResume,
  handleHookDrain,
  handleHookServiceStatus,
  handleHookServiceAction,
  handleHookConfigure,
  handleHookLogTail,
} from "./server/hook.js";
import {
  handleUppidiAgents,
  handleUppidiArchiveAgent,
  handleUppidiArchiveInactiveAgents,
  handleUppidiCreateFrontDesk,
  handleUppidiReplaceFrontDesk,
  handleUppidiAddOrchestrator,
  handleUppidiReplaceOrchestrator,
  handleUppidiToggleRepoMute,
} from "./server/agents.js";

import { handleUppidiRoleModels, handleUppidiSetRoleModel } from "./server/role-models.js";
import { handleUppidiRunners } from "./server/runners.js";
import { handleUppidiFleetMetrics } from "./server/metrics.js";
import { startHookRouter, getActiveHookRouter } from "./server/hook-router.js";
import { createPluginLogger, registerSettingsRpc } from "paseo-plugin-helper/server";
import { getUppidiFleetSettingsStorage } from "./server/settings.js";
import { PLUGIN_VERSION } from "./shared/version.js";
import { HELPER_VERSION, HELPER_SERVED_FROM } from "./shared/helper-version.js";

// The checkout revision both the plugin and the resolved helper were read from.
// `PLUGIN_VERSION` is generated as `<plugin version>+<git sha>` by the helper's
// own stampVersion, so this is that sha and nothing invented here.
const PLUGIN_REVISION = PLUGIN_VERSION.split("+")[1] ?? "unstamped";

// #633: this plugin serves the helper straight out of the checkout it was
// installed from, so nothing travelled with it to be compared against. The
// banner names both halves of the identity in one line the daemon log already
// carries, and doctor:live parses the same tag. A stale daemon therefore has a
// distinguishable load line instead of a reload that looks like it worked.
const log = createPluginLogger("uppidi-fleet", {
  version: PLUGIN_VERSION,
  meta: {
    helper: HELPER_VERSION,
    resolution: HELPER_SERVED_FROM,
    revision: PLUGIN_REVISION,
  },
});

export default function contribute(server: PluginServerContext) {
  server.handle(uppidiIssuesContract, handleUppidiIssues);
  server.handle(uppidiHookStatusContract, handleHookStatus);
  server.handle(uppidiHookInfoContract, handleHookInfo);
  server.handle(uppidiHookQueuesContract, handleHookQueues);
  server.handle(uppidiHookPauseContract, handleHookPause);
  server.handle(uppidiHookResumeContract, handleHookResume);
  server.handle(uppidiHookDrainContract, handleHookDrain);
  server.handle(uppidiHookServiceStatusContract, handleHookServiceStatus);
  server.handle(uppidiHookServiceActionContract, handleHookServiceAction);
  server.handle(uppidiHookConfigureContract, handleHookConfigure);
  server.handle(uppidiHookLogTailContract, handleHookLogTail);
  server.handle(uppidiAgentsContract, handleUppidiAgents);
  server.handle(uppidiRoleModelsContract, handleUppidiRoleModels);
  server.handle(uppidiSetRoleModelContract, handleUppidiSetRoleModel);
  server.handle(uppidiRunnersContract, handleUppidiRunners);
  server.handle(uppidiFleetMetricsContract, handleUppidiFleetMetrics);
  server.handle(uppidiArchiveAgentContract, handleUppidiArchiveAgent);
  server.handle(uppidiArchiveInactiveAgentsContract, handleUppidiArchiveInactiveAgents);
  server.handle(uppidiCreateFrontDeskContract, handleUppidiCreateFrontDesk);
  server.handle(uppidiReplaceFrontDeskContract, handleUppidiReplaceFrontDesk);
  server.handle(uppidiAddOrchestratorContract, handleUppidiAddOrchestrator);
  server.handle(uppidiReplaceOrchestratorContract, handleUppidiReplaceOrchestrator);
  server.handle(uppidiToggleRepoMuteContract, handleUppidiToggleRepoMute);

  const settingsStorage = getUppidiFleetSettingsStorage();
  registerSettingsRpc(server, uppidiFleetSettingsContract, settingsStorage, {
    onUpdate: async (next, prev) => {
      if (next.hookHost !== prev?.hookHost || next.hookPort !== prev?.hookPort) {
        const router = getActiveHookRouter();
        if (router) {
          await router.configure({
            host: next.hookHost,
            port: next.hookPort,
            restart: true,
          });
        }
      }
    },
    onReset: async (defaults, prev) => {
      if (defaults.hookHost !== prev?.hookHost || defaults.hookPort !== prev?.hookPort) {
        const router = getActiveHookRouter();
        if (router) {
          await router.configure({
            host: defaults.hookHost,
            port: defaults.hookPort,
            restart: true,
          });
        }
      }
    },
  });

  const stopHookRouter = startHookRouter(server);

  log.info("Serving paseo-plugin-helper from the checkout this plugin was installed from", {
    helper: HELPER_VERSION,
    resolution: HELPER_SERVED_FROM,
    revision: PLUGIN_REVISION,
    expectationCheck: "scripts/doctor-live.mjs + scripts/helper-resolution.test.mjs",
  });

  return () => {
    log.info("Unloading; disposing hook router");
    void stopHookRouter();
  };
}

import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  uppidiIssuesContract,
  uppidiHookStatusContract,
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
} from "./shared/contracts.js";
import { handleUppidiIssues } from "./server/issues.js";
import {
  handleHookStatus,
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
} from "./server/agents.js";

import { handleUppidiRoleModels, handleUppidiSetRoleModel } from "./server/role-models.js";
import { handleUppidiRunners } from "./server/runners.js";
import { handleUppidiFleetMetrics } from "./server/metrics.js";
import { startHookRouter } from "./server/hook-router.js";

export default function contribute(server: PluginServerContext) {
  server.handle(uppidiIssuesContract, handleUppidiIssues);
  server.handle(uppidiHookStatusContract, handleHookStatus);
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

  const stopHookRouter = startHookRouter(server);

  return () => {
    void stopHookRouter();
  };
}

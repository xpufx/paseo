import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installStorageGuard } from "paseo-plugin-helper/server";
import {
  addOrchestratorContract,
  archiveAgentContract,
  archiveInactiveAgentsContract,
  createFrontDeskContract,
  fleetContract,
  muteRepoContract,
  queueContract,
  queueDrainContract,
  queuePauseContract,
  queueResumeContract,
  replaceFrontDeskContract,
  replaceOrchestratorContract,
  routerStatusContract,
  ticketBoardContract,
} from "./shared/contracts.js";
import {
  handleAddOrchestrator,
  handleArchiveAgent,
  handleArchiveInactive,
  handleCreateFrontDesk,
  handleFleet,
  handleMuteRepo,
  handleReplaceFrontDesk,
  handleReplaceOrchestrator,
  migrateLegacyMutedRepos,
} from "./server/agents.js";
import { handleTickets } from "./server/tickets.js";
import {
  handleQueueDrain,
  handleQueuePause,
  handleQueueResume,
  handleQueues,
  handleRouterStatus,
} from "./server/queue.js";

export default function contribute(server: PluginServerContext) {
  migrateLegacyMutedRepos();
  const uninstallStorageGuard = installStorageGuard({ pluginId: "worktree-install" });

  server.handle(fleetContract, handleFleet);
  server.handle(ticketBoardContract, handleTickets);
  server.handle(routerStatusContract, handleRouterStatus);
  server.handle(queueContract, handleQueues);
  server.handle(queuePauseContract, handleQueuePause);
  server.handle(queueResumeContract, handleQueueResume);
  server.handle(queueDrainContract, handleQueueDrain);
  server.handle(archiveAgentContract, handleArchiveAgent);
  server.handle(archiveInactiveAgentsContract, handleArchiveInactive);
  server.handle(createFrontDeskContract, handleCreateFrontDesk);
  server.handle(replaceFrontDeskContract, handleReplaceFrontDesk);
  server.handle(addOrchestratorContract, handleAddOrchestrator);
  server.handle(replaceOrchestratorContract, handleReplaceOrchestrator);
  server.handle(muteRepoContract, handleMuteRepo);

  return () => {
    uninstallStorageGuard();
  };
}

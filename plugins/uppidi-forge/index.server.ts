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
  uppidiHookLogTailContract,
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
  handleHookLogTail,
} from "./server/hook.js";

export default function contribute(server: PluginServerContext) {
  server.handle(uppidiIssuesContract, handleUppidiIssues);
  server.handle(uppidiHookStatusContract, handleHookStatus);
  server.handle(uppidiHookQueuesContract, handleHookQueues);
  server.handle(uppidiHookPauseContract, handleHookPause);
  server.handle(uppidiHookResumeContract, handleHookResume);
  server.handle(uppidiHookDrainContract, handleHookDrain);
  server.handle(uppidiHookServiceStatusContract, handleHookServiceStatus);
  server.handle(uppidiHookServiceActionContract, handleHookServiceAction);
  server.handle(uppidiHookLogTailContract, handleHookLogTail);

  return () => {};
}

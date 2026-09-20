import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  handleRegistryRead,
  handleDaemonAdd,
  handleDaemonUpdate,
  handleDaemonRemove,
  handleDaemonHealth,
  handleServerStatus,
  handleConversationSend,
  handleIntrospectAgents,
  handleIntroduceAgents,
  handleDaemonProbe,
  handleUiPrefsGet,
  handleUiPrefsSet,
  handleSnapshotRefresh,
  handleDaemonDump,
  handleIdentitySync,
  handlePresenceAnnounce,
  handlePresenceRetract,
  handlePresenceList,
  injectionEnabled,
  onLocalAgentCreated,
  onLocalAgentArchived,
  rememberPaseo,
  stopOutboxWorker,
} from "./server/handlers";
import { maybeRegisterInjection, toInjectionServer } from "./server/injection";
import { handlePeerStatus } from "./server/peer-status";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
  serverStatusRpc,
  conversationSendRpc,
  introspectAgentsRpc,
  introduceAgentsRpc,
  daemonProbeRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
  snapshotRefreshRpc,
  daemonDumpRpc,
  identitySyncRpc,
  presenceAnnounceRpc,
  presenceRetractRpc,
  presenceListRpc,
  peerStatusRpc,
} from "./shared/registry";

export default function contribute(server: PluginServerContext) {
  server.handle(registryReadRpc, handleRegistryRead);
  server.handle(daemonAddRpc, handleDaemonAdd);
  server.handle(daemonUpdateRpc, handleDaemonUpdate);
  server.handle(daemonRemoveRpc, handleDaemonRemove);
  server.handle(daemonHealthRpc, handleDaemonHealth);
  server.handle(serverStatusRpc, handleServerStatus);
  server.handle(conversationSendRpc, handleConversationSend);
  server.handle(introspectAgentsRpc, handleIntrospectAgents);
  server.handle(introduceAgentsRpc, handleIntroduceAgents);
  server.handle(daemonProbeRpc, handleDaemonProbe);
  server.handle(uiPrefsGetRpc, handleUiPrefsGet);
  server.handle(uiPrefsSetRpc, handleUiPrefsSet);
  server.handle(snapshotRefreshRpc, handleSnapshotRefresh);
  server.handle(daemonDumpRpc, handleDaemonDump);
  server.handle(identitySyncRpc, handleIdentitySync);
  server.handle(presenceAnnounceRpc, handlePresenceAnnounce);
  server.handle(presenceRetractRpc, handlePresenceRetract);
  server.handle(presenceListRpc, handlePresenceList);
  server.handle(peerStatusRpc, handlePeerStatus);
  server.on("agent.created", ({ agent }, context) => {
    rememberPaseo(context.paseo);
    void onLocalAgentCreated(agent).catch(() => {});
  });
  server.on("agent.archived", ({ agent }, context) => {
    rememberPaseo(context.paseo);
    void onLocalAgentArchived(agent).catch(() => {});
  });
  const removeInjection = maybeRegisterInjection(toInjectionServer(server), { enabled: injectionEnabled() });
  return () => {
    stopOutboxWorker();
    removeInjection();
  };
}

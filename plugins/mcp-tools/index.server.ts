import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installStorageGuard } from "paseo-plugin-helper/server";
import {
  createCallMcpToolHandler,
  createDiagnoseMcpHandler,
  createHealthHandler,
  createInspectProviderMcpHandler,
  createListMcpHandler,
  createMcpSlashHandler,
  createReadMcpHandler,
  log,
} from "./server/mcp";
import {
  callMcpTool,
  checkMcpHealth,
  diagnoseMcp,
  inspectProviderMcp,
  listMcp,
  mcpToolsSettingsContract,
  readMcp,
  runMcpSlash,
} from "./shared/mcp";
import { settingsHandlers, settingsStorage } from "./server/settings";
import { GATEWAY_SERVER_NAME, injectGatewayIntoCreateRequest } from "./server/inject";
import { startGateway, stopGateway } from "./server/gateway";

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({ pluginId: "mcp-tools" });

  server.handle(listMcp, createListMcpHandler());
  server.handle(readMcp, createReadMcpHandler());
  server.handle(checkMcpHealth, createHealthHandler());
  server.handle(callMcpTool, createCallMcpToolHandler());
  server.handle(diagnoseMcp, createDiagnoseMcpHandler());
  server.handle(inspectProviderMcp, createInspectProviderMcpHandler());
  server.handle(runMcpSlash, createMcpSlashHandler());
  server.handle(mcpToolsSettingsContract.get, settingsHandlers.get);
  server.handle(mcpToolsSettingsContract.update, settingsHandlers.update);
  server.handle(mcpToolsSettingsContract.reset, settingsHandlers.reset);
  server.before("agent.create", ({ request }) => {
    const settings = settingsStorage.read();
    const next = injectGatewayIntoCreateRequest(request, {
      enabled: settings.gatewayInject,
      url: settings.gatewayUrl,
    });
    if (next) {
      log.info(`Injected ${GATEWAY_SERVER_NAME} MCP server into agent.create`, {
        provider: next.config.provider,
      });
    }
    return next;
  });

  const initialSettings = settingsStorage.read();
  if (initialSettings.gatewayInject) {
    void startGateway(initialSettings);
  }

  return () => {
    void stopGateway();
    uninstallStorageGuard();
  };
}

import os from "node:os";
import path from "node:path";
import { matchesFamily } from "./family";
import { discoverFromCandidates } from "../discovery/extract";
import type { McpProbe, ProbeContext } from "../discovery/types";

export const ANTIGRAVITY_MANUAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".gemini",
  "config",
  "mcp_config.json",
);

export function generateAntigravityManualConfigSnippet(
  serverName = "gateway",
  serverConfig?: { url?: string; command?: string; args?: string[] },
): string {
  const config = serverConfig?.url
    ? { url: serverConfig.url }
    : {
        command: serverConfig?.command ?? "node",
        ...(serverConfig?.args && serverConfig.args.length > 0 ? { args: serverConfig.args } : {}),
      };

  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: config,
      },
    },
    null,
    2,
  );
}

export const antigravityProbe: McpProbe = {
  id: "antigravity",
  label: "antigravity · live",
  matches: (provider) => matchesFamily(provider, "antigravity") || matchesFamily(provider, "agy"),
  supportsMcpInjection: false,
  supportsNativePaseoTools: false,
  manualConfigPath: ANTIGRAVITY_MANUAL_CONFIG_PATH,
  getManualConfigSnippet: generateAntigravityManualConfigSnippet,
  async probe(ctx: ProbeContext) {
    const home = os.homedir();
    return discoverFromCandidates("antigravity", [
      { path: path.join(home, ".gemini", "config", "mcp_config.json"), label: "antigravity · user global" },
      { path: path.join(home, ".gemini", "antigravity", "mcp_config.json"), label: "antigravity · app global" },
      { path: path.join(ctx.cwd, ".gemini", "mcp_config.json"), label: "antigravity · project config" },
      { path: path.join(ctx.cwd, "mcp_config.json"), label: "antigravity · project root" },
    ]);
  },
};

export default antigravityProbe;

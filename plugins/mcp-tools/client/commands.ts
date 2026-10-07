import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getOptionalClientHost } from "paseo-plugin-helper/core";
import { listMcp, runMcpSlash } from "../shared/mcp";

function showFeedback(message: string, isError = false): void {
  try {
    const toast = getOptionalClientHost()?.useToast?.();
    if (toast) {
      if (isError && typeof toast.error === "function") {
        toast.error(message);
        return;
      }
      if (typeof toast.show === "function") {
        toast.show(message, isError ? { variant: "error" } : undefined);
        return;
      }
    }
  } catch {}
}

function report(where: string, err: unknown): void {
  try {
    console.error(`[mcp.commands] ${where}: ${err instanceof Error ? err.message : String(err)}`);
  } catch {}
}

export function registerMcpCommands(client: PluginClientContext): () => void {
  const removers = [
    client.addSlashCommand({
      name: "mcp",
      description: "Probe servers, check health, or run an MCP tool",
      argumentHint: "[probe|health [server]|run server tool [json-args]]",
      context: "agent",
      async onSubmit(ctx) {
        const { args, agent, rpc } = ctx;
        try {
          const res = await (rpc as unknown as (contract: unknown, input: unknown) => Promise<{ ok: boolean; title: string; body: string; error?: string | null }>)(
            runMcpSlash as unknown,
            { agentId: agent.id, args },
          );
          if (res.ok) {
            showFeedback("/mcp executed");
          } else {
            showFeedback(`/mcp: ${res.body}`, true);
          }
        } catch (e) {
          const errMessage = e instanceof Error ? e.message : String(e);
          report("mcp-slash", errMessage);
          showFeedback(`/mcp failed: ${errMessage}`, true);
        }
      },
    }),
    client.addCommandCenterItem({
      id: "reprobe-mcp",
      title: "Re-probe MCP servers",
      icon: "Plug",
      keywords: ["mcp", "refresh", "health"],
      context: "agent",
      async onSelect({ agent, rpc }) {
        await rpc(listMcp, { agentId: agent.id });
      },
    }),
  ];
  return () => {
    removers.forEach((remove) => remove());
  };
}

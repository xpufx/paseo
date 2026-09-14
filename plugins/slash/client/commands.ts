import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  interpolateTemplate,
  listCommandsRpc,
  runCommandRpc,
  withPrefix,
  type SlashCommand,
} from "../shared/resources";

async function fetchCommands(rpc: PluginClientContext["rpc"]): Promise<SlashCommand[]> {
  const prefix = "";
  void prefix;
  const res = await (rpc as unknown as (contract: unknown, input: unknown) => Promise<{ commands: SlashCommand[] }>)(
    listCommandsRpc as unknown,
    {},
  );
  return res.commands;
}

export function registerSlashCommands(client: PluginClientContext): () => void {
  const removers: Array<() => void> = [];
  let disposed = false;

  async function sync() {
    if (disposed) return;
    let commands: SlashCommand[] = [];
    try {
      commands = await fetchCommands(client.rpc);
    } catch {
      return;
    }
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {}
    }
    if (disposed) return;
    let prefix = "";
    try {
      const settings = await (client.rpc as unknown as (c: unknown, i: unknown) => Promise<{ prefix?: string }>)(
        { name: "slash.settings.get" } as unknown,
        {},
      );
      prefix = settings.prefix ?? "";
    } catch {}
    for (const command of commands) {
      const name = withPrefix(prefix, command.name);
      if (command.action.verb === "send") {
        removers.push(
          client.addSlashCommand({
            name,
            description: command.description || command.title,
            argumentHint: "{args}",
            context: "agent",
            async onSubmit(ctx) {
              const prompt = interpolateTemplate(command.action.verb === "send" ? command.action.template : "", ctx.args);
              await ctx.paseo.agents.ref(ctx.agent.id).send(prompt);
            },
          }),
        );
      } else if (command.action.verb === "open") {
        const target = command.action.verb === "open" ? command.action.target : "";
        removers.push(
          client.addSlashCommand({
            name,
            description: command.description || command.title,
            argumentHint: "",
            context: "agent",
            async onSubmit(ctx) {
              await ctx.paseo.agents.ref(ctx.agent.id).timeline.append({
                type: "plugin",
                id: "slash-open",
                kind: "slash-result",
                version: 1,
                data: { title: command.title, body: `Open target: ${target}` },
              });
            },
          }),
        );
      } else {
        removers.push(
          client.addSlashCommand({
            name,
            description: command.description || command.title,
            argumentHint: "[args]",
            context: "agent",
            async onSubmit(ctx) {
              try {
                const out = await (client.rpc as unknown as (c: unknown, i: unknown) => Promise<{ result?: unknown }>)(
                  runCommandRpc as unknown,
                  { name: command.name, args: ctx.args },
                );
                await ctx.paseo.agents.ref(ctx.agent.id).timeline.append({
                  type: "plugin",
                  id: "slash-rpc",
                  kind: "slash-result",
                  version: 1,
                  data: { title: command.title, body: JSON.stringify(out.result ?? null) },
                });
              } catch (e) {
                await ctx.paseo.agents.ref(ctx.agent.id).timeline.append({
                  type: "plugin",
                  id: "slash-rpc-error",
                  kind: "slash-result",
                  version: 1,
                  data: { title: command.title, body: `Error: ${e instanceof Error ? e.message : String(e)}` },
                });
              }
            },
          }),
        );
      }
    }
  }

  void sync();
  const interval = setInterval(sync, 30_000);
  return () => {
    disposed = true;
    clearInterval(interval);
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {}
    }
  };
}

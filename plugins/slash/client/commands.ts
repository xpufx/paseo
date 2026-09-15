import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  interpolateTemplate,
  listCommandsRpc,
  runCommandRpc,
  withPrefix,
  type SlashCommand,
} from "../shared/resources";

async function fetchCommands(rpc: PluginClientContext["rpc"]): Promise<SlashCommand[]> {
  const res = await (rpc as unknown as (contract: unknown, input: unknown) => Promise<{ commands: SlashCommand[] }>)(
    listCommandsRpc as unknown,
    {},
  );
  return res.commands;
}

function report(where: string, err: unknown): void {
  try {
    // Visible in Paseo GUI logs; never throws back into registration.
    console.error(`[slash.commands] ${where}: ${err instanceof Error ? err.message : String(err)}`);
  } catch {}
}

export function registerSlashCommands(client: PluginClientContext): () => void {
  const removers: Array<() => void> = [];
  let disposed = false;

  async function sync() {
    if (disposed) return;
    if (typeof client.rpc !== "function") {
      report("sync", `client.rpc unavailable (${typeof client.rpc}); retrying on interval`);
      return;
    }
    let commands: SlashCommand[] = [];
    try {
      commands = await fetchCommands(client.rpc);
    } catch (err) {
      report("list-commands", err);
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
    } catch (err) {
      report("get-prefix", err);
    }
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
              ctx.openSurface(target);
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
                await ctx.paseo.agents.ref(ctx.agent.id).send(`/${command.name}: ${JSON.stringify(out.result ?? null)}`);
              } catch (e) {
                await ctx.paseo.agents.ref(ctx.agent.id).send(`/${command.name} failed: ${e instanceof Error ? e.message : String(e)}`);
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

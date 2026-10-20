import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getOptionalClientHost } from "paseo-plugin-helper/core";
import {
  interpolateTemplate,
  listCommandsRpc,
  runCommandRpc,
  slashSettingsContract,
  withPrefix,
  type SlashCommand,
} from "../shared/resources";

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
    if (!toast) {
      console.error(`[slash.commands] show-feedback: no toast available, message="${message}"`);
    }
  } catch {}
}

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

export const BACKOFF_DELAYS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000] as const;
export const MAX_BACKOFF_MS = 30_000;
export const DEFAULT_SYNC_INTERVAL_MS = 30_000;

export function getBackoffDelay(
  attempt: number,
  delays: readonly number[] = BACKOFF_DELAYS,
  maxBackoffMs: number = MAX_BACKOFF_MS,
): number {
  if (attempt <= 0) return delays[0] ?? 1_000;
  if (attempt < delays.length) return delays[attempt];
  return maxBackoffMs;
}

export interface RegisterSlashCommandsOptions {
  intervalMs?: number;
  backoffDelays?: readonly number[];
  maxBackoffMs?: number;
}

export function registerSlashCommands(
  client: PluginClientContext,
  options?: RegisterSlashCommandsOptions,
): () => void {
  const removers: Array<() => void> = [];
  let disposed = false;
  let isSyncing = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let retryAttempt = 0;
  let cachedCommands: SlashCommand[] = [];
  let cachedPrefix = "";

  const intervalMs = options?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const backoffDelays = options?.backoffDelays ?? BACKOFF_DELAYS;
  const maxBackoffMs = options?.maxBackoffMs ?? MAX_BACKOFF_MS;

  function scheduleRetry() {
    if (disposed) return;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    const delay = getBackoffDelay(retryAttempt, backoffDelays, maxBackoffMs);
    retryAttempt++;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void sync();
    }, delay);
  }

  async function sync() {
    if (disposed || isSyncing) return;
    isSyncing = true;
    try {
      if (typeof client.rpc !== "function") {
        report("sync", `client.rpc unavailable (${typeof client.rpc}); retrying on backoff`);
        scheduleRetry();
        return;
      }
      let commands: SlashCommand[] = [];
      try {
        commands = await fetchCommands(client.rpc);
      } catch (err) {
        report("list-commands", err);
        scheduleRetry();
        return;
      }

      // Successful fetch: reset retry backoff and clear any pending retry timer
      retryAttempt = 0;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      cachedCommands = commands;

      if (disposed) return;

      let prefix = cachedPrefix;
      try {
        const settings = await (client.rpc as unknown as (c: unknown, i: unknown) => Promise<{ prefix?: string }>)(
          slashSettingsContract.get as unknown,
          {},
        );
        prefix = settings.prefix ?? "";
        cachedPrefix = prefix;
      } catch (err) {
        report("get-prefix", err);
      }

      if (disposed) return;

      // Retain previous removers until new commands are ready to register
      for (const remove of removers.splice(0)) {
        try {
          remove();
        } catch {}
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
                try {
                  await (client.rpc as unknown as (c: unknown, i: unknown) => Promise<unknown>)(
                    runCommandRpc as unknown,
                    { name: command.name, args: ctx.args, agentId: ctx.agent.id },
                  );
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  report(`send:${command.name}`, err);
                  showFeedback(`/${command.name} send failed: ${message}`, true);
                }
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
                  await (client.rpc as unknown as (c: unknown, i: unknown) => Promise<{ result?: unknown }>)(
                    runCommandRpc as unknown,
                    { name: command.name, args: ctx.args, agentId: ctx.agent.id },
                  );
                  showFeedback(`/${command.name} executed`);
                } catch (e) {
                  const errMessage = e instanceof Error ? e.message : String(e);
                  report(`run-command:${command.name}`, errMessage);
                  showFeedback(`/${command.name} failed: ${errMessage}`, true);
                }
              },
            }),
          );
        }
      }
    } finally {
      isSyncing = false;
    }
  }

  void sync();
  const interval = setInterval(sync, intervalMs);
  return () => {
    disposed = true;
    clearInterval(interval);
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {}
    }
  };
}

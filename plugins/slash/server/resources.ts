import { createPluginLogger } from "paseo-plugin-helper/server";
import {
  KNOWN_OPEN_TARGETS,
  SEED_COMMANDS,
  mergeOperationBindings,
  interpolateTemplate,
  type CommandBundle,
  type RpcHttpOperationBinding,
  type RpcOperationBinding,
  type SlashCommand,
  type SlashSettings,
} from "../shared/resources";
import { PLUGIN_VERSION as SLASH_PLUGIN_VERSION } from "../shared/version";
import {
  HOOK_TIMEOUT_MS,
  orchestrateHandover,
  readHookSecret,
  resolveHookUrl,
} from "./orchestrate";
import { DEFAULT_SLASH_SETTINGS, getSlashSettingsStorage } from "./settings";

export const log = createPluginLogger("slash", { version: SLASH_PLUGIN_VERSION });

const DEFAULTS: SlashSettings = DEFAULT_SLASH_SETTINGS;

const settingsStorage = getSlashSettingsStorage();

async function readSettings(): Promise<SlashSettings> {
  const data = await settingsStorage.readAsync();
  if (!data.commands || data.commands.length === 0) {
    return { ...data, commands: SEED_COMMANDS };
  }
  return data;
}

export async function handleGetSettings(): Promise<SlashSettings> {
  return readSettings();
}

export async function handleUpdateSettings(patch: Partial<SlashSettings>): Promise<SlashSettings> {
  if (patch.prefix !== undefined && !/^[a-z0-9-]*$/.test(patch.prefix)) {
    throw new Error("prefix may only contain lowercase letters, digits, and dashes");
  }
  return settingsStorage.updateAsync((prev) => ({ ...prev, ...patch }));
}

export async function handleResetSettings(): Promise<SlashSettings> {
  settingsStorage.reset();
  return DEFAULTS;
}

export async function handleListCommands(): Promise<{ commands: SlashCommand[] }> {
  const settings = await readSettings();
  return { commands: settings.commands.filter((c) => c.enabled) };
}

export function handleListCatalog(): { commands: SlashCommand[] } {
  return { commands: SEED_COMMANDS };
}

export async function handleListOperations(): Promise<{ rpc: string[]; open: string[] }> {
  return { rpc: await allowedOperations(), open: [...KNOWN_OPEN_TARGETS] };
}

export interface OperationContext {
  agentId?: string;
}

/** A primitive is a built-in code handler; operation bindings are the data that name it. */
type OperationPrimitive = (
  params: Record<string, unknown>,
  context: OperationContext,
  binding: RpcOperationBinding,
) => unknown;

const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;

/** Headers whose values are secret; any echo/preview must redact them. */
const REDACTED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

/** Returns a copy of `headers` with secret-bearing values replaced by "[redacted]". */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
  }
  return redacted;
}

/** Only http(s) URLs may be targeted; anything else is refused before fetch. */
function assertHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`http operation target is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`http operation target must use http or https: ${parsed.protocol}`);
  }
  return parsed;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

function httpErrorReason(status: number, statusText: string, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const reason = (payload as { error?: unknown }).error;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  return statusText || `http operation failed (${status})`;
}

/**
 * Executes a `kind: "http"` binding with a single generic code path: resolve the
 * target, apply method/path/headers, and build a POST body only from the binding's
 * declared `bodyParams`. Adding an arbitrary callable rpc is a settings change,
 * never a code change (issue #544).
 */
async function runHttpBinding(
  binding: RpcHttpOperationBinding,
  params: Record<string, unknown>,
): Promise<unknown> {
  const url = assertHttpUrl(joinUrl(resolveHookUrl(binding.target), binding.http.path));

  const headers: Record<string, string> = { ...binding.http.headers };
  if (binding.auth === true) {
    headers.authorization = `Bearer ${readHookSecret()}`;
  }

  let body: string | undefined;
  if (binding.http.method === "POST") {
    const whitelisted: Record<string, unknown> = {};
    for (const key of binding.http.bodyParams ?? []) {
      if (key in params) whitelisted[key] = params[key];
    }
    body = JSON.stringify(whitelisted);
    headers["content-type"] ??= "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: binding.http.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
    });
  } catch (err) {
    log.warn(`http operation "${binding.name}" unreachable`, {
      method: binding.http.method,
      url: url.toString(),
      headers: redactHeaders(headers),
    });
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`http operation "${binding.name}" unreachable at ${url.toString()} (${detail})`);
  }

  const { text, truncated } = await readCappedText(response);
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(
      `http operation "${binding.name}" rejected (${response.status}): ${httpErrorReason(response.status, response.statusText, payload)}`,
    );
  }
  if (truncated) {
    return { truncated: true, body: text };
  }
  return payload ?? { ok: true };
}

/**
 * Reads at most MAX_HTTP_RESPONSE_BYTES from the body, cancelling the stream once
 * the cap is hit so an oversized response cannot be buffered whole.
 */
async function readCappedText(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: await response.text().catch(() => ""), truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_HTTP_RESPONSE_BYTES - bytes;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      text += decoder.decode(value, { stream: true });
      bytes += value.byteLength;
    }
    text += decoder.decode();
  } catch {
    // Body read failed; return whatever was decoded so far.
  }
  return { text, truncated };
}

const PRIMITIVES: Record<string, OperationPrimitive> = {
  "slash.ping": () => ({ ok: true, version: SLASH_PLUGIN_VERSION }),
  "slash.echo": (params) => ({ echo: params }),
  "slash.orchestrate": (_params, context, binding) => {
    if (!context.agentId) throw new Error("orchestrate requires a caller agent id");
    return orchestrateHandover(context.agentId, binding.target);
  },
  // One generic handler backs every `kind: "http"` binding.
  http: (params, _context, binding) => {
    if (binding.kind !== "http") {
      throw new Error(`http primitive requires an http binding: ${binding.name}`);
    }
    return runHttpBinding(binding, params);
  },
};

/** Bindings = seed defaults merged with the user's settings additions/overrides. */
async function resolveOperationBindings(): Promise<RpcOperationBinding[]> {
  const settings = await readSettings();
  return mergeOperationBindings(settings.operationBindings);
}

export async function allowedOperations(): Promise<string[]> {
  return (await resolveOperationBindings()).map((binding) => binding.name);
}

export async function runOperation(
  operation: string,
  params: Record<string, unknown>,
  context: OperationContext = {},
): Promise<unknown> {
  const binding = (await resolveOperationBindings()).find((entry) => entry.name === operation);
  if (!binding) {
    throw new Error(`rpc operation not allowlisted: ${operation}`);
  }
  const primitiveName = binding.kind === "http" ? "http" : binding.primitive;
  const primitive = PRIMITIVES[primitiveName];
  if (!primitive) {
    throw new Error(
      `rpc operation binding "${operation}" references unknown primitive: ${primitiveName}`,
    );
  }
  return primitive({ ...binding.params, ...params }, context, binding);
}

export async function handleRunCommand(input: { name: string; args: string; agentId?: string }) {
  const settings = await readSettings();
  const command = settings.commands.find((c) => c.enabled && c.name === input.name);
  if (!command) {
    throw new Error(`unknown or disabled command: ${input.name}`);
  }
  if (command.action.verb === "send") {
    return { verb: "send" as const, prompt: interpolateTemplate(command.action.template, input.args) };
  }
  if (command.action.verb === "open") {
    return { verb: "open" as const, target: command.action.target };
  }
  const result = await runOperation(command.action.operation, command.action.params ?? {}, {
    agentId: input.agentId,
  });
  return { verb: "rpc" as const, result };
}

export async function handleExportBundle(): Promise<{ bundle: CommandBundle }> {
  const settings = await readSettings();
  return {
    bundle: {
      bundle: "slash-commands",
      version: 1,
      commands: settings.commands.filter((c) => c.enabled),
    },
  };
}

export async function handleImportBundle(input: {
  bundle: CommandBundle;
  overwrite: boolean;
}): Promise<{ commands: SlashCommand[] }> {
  const settings = await readSettings();
  const existing = new Map(settings.commands.map((c) => [c.name, c]));
  for (const incoming of input.bundle.commands) {
    if (existing.has(incoming.name) && !input.overwrite) continue;
    existing.set(incoming.name, incoming);
  }
  const commands = [...existing.values()];
  await settingsStorage.updateAsync((prev) => ({ ...prev, commands }));
  return { commands };
}

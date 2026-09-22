import { hostname } from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import { localServerId } from "./peer-channel";

/**
 * Native send for targets that live on THIS daemon.
 *
 * `PaseoApi.send()` is bound to one daemon connection — it carries no host or
 * serverId (see PaseoAgentSendOptions) — so it can only reach agents on the
 * daemon the handle was created for. The plugin server's `context.paseo` is
 * exactly that local daemon handle. Remote peers still go through the bundled
 * MCP server's `paseo send --host` path; there is no host-targeted SDK call.
 *
 * The envelope is the wire contract. This producer must stay byte-compatible
 * with the MCP server's `senderMetaBlock` (mcp/paseo-x-comms.mjs), which stamps
 * the remote path: same prefix, same version, same field set. `parseEnvelope`
 * in shared/envelope.ts reads both.
 */

import { ENVELOPE_OPEN, ENVELOPE_CLOSE, META_PREFIX } from "../shared/envelope.ts";

export { ENVELOPE_OPEN, ENVELOPE_CLOSE };
export const ENVELOPE_PREFIX = META_PREFIX;

/**
 * Sending a message to your own agent is a mistake (the envelope tells the
 * recipient it is from itself). Same fixed label the MCP server uses, so the
 * failure is greppable and identical on both delivery paths.
 */
export const SELF_MESSAGE_LABEL = "x-comms self-message";

export function assertNotSelfMessage(agentId: string, fromAgentId: string | null): void {
  if (fromAgentId && agentId === fromAgentId) {
    throw new Error(
      `${SELF_MESSAGE_LABEL}: target agentId '${agentId}' is your own agent — choose a different agent.`,
    );
  }
}

export interface SenderIdentity {
  agentId: string | null;
  agentName: string | null;
  host: string;
  daemonServerId: string | null;
  cwd: string | null;
}

export interface LocalSendInput {
  agentId: string;
  prompt: string;
  fromAgentId?: string | null;
  fromAgentName?: string | null;
  targetDaemon: string;
  messageId: string;
}

/**
 * Build the `<x-comms-message>{\u2026}</x-comms-message>` envelope exactly as the MCP server's
 * version-6 stamp does. Pure so the contract is testable without a daemon.
 */
export function buildSenderEnvelope(args: {
  sender: SenderIdentity;
  target: { daemon: string | null; agentId: string | null };
  messageId?: string;
  sentAt: string;
}): string {
  const envelope = {
    xComms: {
      version: 6,
      type: "x-comms.message",
      direction: "outgoing",
      sender: {
        agentId: args.sender.agentId,
        agentName: args.sender.agentName,
        host: args.sender.host,
        daemonServerId: args.sender.daemonServerId,
        cwd: args.sender.cwd,
      },
      target: {
        daemon: args.target.daemon ?? null,
        agentId: args.target.agentId ?? null,
      },
      ...(args.messageId ? { messageId: args.messageId } : {}),
      sentAt: args.sentAt,
    },
  };
  return `${ENVELOPE_OPEN}${JSON.stringify(envelope)}${ENVELOPE_CLOSE}`;
}

/** True when a resolved target serverId is this daemon's own serverId. */
export function isLocalIdentity(
  targetServerId: string | null,
  selfServerId: string | null,
): boolean {
  return targetServerId !== null && selfServerId !== null && targetServerId === selfServerId;
}

export type SendRoute = "local" | "remote";

/**
 * Pick the delivery path for a resolved target. Local requires all three: a
 * local PaseoApi handle, a resolved target serverId, and a match with this
 * daemon's serverId. Anything unresolved stays remote, so an unidentifiable
 * direct host conservatively uses the CLI path rather than guessing.
 */
export function resolveSendRoute(args: {
  hasLocalPaseo: boolean;
  targetServerId: string | null;
  selfServerId: string | null;
}): SendRoute {
  if (!args.hasLocalPaseo) return "remote";
  return isLocalIdentity(args.targetServerId, args.selfServerId) ? "local" : "remote";
}

/**
 * Best-effort sender identity for the local stamp. The sender agent's title
 * and cwd come from its snapshot; a lookup failure degrades to null fields
 * (the envelope stays valid, matching the MCP fallback behavior).
 */
export async function gatherLocalSenderIdentity(
  paseo: PaseoApi,
  input: Pick<LocalSendInput, "fromAgentId" | "fromAgentName">,
): Promise<SenderIdentity> {
  const agentId = input.fromAgentId ?? null;
  let agentName = input.fromAgentName ?? null;
  let cwd: string | null = null;
  if (agentId) {
    try {
      const result = await paseo.agents.ref(agentId).refresh();
      const agent = result?.agent ?? null;
      if (!agentName) agentName = agent?.title ?? null;
      cwd = agent?.cwd ?? null;
    } catch {
      // id-only identity is still a valid envelope.
    }
  }
  let daemonServerId: string | null = null;
  try {
    daemonServerId = await localServerId();
  } catch {
    // unreadable server-id: omit it rather than fail the send.
  }
  return { agentId, agentName, host: hostname(), daemonServerId, cwd };
}

/**
 * Send to a local agent via the native SDK. Mirrors `paseo send --no-wait`:
 * `send()` dispatches the message and resolves without waiting for the turn.
 */
export async function sendLocalNative(paseo: PaseoApi, input: LocalSendInput): Promise<void> {
  assertNotSelfMessage(input.agentId, input.fromAgentId ?? null);
  const sender = await gatherLocalSenderIdentity(paseo, input);
  const stamped = `${buildSenderEnvelope({
    sender,
    target: { daemon: input.targetDaemon, agentId: input.agentId },
    messageId: input.messageId,
    sentAt: new Date().toISOString(),
  })}\n\n${input.prompt}`;
  await paseo.agents.ref(input.agentId).send(stamped, { messageId: input.messageId });
}

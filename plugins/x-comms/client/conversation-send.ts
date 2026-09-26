import { buildXCommsEnvelope } from "../shared/envelope";

/**
 * Send routes for the Desktop conversation surface (#611).
 *
 * Both routes go through the one gated `conversation.send` entry point, so a
 * target that is mid-turn is queued rather than preempted whichever way it was
 * addressed, and both return the same four-state result. The configured-host
 * route used to borrow a `PaseoApi` and send directly, which preempted and then
 * reported `dispatched` unconditionally.
 *
 * The renderer cannot join the on-disk defer queue itself: `enqueueDefer` needs
 * `node:fs`, and no `client/` runtime module imports a node builtin. The queue is
 * therefore reached over RPC, which also means the Desktop surface adds no new
 * writer to a directory that the plugin server and the injected MCP server both
 * claim from.
 */

/** Mirrors the daemon's `SendDelivery`; see mcp/README.md#delivery-contract. */
export type SendDelivery = "dispatched" | "queued" | "outbox" | "dropped";

export interface ConversationSendResult {
  daemon: string;
  agentId: string;
  ok: boolean;
  error: string | null;
  /** Absent from a daemon too old to gate; such a daemon really did dispatch. */
  delivery?: SendDelivery;
  queueDepth?: number;
  expiresAt?: string | null;
}

export type ConversationSendInput = {
  daemon: string;
  agentId: string;
  prompt: string;
  fromAgentId?: string | null;
  fromAgentName?: string | null;
  messageId?: string;
  stamped?: boolean;
};

export type CallSend = (input: ConversationSendInput) => Promise<ConversationSendResult>;

/**
 * Send to an agent on a configured host, through the defer gate.
 *
 * The client stamps its own envelope and says so with `stamped: true`, so the
 * daemon delivers the exact bytes rather than re-stamping: re-stamping would
 * move `sentAt` and change what the recipient sees as the sender, which is a
 * different change from gating this route and not one this makes. The Desktop
 * client holds no mesh key, so the envelope carries no `auth` and the recipient
 * treats the claimed sender as unverified — unchanged from before, and visible
 * in the UI as such.
 */
export async function sendConfiguredHostViaGate(args: {
  serverId: string;
  agentId: string;
  body: string;
  fromAgentId: string;
  fromAgentName: string;
  messageId: string;
  sentAt: string;
  callSend: CallSend;
}): Promise<ConversationSendResult> {
  const stamped = `${buildXCommsEnvelope({
    sender: {
      agentId: args.fromAgentId,
      agentName: args.fromAgentName,
      host: "paseo-client",
      daemonServerId: null,
      cwd: null,
    },
    target: { daemon: args.serverId, agentId: args.agentId },
    messageId: args.messageId,
    sentAt: args.sentAt,
  })}\n\n${args.body}`;

  return args.callSend({
    daemon: args.serverId,
    agentId: args.agentId,
    prompt: stamped,
    fromAgentId: args.fromAgentId,
    fromAgentName: args.fromAgentName,
    messageId: args.messageId,
    stamped: true,
  });
}

/**
 * What the send affordance should say about a result.
 *
 * One place, so the queued wording and the bounds it quotes are not restated per
 * route. `null` means the send did not succeed and the caller should show the
 * error instead — `outbox` and `dropped` both land here rather than reading as
 * a send that might have gone out.
 */
export function describeDelivery(
  result: Pick<ConversationSendResult, "ok" | "delivery" | "queueDepth" | "expiresAt"> | undefined,
): { tone: "success" | "warning" | "danger"; text: string } | null {
  if (!result || !result.ok) return null;
  if (result.delivery === "queued") {
    const depth = result.queueDepth ?? 1;
    const expiry = result.expiresAt ? ` until ${new Date(result.expiresAt).toLocaleTimeString()}` : "";
    return {
      tone: "warning",
      text: `⏳ Queued at position ${depth}${expiry} — that agent is mid-turn, so this waits instead of interrupting it`,
    };
  }
  return { tone: "success", text: "" };
}

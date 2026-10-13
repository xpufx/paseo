import { createTicketHandlers, type TicketHandlers } from "@xpufx/backend-tickets/server";
import { createFleetHandlers, type FleetHandlers } from "@xpufx/backend-fleet/server";
import {
  TICKET_TOOLS,
  FLEET_TOOLS,
  ALL_MCP_TOOLS,
  TicketListInputSchema,
  TicketViewInputSchema,
  TicketCreateInputSchema,
  TicketCommentInputSchema,
  TicketEditInputSchema,
  FleetStatusInputSchema,
  FleetQueueInspectInputSchema,
} from "../shared/tools.js";
import type { McpToolDefinition } from "../shared/tools.js";

// ---------------------------------------------------------------------------
// Per-agent session gating
// ---------------------------------------------------------------------------

interface AgentSession {
  agentId: string;
  active: boolean;
  createdAt: number;
}

const SESSIONS = new Map<string, AgentSession>();

/**
 * Validates that the caller has an active session and returns its id.
 * Returns the agentId string on success, null on failure.
 */
export function requireAgentSession(
  sessionId: string | undefined | null,
  ttlMs: number = 30 * 60 * 1000 // 30 min default TTL
): string | null {
  if (!sessionId) return null;
  const session = SESSIONS.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > ttlMs) {
    SESSIONS.delete(sessionId);
    return null;
  }
  session.createdAt = Date.now(); // refresh TTL
  return session.agentId;
}

/**
 * Registers a new agent session. Returns true on success.
 */
export function registerAgentSession(
  sessionId: string,
  agentId: string
): boolean {
  if (SESSIONS.has(sessionId)) {
    SESSIONS.delete(sessionId);
  }
  SESSIONS.set(sessionId, { agentId, active: true, createdAt: Date.now() });
  return true;
}

/**
 * Revokes an agent session (cleanup).
 */
export function revokeAgentSession(sessionId: string): void {
  SESSIONS.delete(sessionId);
}

/** Clears all sessions — test helper. */
export function _clearAllSessions(): void {
  SESSIONS.clear();
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface ToolRegistryOptions {
  ticketHandlers?: TicketHandlers;
  fleetHandlers?: FleetHandlers;
  /** TTL in ms for per-agent sessions; defaults to 30 minutes. */
  sessionTtlMs?: number;
}

export class ToolRegistry {
  private ticketHandlers: TicketHandlers;
  private fleetHandlers: FleetHandlers;
  private sessionTtlMs: number;

  constructor(options: ToolRegistryOptions = {}) {
    this.ticketHandlers = options.ticketHandlers ?? createTicketHandlers();
    this.fleetHandlers = options.fleetHandlers ?? createFleetHandlers();
    this.sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  }

  /** All registered MCP tool definitions. */
  getTools(): McpToolDefinition[] {
    return [...ALL_MCP_TOOLS];
  }

  /** Dispatch a single tool call by name with validated input. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string | null
  ): Promise<{ ok: boolean; result: unknown; error?: string }> {
    const agentId = requireAgentSession(sessionId, this.sessionTtlMs);
    if (!agentId) {
      return { ok: false, result: null, error: `Session validation failed` };
    }

    switch (name) {
      case "ticket_list": {
        const parsed = TicketListInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid ticket_list input: ${parsed.error.message}` };
        }
        const output = await this.ticketHandlers.handleOpenIssues(parsed.data);
        return { ok: true, result: output };
      }

      case "ticket_view": {
        const parsed = TicketViewInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid ticket_view input: ${parsed.error.message}` };
        }
        const output = await this.ticketHandlers.handleIssueDetail({
          issueNumber: parsed.data.issueNumber,
          directory: parsed.data.directory,
          remoteUrl: parsed.data.remoteUrl,
        });
        return { ok: true, result: output };
      }

      case "ticket_create": {
        const parsed = TicketCreateInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid ticket_create input: ${parsed.error.message}` };
        }
        const output = await this.ticketHandlers.handleCreateIssue({
          title: parsed.data.title,
          body: parsed.data.body || "",
          labels: parsed.data.labels.length > 0 ? parsed.data.labels : undefined,
          directory: parsed.data.directory,
          remoteUrl: parsed.data.remoteUrl,
        });
        return { ok: true, result: output };
      }

      case "ticket_comment": {
        const parsed = TicketCommentInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid ticket_comment input: ${parsed.error.message}` };
        }
        const output = await this.ticketHandlers.handleAddComment({
          issueNumber: parsed.data.issueNumber,
          body: parsed.data.body,
          directory: parsed.data.directory,
          remoteUrl: parsed.data.remoteUrl,
        });
        return { ok: true, result: output };
      }

      case "ticket_edit": {
        const parsed = TicketEditInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid ticket_edit input: ${parsed.error.message}` };
        }
        const output = await this.ticketHandlers.handleSetLabel({
          issueNumber: parsed.data.issueNumber,
          label: parsed.data.label,
          directory: parsed.data.directory,
          remoteUrl: parsed.data.remoteUrl,
        });
        return { ok: true, result: output };
      }

      case "fleet_status": {
        const parsed = FleetStatusInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid fleet_status input: ${parsed.error.message}` };
        }
        const output = await this.fleetHandlers.handleFleetRoster(parsed.data);
        return { ok: true, result: output };
      }

      case "fleet_queue_inspect": {
        const parsed = FleetQueueInspectInputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, result: null, error: `Invalid fleet_queue_inspect input: ${parsed.error.message}` };
        }
        const output = await this.fleetHandlers.handleFleetRoster(parsed.data);
        return { ok: true, result: output };
      }

      default:
        return { ok: false, result: null, error: `Unknown tool: ${name}` };
    }
  }

  /** Returns current session count. */
  getSessionCount(): number {
    return SESSIONS.size;
  }

  /** Register an agent session for per-agent gating. */
  registerSession(sessionId: string, agentId: string): boolean {
    return registerAgentSession(sessionId, agentId);
  }
}

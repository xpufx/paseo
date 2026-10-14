import type { IncomingMessage, ServerResponse } from "node:http";
import { HookEventQueue } from "./queue.js";
import {
  validateForgejoSignature,
  validateGitHubSignature,
  validateGitLabSignature,
} from "../shared/signatures.js";
import {
  normalizeForgejoEvent,
  normalizeGitHubEvent,
  normalizeGitLabEvent,
} from "../shared/normalizers.js";
import type { NormalizedEvent, ForgeId, QueueState } from "../shared/types.js";

export interface HookIngressOptions {
  secret?: string;
  requireSignature?: boolean;
}

export interface IngressResult {
  ok: boolean;
  status: number;
  error?: string;
  forge?: ForgeId;
  event?: string;
  normalized?: NormalizedEvent;
}

/**
 * Handle incoming webhook ingress: validate HMAC signature and normalize the event.
 */
export function handleHookIngress(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  body: Record<string, unknown>,
  options: HookIngressOptions = {},
): IngressResult {
  const getHeader = (name: string): string | undefined => {
    const val = headers[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  // Determine forge and event type
  let forge: ForgeId = "forgejo";
  let eventType = "unknown";

  if (getHeader("x-forgejo-event")) {
    forge = "forgejo";
    eventType = getHeader("x-forgejo-event")!;
  } else if (getHeader("x-gitea-event")) {
    forge = "gitea";
    eventType = getHeader("x-gitea-event")!;
  } else if (getHeader("x-github-event")) {
    forge = "github";
    eventType = getHeader("x-github-event")!;
  } else if (getHeader("x-gitlab-event")) {
    forge = "gitlab";
    eventType = getHeader("x-gitlab-event")!;
  }

  // Validate HMAC signature if secret is configured or signature is required
  if (options.secret) {
    const sigHeader =
      getHeader("x-hub-signature-256") ??
      getHeader("x-gitea-signature") ??
      getHeader("x-forgejo-signature");
    const gitlabToken = getHeader("x-gitlab-token");
    const gitlabSig = getHeader("x-gitlab-signature-256");

    let valid = false;
    if (forge === "gitlab") {
      valid = validateGitLabSignature(rawBody, options.secret, {
        receivedToken: gitlabToken,
        signatureHex: gitlabSig,
      });
    } else if (forge === "github") {
      valid = Boolean(sigHeader && validateGitHubSignature(rawBody, options.secret, sigHeader));
    } else {
      valid = Boolean(sigHeader && validateForgejoSignature(rawBody, options.secret, sigHeader));
    }

    if (!valid && (sigHeader || gitlabToken || gitlabSig || options.requireSignature)) {
      return { ok: false, status: 401, error: "Invalid webhook signature" };
    }
  }

  // Generate event ID
  const eventId =
    getHeader("x-forgejo-delivery") ??
    getHeader("x-github-delivery") ??
    getHeader("x-gitlab-event-uuid") ??
    `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Normalize event
  let normalized: NormalizedEvent;
  switch (forge) {
    case "github":
      normalized = normalizeGitHubEvent(body, eventId);
      break;
    case "gitlab":
      normalized = normalizeGitLabEvent(body, eventId);
      break;
    case "forgejo":
    case "gitea":
    default:
      normalized = normalizeForgejoEvent(body, eventId);
      break;
  }

  return {
    ok: true,
    status: 200,
    forge,
    event: eventType,
    normalized,
  };
}

export interface QueueAdminResult {
  handled: boolean;
  status: number;
  data?: unknown;
}

/**
 * Handle queue administration requests (/queues, /pause, /resume, /purge, /drain).
 */
export function handleQueueAdmin(
  pathname: string,
  method: string,
  queue: HookEventQueue,
  body?: Record<string, unknown>,
): QueueAdminResult {
  if (method === "GET" && (pathname === "/queues" || pathname === "/queues/overview")) {
    return { handled: true, status: 200, data: queue.inspect() };
  }

  if (method === "POST" && (pathname === "/queues/pause" || pathname === "/queue/pause")) {
    void queue.pause();
    return { handled: true, status: 200, data: { ok: true, state: queue.getState() } };
  }

  if (method === "POST" && (pathname === "/queues/resume" || pathname === "/queue/resume")) {
    queue.resume();
    return { handled: true, status: 200, data: { ok: true, state: queue.getState() } };
  }

  if (method === "POST" && (pathname === "/queues/purge" || pathname === "/queue/purge")) {
    const purged = queue.purge();
    return { handled: true, status: 200, data: { ok: true, purged } };
  }

  return { handled: false, status: 404 };
}

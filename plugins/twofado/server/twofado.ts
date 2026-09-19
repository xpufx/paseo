import net from "node:net";
import os from "node:os";
import type { RpcInput, RpcOutput } from "paseo-plugin-helper/shared";
import { createPluginLogger, guardRpcHandler } from "paseo-plugin-helper/server";
import {
  approvalAck,
  approvalSettings,
  approvalStatus,
  approvalTelegramInfo,
  approvalTelegramSetConfig,
  daemonHealth,
  pendingList,
  policyAddRule,
  recentList,
  verdict,
} from "../shared/approval";

const log = createPluginLogger("twofado", { banner: false });

const DEFAULT_SOCKET = "/tmp/2fado.sock";

function socketCandidates(configured?: string): string[] {
  const candidates: string[] = [];
  const push = (sock: string | undefined) => {
    const trimmed = sock?.trim();
    if (trimmed !== undefined && trimmed.length > 0 && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };
  push(configured);
  push(process.env.TWOFADO_SOCKET);
  push(process.env.FADO_SOCKET);
  push(DEFAULT_SOCKET);
  return candidates;
}

interface DaemonPendingItem {
  id: string;
  argv: string[];
  uid: number;
  cwd: string;
  expires_in: number;
  step?: string;
  confirm_of?: string;
  kind?: string;
  link?: string;
  summary?: string;
  acked?: boolean;
  ack_by?: string;
  auth_url?: string;
  preview?: {
    resolved_binary?: string;
    target_cwd?: string;
    affected_count?: number;
    sample_paths?: string[];
    risk_level?: "low" | "medium" | "high" | "critical";
    risk_reason?: string;
  };
}

interface DaemonPendingList {
  items: DaemonPendingItem[];
}

interface DaemonRecentItem {
  id: string;
  argv: string[];
  cwd: string;
  decision: string;
  by: string;
  exit: number;
  output: string;
  step?: string;
  confirm_of?: string;
  kind?: string;
  link?: string;
  summary?: string;
  acked?: boolean;
  ack_by?: string;
  auth_url?: string;
}

interface DaemonRecentList {
  items: DaemonRecentItem[];
}

interface DaemonStatusResponse {
  id: string;
  status: string;
  argv?: string[];
  cwd?: string;
  uid?: number;
  expires_in?: number;
  decision?: string;
  by?: string;
  exit: number;
  output?: string;
  step?: string;
  confirm_of?: string;
  kind?: string;
  link?: string;
  summary?: string;
  acked?: boolean;
  ack_by?: string;
  ack_at?: number;
  auth_url?: string;
}

function callDaemonOn(sock: string, message: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const socket = net.createConnection(sock);
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`2fadod timeout (${sock})`)), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(JSON.stringify(message) + "\n");
    });
    socket.on("data", (data: string) => {
      buffer += data;
      const nl = buffer.indexOf("\n");
      if (nl >= 0) {
        const line = buffer.slice(0, nl);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
    socket.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    socket.on("close", () => fail(new Error(`2fadod closed connection (${sock})`)));
  });
}

async function callDaemon(
  message: unknown,
  configured?: string,
  timeoutMs = 2000,
): Promise<unknown> {
  let lastError: unknown = new Error("no 2fadod socket candidates");
  for (const sock of socketCandidates(configured)) {
    try {
      return await callDaemonOn(sock, message, timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function listPendingInner(
  input?: RpcInput<typeof pendingList>,
): Promise<RpcOutput<typeof pendingList>> {
  try {
    const raw = (await callDaemon({ list: {} }, input?.socketPath)) as DaemonPendingList;
    const host = os.hostname();
    const items = Array.isArray(raw.items) ? raw.items : [];
    return {
      items: items.map((item) => ({
        id: item.id,
        argv: Array.isArray(item.argv) ? item.argv : [],
        host,
        caller: String(item.uid),
        cwd: typeof item.cwd === "string" ? item.cwd : "",
        expiresIn: typeof item.expires_in === "number" ? item.expires_in : 0,
      step: item.step === "confirm" ? ("confirm" as const) : ("initial" as const),
      confirmOf: item.confirm_of,
      kind: item.kind,
      link: item.link,
      summary: item.summary,
      acked: item.acked,
      ackBy: item.ack_by,
      authUrl: item.auth_url,
      preview: item.preview
        ? {
            resolvedBinary: item.preview.resolved_binary,
            targetCwd: item.preview.target_cwd,
            affectedCount: item.preview.affected_count,
            samplePaths: item.preview.sample_paths,
            riskLevel: item.preview.risk_level,
            riskReason: item.preview.risk_reason,
          }
          : undefined,
      })),
    };
  } catch (err) {
    log.warn("pending list failed", { error: err });
    return { items: [] };
  }
}

async function submitVerdictInner(
  input?: RpcInput<typeof verdict>,
): Promise<RpcOutput<typeof verdict>> {
  if (input === undefined) return { recorded: false };
  try {
    const raw = (await callDaemon(
      {
        verdict: { id: input.id, decision: input.decision, by: "paseo" },
      },
      input.socketPath,
    )) as { recorded: boolean };
    return { recorded: raw.recorded === true };
  } catch (err) {
    log.warn("verdict submit failed", { id: input.id, error: err });
    return { recorded: false };
  }
}

export const listPending = guardRpcHandler(listPendingInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("list timed out", info),
  onSaturated: (info) => log.warn("list saturated, shedding load", info),
});

async function listRecentInner(
  input?: RpcInput<typeof recentList>,
): Promise<RpcOutput<typeof recentList>> {
  const limit = input?.limit ?? 10;
  try {
    const raw = (await callDaemon({ recent: { limit } }, input?.socketPath)) as DaemonRecentList;
    const items = Array.isArray(raw.items) ? raw.items : [];
    return {
      items: items.map((item) => ({
        id: item.id,
        argv: Array.isArray(item.argv) ? item.argv : [],
        cwd: typeof item.cwd === "string" ? item.cwd : "",
        decision: typeof item.decision === "string" ? item.decision : "",
        by: typeof item.by === "string" ? item.by : "",
        exit: typeof item.exit === "number" ? item.exit : -1,
        output: typeof item.output === "string" ? item.output : "",
        step: item.step === "confirm" ? ("confirm" as const) : ("initial" as const),
        confirmOf: item.confirm_of,
        kind: item.kind,
        link: item.link,
        summary: item.summary,
        acked: item.acked,
        ackBy: item.ack_by,
        authUrl: item.auth_url,
      })),
    };
  } catch (err) {
    log.warn("recent list failed", { error: err });
    return { items: [] };
  }
}

export const listRecent = guardRpcHandler(listRecentInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("recent timed out", info),
  onSaturated: (info) => log.warn("recent saturated, shedding load", info),
});

export const submitVerdict = guardRpcHandler(submitVerdictInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("verdict timed out", info),
  onSaturated: (info) => log.warn("verdict saturated, shedding load", info),
});

async function submitAckInner(
  input?: RpcInput<typeof approvalAck>,
): Promise<RpcOutput<typeof approvalAck>> {
  if (input === undefined || !input.id) return { acked: false };
  try {
    const raw = (await callDaemon(
      {
        ack: { id: input.id, by: "paseo" },
      },
      input.socketPath,
    )) as { acked: boolean };
    return { acked: raw.acked === true };
  } catch (err) {
    log.warn("ack submit failed", { id: input.id, error: err });
    return { acked: false };
  }
}

export const submitAck = guardRpcHandler(submitAckInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("ack timed out", info),
  onSaturated: (info) => log.warn("ack saturated, shedding load", info),
});

async function statusInner(
  input?: RpcInput<typeof approvalStatus>,
): Promise<RpcOutput<typeof approvalStatus>> {
  if (!input?.id) {
    return { id: "", status: "not_found", exit: -1 };
  }
  try {
    const raw = (await callDaemon(
      { status: { id: input.id } },
      input.socketPath,
    )) as DaemonStatusResponse;
    const validStatuses = [
      "not_found",
      "pending",
      "confirming",
      "running",
      "completed",
      "denied",
      "timeout",
      "client_aborted",
      "confirmation_timeout",
      "acked",
    ] as const;
    const rawStatus = raw?.status as (typeof validStatuses)[number];
    const status = validStatuses.includes(rawStatus) ? rawStatus : "not_found";
    return {
      id: raw?.id ?? input.id,
      status,
      decision: raw?.decision,
      by: raw?.by,
      exit: typeof raw?.exit === "number" ? raw.exit : -1,
      output: typeof raw?.output === "string" ? raw.output : "",
      argv: Array.isArray(raw?.argv) ? raw.argv : undefined,
      cwd: raw?.cwd,
      expiresIn: raw?.expires_in,
      step: raw?.step,
      confirmOf: raw?.confirm_of,
      kind: raw?.kind,
      link: raw?.link,
      summary: raw?.summary,
      acked: raw?.acked,
      ackBy: raw?.ack_by,
      ackAt: raw?.ack_at,
      authUrl: raw?.auth_url,
    };
  } catch (err) {
    log.warn("status fetch failed", { id: input.id, error: err });
    return { id: input.id, status: "not_found", exit: -1 };
  }
}

export const getStatus = guardRpcHandler(statusInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("status timed out", info),
  onSaturated: (info) => log.warn("status saturated, shedding load", info),
});

interface DaemonTelegramInfoResponse {
  configured?: boolean;
  bot_username?: string;
  chat_id?: string;
  approvers?: string[];
  status?: "connected" | "disconnected" | "unconfigured" | "error";
  error?: string;
  notification_target?: string;
}

function daemonNotificationTarget(raw: string | undefined): "telegram" | "paseo" | "both" {
  return raw === "telegram" || raw === "paseo" || raw === "both" ? raw : "both";
}

async function telegramInfoInner(
  input?: RpcInput<typeof approvalTelegramInfo>,
): Promise<RpcOutput<typeof approvalTelegramInfo>> {
  try {
    const raw = (await callDaemon(
      { telegram_info: {} },
      input?.socketPath,
      8000,
    )) as DaemonTelegramInfoResponse;
    const validStatuses = ["connected", "disconnected", "unconfigured", "error"] as const;
    const rawStatus = raw?.status as (typeof validStatuses)[number];
    const status = validStatuses.includes(rawStatus)
      ? rawStatus
      : raw?.configured
        ? "connected"
        : "unconfigured";
    return {
      configured: Boolean(raw?.configured),
      botUsername: raw?.bot_username,
      chatId: raw?.chat_id,
      approvers: Array.isArray(raw?.approvers) ? raw.approvers : [],
      status,
      error: raw?.error,
      notificationTarget: daemonNotificationTarget(raw?.notification_target),
    };
  } catch (err) {
    log.warn("telegram info fetch failed", { error: err });
    return {
      configured: false,
      status: "unconfigured",
      approvers: [],
      error: err instanceof Error ? err.message : String(err),
      notificationTarget: "both",
    };
  }
}

export const getTelegramInfo = guardRpcHandler(telegramInfoInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("telegram info timed out", info),
  onSaturated: (info) => log.warn("telegram info saturated, shedding load", info),
});

interface DaemonTelegramConfigResponse {
  success?: boolean;
  bot_username?: string;
  error?: string;
}

async function telegramSetConfigInner(
  input?: RpcInput<typeof approvalTelegramSetConfig>,
): Promise<RpcOutput<typeof approvalTelegramSetConfig>> {
  if (!input) return { success: false, error: "missing input" };
  try {
    const raw = (await callDaemon(
      {
        telegram_set_config: {
          bot_token: input.botToken,
          chat_id: input.chatId,
          approvers: input.approvers,
          notification_target: input.notificationTarget,
        },
      },
      input.socketPath,
    )) as DaemonTelegramConfigResponse;
    return {
      success: Boolean(raw?.success),
      botUsername: raw?.bot_username,
      error: raw?.error,
    };
  } catch (err) {
    log.warn("telegram set config failed", { error: err });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const setTelegramConfig = guardRpcHandler(telegramSetConfigInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("telegram set config timed out", info),
  onSaturated: (info) => log.warn("telegram set config saturated, shedding load", info),
});

interface DaemonVersionResponse {
  version?: string;
  git_commit?: string;
  build_time?: string;
  binary_sha256?: string;
  pid?: number;
}

async function healthInner(
  input?: RpcInput<typeof daemonHealth>,
): Promise<RpcOutput<typeof daemonHealth>> {
  try {
    const raw = (await callDaemon({ version: {} }, input?.socketPath, 1500)) as DaemonVersionResponse;
    return {
      reachable: true,
      version: typeof raw?.version === "string" ? raw.version : undefined,
      pid: typeof raw?.pid === "number" ? raw.pid : undefined,
    };
  } catch (err) {
    log.warn("health probe failed", { error: err });
    return { reachable: false };
  }
}

export const getHealth = guardRpcHandler(healthInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("health timed out", info),
  onSaturated: (info) => log.warn("health saturated, shedding load", info),
});

export class TwofadoClient {
  constructor(private socketPath?: string) {}

  async policyAddRule(
    params: RpcInput<typeof policyAddRule>,
  ): Promise<RpcOutput<typeof policyAddRule>> {
    return policyAddRuleInner({ ...params, socketPath: params?.socketPath ?? this.socketPath });
  }
}

export const FadoClient = TwofadoClient;

interface DaemonPolicyAddRuleResponse {
  success?: boolean;
  error?: string;
  rules_count?: number;
}

async function policyAddRuleInner(
  input?: RpcInput<typeof policyAddRule>,
): Promise<RpcOutput<typeof policyAddRule>> {
  if (!input || input.pattern.length === 0) return { success: false, error: "empty pattern" };
  try {
    const raw = (await callDaemon(
      {
        policy_add_rule: {
          target: input.target,
          match_type: input.match_type,
          pattern: input.pattern,
        },
      },
      input.socketPath,
    )) as DaemonPolicyAddRuleResponse;
    if (raw?.success === true) return { success: true, rules_count: raw.rules_count };
    return { success: false, error: raw?.error ?? "daemon rejected rule" };
  } catch (err) {
    log.warn("policy add rule failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const addPolicyRule = guardRpcHandler(policyAddRuleInner, {
  timeoutMs: 5000,
  maxInflight: 4,
  onTimeout: (info) => log.warn("policy add rule timed out", info),
  onSaturated: (info) => log.warn("policy add rule saturated, shedding load", info),
});

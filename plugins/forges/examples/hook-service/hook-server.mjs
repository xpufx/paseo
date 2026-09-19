#!/usr/bin/env node
/**
 * Generic Forgejo/Gitea-family webhook -> Paseo bridge (EXAMPLE SKELETON).
 *
 * This is a teaching skeleton, not a supported service. It implements the
 * contract described in ../../docs/workflow.md §2 with placeholders only:
 *
 *   POST /hook        authenticated webhook delivery; summarize + queue + send
 *   POST /orchestrate register which agent owns a repo (loopback needs no secret)
 *
 * Configuration is environment-only; see ./hook.env.example. Replace the
 * placeholders, review the TODOs, and run it either as a systemd service
 * (./forge-hook.service) or as a Paseo workspace service.
 *
 * Deliberately omitted from this skeleton (see the docs for why they matter):
 *   - shared-secret rotation and constant-time comparison of the bearer token
 *   - durable queueing across restarts
 *   - event coalescing / debounce with slash-command bypass
 *   - validating the payload against a strict schema
 */
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOST = process.env.HOOK_HOST ?? "127.0.0.1";
const PORT = Number(process.env.HOOK_PORT ?? 8099);
const PASEO_BIN = process.env.PASEO_BIN ?? "paseo";
const STATE_DIR = process.env.HOOK_STATE_DIR ?? join(process.cwd(), ".forge-hook");
const FALLBACK_AGENT_ID = process.env.HOOK_DEFAULT_AGENT_ID ?? "";

/** Secret wins from a file when WEBHOOK_SECRET_FILE is set, else inline. */
function readSecret() {
  const file = process.env.WEBHOOK_SECRET_FILE;
  if (file) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch (error) {
      console.error(`cannot read WEBHOOK_SECRET_FILE (${file}): ${error.message}`);
    }
  }
  return process.env.WEBHOOK_SECRET ?? "";
}
const SECRET = readSecret();

// ---------------------------------------------------------------------------
// Routing key: forge-qualified host/owner/repo, derived from the payload so one
// process can serve many repos regardless of its working directory.
// ---------------------------------------------------------------------------

function repoKey(body) {
  const repository = body?.repository ?? {};
  const url = repository.html_url ?? repository.clone_url ?? repository.ssh_url ?? "";
  try {
    const parsed = new URL(url);
    const [owner, ...rest] = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
    const repo = rest.join("/");
    if (!parsed.hostname || !owner || !repo) return null;
    return `${parsed.hostname.toLowerCase()}/${owner.toLowerCase()}/${repo.toLowerCase()}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-repo orchestrator state. The file is the authority; agent name/role
// labels (set elsewhere) are only a UI projection.
// ---------------------------------------------------------------------------

function statePath(key) {
  return join(STATE_DIR, `${key.replace(/[^a-z0-9._-]+/gi, "_")}.json`);
}

function readOrchestrator(key) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(key), "utf8"));
    if (typeof parsed?.agentId === "string" && parsed.agentId) return parsed.agentId;
  } catch {
    // No file yet.
  }
  return FALLBACK_AGENT_ID || null;
}

function writeOrchestrator(key, agentId) {
  mkdirSync(STATE_DIR, { recursive: true });
  const target = statePath(key);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ agentId, updatedAt: new Date().toISOString() }, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmp, target);
}

// ---------------------------------------------------------------------------
// Auth: accept a bearer token, a plain secret header, or a Forgejo HMAC of the
// raw body. The secret never reaches an agent.
// ---------------------------------------------------------------------------

function authorized(req, raw) {
  if (!SECRET) return true; // TODO: refuse to start when unset in production.
  const auth = req.headers["authorization"] ?? "";
  if (auth === `Bearer ${SECRET}`) return true;
  if ((req.headers["x-webhook-secret"] ?? "") === SECRET) return true;
  const signature = req.headers["x-forgejo-signature"] ?? "";
  if (!signature) return false;
  const mac = createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
  if (mac.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// ---------------------------------------------------------------------------
// Human-readable summary. The forges plugin parses this shape into a timeline
// card (shared/webhook.ts); keep the prefix and bracket format if you want it.
// ---------------------------------------------------------------------------

const HOOK_HEAD = "🔔 Forgejo webhook incoming";

function summarize(event, body) {
  const repo = body?.repository?.full_name ?? repoKey(body) ?? "unknown repo";
  const sender = body?.sender?.login ?? "unknown";
  if (event === "ping") return `${HOOK_HEAD} (ping test) ${repo} (by ${sender})`;
  const subject = body?.issue ?? body?.pull_request ?? {};
  const action = body?.action ?? "";
  const label = subject.number != null ? `${repo}#${subject.number} ${subject.title ?? ""}`.trim() : repo;
  const line = `${HOOK_HEAD} [${event}:${action}] ${label} (by ${sender})`.trim();
  const url = subject.html_url ?? body?.repository?.html_url ?? "";
  return url && !line.includes(url) ? `${line} ${url}` : line;
}

// ---------------------------------------------------------------------------
// Delivery: one `paseo send` at a time per repo. The daemon rejects a second
// send while an agent already has an active run, so serialize and retry later.
// ---------------------------------------------------------------------------

const pending = new Map();
const draining = new Set();

function enqueue(key, message) {
  const list = pending.get(key) ?? [];
  if (!list.includes(message)) list.push(message);
  pending.set(key, list);
  return list.length;
}

function deliver(agentId, message) {
  return new Promise((resolve) => {
    execFile(PASEO_BIN, ["send", agentId, message], (error) => {
      if (error) console.error(`paseo send failed: ${error.message}`);
      resolve(!error);
    });
  });
}

async function drain(key) {
  if (draining.has(key)) return;
  draining.add(key);
  try {
    for (;;) {
      const list = pending.get(key);
      if (!list || list.length === 0) {
        pending.delete(key);
        return;
      }
      const agentId = readOrchestrator(key);
      if (!agentId) {
        console.error(`no orchestrator for ${key}; holding ${list.length} message(s)`);
        return;
      }
      if (!(await deliver(agentId, list[0]))) return; // Retried by the interval below.
      list.shift();
    }
  } finally {
    draining.delete(key);
  }
}

function handleMessage(key, message) {
  const depth = enqueue(key, message);
  console.log(`queued ${key} queue=${depth}`);
  void drain(key);
}

// ---------------------------------------------------------------------------
// HTTP surface.
// ---------------------------------------------------------------------------

function handleHook(req, raw, res) {
  const event = String(req.headers["x-forgejo-event"] ?? "unknown");
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  const key = repoKey(body);
  const message = summarize(event, body);
  console.log(`${new Date().toISOString()} event=${event} key=${key ?? "?"} ${message}`);
  res.writeHead(202).end("accepted");
  if (!key) {
    console.error("no repo key in payload; event dropped");
    return;
  }
  handleMessage(key, message);
}

function handleOrchestrate(raw, res) {
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  const agentId = String(body?.agentId ?? "").trim();
  const key = typeof body?.repo === "string" ? body.repo.trim().toLowerCase() : "";
  if (!agentId || !key) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "agentId and repo are required" }));
    return;
  }
  writeOrchestrator(key, agentId);
  console.log(`orchestrator ${key} -> ${agentId}`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ key, agentId }));
}

const server = http.createServer((req, res) => {
  const path = req.url?.split("?")[0];
  if (req.method !== "POST" || (path !== "/hook" && path !== "/orchestrate")) {
    res.writeHead(404).end("not found");
    return;
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 256 * 1024) req.destroy();
  });
  req.on("end", () => {
    const loopbackControl = path === "/orchestrate" && isLoopback(req);
    if (!loopbackControl && SECRET && !authorized(req, raw)) {
      res.writeHead(403).end("bad secret");
      return;
    }
    if (path === "/orchestrate") handleOrchestrate(raw, res);
    else handleHook(req, raw, res);
  });
});

// Periodically retry anything held because the target was busy or unset.
setInterval(() => {
  for (const key of pending.keys()) void drain(key);
}, Number(process.env.HOOK_RETRY_MS ?? 30000)).unref?.();

server.listen(PORT, HOST, () => console.log(`forge-hook listening on ${HOST}:${PORT}`));

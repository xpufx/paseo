import http from "node:http";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile, execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = Number(process.env.PASEO_PORT ?? 8099);
const HOST = process.env.HOST ?? "127.0.0.1";
const ROLE = process.env.ORCHESTRATOR_ROLE ?? "orchestrator";

function loadSecret() {
  try {
    return readFileSync(`${process.env.HOME ?? "/home/xpufx"}/.paseo/forgejo-hook.secret`, "utf8").trim();
  } catch {
    return process.env.FORGEJO_WEBHOOK_SECRET ?? "";
  }
}
const SECRET = loadSecret();

function cliClientModule() {
  const bin = execSync("command -v paseo", { encoding: "utf8" }).trim();
  const base = dirname(dirname(realpathSync(bin)));
  return join(base, "dist", "utils", "client.js");
}

async function resolveOrchestrator() {
  if (process.env.ORCHESTRATOR_AGENT_ID) return process.env.ORCHESTRATOR_AGENT_ID;
  const { connectToDaemon } = await import(cliClientModule());
  const client = await connectToDaemon({});
  try {
    const { entries } = await client.fetchAgents({});
    const cands = entries
      .map((e) => e.agent ?? e)
      .filter((a) => !a.archivedAt && (a.labels ?? {}).role === ROLE);
    if (cands.length === 1) return cands[0].id;
    const ws = await client.fetchWorkspaces({});
    const own = (ws.entries ?? []).find(
      (w) => (w.workspaceDirectory ?? "").replace(/\/$/, "") === process.cwd().replace(/\/$/, ""),
    );
    const scoped = own ? cands.filter((a) => a.workspaceId === own.id) : [];
    if (scoped.length === 1) return scoped[0].id;
    throw new Error(
      cands.length === 0
        ? `no agent labeled role=${ROLE}`
        : `multiple agents labeled role=${ROLE} and none unique to this workspace: ${cands.map((a) => a.id.slice(0, 7)).join(",")}`,
    );
  } finally {
    await client.close?.().catch(() => undefined);
  }
}

function authorized(req, rawBody) {
  const auth = req.headers["authorization"] ?? "";
  if (auth === `Bearer ${SECRET}`) return true;
  if ((req.headers["x-webhook-secret"] ?? "") === SECRET) return true;
  const sig = req.headers["x-forgejo-signature"] ?? "";
  if (!sig) return false;
  const mac = createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");
  if (mac.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(sig));
  } catch {
    return false;
  }
}

function summarize(event, body) {
  const repo = body?.repository?.full_name ?? "unknown repo";
  const sender = body?.sender?.login ?? "unknown";
  const head = "🔔 Forgejo webhook incoming";
  if (event === "ping") return `${head} (ping test) ${repo} (by ${sender})`;
  if (event === "issues" || event === "issue_comment") {
    const issue = body?.issue ?? {};
    const action = body?.action ?? "";
    return `${head} [${event}:${action}] ${repo}#${issue.number ?? "?"} ${issue.title ?? ""} (by ${sender})`.trim();
  }
  if (event === "push") {
    const commits = (body?.commits ?? []).length;
    return `${head} [push] ${repo} ${body?.ref ?? ""} ${commits} commit(s) by ${sender}`;
  }
  if (event === "pull_request") {
    const pr = body?.pull_request ?? {};
    return `${head} [pull_request:${body?.action ?? ""}] ${repo}#${pr.number ?? "?"} ${pr.title ?? ""} (by ${sender})`;
  }
  return `${head} [${event}] ${repo} (by ${sender})`;
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url?.split("?")[0] !== "/hook") {
    res.writeHead(404).end("not found");
    return;
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 256 * 1024) req.destroy();
  });
  req.on("end", () => {
    if (SECRET && !authorized(req, raw)) {
      console.log(new Date().toISOString(), "AUTH REJECT", req.headers["x-forgejo-event"] ?? "?");
      res.writeHead(403).end("bad secret");
      return;
    }
    const event = req.headers["x-forgejo-event"] ?? "unknown";
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const msg = summarize(String(event), body);
    const delivery = req.headers["x-forgejo-delivery"] ?? "local";
    console.log(new Date().toISOString(), `delivery=${delivery}`, msg);
    resolveOrchestrator().then(
      (id) => handleMessage(id, msg),
      (err) => console.error("ORCHESTRATOR UNRESOLVED:", err.message),
    );
    res.writeHead(200).end("ok");
  });
});

const pending = new Map();
const FLUSH_MS = Number(process.env.HOOK_FLUSH_MS ?? 30000);
const MAX_PENDING_PER_AGENT = 100;

async function agentBusy(id) {
  const { connectToDaemon } = await import(cliClientModule());
  const client = await connectToDaemon({});
  try {
    const a = await client.fetchAgent(id);
    const snap = a?.agent ?? a;
    return snap?.status === "running" || Boolean(snap?.activeTurn);
  } finally {
    await client.close?.().catch(() => undefined);
  }
}

function deliver(id, msg) {
  execFile("paseo", ["send", id, msg], (err) => {
    if (err) {
      console.error("paseo send failed:", err.message);
      const list = pending.get(id) ?? [];
      if (!list.includes(msg)) list.unshift(msg);
      while (list.length > MAX_PENDING_PER_AGENT) {
        const dropped = list.pop();
        console.error(`pending queue full for ${id.slice(0, 7)} (cap=${MAX_PENDING_PER_AGENT}), dropped oldest: ${dropped}`);
      }
      pending.set(id, list);
      console.log(`re-queued for ${id.slice(0, 7)} (send failed), queue=${list.length}`);
    } else console.log("sent to", id.slice(0, 7));
  });
}

async function handleMessage(id, msg) {
  try {
    if (await agentBusy(id)) {
      const list = pending.get(id) ?? [];
      if (!list.includes(msg)) list.push(msg);
      pending.set(id, list);
      console.log(`deferred for ${id.slice(0, 7)} (busy), queue=${list.length}`);
      return;
    }
  } catch (err) {
    console.error("busy check failed, sending anyway:", err.message);
  }
  deliver(id, msg);
}

setInterval(async () => {
  for (const [id, list] of pending) {
    if (list.length === 0) continue;
    try {
      if (await agentBusy(id)) continue;
    } catch (err) {
      console.error("flush busy check failed:", err.message);
      continue;
    }
    pending.set(id, []);
    for (const m of list) deliver(id, m);
  }
}, FLUSH_MS).unref();

server.listen(PORT, HOST, () => console.log(`forgejo-hook listening on ${HOST}:${PORT}`));

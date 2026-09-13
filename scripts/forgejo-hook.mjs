import http from "node:http";
import { execFile } from "node:child_process";

const PORT = Number(process.env.PASEO_PORT ?? 8099);
const HOST = process.env.HOST ?? "127.0.0.1";
const ORCHESTRATOR = process.env.ORCHESTRATOR_AGENT_ID ?? "a07bacfa-3679-40c4-8d25-e81165175329";
const SECRET = process.env.FORGEJO_WEBHOOK_SECRET ?? "";

function summarize(event, body) {
  const repo = body?.repository?.full_name ?? "unknown repo";
  const sender = body?.sender?.login ?? "unknown";
  if (event === "issues" || event === "issue_comment") {
    const issue = body?.issue ?? {};
    const action = body?.action ?? "";
    return `[forgejo:${event}:${action}] ${repo}#${issue.number ?? "?"} ${issue.title ?? ""} (by ${sender}) ${issue.html_url ?? ""}`.trim();
  }
  if (event === "push") {
    const commits = (body?.commits ?? []).length;
    return `[forgejo:push] ${repo} ${body?.ref ?? ""} ${commits} commit(s) by ${sender}`;
  }
  if (event === "pull_request") {
    const pr = body?.pull_request ?? {};
    return `[forgejo:pull_request:${body?.action ?? ""}] ${repo}#${pr.number ?? "?"} ${pr.title ?? ""} (by ${sender})`;
  }
  return `[forgejo:${event}] ${repo} (by ${sender})`;
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url?.split("?")[0] !== "/hook") {
    res.writeHead(404).end("not found");
    return;
  }
  if (SECRET) {
    const got = req.headers["x-webhook-secret"] ?? "";
    if (got !== SECRET) {
      res.writeHead(403).end("bad secret");
      return;
    }
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 256 * 1024) req.destroy();
  });
  req.on("end", () => {
    const event = req.headers["x-forgejo-event"] ?? "unknown";
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const msg = summarize(String(event), body);
    console.log(new Date().toISOString(), msg);
    execFile("paseo", ["send", ORCHESTRATOR, msg], (err) => {
      if (err) console.error("paseo send failed:", err.message);
    });
    res.writeHead(200).end("ok");
  });
});

server.listen(PORT, HOST, () => console.log(`forgejo-hook listening on ${HOST}:${PORT}`));

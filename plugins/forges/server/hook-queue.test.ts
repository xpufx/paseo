import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  resolveHookUrl,
  handleHookStatus,
  handleHookQueues,
  handleHookPause,
  handleHookResume,
  handleHookDrain,
} from "./hook-queue.js";

test("resolveHookUrl", async (t) => {
  await t.test("trims trailing slashes", () => {
    assert.equal(resolveHookUrl("http://localhost:8099/"), "http://localhost:8099");
  });
  await t.test("falls back to default", () => {
    assert.match(resolveHookUrl(), /^http:\/\//);
  });
});

test("hook server handlers against mock http server", async (t) => {
  let receivedMethod = "";
  let receivedPath = "";
  let receivedBody = "";

  const server = http.createServer((req, res) => {
    receivedMethod = req.method ?? "";
    receivedPath = req.url ?? "";
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      receivedBody = body;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (receivedPath === "/status") {
        res.end(JSON.stringify({ ok: true, service: "forgejo-hook", totalQueued: 4, paused: [] }));
      } else if (receivedPath === "/queues") {
        res.end(JSON.stringify({ ok: true, queues: [{ key: "mock-repo", depth: 4, paused: false, isBusy: false, messages: [] }] }));
      } else if (receivedPath === "/queue/pause") {
        res.end(JSON.stringify({ ok: true, paused: "mock-repo", allPaused: ["mock-repo"] }));
      } else if (receivedPath === "/queue/resume") {
        res.end(JSON.stringify({ ok: true, resumed: "mock-repo", allPaused: [] }));
      } else if (receivedPath === "/queue/drain") {
        res.end(JSON.stringify({ ok: true, draining: "mock-repo" }));
      } else {
        res.writeHead(404).end();
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const mockUrl = `http://127.0.0.1:${port}`;
  const dummyContext = {} as any;

  try {
    await t.test("handleHookStatus queries /status", async () => {
      const out = await handleHookStatus({ hookUrl: mockUrl }, dummyContext);
      assert.equal(out.ok, true);
      assert.equal(out.totalQueued, 4);
      assert.equal(receivedPath, "/status");
    });

    await t.test("handleHookQueues queries /queues", async () => {
      const out = await handleHookQueues({ hookUrl: mockUrl }, dummyContext);
      assert.equal(out.ok, true);
      assert.equal(out.queues.length, 1);
      assert.equal(out.queues[0].key, "mock-repo");
      assert.equal(receivedPath, "/queues");
    });

    await t.test("handleHookPause posts to /queue/pause", async () => {
      const out = await handleHookPause({ hookUrl: mockUrl, repo: "mock-repo" }, dummyContext);
      assert.equal(out.ok, true);
      assert.equal(out.paused, "mock-repo");
      assert.equal(receivedPath, "/queue/pause");
      assert.equal(JSON.parse(receivedBody).repo, "mock-repo");
    });

    await t.test("handleHookResume posts to /queue/resume", async () => {
      const out = await handleHookResume({ hookUrl: mockUrl, repo: "mock-repo" }, dummyContext);
      assert.equal(out.ok, true);
      assert.equal(out.resumed, "mock-repo");
      assert.equal(receivedPath, "/queue/resume");
    });

    await t.test("handleHookDrain posts to /queue/drain", async () => {
      const out = await handleHookDrain({ hookUrl: mockUrl, repo: "mock-repo" }, dummyContext);
      assert.equal(out.ok, true);
      assert.equal(out.draining, "mock-repo");
      assert.equal(receivedPath, "/queue/drain");
    });

    await t.test("handles unreachable url gracefully", async () => {
      const out = await handleHookStatus({ hookUrl: "http://127.0.0.1:1" }, dummyContext);
      assert.equal(out.ok, false);
      assert.match(out.error ?? "", /Unreachable/);
    });
  } finally {
    server.close();
  }
});

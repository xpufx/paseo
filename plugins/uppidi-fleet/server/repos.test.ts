import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleUppidiRepos,
  handleUppidiEnrollRepo,
  handleUppidiUnenrollRepo,
} from "./repos.js";
import { setFetchForTest, setTokenResolverForTest } from "./forgejo-api.js";
import {
  HookRouter,
  setActiveHookRouter,
  getActiveHookRouter,
  clearHookLogs,
} from "./hook-router.js";
import { getUppidiFleetSettingsStorage, resetUppidiFleetSettingsStorageInstance } from "./settings.js";

/** Drop the persisted plugin settings so each test starts from schema defaults. */
function clearSettingsStorage(): void {
  try {
    rmSync(getUppidiFleetSettingsStorage().filePath, { force: true });
  } catch {
    // ignore missing file
  }
  resetUppidiFleetSettingsStorageInstance();
}

interface JsonLike {
  json: () => Promise<unknown>;
}

function jsonResponse(body: unknown, status = 200, ok = true): JsonLike {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as unknown as JsonLike;
}

describe("uppidi-fleet repos handler (#867)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fleet-repos-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    clearSettingsStorage();
  });

  afterEach(async () => {
    setFetchForTest(null);
    setTokenResolverForTest(null);
    delete process.env.FORGEJO_HOST;

    const router = getActiveHookRouter();
    if (router) {
      await router.stop();
      setActiveHookRouter(null);
    }
    clearHookLogs();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("lists repos from Forgejo with enrollment, pause, and queue status", async () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
    });
    setActiveHookRouter(router);

    router.enrollRepo("forge.mrs.uppidi.com/xpufx-org/paseo");
    router.pauseRepo("forge.mrs.uppidi.com/xpufx-org/paseo");
    router.writeOrchestrator("forge.mrs.uppidi.com/xpufx-org/paseo", "agent-orch-1");
    router.enqueue("forge.mrs.uppidi.com/xpufx-org/paseo", "msg1");

    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: string) => {
      assert.match(String(input), /\/api\/v1\/repos\/search\?limit=50/);
      return jsonResponse({
        data: [
          {
            name: "paseo",
            full_name: "xpufx-org/paseo",
            owner: { login: "xpufx-org" },
            html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo",
            private: false,
          },
          {
            name: "2fado",
            full_name: "xpufx-org/2fado",
            owner: { login: "xpufx-org" },
            html_url: "https://forge.mrs.uppidi.com/xpufx-org/2fado",
            private: true,
          },
        ],
      });
    });

    const res = await handleUppidiRepos({});
    assert.equal(res.ok, true);
    assert.equal(res.repos.length, 2);

    const paseo = res.repos.find((r) => r.name === "paseo");
    assert.ok(paseo);
    assert.equal(paseo.key, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(paseo.enrolled, true);
    assert.equal(paseo.paused, true);
    assert.equal(paseo.hasOrchestrator, true);
    assert.equal(paseo.queueDepth, 1);
    assert.equal(paseo.private, false);

    const fado = res.repos.find((r) => r.name === "2fado");
    assert.ok(fado);
    assert.equal(fado.enrolled, false);
    assert.equal(fado.paused, false);
    assert.equal(fado.hasOrchestrator, false);
    assert.equal(fado.queueDepth, 0);
    assert.equal(fado.private, true);
  });

  it("passes query parameter to repos/search", async () => {
    let capturedUrl = "";
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: string) => {
      capturedUrl = String(input);
      return jsonResponse({ data: [] });
    });

    const res = await handleUppidiRepos({ query: "paseo" });
    assert.equal(res.ok, true);
    assert.match(capturedUrl, /q=paseo/);
  });

  it("falls back to /user/repos when search returns 404", async () => {
    const urls: string[] = [];
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: string) => {
      urls.push(String(input));
      if (String(input).includes("/repos/search")) {
        return jsonResponse({ message: "Not found" }, 404, false);
      }
      return jsonResponse([
        {
          name: "fallback-repo",
          full_name: "xpufx-org/fallback-repo",
          owner: { login: "xpufx-org" },
          private: false,
        },
      ]);
    });

    const res = await handleUppidiRepos({});
    assert.equal(res.ok, true);
    assert.equal(res.repos.length, 1);
    assert.equal(res.repos[0]?.name, "fallback-repo");
    assert.ok(urls.some((u) => u.includes("/api/v1/user/repos")));
  });

  it("classifies 401 as 'Forgejo token missing or invalid'", async () => {
    setTokenResolverForTest(async () => "invalid-token");
    setFetchForTest(async () => {
      return jsonResponse({ message: "Unauthorized" }, 401, false);
    });

    const res = await handleUppidiRepos({});
    assert.equal(res.ok, false);
    assert.equal(res.error, "Forgejo token missing or invalid");
    assert.deepEqual(res.repos, []);
  });

  it("handles unreachable network errors", async () => {
    setTokenResolverForTest(async () => "token");
    setFetchForTest(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:443");
    });

    const res = await handleUppidiRepos({});
    assert.equal(res.ok, false);
    assert.match(res.error || "", /ECONNREFUSED/);
  });

  it("enrolls and unenrolls repositories via active HookRouter", async () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
    });
    setActiveHookRouter(router);

    // Enroll with bare repo name
    const enrollRes = await handleUppidiEnrollRepo({ repo: "xpufx-org/paseo" });
    assert.equal(enrollRes.ok, true);
    assert.equal(enrollRes.repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.ok(enrollRes.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/paseo"));
    assert.ok(router.getEnrolledRepos().includes("forge.mrs.uppidi.com/xpufx-org/paseo"));

    // Unenroll
    const unenrollRes = await handleUppidiUnenrollRepo({ repo: "forge.mrs.uppidi.com/xpufx-org/paseo" });
    assert.equal(unenrollRes.ok, true);
    assert.equal(unenrollRes.repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.ok(!unenrollRes.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/paseo"));
    assert.ok(!router.getEnrolledRepos().includes("forge.mrs.uppidi.com/xpufx-org/paseo"));
  });

  it("enrolls and unenrolls repositories with config fallback when router is inactive", async () => {
    setActiveHookRouter(null);

    const enrollRes = await handleUppidiEnrollRepo({ repo: "xpufx-org/standalone-repo" });
    assert.equal(enrollRes.ok, true);
    assert.equal(enrollRes.repo, "forge.mrs.uppidi.com/xpufx-org/standalone-repo");
    assert.ok(enrollRes.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/standalone-repo"));

    const unenrollRes = await handleUppidiUnenrollRepo({ repo: "xpufx-org/standalone-repo" });
    assert.equal(unenrollRes.ok, true);
    assert.ok(!unenrollRes.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/standalone-repo"));
  });
});

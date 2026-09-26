import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  handleUppidiRunners,
  normalizeForgejoRunners,
  runnerScopeEndpoints,
  fetchLocalContainers,
  setExecFileAsyncForTest,
} from "./runners.js";
import { setFetchForTest, setTokenResolverForTest } from "./forgejo-api.js";
import { getRunnerStatusConfig, UppidiRunnerSchema } from "../shared/contracts.js";

/** Podman is not part of these assertions unless a test opts in. */
function podmanUnavailable(): void {
  setExecFileAsyncForTest(async () => {
    throw new Error("podman not installed");
  });
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  };
}

/** Builds a fetch stub that answers per API path, defaulting to a bare 404. */
function fetchByPath(routes: Record<string, () => unknown | Promise<unknown>>) {
  const calls: string[] = [];
  setFetchForTest(async (input: string) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "");
    calls.push(path);
    const route = routes[path];
    if (!route) return jsonResponse({ message: "not found" }, 404);
    const result = await route();
    return result && typeof result === "object" && "ok" in result
      ? result
      : jsonResponse(result);
  });
  return calls;
}

const ACTIVE_RUNNER = {
  id: 42,
  uuid: "e0f1a2b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  name: "act-runner-01",
  description: "shared host runner",
  ephemeral: false,
  labels: ["ubuntu-latest", "linux-x64"],
  owner_id: 2,
  repo_id: 0,
  status: "idle",
  version: "0.2.11",
};

const OFFLINE_RUNNER = {
  id: 43,
  uuid: "11111111-2222-3333-4444-555555555555",
  name: "act-runner-02",
  labels: [],
  owner_id: 2,
  repo_id: 0,
  status: "offline",
  version: "0.2.10",
};

describe("runner fleet from the Forgejo API (#632)", () => {
  beforeEach(() => {
    // Every input these assertions depend on is injected: the token, the HTTP
    // transport, and the container runtime. Reading the operator's real
    // `~/.config/tea/config.yml` would make the suite pass or fail based on
    // which workstation it ran on.
    setTokenResolverForTest(async () => "test-token");
    podmanUnavailable();
  });

  afterEach(() => {
    setFetchForTest(null);
    setExecFileAsyncForTest(null);
    setTokenResolverForTest(null);
    delete process.env.FORGEJO_HOST;
  });

  it("renders the runners the API returns, verbatim and capacity-counted", async () => {
    const calls = fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () => jsonResponse([ACTIVE_RUNNER]),
      "/api/v1/orgs/xpufx-org/actions/runners": () =>
        jsonResponse({ message: "token does not have at least one of required scope(s)" }, 403),
      "/api/v1/user/actions/runners": () => jsonResponse([OFFLINE_RUNNER]),
    });

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.ok, true);
    assert.equal(res.fleetStatus, "ok");
    assert.equal(res.totalCount, 2);
    // Only the runner the API reports as `idle` is capacity; `offline` is not.
    assert.equal(res.onlineCount, 1);

    const active = res.runners.find((r) => r.name === "act-runner-01");
    assert.ok(active, "runner from the repo scope must be present");
    assert.equal(active.id, ACTIVE_RUNNER.uuid);
    assert.equal(active.status, "idle", "status must pass through unmodified");
    assert.equal(active.available, true);
    assert.equal(active.scope, "repo");
    assert.deepEqual(active.labels, ["ubuntu-latest", "linux-x64"]);
    assert.equal(active.description, "shared host runner");
    assert.equal(active.version, "0.2.11");

    const offline = res.runners.find((r) => r.name === "act-runner-02");
    assert.ok(offline, "runner from the user scope must be present");
    assert.equal(offline.available, false);
    assert.equal(offline.scope, "user");

    // A 403 on one scope must not be reported as "no runners" for that scope.
    const orgSource = res.sources.find((s) => s.key === "org");
    assert.equal(orgSource?.ok, false);
    assert.equal(orgSource?.failure, "http");
    assert.equal(orgSource?.httpStatus, 403);
    assert.match(orgSource?.error ?? "", /403/);

    assert.ok(calls.includes("/api/v1/user/actions/runners"));
  });

  it("reports an authoritative empty fleet when the API returns no runners", async () => {
    fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () =>
        jsonResponse({ message: "user should be the owner of the repo" }, 403),
      "/api/v1/orgs/xpufx-org/actions/runners": () =>
        jsonResponse({ message: "token does not have at least one of required scope(s)" }, 403),
      "/api/v1/user/actions/runners": () => jsonResponse([]),
    });

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.ok, true, "a 200 with an empty list is a successful read");
    assert.equal(res.fleetStatus, "empty");
    assert.deepEqual(res.runners, []);
    assert.equal(res.totalCount, 0);
    assert.equal(res.onlineCount, 0, "an empty fleet has zero capacity, never a placeholder");
    assert.equal(res.error, undefined);
  });

  it("reports unreachable when the API cannot be reached at all", async () => {
    setFetchForTest(async () => {
      throw new TypeError("fetch failed");
    });

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.ok, false);
    assert.equal(res.fleetStatus, "unreachable");
    assert.deepEqual(res.runners, [], "no fallback runner may be invented");
    assert.equal(res.totalCount, 0);
    assert.equal(res.onlineCount, 0);
    assert.match(res.error ?? "", /unreachable/i);
    const fleetSources = res.sources.filter((s) => s.kind === "forgejo-runners");
    assert.equal(fleetSources.length, 3);
    for (const source of fleetSources) {
      assert.equal(source.ok, false);
      assert.equal(source.failure, "unreachable");
    }
  });

  it("reports forbidden when the API rejects the token, and never counts capacity", async () => {
    fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () =>
        jsonResponse({ message: "user should be the owner of the repo" }, 403),
      "/api/v1/orgs/xpufx-org/actions/runners": () =>
        jsonResponse({ message: "token does not have at least one of required scope(s)" }, 403),
      "/api/v1/user/actions/runners": () => jsonResponse({ message: "unauthorized" }, 401),
    });

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.ok, false);
    assert.equal(res.fleetStatus, "forbidden");
    assert.equal(res.onlineCount, 0);
    assert.match(res.error ?? "", /rejected/i);
  });

  it("keeps local containers out of the CI list and out of capacity", async () => {
    fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () => jsonResponse([ACTIVE_RUNNER]),
      "/api/v1/orgs/xpufx-org/actions/runners": () => jsonResponse([]),
      "/api/v1/user/actions/runners": () => jsonResponse([]),
    });
    setExecFileAsyncForTest(async () => ({
      stdout: JSON.stringify([
        {
          Id: "c9f4e62a78df13daf8fcba265739ae9b4c91f03dfb7ecfc139693883b6f8e3f3",
          Names: ["gitdeck"],
          State: "running",
          Image: "ghcr.io/debba/gitdeck:latest",
          CreatedAt: "6 days ago",
        },
      ]),
    }));

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.totalCount, 1, "the local container is not a CI runner");
    assert.equal(res.onlineCount, 1, "capacity reflects Forgejo only");
    assert.ok(
      !res.runners.some((r) => r.name === "gitdeck"),
      "local containers must not appear in the CI runner list",
    );
    assert.equal(res.localRunners.length, 1);
    assert.equal(res.localRunners[0]!.name, "gitdeck");
    assert.equal(res.localRunners[0]!.status, "running");
    const localSource = res.sources.find((s) => s.key === "local");
    assert.equal(localSource?.ok, true);
  });

  it("surfaces a local container probe failure instead of rendering zero silently", async () => {
    fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () => jsonResponse([]),
      "/api/v1/orgs/xpufx-org/actions/runners": () => jsonResponse([]),
      "/api/v1/user/actions/runners": () => jsonResponse([]),
    });
    podmanUnavailable();

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.fleetStatus, "empty");
    const localSource = res.sources.find((s) => s.key === "local");
    assert.equal(localSource?.ok, false);
    assert.match(localSource?.error ?? "", /podman not installed/);
  });

  it("fails closed on a runner whose status the API did not report", async () => {
    fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () =>
        jsonResponse([{ id: 9, uuid: "aaaa", name: "mystery-runner" }]),
    });

    const res = await handleUppidiRunners({}, {} as any);

    assert.equal(res.fleetStatus, "ok");
    assert.equal(res.totalCount, 1);
    assert.equal(res.onlineCount, 0, "an unreported status is never capacity");
    assert.equal(res.runners[0]!.status, "unknown");
    assert.equal(res.runners[0]!.available, false);
    assert.equal(getRunnerStatusConfig("unknown").available, false);
  });

  it("omits rather than fabricates entries with no Forgejo identity", async () => {
    const { runners, skipped } = normalizeForgejoRunners(
      [{ name: "no-id" }, { id: 7 }, null, "nonsense", ACTIVE_RUNNER],
      "user"
    );
    assert.equal(skipped, 4);
    assert.equal(runners.length, 1);
    assert.equal(runners[0]!.name, ACTIVE_RUNNER.name);
    assert.equal(runners[0]!.id, ACTIVE_RUNNER.uuid);
  });

  it("falls back to the numeric runner id when an instance returns no uuid", async () => {
    const { runners } = normalizeForgejoRunners([{ id: 12, name: "no-uuid-runner" }], "org");
    assert.equal(runners[0]!.id, "12");
  });

  it("queries every Forgejo runner scope a repo's jobs can draw from", () => {
    assert.deepEqual(runnerScopeEndpoints("xpufx-org/paseo"), [
      { scope: "repo", path: "/api/v1/repos/xpufx-org/paseo/actions/runners" },
      { scope: "org", path: "/api/v1/orgs/xpufx-org/actions/runners" },
      { scope: "user", path: "/api/v1/user/actions/runners" },
    ]);
  });

  it("drops duplicate runners reported by more than one scope", async () => {
    fetchByPath({
      "/api/v1/repos/xpufx-org/paseo/actions/runners": () => jsonResponse([ACTIVE_RUNNER]),
      "/api/v1/orgs/xpufx-org/actions/runners": () => jsonResponse([ACTIVE_RUNNER]),
      "/api/v1/user/actions/runners": () => jsonResponse([ACTIVE_RUNNER]),
    });

    const res = await handleUppidiRunners({}, {} as any);
    assert.equal(res.totalCount, 1);
    assert.equal(res.onlineCount, 1);
  });

  it("carries no field that could hold a fabricated last-seen or last-job", () => {
    // The runner contract has no lastSeen/lastJob member at all, so no
    // placeholder can be attached to a runner without a type error (#632).
    const parsed = UppidiRunnerSchema.parse({
      id: "u",
      name: "r",
      status: "idle",
      scope: "user",
    });
    assert.equal("lastSeen" in parsed, false);
    assert.equal("lastJob" in parsed, false);
  });

  it("reports no local runners when the probe returns an empty container list", async () => {
    setExecFileAsyncForTest(async () => ({ stdout: "[]" }));
    const local = await fetchLocalContainers();
    assert.deepEqual(local.runners, []);
    assert.equal(local.error, undefined);
  });

  it("honours FORGEJO_HOST and authenticates without leaking the token into the URL", async () => {
    process.env.FORGEJO_HOST = "forge.example.test";
    // Resolve per host, so the override is exercised on the same lookup the
    // handler performs rather than being satisfied by a host that happens to
    // match nothing in the ambient environment.
    setTokenResolverForTest(async (host) => (host === "forge.example.test" ? "test-token" : null));
    const seen: Array<{ url: string; auth?: string }> = [];
    setFetchForTest(async (input: string, init: any) => {
      seen.push({ url: String(input), auth: init?.headers?.Authorization });
      return jsonResponse([]);
    });

    const res = await handleUppidiRunners({}, {} as any);
    assert.equal(res.fleetStatus, "empty");

    assert.equal(seen.length, 3);
    for (const call of seen) {
      assert.match(call.url, /^https:\/\/forge\.example\.test\/api\/v1\/(repos|orgs|user)\//);
      assert.ok(!call.url.includes("test-token"), "the token must travel in a header, not the URL");
      assert.equal(call.auth, "token test-token");
    }
  });

  it("still reads a real fleet when the token is absent, as an unauthenticated read", async () => {
    setTokenResolverForTest(async () => null);
    const seen: Array<{ url: string; auth?: string }> = [];
    setFetchForTest(async (input: string, init: any) => {
      seen.push({ url: String(input), auth: init?.headers?.Authorization });
      return jsonResponse([OFFLINE_RUNNER]);
    });

    const res = await handleUppidiRunners({}, {} as any);
    assert.equal(seen.every((call) => call.auth === undefined), true);
    // A 200 is still a 200: the fleet is rendered, and the offline runner is
    // reported as zero capacity rather than as a fabricated online runner.
    assert.equal(res.fleetStatus, "ok");
    assert.equal(res.totalCount, 1);
    assert.equal(res.onlineCount, 0);
  });
});

describe("runner status capacity semantics (#632)", () => {
  it("counts only positively reported active/idle runners as capacity", () => {
    assert.equal(getRunnerStatusConfig("active").available, true);
    assert.equal(getRunnerStatusConfig("idle").available, true);
    assert.equal(getRunnerStatusConfig("offline").available, false);
    assert.equal(getRunnerStatusConfig("unknown").available, false);
    assert.equal(getRunnerStatusConfig("").available, false);
    assert.equal(getRunnerStatusConfig(undefined).available, false);
    assert.equal(getRunnerStatusConfig(null).available, false);
    assert.equal(getRunnerStatusConfig("active-ish").available, false);
  });
});

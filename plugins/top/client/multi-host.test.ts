import test from "node:test";
import assert from "node:assert/strict";
import {
  MultiHostPoller,
  aggregateFleet,
  sortFleetSnapshots,
  type FleetHostClient,
  type FleetHostCounts,
  type FleetHostInput,
} from "../shared/multi-host";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function counts(partial: Partial<FleetHostCounts> = {}): FleetHostCounts {
  return { agents: 0, activeAgents: 0, workspaces: 0, ...partial };
}

function host(
  serverId: string,
  status: FleetHostInput["status"] = "online",
  label = serverId,
): FleetHostInput {
  return { serverId, label, status };
}

/**
 * Test harness that records acquisitions/disposals and lets a test drive the
 * readCounts promise (immediate, deferred, or timeout).
 */
function createHarness() {
  const acquired: string[] = [];
  const disposed: string[] = [];
  const reads: string[] = [];
  const pending = new Map<string, Deferred<FleetHostCounts>>();
  let responseFor: (serverId: string) => Promise<FleetHostCounts>;

  const acquire = (serverId: string): FleetHostClient => {
    acquired.push(serverId);
    return {
      readCounts: () => {
        reads.push(serverId);
        return responseFor(serverId);
      },
      dispose: () => {
        disposed.push(serverId);
      },
    };
  };

  return {
    acquire,
    acquired,
    disposed,
    reads,
    pending,
    setImmediateResponse(values: Record<string, FleetHostCounts>) {
      responseFor = (serverId) => Promise.resolve(values[serverId] ?? counts());
    },
    setDeferredResponse() {
      responseFor = (serverId) => {
        const d = deferred<FleetHostCounts>();
        pending.set(serverId, d);
        return d.promise;
      };
    },
    setNeverResponse() {
      responseFor = () => new Promise<FleetHostCounts>(() => {});
    },
    setRejectingResponse(message: string) {
      responseFor = () => Promise.reject(new Error(message));
    },
  };
}

test("defaults match the #299 bounded contract: 15s cadence, 4s timeout", () => {
  assert.equal(MultiHostPoller.DEFAULT_INTERVAL_MS, 15_000);
  assert.equal(MultiHostPoller.DEFAULT_TIMEOUT_MS, 4_000);
});

test("online host reports counts and latency on a successful probe", async () => {
  const h = createHarness();
  h.setImmediateResponse({ "host-a": counts({ agents: 3, activeAgents: 1, workspaces: 2 }) });
  // The poller reads `now()` at probe start, then for latency, then for the
  // last-updated stamp; drive those three reads explicitly.
  const clock = [1000, 1042, 1042];
  let tick = 0;
  const poller = new MultiHostPoller({
    acquire: h.acquire,
    now: () => clock[Math.min(tick++, clock.length - 1)],
  });
  poller.setHosts([host("host-a")]);

  await poller.pollOnce();

  const [snapshot] = poller.getSnapshots();
  assert.equal(snapshot.status, "online");
  assert.equal(snapshot.counts?.agents, 3);
  assert.equal(snapshot.counts?.activeAgents, 1);
  assert.equal(snapshot.counts?.workspaces, 2);
  assert.equal(snapshot.latencyMs, 42);
  assert.equal(snapshot.lastUpdatedAt, 1042);
  assert.equal(snapshot.staleAt, null);
  assert.equal(snapshot.error, null);
  assert.deepEqual(h.acquired, ["host-a"]);
  poller.dispose();
});

test("offline host never acquires a client and renders an offline badge", async () => {
  const h = createHarness();
  h.setImmediateResponse({});
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a", "offline")]);

  await poller.pollOnce();

  const [snapshot] = poller.getSnapshots();
  assert.equal(snapshot.status, "offline");
  assert.equal(snapshot.counts, null);
  assert.deepEqual(h.acquired, []);
  poller.dispose();
});

test("errored host renders an error badge without throwing", async () => {
  const h = createHarness();
  h.setImmediateResponse({});
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a", "error")]);

  await poller.pollOnce();

  const [snapshot] = poller.getSnapshots();
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.error, "Host connection error");
  assert.deepEqual(h.acquired, []);
  poller.dispose();
});

test("a timed-out host is marked stale with a timestamp and is not retried until the next tick", async () => {
  const h = createHarness();
  h.setNeverResponse();
  let clock = 0;
  const poller = new MultiHostPoller({
    acquire: h.acquire,
    timeoutMs: 20,
    now: () => clock,
  });
  poller.setHosts([host("host-a")]);

  clock = 5000;
  await poller.pollOnce();

  let [snapshot] = poller.getSnapshots();
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.staleAt, 5000);
  assert.equal(snapshot.error, "Timed out");
  // The borrowed client is retained; only the next tick may probe again.
  assert.deepEqual(h.acquired, ["host-a"]);
  assert.deepEqual(h.disposed, []);

  await poller.pollOnce();
  // The retained client is reused for the next-interval retry (no reacquire),
  // but the probe itself only runs once per tick.
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.acquired, ["host-a"]);
  snapshot = poller.getSnapshots()[0];
  assert.equal(snapshot.status, "stale");
  poller.dispose();
});

test("stale clears when the host responds on a later tick", async () => {
  const h = createHarness();
  h.setNeverResponse();
  const poller = new MultiHostPoller({ acquire: h.acquire, timeoutMs: 15 });
  poller.setHosts([host("host-a")]);
  await poller.pollOnce();
  assert.equal(poller.getSnapshots()[0].status, "stale");

  h.setImmediateResponse({ "host-a": counts({ agents: 1 }) });
  await poller.pollOnce();
  const snapshot = poller.getSnapshots()[0];
  assert.equal(snapshot.status, "online");
  assert.equal(snapshot.staleAt, null);
  assert.equal(snapshot.counts?.agents, 1);
  poller.dispose();
});

test("a rejected probe marks the host error and drops the client so the next tick reacquires", async () => {
  const h = createHarness();
  h.setRejectingResponse("borrowed API released");
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a")]);

  await poller.pollOnce();
  const snapshot = poller.getSnapshots()[0];
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.error, "borrowed API released");
  assert.deepEqual(h.disposed, ["host-a"]);

  await poller.pollOnce();
  assert.deepEqual(h.acquired, ["host-a", "host-a"]);
  poller.dispose();
});

test("status transition disposes the borrowed client and reacquires on the next probe", async () => {
  const h = createHarness();
  h.setImmediateResponse({ "host-a": counts() });
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a")]);
  await poller.pollOnce();
  assert.deepEqual(h.acquired, ["host-a"]);
  assert.deepEqual(h.disposed, []);

  // Reconnect (online -> offline -> online) is a connection change: the old
  // borrowed API must be released.
  poller.setHosts([host("host-a", "offline")]);
  assert.deepEqual(h.disposed, ["host-a"]);
  assert.equal(poller.getSnapshots()[0].status, "offline");
  assert.equal(
    poller.getSnapshots()[0].counts,
    null,
    "a disconnected host must not keep stale counts",
  );

  poller.setHosts([host("host-a", "online")]);
  await poller.pollOnce();
  assert.deepEqual(h.acquired, ["host-a", "host-a"]);
  assert.equal(poller.getSnapshots()[0].status, "online");
  poller.dispose();
});

test("a result from a superseded connection generation is discarded", async () => {
  const h = createHarness();
  h.setDeferredResponse();
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a")]);

  const tick = poller.pollOnce();
  // The connection is replaced while the old probe is still in flight.
  poller.setHosts([host("host-a", "offline")]);
  poller.setHosts([host("host-a", "online")]);

  h.pending.get("host-a")!.resolve(counts({ agents: 99 }));
  await tick;

  const snapshot = poller.getSnapshots()[0];
  assert.equal(snapshot.status, "online");
  assert.equal(snapshot.counts, null, "superseded probe result must not be applied");
  poller.dispose();
});

test("removing a host releases its client and drops it from the fleet", async () => {
  const h = createHarness();
  h.setImmediateResponse({ "host-a": counts(), "host-b": counts() });
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a"), host("host-b")]);
  await poller.pollOnce();
  assert.equal(poller.getSnapshots().length, 2);

  poller.setHosts([host("host-b")]);
  assert.deepEqual(h.disposed, ["host-a"]);
  assert.deepEqual(poller.getSnapshots().map((s) => s.serverId), ["host-b"]);
  poller.dispose();
});

test("bounds concurrency to one in-flight probe per host", async () => {
  const h = createHarness();
  h.setDeferredResponse();
  const poller = new MultiHostPoller({ acquire: h.acquire });
  poller.setHosts([host("host-a")]);

  const first = poller.pollOnce();
  // A second pass while the first is still in flight must not start a new probe.
  const second = poller.pollOnce();
  assert.equal(h.acquired.length, 1);

  h.pending.get("host-a")!.resolve(counts());
  await Promise.all([first, second]);
  assert.deepEqual(h.acquired, ["host-a"]);
  poller.dispose();
});

test("aggregate sums counts only and tallies statuses", () => {
  const snapshots = sortFleetSnapshots([
    {
      serverId: "b",
      label: "Beta",
      connectionStatus: "online",
      status: "stale",
      latencyMs: 10,
      lastUpdatedAt: 1,
      staleAt: 1,
      error: "Timed out",
      counts: counts({ agents: 2, activeAgents: 1, workspaces: 1 }),
    },
    {
      serverId: "a",
      label: "Alpha",
      connectionStatus: "online",
      status: "online",
      latencyMs: 5,
      lastUpdatedAt: 1,
      staleAt: null,
      error: null,
      counts: counts({ agents: 4, activeAgents: 3, workspaces: 2 }),
    },
    {
      serverId: "c",
      label: "Gamma",
      connectionStatus: "offline",
      status: "offline",
      latencyMs: null,
      lastUpdatedAt: null,
      staleAt: null,
      error: null,
      counts: null,
    },
  ]);

  assert.deepEqual(snapshots.map((s) => s.label), ["Alpha", "Beta", "Gamma"]);

  const aggregate = aggregateFleet(snapshots);
  assert.equal(aggregate.hosts, 3);
  assert.equal(aggregate.online, 1);
  assert.equal(aggregate.stale, 1);
  assert.equal(aggregate.offline, 1);
  assert.equal(aggregate.responsive, 2);
  assert.deepEqual(aggregate.counts, {
    agents: 6,
    activeAgents: 4,
    workspaces: 3,
  });
});

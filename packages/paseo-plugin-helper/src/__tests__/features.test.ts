import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineRpc } from "../shared/rpc.js";
import {
  composeFeatureModules,
  type FeatureDisposer,
  type FeatureModule,
} from "../shared/features.js";
import { createCustomPillsFeature } from "../server/custom-pills.js";
import { createTimelineTelemetryFeature } from "../server/telemetry.js";


const ping = defineRpc({
  name: "test.ping",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

const pong = defineRpc({
  name: "test.pong",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

type ServerCtx = { name: "server" };
type ClientCtx = { name: "client" };

describe("composeFeatureModules", () => {
  it("runs every module's contribution hook with the given context, in order", () => {
    const calls: string[] = [];
    const server = { name: "server" } as ServerCtx;
    const client = { name: "client" } as ClientCtx;

    const features: FeatureModule<ServerCtx, ClientCtx>[] = [
      {
        id: "alpha",
        contributeServer(ctx: ServerCtx) {
          calls.push(`server:alpha:${ctx.name}`);
        },
        contributeClient(ctx: ClientCtx) {
          calls.push(`client:alpha:${ctx.name}`);
        },
      },
      {
        id: "beta",
        contributeServer(ctx: ServerCtx) {
          calls.push(`server:beta:${ctx.name}`);
        },
      },
      {
        id: "gamma",
        contributeClient(ctx: ClientCtx) {
          calls.push(`client:gamma:${ctx.name}`);
        },
      },
    ];

    const composed = composeFeatureModules<ServerCtx, ClientCtx>(features);
    composed.contributeServer(server);
    composed.contributeClient(client);

    expect(calls).toEqual([
      "server:alpha:server",
      "server:beta:server",
      "client:alpha:client",
      "client:gamma:client",
    ]);
  });

  it("treats a void contribution as a no-op disposer", () => {
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      { id: "noop", contributeServer() {} },
    ]);

    const dispose = composed.contributeServer({ name: "server" });
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });

  it("disposes modules in reverse (LIFO) order", () => {
    const order: string[] = [];
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      { id: "first", contributeServer: () => () => order.push("first") },
      { id: "second", contributeServer: () => () => order.push("second") },
      { id: "third", contributeServer: () => () => order.push("third") },
    ]);

    composed.contributeServer({ name: "server" })();

    expect(order).toEqual(["third", "second", "first"]);
  });

  it("returns an idempotent combined disposer", () => {
    const moduleDispose = vi.fn();
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      { id: "one", contributeServer: () => moduleDispose },
    ]);

    const dispose = composed.contributeServer({ name: "server" });
    dispose();
    dispose();
    dispose();

    expect(moduleDispose).toHaveBeenCalledTimes(1);
  });

  it("runs every disposer even when one throws, then rethrows the first error", () => {
    const order: string[] = [];
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      { id: "first", contributeServer: () => () => order.push("first") },
      {
        id: "second",
        contributeServer: () => () => {
          order.push("second");
          throw new Error("boom");
        },
      },
      { id: "third", contributeServer: () => () => order.push("third") },
    ]);

    const dispose = composed.contributeServer({ name: "server" });
    expect(() => dispose()).toThrow("boom");
    expect(order).toEqual(["third", "second", "first"]);

    // The failed teardown is still only attempted once, and does not rethrow.
    expect(() => dispose()).not.toThrow();
    expect(order).toEqual(["third", "second", "first"]);
  });

  it("tears down already-contributed modules when a later contribution throws", () => {
    const order: string[] = [];
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      {
        id: "first",
        contributeServer: () => () => order.push("first"),
      },
      {
        id: "second",
        contributeServer: () => {
          throw new Error("setup failed");
        },
      },
      {
        id: "third",
        contributeServer: () => () => order.push("third"),
      },
    ]);

    expect(() => composed.contributeServer({ name: "server" })).toThrow("setup failed");
    expect(order).toEqual(["first"]);
  });

  it("keeps the contribution error when a rollback disposer also throws", () => {
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      {
        id: "first",
        contributeServer: () => () => {
          throw new Error("rollback failed");
        },
      },
      {
        id: "second",
        contributeServer: () => {
          throw new Error("setup failed");
        },
      },
    ]);

    expect(() => composed.contributeServer({ name: "server" })).toThrow("setup failed");
  });

  it("flattens declared contracts in module order", () => {
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      { id: "alpha", contracts: { ping } },
      { id: "beta", contracts: { pong } },
      { id: "gamma" },
    ]);

    expect(composed.ids).toEqual(["alpha", "beta", "gamma"]);
    expect(composed.contracts.map((contract) => contract.name)).toEqual([
      "test.ping",
      "test.pong",
    ]);
  });

  it("throws on duplicate module ids", () => {
    expect(() =>
      composeFeatureModules<ServerCtx, ClientCtx>([{ id: "dup" }, { id: "dup" }]),
    ).toThrow('Duplicate feature module id "dup"');
  });

  it("throws on empty or whitespace-only ids", () => {
    expect(() => composeFeatureModules<ServerCtx, ClientCtx>([{ id: "" }])).toThrow(
      "Feature module id must be a non-empty string",
    );
    expect(() => composeFeatureModules<ServerCtx, ClientCtx>([{ id: "   " }])).toThrow(
      "Feature module id must be a non-empty string",
    );
  });

  it("throws on duplicate contract names across modules", () => {
    expect(() =>
      composeFeatureModules<ServerCtx, ClientCtx>([
        { id: "alpha", contracts: { ping } },
        { id: "beta", contracts: { aliased: ping } },
      ]),
    ).toThrow('Duplicate RPC contract "test.ping" across feature modules');
  });

  it("gives each contribute call its own independent disposal", () => {
    const disposers: FeatureDisposer[] = [];
    const composed = composeFeatureModules<ServerCtx, ClientCtx>([
      {
        id: "one",
        contributeServer: () => {
          const dispose = vi.fn();
          disposers.push(dispose);
          return dispose;
        },
      },
    ]);

    const first = composed.contributeServer({ name: "server" });
    const second = composed.contributeServer({ name: "server" });

    first();
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).not.toHaveBeenCalled();

    second();
    expect(disposers[1]).toHaveBeenCalledTimes(1);
  });
});

describe("concrete feature modules (#933)", () => {
  it("createCustomPillsFeature satisfies FeatureModule contract and manages poller lifecycle", () => {
    let pollerMounted = false;
    let started = false;
    let stopped = false;
    const fakePoller: any = {
      start: () => {
        started = true;
      },
      stop: () => {
        stopped = true;
      },
    };

    const handled = new Map<string, any>();
    const fakeServer = {
      handle: (contract: any, handler: any) => {
        handled.set(contract.name, handler);
      },
    };

    const feature = createCustomPillsFeature({
      poller: fakePoller,
      contracts: { get: ping },
      handlers: { get: async () => ({ pills: [] }) },
      onMount: () => {
        pollerMounted = true;
      },
    });

    expect(feature.id).toBe("custom-pills");
    expect(feature.contracts?.get).toBe(ping);

    const dispose = feature.contributeServer!(fakeServer);
    expect(pollerMounted).toBe(true);
    expect(started).toBe(true);
    expect(handled.has("test.ping")).toBe(true);

    // Idempotent disposer stops poller
    expect(stopped).toBe(false);
    dispose!();
    expect(stopped).toBe(true);
    dispose!(); // second call should not throw
  });

  it("createTimelineTelemetryFeature satisfies FeatureModule contract and manages tap lifecycle", () => {
    let tapDisposed = false;
    const fakeServer = {
      on: (_event: string, _handler: any) => {
        return () => {
          tapDisposed = true;
        };
      },
    };

    const feature = createTimelineTelemetryFeature({
      contracts: { test: pong },
    });

    expect(feature.id).toBe("timeline-telemetry");
    expect(feature.contracts?.test).toBe(pong);

    const dispose = feature.contributeServer!(fakeServer);
    expect(typeof dispose).toBe("function");

    expect(tapDisposed).toBe(false);
    dispose!();
    expect(tapDisposed).toBe(true);
    dispose!(); // idempotent
  });
});


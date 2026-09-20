import { describe, expect, it, vi } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  demoSettingsDefinition,
  type ServerSettingsHandleState,
} from "../shared/server-settings.js";
import {
  registerDemoServerSettings,
  handleGetServerSettingsSnapshot,
  type DemoSettingsHandle,
} from "./server-settings.js";

type Listener = (state: ServerSettingsHandleState) => void | Promise<void>;

/** Minimal in-memory stand-in for upstream's PluginSettings handle. */
function fakeHandle(initial?: ServerSettingsHandleState) {
  const listeners = new Set<Listener>();
  const reads: ServerSettingsHandleState[] = [];
  let current: ServerSettingsHandleState =
    initial ?? { status: "ready", revision: "missing", values: { label: "seed", enabled: true, threshold: 5 } };
  return {
    listeners,
    setState(state: ServerSettingsHandleState) {
      current = state;
      for (const listener of listeners) void listener(state);
    },
    handle: {
      async read() {
        reads.push(current);
        return current;
      },
      subscribe(listener: Listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    reads,
  };
}

function fakeServer(returned: unknown) {
  const registered: unknown[] = [];
  const context = {
    registerSettings(definition: unknown) {
      registered.push(definition);
      return returned;
    },
  } as unknown as PluginServerContext;
  return { context, registered };
}

async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("registerDemoServerSettings", () => {
  it("captures the handle, subscribes, and reads on initialize", async () => {
    const { handle, listeners } = fakeHandle();
    const { context, registered } = fakeServer(handle);
    const demo = registerDemoServerSettings(context);
    await settled();
    expect(registered[0]).toBe(demoSettingsDefinition);
    expect(listeners.size).toBe(1);

    const snapshot = await handleGetServerSettingsSnapshot({});
    expect(snapshot.handleAvailable).toBe(true);
    expect(snapshot.subscribed).toBe(true);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.values).toMatchObject({ label: "seed" });
    demo.dispose();
  });

  it("records subscribe() events and reflects them in the snapshot", async () => {
    const { handle, setState } = fakeHandle();
    const demo = registerDemoServerSettings(fakeServer(handle).context);
    await settled();

    setState({ status: "ready", revision: "next", values: { label: "changed", enabled: false, threshold: 9 } });
    await settled();

    const snapshot = await handleGetServerSettingsSnapshot({});
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.lastEventStatus).toBe("ready");
    expect(snapshot.lastEventAt).not.toBeNull();
    expect(snapshot.revision).toBe("next");
    expect(snapshot.values).toMatchObject({ label: "changed", enabled: false });
    demo.dispose();
  });

  it("degrades to unavailable when registerSettings() returns void (SDK < 0.9)", async () => {
    const demo: DemoSettingsHandle = registerDemoServerSettings(fakeServer(undefined).context);
    await settled();
    const snapshot = await handleGetServerSettingsSnapshot({});
    expect(snapshot.handleAvailable).toBe(false);
    expect(snapshot.unavailableReason).toContain("0.9.0-beta.1");
    expect(snapshot.status).toBe("uninitialized");
    demo.dispose();
  });

  it("reports uninitialized values when the handle read fails", async () => {
    const handle = {
      read: vi.fn(async () => {
        throw new Error("read exploded");
      }),
      subscribe: () => () => {},
    };
    const demo = registerDemoServerSettings(fakeServer(handle).context);
    await settled();
    const snapshot = await handleGetServerSettingsSnapshot({});
    expect(snapshot.status).toBe("invalid");
    expect(snapshot.error).toBe("read exploded");
    demo.dispose();
  });
});

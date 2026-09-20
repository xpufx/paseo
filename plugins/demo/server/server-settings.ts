import type {
  PluginHandlerContext,
  PluginServerContext,
} from "@getpaseo/plugin/server";
import type { SettingsDefinition } from "@getpaseo/plugin";
import { createPluginLogger } from "paseo-plugin-helper/server";
import {
  buildServerSettingsSnapshot,
  demoSettingsDefinition,
  DEMO_SERVER_SETTINGS_EXPECTED_PATH,
  DEMO_SERVER_SETTINGS_ID,
  type ServerSettingsHandleState,
  type ServerSettingsSnapshot,
} from "../shared/server-settings.js";

// Own logger so this module is importable without the demo's background task.
const log = createPluginLogger("helper-demo", {
  banner: false,
  subsystem: "server-settings",
});

type HandleState = ServerSettingsHandleState;

/**
 * Structural shape of upstream's 0.9 `PluginSettings` handle. Typed locally so
 * the module compiles and degrades cleanly on the 0.8 SDK, where
 * `registerSettings()` returns `void` and no handle exists.
 */
interface SettingsHandleLike {
  read(): Promise<HandleState>;
  subscribe(listener: (state: HandleState) => void | Promise<void>): () => void;
}

interface RegisterSettingsCapable {
  registerSettings(definition: SettingsDefinition<typeof demoSettingsDefinition.schema>): unknown;
}

function isSettingsHandle(value: unknown): value is SettingsHandleLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { read?: unknown; subscribe?: unknown };
  return typeof candidate.read === "function" && typeof candidate.subscribe === "function";
}

/**
 * TEMP DEMO (issue #62): owns the upstream server settings handle for this
 * plugin installation. Everything the demo shows about "server settings" comes
 * from `handle.read()`/`handle.subscribe()` below - never from the helper's
 * `PluginStorage`/`registerSettingsRpc` layer.
 */
class DemoSettingsHandle {
  private readonly handle: SettingsHandleLike | null;
  private readonly unavailableReason: string | null;
  private current: HandleState | null = null;
  private readCount = 0;
  private eventCount = 0;
  private lastEventAt: string | null = null;
  private lastEventStatus: "ready" | "invalid" | null = null;
  private subscribed = false;
  private unsubscribe: (() => void) | null = null;

  constructor(handle: SettingsHandleLike | null, unavailableReason: string | null) {
    this.handle = handle;
    this.unavailableReason = unavailableReason;
  }

  /**
   * Subscribe before the first read so a concurrent client write during startup
   * is not missed; the initial `read()` below establishes the baseline.
   */
  async initialize(): Promise<void> {
    if (this.handle) {
      this.unsubscribe = this.handle.subscribe((state) => {
        this.eventCount += 1;
        this.lastEventAt = new Date().toISOString();
        this.lastEventStatus = state.status === "ready" ? "ready" : "invalid";
        this.current = state;
        log.info("Demo upstream settings handle observed a change", {
          status: state.status,
          revision: state.revision,
        });
      });
      this.subscribed = true;
    }
    await this.refresh();
  }

  /** Reads through the upstream handle and returns the current snapshot. */
  async refresh(): Promise<ServerSettingsSnapshot> {
    if (!this.handle) return this.snapshot();
    try {
      this.current = await this.handle.read();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.current = { status: "invalid", revision: "unknown", error: detail };
    }
    this.readCount += 1;
    return this.snapshot();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribed = false;
  }

  private snapshot(): ServerSettingsSnapshot {
    return buildServerSettingsSnapshot({
      settingsId: DEMO_SERVER_SETTINGS_ID,
      expectedPath: DEMO_SERVER_SETTINGS_EXPECTED_PATH,
      handleAvailable: this.handle !== null,
      unavailableReason: this.unavailableReason,
      subscribed: this.subscribed,
      readCount: this.readCount,
      eventCount: this.eventCount,
      lastEventAt: this.lastEventAt,
      lastEventStatus: this.lastEventStatus,
      schemaVersion: demoSettingsDefinition.version,
      current: this.current,
    });
  }
}

let activeHandle: DemoSettingsHandle | null = null;

/**
 * Registers the host-scoped demo settings document via upstream
 * `registerSettings()` and captures the returned handle. Called once from
 * `contribute()`; the async `initialize()` is intentionally not awaited so the
 * synchronous contribution contract is preserved.
 */
export function registerDemoServerSettings(server: PluginServerContext): DemoSettingsHandle {
  const capable = server as unknown as RegisterSettingsCapable;
  const returned = capable.registerSettings(demoSettingsDefinition);

  let handle: SettingsHandleLike | null = null;
  let reason: string | null = null;
  if (isSettingsHandle(returned)) {
    handle = returned;
  } else {
    reason =
      "registerSettings() did not return a PluginSettings handle. On Paseo < 0.9.0-beta.1 it returns void (the handle shipped in 0.9.0-beta.1, upstream PR #4674); this build is running against an older host runtime.";
  }

  const demo = new DemoSettingsHandle(handle, reason);
  activeHandle = demo;
  void demo.initialize().catch((error) => {
    log.error("Demo upstream settings handle failed to initialize", error);
  });
  return demo;
}

function unavailableSnapshot(): ServerSettingsSnapshot {
  return buildServerSettingsSnapshot({
    settingsId: DEMO_SERVER_SETTINGS_ID,
    expectedPath: DEMO_SERVER_SETTINGS_EXPECTED_PATH,
    handleAvailable: false,
    unavailableReason: "Settings handle was not registered (plugin server did not initialize it).",
    subscribed: false,
    readCount: 0,
    eventCount: 0,
    lastEventAt: null,
    lastEventStatus: null,
    schemaVersion: demoSettingsDefinition.version,
    current: null,
  });
}

/** RPC handler backing the temp demo surface's snapshot read. */
export async function handleGetServerSettingsSnapshot(
  _input: Record<string, never>,
  _context?: PluginHandlerContext,
): Promise<ServerSettingsSnapshot> {
  if (!activeHandle) return unavailableSnapshot();
  return activeHandle.refresh();
}

export type { DemoSettingsHandle };

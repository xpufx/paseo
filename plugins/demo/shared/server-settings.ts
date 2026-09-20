import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

/**
 * TEMP DEMO (issue #62): upstream server-side settings handle.
 *
 * The `SettingsDefinition` below is the single source of truth for a
 * host-scoped settings document. Upstream `registerSettings()` on the server
 * now returns a `PluginSettings` handle with `read()`/`subscribe()`; the client
 * half is the auto-registered `settings.<id>.*` RPC plus the host `useSettings()`
 * hook built on it. This module is intentionally outside our helper's
 * `PluginStorage`/`registerSettingsRpc` layer - that is the point of the demo.
 */
export const DEMO_SERVER_SETTINGS_ID = "server-demo";

/** Upstream store layout, shown in the demo UI: `~/.paseo/plugin-settings/<pluginId>/<id>.json`. */
export const DEMO_SERVER_SETTINGS_EXPECTED_PATH =
  "~/.paseo/plugin-settings/paseo-helper-demo/server-demo.json";

export const DemoSettingsSchema = z.object({
  label: z.string().min(1).default("upstream handle demo"),
  enabled: z.boolean().default(true),
  threshold: z.number().int().min(0).max(100).default(70),
});

export type DemoSettingsValues = z.infer<typeof DemoSettingsSchema>;

export const demoSettingsDefinition = defineSettings({
  id: DEMO_SERVER_SETTINGS_ID,
  scope: "host",
  version: 1,
  schema: DemoSettingsSchema,
});

/** The host RPC the server handle auto-registers; the client writes through it. */
export const demoSettingsRpc = settingsRpc(DEMO_SERVER_SETTINGS_ID);

/**
 * Server-handle snapshot: what the daemon process has observed via the
 * upstream handle's `read()` and `subscribe()`, not our helper storage.
 */
export const ServerSettingsSnapshotSchema = z.object({
  settingsId: z.string(),
  expectedPath: z.string(),
  handleAvailable: z.boolean(),
  unavailableReason: z.string().nullable(),
  subscribed: z.boolean(),
  status: z.enum(["uninitialized", "ready", "invalid"]),
  revision: z.string(),
  values: DemoSettingsSchema.nullable(),
  error: z.string().nullable(),
  readCount: z.number(),
  eventCount: z.number(),
  lastEventAt: z.string().nullable(),
  lastEventStatus: z.enum(["ready", "invalid"]).nullable(),
  schemaVersion: z.number(),
});

export type ServerSettingsSnapshot = z.infer<typeof ServerSettingsSnapshotSchema>;

/** A single state emitted by the upstream handle (structurally mirrors 0.9's PluginSettingsState). */
export type ServerSettingsHandleState =
  | { status: "ready"; revision: string; values: unknown }
  | { status: "invalid"; revision: string; error: string };

export interface ServerSettingsObservation {
  settingsId: string;
  expectedPath: string;
  handleAvailable: boolean;
  unavailableReason: string | null;
  subscribed: boolean;
  readCount: number;
  eventCount: number;
  lastEventAt: string | null;
  lastEventStatus: "ready" | "invalid" | null;
  schemaVersion: number;
  current: ServerSettingsHandleState | null;
}

/**
 * Pure projection of the daemon's handle observations into the RPC snapshot
 * shape. Kept free of the SDK so it is unit-testable; the server class only
 * tracks counters and calls this.
 */
export function buildServerSettingsSnapshot(
  observation: ServerSettingsObservation,
): ServerSettingsSnapshot {
  const base = {
    settingsId: observation.settingsId,
    expectedPath: observation.expectedPath,
    handleAvailable: observation.handleAvailable,
    unavailableReason: observation.unavailableReason,
    subscribed: observation.subscribed,
    readCount: observation.readCount,
    eventCount: observation.eventCount,
    lastEventAt: observation.lastEventAt,
    lastEventStatus: observation.lastEventStatus,
    schemaVersion: observation.schemaVersion,
  };
  if (!observation.current) {
    return ServerSettingsSnapshotSchema.parse({
      ...base,
      status: "uninitialized",
      revision: "missing",
      values: null,
      error: null,
    });
  }
  if (observation.current.status === "ready") {
    const parsed = DemoSettingsSchema.safeParse(observation.current.values);
    if (!parsed.success) {
      return ServerSettingsSnapshotSchema.parse({
        ...base,
        status: "invalid",
        revision: observation.current.revision,
        values: null,
        error: parsed.error.message,
      });
    }
    return ServerSettingsSnapshotSchema.parse({
      ...base,
      status: "ready",
      revision: observation.current.revision,
      values: parsed.data,
      error: null,
    });
  }
  return ServerSettingsSnapshotSchema.parse({
    ...base,
    status: "invalid",
    revision: observation.current.revision,
    values: null,
    error: observation.current.error,
  });
}

export const demoSettingsSnapshotContract = defineContract({
  name: "helper-demo.server-settings.snapshot",
  description: "Server handle state observed via upstream registerSettings().read()/subscribe()",
  input: z.object({}),
  output: ServerSettingsSnapshotSchema,
});

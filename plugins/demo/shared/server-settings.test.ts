import { describe, expect, it } from "vitest";
import {
  buildServerSettingsSnapshot,
  DemoSettingsSchema,
  demoSettingsDefinition,
  DEMO_SERVER_SETTINGS_ID,
  DEMO_SERVER_SETTINGS_EXPECTED_PATH,
  type ServerSettingsObservation,
} from "./server-settings.js";

function observation(
  overrides: Partial<ServerSettingsObservation> = {},
): ServerSettingsObservation {
  return {
    settingsId: DEMO_SERVER_SETTINGS_ID,
    expectedPath: DEMO_SERVER_SETTINGS_EXPECTED_PATH,
    handleAvailable: true,
    unavailableReason: null,
    subscribed: true,
    readCount: 0,
    eventCount: 0,
    lastEventAt: null,
    lastEventStatus: null,
    schemaVersion: demoSettingsDefinition.version,
    current: null,
    ...overrides,
  };
}

describe("upstream server settings definition (#62 demo)", () => {
  it("is a host-scoped, versioned definition with schema defaults", () => {
    expect(demoSettingsDefinition.id).toBe("server-demo");
    expect(demoSettingsDefinition.scope).toBe("host");
    expect(demoSettingsDefinition.version).toBe(1);
    expect(DemoSettingsSchema.parse({})).toEqual({
      label: "upstream handle demo",
      enabled: true,
      threshold: 70,
    });
    expect(DemoSettingsSchema.safeParse({ threshold: 101 }).success).toBe(false);
  });
});

describe("buildServerSettingsSnapshot", () => {
  it("reports uninitialized before the first handle read", () => {
    const snapshot = buildServerSettingsSnapshot(observation());
    expect(snapshot.status).toBe("uninitialized");
    expect(snapshot.revision).toBe("missing");
    expect(snapshot.values).toBeNull();
    expect(snapshot.handleAvailable).toBe(true);
    expect(snapshot.subscribed).toBe(true);
  });

  it("projects a ready handle state with validated values", () => {
    const snapshot = buildServerSettingsSnapshot(
      observation({
        readCount: 3,
        eventCount: 2,
        lastEventAt: "2026-09-20T00:00:00.000Z",
        lastEventStatus: "ready",
        current: {
          status: "ready",
          revision: "abc123",
          values: { label: "from handle", enabled: false, threshold: 12 },
        },
      }),
    );
    expect(snapshot).toMatchObject({
      status: "ready",
      revision: "abc123",
      values: { label: "from handle", enabled: false, threshold: 12 },
      readCount: 3,
      eventCount: 2,
      lastEventStatus: "ready",
    });
    expect(snapshot.error).toBeNull();
  });

  it("propagates an invalid handle state", () => {
    const snapshot = buildServerSettingsSnapshot(
      observation({
        current: { status: "invalid", revision: "def456", error: "boom" },
      }),
    );
    expect(snapshot.status).toBe("invalid");
    expect(snapshot.revision).toBe("def456");
    expect(snapshot.error).toBe("boom");
    expect(snapshot.values).toBeNull();
  });

  it("flags a ready state whose values fail schema validation", () => {
    const snapshot = buildServerSettingsSnapshot(
      observation({
        current: {
          status: "ready",
          revision: "xyz",
          values: { label: "", enabled: true, threshold: 1000 },
        },
      }),
    );
    expect(snapshot.status).toBe("invalid");
    expect(snapshot.error).toBeTruthy();
  });

  it("surfaces an unavailable handle with its reason", () => {
    const snapshot = buildServerSettingsSnapshot(
      observation({ handleAvailable: false, unavailableReason: "older runtime" }),
    );
    expect(snapshot.handleAvailable).toBe(false);
    expect(snapshot.unavailableReason).toBe("older runtime");
    expect(snapshot.status).toBe("uninitialized");
  });
});

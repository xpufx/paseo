import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FleetModeSchema,
  EventClassSchema,
  EventClassActionSchema,
  coerceFleetMode,
  defaultEventClassPolicyByMode,
  uppidiFleetSettingsSchema,
  HookStatusOutputSchema,
} from "./contracts.js";

describe("Unified fleet control — FleetMode enum (#1034)", () => {
  it("accepts all four canonical modes", () => {
    assert.equal(FleetModeSchema.parse("RUN"), "RUN");
    assert.equal(FleetModeSchema.parse("DRAIN"), "DRAIN");
    assert.equal(FleetModeSchema.parse("HALT"), "HALT");
    assert.equal(FleetModeSchema.parse("STOP"), "STOP");
  });

  it("rejects unknown modes", () => {
    assert.throws(() => FleetModeSchema.parse("PAUSE"));
    assert.throws(() => FleetModeSchema.parse("TEARDOWN"));
    assert.throws(() => FleetModeSchema.parse("invalid"));
  });
});

describe("coerceFleetMode — HOLD → HALT alias (#1034 §4.3)", () => {
  it("passes through canonical modes unchanged", () => {
    assert.equal(coerceFleetMode("RUN"), "RUN");
    assert.equal(coerceFleetMode("DRAIN"), "DRAIN");
    assert.equal(coerceFleetMode("HALT"), "HALT");
    assert.equal(coerceFleetMode("STOP"), "STOP");
  });

  it("coerces HOLD to HALT (case-insensitive)", () => {
    assert.equal(coerceFleetMode("HOLD"), "HALT");
    assert.equal(coerceFleetMode("hold"), "HALT");
    assert.equal(coerceFleetMode("Hold"), "HALT");
  });

  it("falls back to RUN for unknown input instead of throwing", () => {
    assert.equal(coerceFleetMode("PAUSE"), "RUN");
    assert.equal(coerceFleetMode("teardown"), "RUN");
    assert.equal(coerceFleetMode(""), "RUN");
  });
});

describe("EventClass enum (#1034 §5.1)", () => {
  it("accepts all six event classes", () => {
    const expected = ["sos", "administrative", "health", "attention", "work", "noise"];
    for (const cls of expected) {
      assert.equal(EventClassSchema.parse(cls), cls);
    }
  });

  it("rejects unknown classes", () => {
    assert.throws(() => EventClassSchema.parse("debug"));
    assert.throws(() => EventClassSchema.parse("critical"));
  });
});

describe("EventClassAction enum", () => {
  it("accepts all four actions", () => {
    assert.equal(EventClassActionSchema.parse("deliver"), "deliver");
    assert.equal(EventClassActionSchema.parse("hold"), "hold");
    assert.equal(EventClassActionSchema.parse("detect"), "detect");
    assert.equal(EventClassActionSchema.parse("drop"), "drop");
  });

  it("rejects unknown actions", () => {
    assert.throws(() => EventClassActionSchema.parse("ignore"));
  });
});

describe("defaultEventClassPolicyByMode per-mode defaults (#1034 §5.2)", () => {
  it("has entries for all four modes", () => {
    assert.ok(defaultEventClassPolicyByMode.RUN);
    assert.ok(defaultEventClassPolicyByMode.DRAIN);
    assert.ok(defaultEventClassPolicyByMode.HALT);
    assert.ok(defaultEventClassPolicyByMode.STOP);
  });

  it("RUN: sos/administrative/attention deliver, health detect, work deliver, noise drop", () => {
    const p = defaultEventClassPolicyByMode.RUN;
    assert.equal(p.sos, "deliver");
    assert.equal(p.administrative, "deliver");
    assert.equal(p.attention, "deliver");
    assert.equal(p.health, "detect");
    assert.equal(p.work, "deliver");
    assert.equal(p.noise, "drop");
  });

  it("DRAIN: work held after snapshot, others same as RUN minus health remediate", () => {
    const p = defaultEventClassPolicyByMode.DRAIN;
    assert.equal(p.sos, "deliver");
    assert.equal(p.administrative, "deliver");
    assert.equal(p.attention, "deliver");
    assert.equal(p.health, "detect");
    assert.equal(p.work, "hold");
    assert.equal(p.noise, "drop");
  });

  it("HALT: identical to DRAIN on policy table", () => {
    const p = defaultEventClassPolicyByMode.HALT;
    assert.equal(p.sos, "deliver");
    assert.equal(p.administrative, "deliver");
    assert.equal(p.attention, "deliver");
    assert.equal(p.health, "detect");
    assert.equal(p.work, "hold");
    assert.equal(p.noise, "drop");
  });

  it("STOP: health drops (no detection possible when process down)", () => {
    const p = defaultEventClassPolicyByMode.STOP;
    assert.equal(p.sos, "deliver");
    assert.equal(p.administrative, "deliver");
    assert.equal(p.attention, "deliver");
    assert.equal(p.health, "drop");
    assert.equal(p.work, "hold");
    assert.equal(p.noise, "drop");
  });
});

describe("uppidiFleetSettingsSchema — mode and eventClassPolicy (#1034 §8.1)", () => {
  it("defaults mode to RUN", () => {
    const defaults = uppidiFleetSettingsSchema.parse({});
    assert.equal(defaults.mode, "RUN");
  });

  it("accepts explicit mode values", () => {
    const run = uppidiFleetSettingsSchema.parse({ mode: "RUN" });
    assert.equal(run.mode, "RUN");

    const halt = uppidiFleetSettingsSchema.parse({ mode: "HALT" });
    assert.equal(halt.mode, "HALT");

    const drain = uppidiFleetSettingsSchema.parse({ mode: "DRAIN" });
    assert.equal(drain.mode, "DRAIN");

    const stop = uppidiFleetSettingsSchema.parse({ mode: "STOP" });
    assert.equal(stop.mode, "STOP");
  });

  it("rejects invalid mode values", () => {
    assert.throws(() => uppidiFleetSettingsSchema.parse({ mode: "PAUSE" }));
    assert.throws(() => uppidiFleetSettingsSchema.parse({ mode: "HOLD" }));
  });

  it("defaults eventClassPolicy to undefined (absent)", () => {
    const defaults = uppidiFleetSettingsSchema.parse({});
    assert.equal(defaults.eventClassPolicy, undefined);
  });

  it("accepts explicit eventClassPolicy overrides", () => {
    const withPolicy = uppidiFleetSettingsSchema.parse({
      eventClassPolicy: {
        work: "hold",
        health: "detect",
      },
    });
    assert.deepEqual(withPolicy.eventClassPolicy, {
      work: "hold",
      health: "detect",
    });
  });

  it("validates that eventClassPolicy keys are valid EventClass values", () => {
    assert.throws(() =>
      uppidiFleetSettingsSchema.parse({
        eventClassPolicy: { debug: "drop" },
      }),
    );
  });

  it("preserves existing settings alongside new fields", () => {
    const combined = uppidiFleetSettingsSchema.parse({
      hookHost: "0.0.0.0",
      hookPort: 9000,
      enrolledRepos: ["xpufx-org/paseo"],
      pausedRepos: ["xpufx-org/other"],
      mode: "HALT",
      eventClassPolicy: { work: "hold" },
    });
    assert.equal(combined.hookHost, "0.0.0.0");
    assert.equal(combined.hookPort, 9000);
    assert.deepEqual(combined.enrolledRepos, ["xpufx-org/paseo"]);
    assert.deepEqual(combined.pausedRepos, ["xpufx-org/other"]);
    assert.equal(combined.mode, "HALT");
    assert.deepEqual(combined.eventClassPolicy, { work: "hold" });
  });
});

describe("HookStatusOutputSchema — mode + eventClassPolicy + derived halted (#1034 §8.2)", () => {
  it("defaults mode to RUN", () => {
    const minimal = HookStatusOutputSchema.parse({ ok: true });
    assert.equal(minimal.mode, "RUN");
  });

  it("accepts explicit mode in output", () => {
    const haltStatus = HookStatusOutputSchema.parse({
      ok: true,
      mode: "HALT",
    });
    assert.equal(haltStatus.mode, "HALT");

    const drainStatus = HookStatusOutputSchema.parse({
      ok: true,
      mode: "DRAIN",
    });
    assert.equal(drainStatus.mode, "DRAIN");
  });

  it("defaults eventClassPolicy to undefined in schema", () => {
    const minimal = HookStatusOutputSchema.parse({ ok: true });
    assert.equal(minimal.eventClassPolicy, undefined);
  });

  it("accepts explicit eventClassPolicy in output", () => {
    const status = HookStatusOutputSchema.parse({
      ok: true,
      eventClassPolicy: { work: "hold", health: "detect" },
    });
    assert.deepEqual(status.eventClassPolicy, { work: "hold", health: "detect" });
  });

  it("backward-compat: halted field is preserved independently", () => {
    const haltedStatus = HookStatusOutputSchema.parse({
      ok: true,
      halted: true,
    });
    assert.equal(haltedStatus.halted, true);

    const runningStatus = HookStatusOutputSchema.parse({
      ok: true,
      halted: false,
    });
    assert.equal(runningStatus.halted, false);
  });

  it("rejects invalid mode values", () => {
    assert.throws(() =>
      HookStatusOutputSchema.parse({ ok: true, mode: "PAUSE" }),
    );
  });
});

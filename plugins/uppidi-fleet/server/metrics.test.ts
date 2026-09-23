import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleUppidiFleetMetrics,
  loadFleetMetrics,
  BASELINE_CANDIDATES,
  DEFAULT_TASK_PROFILES,
} from "./metrics.js";

describe("Uppidi Fleet Capability & Benchmark Metrics (#373 / platform#18)", () => {
  it("loads baseline fleet benchmark metrics when no custom storage file exists", async () => {
    const data = await loadFleetMetrics();
    assert.ok(data.candidates.length >= 4, "Must have at least 4 candidate models");
    assert.deepEqual(data.taskProfiles, DEFAULT_TASK_PROFILES);
    assert.ok(data.totalEvaluatedTrials > 100, "Should have aggregate trial counts");
    assert.ok(data.privacyNotice.includes("platform#18 compliant"), "Must declare privacy boundary");
  });

  it("handles RPC request without filters returning all candidates", async () => {
    const res = await handleUppidiFleetMetrics({}, {} as any);
    assert.equal(res.ok, true);
    assert.equal(res.candidates.length, BASELINE_CANDIDATES.length);
    assert.ok(res.totalEvaluatedTrials > 0);
  });

  it("filters benchmark candidates by model", async () => {
    const res = await handleUppidiFleetMetrics({ model: "gemini-3.8-flash-low" }, {} as any);
    assert.equal(res.ok, true);
    assert.equal(res.candidates.length, 1);
    assert.equal(res.candidates[0].model, "gemini-3.8-flash-low");
    assert.equal(res.candidates[0].profiles.length, 4);
  });

  it("filters benchmark candidate task profiles", async () => {
    const res = await handleUppidiFleetMetrics({ taskProfile: "surgical-bugfix" }, {} as any);
    assert.equal(res.ok, true);
    assert.ok(res.candidates.length > 0);
    for (const c of res.candidates) {
      assert.equal(c.profiles.length, 1);
      assert.equal(c.profiles[0].taskProfile, "surgical-bugfix");
    }
  });

  it("ensures each task profile contains failure breakdown and advisory guidance", async () => {
    const data = await loadFleetMetrics();
    for (const c of data.candidates) {
      assert.ok(c.model.length > 0);
      assert.ok(c.recommendedRoles.length > 0);
      for (const p of c.profiles) {
        assert.ok(p.taskProfile.length > 0);
        assert.ok(p.advisory.length > 0);
        assert.ok(p.failureBreakdown !== undefined);
        assert.equal(typeof p.failureBreakdown.quota, "number");
        assert.equal(typeof p.failureBreakdown.timeout, "number");
        assert.equal(typeof p.failureBreakdown.toolFailure, "number");
        assert.equal(typeof p.failureBreakdown.checkFailure, "number");
      }
    }
  });
});

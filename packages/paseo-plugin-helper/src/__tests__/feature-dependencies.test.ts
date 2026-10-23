import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFeatureDependencies, validateFeatureDependencies } from "../shared/feature-dependencies.js";
import { resolveFeatureDependencies as resolveServer } from "../server/plugins.js";
import * as processModule from "../server/process.js";

describe("validateFeatureDependencies", () => {
  it("accepts a well-formed map", () => {
    expect(validateFeatureDependencies({ a: ["x", "y"] })).toEqual([]);
  });

  it("rejects non-object", () => {
    expect(validateFeatureDependencies(42 as any).length).toBeGreaterThan(0);
  });

  it("rejects non-array values", () => {
    expect(validateFeatureDependencies({ a: "x" as any }).length).toBeGreaterThan(0);
  });

  it("rejects empty module ids and duplicates", () => {
    const errs = validateFeatureDependencies({ a: ["", "x", "x"] });
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts from manifest-like object", () => {
    expect(validateFeatureDependencies({ dependencies: { a: ["x"] } })).toEqual([]);
  });
});

describe("resolveFeatureDependencies (shared)", () => {
  it("resolves against available features", () => {
    const r = resolveFeatureDependencies({ a: ["x"] }, { availableFeatures: { a: ["x", "y"] } });
    expect(r.satisfied).toBe(true);
    expect(r.missingFeatures).toEqual([]);
  });

  it("reports missing features", () => {
    const r = resolveFeatureDependencies({ a: ["z"] }, { a: ["x"] });
    expect(r.satisfied).toBe(false);
    expect(r.missingFeatures).toEqual([{ pluginId: "a", featureModuleIds: ["z"] }]);
  });

  it("positional available map works", () => {
    const r = resolveFeatureDependencies({ a: ["x"] }, new Map([["a", ["x"]]]));
    expect(r.satisfied).toBe(true);
  });
});

describe("resolveFeatureDependencies (server)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves running plugins", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ id: "top", enabled: true, status: "running" }]),
      stderr: "",
      signal: null,
      durationMs: 10,
    } as any);
    const r = await resolveServer({ top: ["m"] });
    expect(r.satisfied).toBe(true);
  });

  it("reports missing plugins", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([]),
      stderr: "",
      signal: null,
      durationMs: 10,
    } as any);
    const r = await resolveServer({ top: ["m"] });
    expect(r.satisfied).toBe(false);
    expect(r.missingPlugins).toEqual(["top"]);
  });

  it("accepts context-first ordering", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "top", status: "running", enabled: true }]);
    const ctx = { paseo: { plugins: { list } } };
    const r = await resolveServer(ctx as any, { top: ["m"] } as any);
    expect(r.satisfied).toBe(true);
  });
});

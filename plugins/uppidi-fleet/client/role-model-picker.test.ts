import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "surface.tsx"), "utf8");

describe("role model picker (#635)", () => {
  it("no longer cycles to an arbitrary next model", () => {
    // The defect: (available.indexOf(primary) + 1) % available.length — a control
    // whose effect the user could not see or choose.
    expect(src).not.toMatch(/indexOf\(cfg\.primaryModel\)\s*\+\s*1/);
    expect(src).not.toContain('label="Switch model"');
  });

  it("offers the daemon's real model list through a Select", () => {
    expect(src).toContain("options={roleModelOptions}");
    expect(src).toContain("onValueChange={(model) =>");
  });

  it("makes the no-op case visible instead of silently doing nothing", () => {
    // With one model there is nothing to switch to; the old button just did
    // nothing, which read as a broken control.
    expect(src).toContain("disabled={roleModelOptions.length < 2}");
  });

  it("does not fire a write when the chosen model is already active", () => {
    expect(src).toMatch(/if \(model !== cfg\.primaryModel\)/);
  });

  it("names the control for assistive tech without duplicating the role heading", () => {
    expect(src).toContain("label={`${roleKey} model`}");
  });

  it("deduplicates and sorts so the list does not reshuffle between polls", () => {
    expect(src).toContain("seen.has(name)");
    expect(src).toMatch(/localeCompare/);
  });

  it("tolerates a partial payload with no availableModels", () => {
    // #510: a stale payload can carry roles with no model list at all.
    expect(src).toContain("toList(roleModelsData?.availableModels)");
    expect(src).toContain("No models reported by the daemon.");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const surface = readFileSync(join(HERE, "surface.tsx"), "utf8");

const PRESETS = [
  "all",
  "needs-you",
  "needs-attention",
  "triage-review",
  "in-progress",
  "verify",
] as const;

describe("issue metrics bar (#645)", () => {
  it("exposes every preset as a filter, so removing the filter row lost nothing", () => {
    // The regression this guards: the filter row was deleted because its options
    // were "available on the top nice row" — but only three of the six were.
    for (const id of PRESETS) {
      // Three are wired by literal onPress; the three added in #645 are wired
      // through the EXTRA_METRIC_PRESETS map, so accept either form.
      const literal = surface.includes(`setFilter("${id}")`);
      const inMap = new RegExp(`id: "${id}"`).test(surface);
      expect(literal || inMap, `preset "${id}" must remain reachable from the bar`).toBe(true);
    }
  });

  it("no longer renders the separate filter-button row", () => {
    expect(surface).not.toContain("Action Bar & Filter Buttons");
    // The row mapped the preset list into buttons; the bar owns them now.
    expect(surface).not.toMatch(/issuePresetFilters\.map/);
  });

  it("keeps the repo indicator that shared the removed row", () => {
    // It was not a filter option, but it lived in the deleted row, so it had to
    // be carried over rather than dropped.
    expect(surface).toContain("All Repositories");
  });

  it("counts every preset in one place", () => {
    // Two copies of these predicates is how the bar and the row drifted apart.
    const memo = surface.match(/const presetCounts = useMemo/);
    expect(memo, "presetCounts memo must exist").not.toBeNull();
    for (const id of PRESETS) {
      expect(surface, `presetCounts must cover "${id}"`).toMatch(new RegExp(`["']?${id}["']?:`));
    }
  });
});

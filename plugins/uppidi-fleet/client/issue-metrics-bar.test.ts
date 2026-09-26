import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
      assert.ok(
        literal || inMap,
        `preset "${id}" must remain reachable from the bar`,
      );
    }
  });

  it("no longer renders the separate filter-button row", () => {
    assert.ok(
      !surface.includes("Action Bar & Filter Buttons"),
      "the deleted row must not come back",
    );
    // The row mapped the preset list into buttons; the bar owns them now.
    assert.ok(
      !/issuePresetFilters\.map/.test(surface),
      "the bar must not still map the old preset list",
    );
  });

  it("keeps the repo indicator that shared the removed row", () => {
    // It was not a filter option, but it lived in the deleted row, so it had to
    // be carried over rather than dropped.
    assert.ok(surface.includes("All Repositories"), "the repo indicator must survive the merge");
  });

  it("counts every preset in one place", () => {
    // Two copies of these predicates is how the bar and the row drifted apart.
    const memo = surface.match(/const presetCounts = useMemo/);
    assert.ok(memo, "presetCounts memo must exist");
    for (const id of PRESETS) {
      assert.ok(
        new RegExp(`["']?${id}["']?:`).test(surface),
        `presetCounts must cover "${id}"`,
      );
    }
  });
});

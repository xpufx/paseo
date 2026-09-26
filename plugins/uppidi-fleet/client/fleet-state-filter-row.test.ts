import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "tree-view.tsx"), "utf8");

describe("fleet state filter row folded into the header (#645 follow-up)", () => {
  it("no longer renders a separate state-filter row", () => {
    assert.ok(!src.includes("Filter and Search Bar"), "the deleted row must not come back");
    assert.ok(!src.includes('label: "All States"'), "the row's own filter label must be gone");
  });

  it("keeps every state reachable from the header", () => {
    for (const id of ["all", "working", "idle", "failed"]) {
      assert.ok(
        src.includes(`{ id: "${id}" as const`),
        `state "${id}" must remain filterable`,
      );
    }
    assert.ok(src.includes("setStateFilter(id)"), "the header chips must still drive the filter");
  });

  it("keeps the controls that shared the deleted row", () => {
    // These lived in the row that was removed, so they had to be carried over
    // rather than dropped along with the duplicate filters.
    assert.ok(src.includes("Collapse All"), "Collapse All must survive the merge");
    assert.ok(src.includes("handleBulkArchive"), "bulk archive must survive the merge");
    assert.ok(
      /<SearchInput[\s\S]{0,200}value=\{query\}/.test(src),
      "the search input must still be bound to query",
    );
  });

  it("does not narrow the idle filter's meaning when merging", () => {
    // The header badge said "Idle" and the button said "Idle / Sleeping".
    // Merging must keep the fuller label or the filter silently means less.
    assert.ok(src.includes('label: "Idle / Sleeping"'), "the fuller idle label must be kept");
  });

  it("still hides a zero Failed chip, as the badge did", () => {
    assert.ok(
      /count === 0 && id === "failed"/.test(src),
      "a zero Failed chip must stay hidden",
    );
  });
});

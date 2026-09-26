import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "tree-view.tsx"), "utf8");

describe("fleet state filter row folded into the header (#645 follow-up)", () => {
  it("no longer renders a separate state-filter row", () => {
    expect(src).not.toContain("Filter and Search Bar");
    expect(src).not.toContain('label: "All States"');
  });

  it("keeps every state reachable from the header", () => {
    for (const id of ["all", "working", "idle", "failed"]) {
      expect(src, `state "${id}" must remain filterable`).toContain(
        `{ id: "${id}" as const`,
      );
    }
    expect(src).toContain("setStateFilter(id)");
  });

  it("keeps the controls that shared the deleted row", () => {
    // These lived in the row that was removed, so they had to be carried over
    // rather than dropped along with the duplicate filters.
    expect(src).toContain("Collapse All");
    expect(src).toContain("handleBulkArchive");
    expect(src).toMatch(/<SearchInput[\s\S]{0,200}value=\{query\}/);
  });

  it("does not narrow the idle filter's meaning when merging", () => {
    // The header badge said "Idle" and the button said "Idle / Sleeping".
    // Merging must keep the fuller label or the filter silently means less.
    expect(src).toContain('label: "Idle / Sleeping"');
  });

  it("still hides a zero Failed chip, as the badge did", () => {
    expect(src).toMatch(/count === 0 && id === "failed"/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "tree-view.tsx"), "utf8");

describe("DenseAgentRow zebra striping (#628)", () => {
  it("alternates on sibling position, not on depth or agent id", () => {
    // Striping by depth would band whole subtrees together; striping by id would
    // be stable across reordering but has nothing to do with visual adjacency.
    expect(src).toMatch(/siblingIndex % 2 === 1/);
    expect(src).not.toMatch(/depth % 2/);
  });

  it("keeps hover winning over the stripe", () => {
    // A stripe that overrides hover makes the row feel broken on mouse-over.
    const block = src.slice(src.indexOf("siblingIndex % 2 === 1") - 400, src.indexOf("siblingIndex % 2 === 1") + 200);
    expect(block.indexOf("isHovered")).toBeLessThan(block.indexOf("siblingIndex % 2"));
  });

  it("stays theme-aware rather than hardcoding a light/dark value", () => {
    expect(src).toMatch(/alpha\?\.\(colors\.surface1/);
    // A literal rgba tint would be near-invisible in one of the two themes.
    expect(src).not.toMatch(/backgroundColor: "rgba\(255,255,255,0\.0\d"\),?\s*\n\s*siblingIndex/);
  });

  it("wires every DenseAgentRow call site to the sibling index", () => {
    const sites = src.match(/<DenseAgentRow/g)?.length ?? 0;
    const wired = src.match(/siblingIndex=\{idx\}/g)?.length ?? 0;
    expect(sites, "every row must receive its sibling index").toBe(wired);
    expect(sites).toBeGreaterThan(0);
  });
});

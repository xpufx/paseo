import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "tree-view.tsx"), "utf8");

const STRIPE = "siblingIndex % 2 === 1";

describe("DenseAgentRow zebra striping (#628)", () => {
  it("alternates on sibling position, not on depth or agent id", () => {
    // Striping by depth would band whole subtrees together; striping by id would
    // be stable across reordering but has nothing to do with visual adjacency.
    assert.ok(new RegExp(STRIPE).test(src), "the stripe must key off the sibling index");
    assert.ok(!/depth % 2/.test(src), "the stripe must not key off depth");
  });

  it("keeps hover winning over the stripe", () => {
    // A stripe that overrides hover makes the row feel broken on mouse-over.
    const block = src.slice(src.indexOf(STRIPE) - 400, src.indexOf(STRIPE) + 200);
    assert.ok(
      block.indexOf("isHovered") < block.indexOf("siblingIndex % 2"),
      "isHovered must be decided before the stripe",
    );
  });

  it("stays theme-aware rather than hardcoding a light/dark value", () => {
    assert.ok(
      /alpha\?\.\(colors\.surface1/.test(src),
      "the stripe tint must come from the theme",
    );
    // A literal rgba tint would be near-invisible in one of the two themes.
    assert.ok(
      !/backgroundColor: "rgba\(255,255,255,0\.0\d"\),?\s*\n\s*siblingIndex/.test(src),
      "a hardcoded rgba tint must not sit next to the stripe",
    );
  });

  it("wires every DenseAgentRow call site to the sibling index", () => {
    const sites = src.match(/<DenseAgentRow/g)?.length ?? 0;
    const wired = src.match(/siblingIndex=\{idx\}/g)?.length ?? 0;
    assert.ok(sites > 0, "there must be at least one DenseAgentRow call site");
    assert.equal(wired, sites, "every row must receive its sibling index");
  });
});

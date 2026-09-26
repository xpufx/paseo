import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "surface.tsx"), "utf8");

describe("role model picker (#635)", () => {
  it("no longer cycles to an arbitrary next model", () => {
    // The defect: (available.indexOf(primary) + 1) % available.length — a control
    // whose effect the user could not see or choose.
    assert.ok(
      !/indexOf\(cfg\.primaryModel\)\s*\+\s*1/.test(src),
      "the arbitrary indexOf+1 cycle must not come back",
    );
    assert.ok(!src.includes('label="Switch model"'), "the opaque Switch model button must be gone");
  });

  it("offers the daemon's real model list through a Select", () => {
    assert.ok(src.includes("options={roleModelOptions}"), "the Select must use the daemon's list");
    assert.ok(src.includes("onValueChange={(model) =>"), "the Select must drive the change");
  });

  it("makes the no-op case visible instead of silently doing nothing", () => {
    // With one model there is nothing to switch to; the old button just did
    // nothing, which read as a broken control.
    assert.ok(
      src.includes("disabled={roleModelOptions.length < 2}"),
      "a one-model daemon must disable the control visibly",
    );
  });

  it("does not fire a write when the chosen model is already active", () => {
    assert.ok(
      /if \(model !== cfg\.primaryModel\)/.test(src),
      "the write must be guarded on a real change",
    );
  });

  it("names the control for assistive tech without duplicating the role heading", () => {
    assert.ok(src.includes("label={`${roleKey} model`}"), "the Select needs its own label");
  });

  it("deduplicates and sorts so the list does not reshuffle between polls", () => {
    assert.ok(src.includes("seen.has(name)"), "the list must deduplicate");
    assert.ok(/localeCompare/.test(src), "the list must be sorted");
  });

  it("tolerates a partial payload with no availableModels", () => {
    // #510: a stale payload can carry roles with no model list at all.
    assert.ok(
      src.includes("toList(roleModelsData?.availableModels)"),
      "a missing model list must not throw",
    );
    assert.ok(
      src.includes("No models reported by the daemon."),
      "the empty state must be explained",
    );
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const tree = readFileSync(join(HERE, "tree-view.tsx"), "utf8");
const surface = readFileSync(join(HERE, "surface.tsx"), "utf8");

/**
 * The operator rejected the first version of the Agents and Fleet state bar for
 * not *looking* like the work-queue one. Matching by eye is exactly how it
 * drifted in the first place, so the shared values are pinned here and the
 * second file is read to prove the two really are the same numbers.
 */

function barStyle(source: string): string {
  const at = source.indexOf('backgroundColor: colors.surface1 ?? "rgba(255,255,255,0.03)"');
  expect(at, "the metrics bar container must exist").toBeGreaterThan(-1);
  return source.slice(at - 260, at + 320);
}

describe("fleet state bar matches the work-queue metrics bar (#645)", () => {
  it("uses the same container fill, border, radius and padding", () => {
    const a = barStyle(tree);
    const b = barStyle(surface);
    for (const token of [
      'backgroundColor: colors.surface1 ?? "rgba(255,255,255,0.03)"',
      "paddingHorizontal: 6",
      "paddingVertical: 4",
      "borderRadius: 6",
      "borderWidth: 1",
      'borderColor: colors.border ?? "transparent"',
    ]) {
      expect(a, `fleet bar is missing ${token}`).toContain(token);
      expect(b, `queue bar is missing ${token}`).toContain(token);
    }
  });

  it("uses the same chip anatomy: icon, muted label, bold count", () => {
    // A Badge is not the same as icon + two Texts. That difference is what the
    // operator pointed at.
    expect(tree).not.toMatch(/<Badge[\s\S]{0,200}count === 0 && id === "failed"/);
    for (const token of [
      "<Icon name={icon} size={13}",
      "fontSize: 11",
      'fontWeight: "700", fontSize: 12',
      "paddingHorizontal: 8",
      "paddingVertical: 3",
      "pressedOpacity={0.7}",
    ]) {
      expect(tree, `fleet chip is missing ${token}`).toContain(token);
    }
  });

  it("keeps every state filter and every surviving control in the bar", () => {
    for (const id of ["all", "working", "idle", "failed"]) {
      expect(tree).toContain(`{ id: "${id}" as const`);
    }
    expect(tree).toContain("setStateFilter(id)");
    expect(tree).toContain("Collapse All");
    expect(tree).toContain("handleBulkArchive");
    expect(tree).toMatch(/<SearchInput[\s\S]{0,200}value=\{query\}/);
  });

  it("still hides a zero Failed chip", () => {
    expect(tree).toMatch(/count === 0 && id === "failed"/);
  });
});

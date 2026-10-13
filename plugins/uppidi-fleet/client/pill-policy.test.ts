/**
 * Pill segregation policy for agent rows (#1192).
 *
 * Asserts that secondary metadata pills live exclusively in the expandable
 * sub-drawer (`AgentInventoryDrawer`) while the default row keeps only the
 * approved identity-anchor cluster and primary badges.
 *
 * The contract:
 *   Default Row (Orchestrator):
 *     [Status Light + Icon + Title Link] [State Badge] [Optional Main Dirty Warning] [Archive Btn]
 *   Default Row (Worker):
 *     [Status Light + Icon + Title Link] [#Issue Badge] [State Badge] [Archive Btn]
 *   Sub Row Drawer:
 *     shortId, role/category, model, worktree, parentage ("via …"), custom labels
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "tree-view.tsx"), "utf8");

/** Extract a function body by finding the next top-level `export function` after start. */
function extractFnBody(fnName: string): string {
  const start = src.indexOf(`export function ${fnName}`);
  if (start === -1) return "";
  // Search for the next export function starting AFTER this one's name
  const afterName = src.indexOf("export function", start + fnName.length + 9);
  if (afterName === -1) return src.slice(start);
  return src.slice(start, afterName);
}

// --- AgentInventoryDrawer must exist and collect secondary pills ---

describe("AgentInventoryDrawer exists (#1192)", () => {
  it("exports an AgentInventoryDrawer component", () => {
    assert.ok(
      /export\s+function\s+AgentInventoryDrawer/.test(src),
      "AgentInventoryDrawer must be exported",
    );
  });

  it("gathers shortId into the drawer pills array", () => {
    const body = extractFnBody("AgentInventoryDrawer");
    assert.ok(body.length > 0, "AgentInventoryDrawer function must exist");
    assert.ok(
      /pills\.push\(\{[^}]*shortId/.test(body),
      "shortId must be pushed into the pills array",
    );
  });

  it("gathers category into the drawer pills array", () => {
    const body = extractFnBody("AgentInventoryDrawer");
    assert.ok(
      /categoryLabel/.test(body),
      "category label must be gathered into the drawer",
    );
  });

  it("gathers model into the drawer pills array", () => {
    const body = extractFnBody("AgentInventoryDrawer");
    assert.ok(
      /pills\.push\(\{[^}]*model/.test(body),
      "model must be pushed into the pills array",
    );
  });

  it("gathers worktree into the drawer pills array", () => {
    const body = extractFnBody("AgentInventoryDrawer");
    assert.ok(
      /pills\.push\(\{[^}]*worktree/.test(body),
      "worktree must be pushed into the pills array",
    );
  });

  it("includes ParentAgentPill inside the drawer content", () => {
    const body = extractFnBody("AgentInventoryDrawer");
    assert.ok(
      /ParentAgentPill/.test(body),
      "ParentAgentPill must render inside the drawer",
    );
  });

  it("includes AgentLabelsRow inside the drawer content", () => {
    const body = extractFnBody("AgentInventoryDrawer");
    assert.ok(
      /AgentLabelsRow/.test(body),
      "AgentLabelsRow must render inside the drawer",
    );
  });
});

// --- DenseAgentRow: default row pills check ---

describe("DenseAgentRow default row pill policy (#1192)", () => {
  it("keeps #Issue badge on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    assert.ok(
      /attributedWork\?\.issue/.test(body),
      "#Issue badge must remain on the default row",
    );
  });

  it("keeps State badge on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    assert.ok(
      /deterministicState.*stateDetail/.test(body),
      "State badge must remain on the default row",
    );
  });

  it("keeps Archive button on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    assert.ok(
      /icon="Archive"/.test(body),
      "Archive button must remain on the default row",
    );
  });

  it("does NOT put shortId badge directly on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/<Badge[\s\S]*?agent\.shortId/.test(beforeDrawer),
      "shortId badge must not appear on the default row (before the drawer)",
    );
  });

  it("does NOT put category badge directly on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/<Badge[\s\S]*?agent\.category/.test(beforeDrawer),
      "category badge must not appear on the default row (before the drawer)",
    );
  });

  it("does NOT put ParentAgentPill directly on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/ParentAgentPill/.test(beforeDrawer),
      "ParentAgentPill must not appear on the default row (before the drawer)",
    );
  });

  it("does NOT put AgentLabelsRow directly on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/AgentLabelsRow/.test(beforeDrawer),
      "AgentLabelsRow must not appear on the default row (before the drawer)",
    );
  });

  it("renders AgentInventoryDrawer on the default row", () => {
    const body = extractFnBody("DenseAgentRow");
    assert.ok(
      /<AgentInventoryDrawer/.test(body),
      "AgentInventoryDrawer must be rendered within DenseAgentRow",
    );
  });

  it("uses wrap={false} on the identity anchor cluster", () => {
    const body = extractFnBody("DenseAgentRow");
    assert.ok(
      /wrap=\{false\}/.test(body),
      "the identity anchor Row must use wrap={false}",
    );
  });
});

// --- OrchestratorRow: default row pills check ---

describe("OrchestratorRow default row pill policy (#1192)", () => {
  it("keeps State badge on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    assert.ok(
      /deterministicState.*stateDetail/.test(body),
      "State badge must remain on the default row",
    );
  });

  it("keeps Archive button on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    assert.ok(
      /icon="Archive"/.test(body),
      "Archive button must remain on the default row",
    );
  });

  it("keeps optional Main Dirty warning on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    assert.ok(
      /isMainDirty/.test(body),
      "Main Dirty warning must remain on the default row",
    );
  });

  it("does NOT put shortId badge directly on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/<Badge[\s\S]*?agent\.shortId/.test(beforeDrawer),
      "shortId badge must not appear on the default row (before the drawer)",
    );
  });

  it("does NOT put 'Orchestrator' label badge directly on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/<Badge[\s\S]*?label=\{"Orchestrator"\}/.test(beforeDrawer),
      "'Orchestrator' badge must not appear on the default row (before the drawer)",
    );
  });

  it("does NOT put ParentAgentPill directly on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/ParentAgentPill/.test(beforeDrawer),
      "ParentAgentPill must not appear on the default row (before the drawer)",
    );
  });

  it("does NOT put AgentLabelsRow directly on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    const drawerIdx = body.indexOf("AgentInventoryDrawer");
    const beforeDrawer = body.slice(0, drawerIdx);
    assert.ok(
      !/AgentLabelsRow/.test(beforeDrawer),
      "AgentLabelsRow must not appear on the default row (before the drawer)",
    );
  });

  it("renders AgentInventoryDrawer on the default row", () => {
    const body = extractFnBody("OrchestratorRow");
    assert.ok(
      /<AgentInventoryDrawer/.test(body),
      "AgentInventoryDrawer must be rendered within OrchestratorRow",
    );
  });

  it("uses wrap={false} on the identity anchor cluster", () => {
    const body = extractFnBody("OrchestratorRow");
    assert.ok(
      /wrap=\{false\}/.test(body),
      "the identity anchor Row must use wrap={false}",
    );
  });
});

// --- Cross-cutting: verify no stray pills in the tree-view row components ---
//
// We scope the check to the three row components (DenseAgentRow,
// OrchestratorRow, AgentInventoryDrawer) only.  FrontDeskHero has its own
// hero-card layout and is intentionally excluded.

describe("Row-component pill segregation (#1192)", () => {
  /**
   * Concatenate the bodies of DenseAgentRow and OrchestratorRow only.
   * This is the surface where the default-row-vs-sub-drawer contract applies.
   */
  function rowComponentScope(): string {
    return extractFnBody("DenseAgentRow") + extractFnBody("OrchestratorRow");
  }

  it("no loose shortId <Badge> in row components", () => {
    const scope = rowComponentScope();
    assert.ok(
      !/<Badge[\s\S]{0,120}agent\.shortId/.test(scope),
      "shortId must not be rendered as a standalone Badge in row components",
    );
  });

  it("no loose category <Badge> in row components", () => {
    const scope = rowComponentScope();
    assert.ok(
      !/<Badge[\s\S]{0,120}agent\.category/.test(scope),
      "category must not be rendered as a standalone Badge in row components",
    );
  });

  it("no loose model <Badge> in row components", () => {
    const scope = rowComponentScope();
    assert.ok(
      !/<Badge[\s\S]{0,120}agent\.model/.test(scope),
      "model must not be rendered as a standalone Badge in row components",
    );
  });

  it("no loose worktree <Badge> in row components", () => {
    const scope = rowComponentScope();
    assert.ok(
      !/<Badge[\s\S]{0,120}worktree\b/.test(scope),
      "worktree must not be rendered as a standalone Badge in row components",
    );
  });

  it("ParentAgentPill only renders inside AgentInventoryDrawer in row components", () => {
    const body = extractFnBody("DenseAgentRow") + extractFnBody("OrchestratorRow");
    // Count occurrences outside AgentInventoryDrawer
    const invStart = body.indexOf("AgentInventoryDrawer");
    const beforeInv = body.slice(0, invStart);
    assert.equal(
      (beforeInv.match(/ParentAgentPill/g) || []).length,
      0,
      "ParentAgentPill must not appear before AgentInventoryDrawer in row components",
    );
  });

  it("AgentLabelsRow only renders inside AgentInventoryDrawer in row components", () => {
    const body = extractFnBody("DenseAgentRow") + extractFnBody("OrchestratorRow");
    const invStart = body.indexOf("AgentInventoryDrawer");
    const beforeInv = body.slice(0, invStart);
    assert.equal(
      (beforeInv.match(/AgentLabelsRow/g) || []).length,
      0,
      "AgentLabelsRow must not appear before AgentInventoryDrawer in row components",
    );
  });
});

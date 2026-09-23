import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("uppidi-forge client entry contract", () => {
  it("verifies index.client.tsx registers workspace panel via client.addWorkspacePanel()", () => {
    const entryPath = path.resolve(__dirname, "../index.client.tsx");
    assert.ok(fs.existsSync(entryPath), "index.client.tsx must exist");
    const source = fs.readFileSync(entryPath, "utf8");

    assert.match(
      source,
      /initClientHelpers\s*\(\s*\{[\s\S]*\}\s*\)/,
      "index.client.tsx must call initClientHelpers() before registering surfaces",
    );

    assert.match(
      source,
      /client\.addWorkspacePanel\s*\(\s*\{[\s\S]*id:\s*["']uppidi-forge["'][\s\S]*\}\s*\)/,
      "index.client.tsx must register workspace panel using client.addWorkspacePanel() with id 'uppidi-forge'",
    );

    assert.match(
      source,
      /context:\s*["']workspace["']/,
      "workspace panel must specify context 'workspace'",
    );

    assert.match(
      source,
      /title:\s*["']Uppidi Forge["']/,
      "workspace panel must specify title 'Uppidi Forge'",
    );

    assert.match(
      source,
      /icon:\s*["']GitPullRequest["']/,
      "workspace panel must specify icon 'GitPullRequest'",
    );
  });

  it("verifies client/index.ts exports panel and registerWorkspacePanel helper", () => {
    const indexPath = path.resolve(__dirname, "index.ts");
    assert.ok(fs.existsSync(indexPath), "client/index.ts must exist");
    const source = fs.readFileSync(indexPath, "utf8");

    assert.match(
      source,
      /export\s+\*\s+from\s+["']\.\/panel\.js["']/,
      "client/index.ts must export from panel.js",
    );

    const panelPath = path.resolve(__dirname, "panel.tsx");
    assert.ok(fs.existsSync(panelPath), "client/panel.tsx must exist");
    const panelSource = fs.readFileSync(panelPath, "utf8");

    assert.match(
      panelSource,
      /export\s+function\s+UppidiForgePanel/,
      "client/panel.tsx must export UppidiForgePanel",
    );

    assert.match(
      panelSource,
      /client\.addWorkspacePanel\s*\(\s*\{[\s\S]*id:\s*["']uppidi-forge["'][\s\S]*\}\s*\)/,
      "registerWorkspacePanel must invoke client.addWorkspacePanel() with id 'uppidi-forge'",
    );
  });

  it("verifies client/tree-view.tsx defines getParentBadgeLabel and ParentAgentPill (#430)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    assert.match(
      source,
      /export\s+function\s+getParentBadgeLabel\s*\(/,
      "tree-view.tsx must export getParentBadgeLabel",
    );

    assert.match(
      source,
      /export\s+function\s+ParentAgentPill\s*\(/,
      "tree-view.tsx must export ParentAgentPill",
    );

    assert.match(
      source,
      /<ParentAgentPill\s+agent=\{agent\}\s+navigation=\{navigation\}\s*\/>/,
      "OrchestratorRow and DenseAgentRow must render ParentAgentPill",
    );
  });

  it("verifies AgentStatusLight renders floating tooltip with agent name on hover (#410)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    // 1. Component exports
    assert.match(
      source,
      /export\s+function\s+AgentStatusLight\s*\(/,
      "tree-view.tsx must export AgentStatusLight",
    );
    assert.match(
      source,
      /export\s+function\s+AgentStatusLightsRow\s*\(/,
      "tree-view.tsx must export AgentStatusLightsRow",
    );

    // 2. Interactive hover tracking and conditional floating tooltip rendering
    assert.match(
      source,
      /onMouseEnter=\{[^{}]*setHovered\(true\)[^{}]*\}/,
      "AgentStatusLight must handle onMouseEnter to set hovered state",
    );
    assert.match(
      source,
      /onMouseLeave=\{[^{}]*setHovered\(false\)[^{}]*\}/,
      "AgentStatusLight must handle onMouseLeave to reset hovered state",
    );
    assert.match(
      source,
      /hovered\s*&&\s*\(/,
      "AgentStatusLight must conditionally render floating tooltip when hovered is true",
    );

    // 3. Floating tooltip displays agent name and status detail
    assert.match(
      source,
      /testID="agent-status-light-tooltip"/,
      "AgentStatusLight floating tooltip must have testID for status light tooltip",
    );
    assert.match(
      source,
      /\{\s*agent\.name\s*\}/,
      "AgentStatusLight tooltip must display agent.name",
    );
    assert.match(
      source,
      /\{\s*statusDetail\s*\}|\{\s*statusText\s*\}/,
      "AgentStatusLight tooltip must display status detail",
    );

    // 4. Secure tooltip positioning and styling attributes
    assert.match(
      source,
      /position:\s*["']absolute["']/,
      "tooltip must have absolute positioning",
    );
    assert.match(
      source,
      /zIndex:\s*100/,
      "tooltip must specify zIndex: 100",
    );
    assert.match(
      source,
      /pointerEvents:\s*["']none["']/,
      "tooltip must specify pointerEvents: none to avoid hover jitter",
    );
    assert.match(
      source,
      /whiteSpace:\s*["']nowrap["']/,
      "tooltip must specify whiteSpace: nowrap",
    );
    assert.match(
      source,
      /borderRadius:\s*(?:9999|\d+)/,
      "tooltip must have compact rounded pill style",
    );
    assert.match(
      source,
      /shadowColor:\s*["']#000["']|shadowOpacity:/,
      "tooltip must have shadow or border styling",
    );

    // 5. Retains native title and accessibilityLabel
    assert.match(
      source,
      /title=\{tooltip\}/,
      "AgentStatusLight must keep native title tooltip",
    );
    assert.match(
      source,
      /accessibilityLabel=\{tooltip\}/,
      "AgentStatusLight must keep native accessibilityLabel",
    );

    // 6. Overflow visible on row containers
    assert.match(
      source,
      /overflow:\s*["']visible["']/,
      "AgentStatusLightsRow must ensure overflow: visible to prevent clipping floating tooltips",
    );
  });
});

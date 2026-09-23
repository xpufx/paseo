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
});

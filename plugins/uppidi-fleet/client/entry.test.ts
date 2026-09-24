import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("uppidi-fleet client entry contract", () => {
  it("verifies index.client.tsx registers sidebar surface and workspace panel via helper and client", () => {
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
      /registerSidebarSurface\s*\(\s*client,\s*\{[\s\S]*id:\s*["']uppidi-fleet["'][\s\S]*\}\s*\)/,
      "index.client.tsx must register sidebar surface using registerSidebarSurface() with id 'uppidi-fleet'",
    );

    assert.match(
      source,
      /client\.addWorkspacePanel\s*\(\s*\{[\s\S]*id:\s*["']uppidi-fleet["'][\s\S]*\}\s*\)/,
      "index.client.tsx must register workspace panel using client.addWorkspacePanel() with id 'uppidi-fleet'",
    );

    assert.match(
      source,
      /context:\s*["']workspace["']/,
      "workspace panel must specify context 'workspace'",
    );

    assert.match(
      source,
      /title:\s*["']Uppidi Fleet["']/,
      "workspace panel must specify title 'Uppidi Fleet'",
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
      /export\s+function\s+UppidiFleetPanel/,
      "client/panel.tsx must export UppidiFleetPanel",
    );

    assert.match(
      panelSource,
      /export\s+const\s+UppidiForgePanel/,
      "client/panel.tsx must export UppidiForgePanel alias",
    );

    assert.match(
      panelSource,
      /client\.addWorkspacePanel\s*\(\s*\{[\s\S]*id:\s*["']uppidi-fleet["'][\s\S]*\}\s*\)/,
      "registerWorkspacePanel must invoke client.addWorkspacePanel() with id 'uppidi-fleet'",
    );
  });

  it("verifies client/tree-view.tsx exports AgentLabelsRow and getDisplayableAgentLabels (#447)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    assert.match(
      source,
      /export\s+function\s+getDisplayableAgentLabels/,
      "client/tree-view.tsx must export getDisplayableAgentLabels"
    );
    assert.match(
      source,
      /export\s+function\s+AgentLabelsRow/,
      "client/tree-view.tsx must export AgentLabelsRow"
    );
    assert.match(
      source,
      /<AgentLabelsRow\s+agent=\{agent\}\s*\/>/,
      "client/tree-view.tsx must render AgentLabelsRow for agents"
    );
  });

  it("verifies client/tree-view.tsx renders main dirty indicator badge on orchestrator row (#450)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    assert.match(
      source,
      /agent\.isMainDirty/,
      "client/tree-view.tsx must check agent.isMainDirty"
    );
    assert.match(
      source,
      /Main Dirty/,
      "client/tree-view.tsx must render Main Dirty badge label"
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

  describe("Cockpit density, unified header, and modal selection (#425, #424)", () => {
    const surfacePath = path.resolve(__dirname, "surface.tsx");
    const surfaceSource = fs.readFileSync(surfacePath, "utf8");

    it("verifies default navigation tab is tree and tab ordering (#425)", () => {
      // 1. Default activeTab is 'tree'
      assert.match(
        surfaceSource,
        /useState<SurfaceTab>\(\s*["']tree["']\s*\)/,
        "default activeTab must be 'tree'",
      );

      // 2. Tab order: tree first, then dashboard, then mockup
      assert.match(
        surfaceSource,
        /id:\s*["']tree["'][\s\S]*id:\s*["']dashboard["'][\s\S]*id:\s*["']mockup["']/,
        "tabs order must be tree, dashboard, mockup",
      );

      // 3. Tab labels
      assert.match(
        surfaceSource,
        /label:\s*["']Agents & Fleet["']/,
        "tree tab must have label 'Agents & Fleet'",
      );
      assert.match(
        surfaceSource,
        /label:\s*["']Work Queue["']/,
        "dashboard tab must have label 'Work Queue'",
      );
    });

    it("verifies density state and localStorage persistence (#425)", () => {
      assert.match(
        surfaceSource,
        /export\s+const\s+DENSITY_STORAGE_KEY\s*=\s*["']uppidi-fleet-density["']/,
        "must define DENSITY_STORAGE_KEY as 'uppidi-fleet-density'",
      );
      assert.match(
        surfaceSource,
        /export\s+function\s+getStoredDensity\(\)/,
        "must export getStoredDensity helper",
      );
      assert.match(
        surfaceSource,
        /export\s+function\s+setStoredDensity\(/,
        "must export setStoredDensity helper",
      );
      assert.match(
        surfaceSource,
        /useState<SurfaceDensity>\(getStoredDensity\)/,
        "must initialize density state using getStoredDensity()",
      );
    });

    it("verifies single unified router status badge in header bar (#464)", () => {
      assert.match(
        surfaceSource,
        /export\s+function\s+resolveRouterStatusBadge\s*\(/,
        "surface.tsx must export resolveRouterStatusBadge helper",
      );
      assert.match(
        surfaceSource,
        /<UppidiTopHeaderBar[\s\S]*isConnected=\{isConnected\}[\s\S]*isServiceRunning=\{isServiceRunning\}/,
        "surface.tsx must pass both router flags to UppidiTopHeaderBar",
      );

      // The header renders exactly one router badge driven by the resolved status.
      assert.match(
        surfaceSource,
        /const\s+routerBadge\s*=\s*resolveRouterStatusBadge\(isConnected,\s*isServiceRunning\)/,
        "UppidiTopHeaderBar must derive a single routerBadge from resolveRouterStatusBadge",
      );
      assert.match(
        surfaceSource,
        /label=\{routerBadge\.label\}[\s\S]*variant=\{routerBadge\.variant\}/,
        "UppidiTopHeaderBar must render the single unified router Badge from routerBadge",
      );

      // Legacy contradictory badges must be gone.
      assert.doesNotMatch(
        surfaceSource,
        /Router Connected/,
        "must not render legacy 'Router Connected' badge",
      );
      assert.doesNotMatch(
        surfaceSource,
        /label=["']Router active["']/,
        "must not render redundant 'Router active' badge",
      );

      // Coherent labels for each state.
      assert.match(surfaceSource, /label:\s*["']Router Active["']/, "connected state label must be 'Router Active'");
      assert.match(surfaceSource, /label:\s*["']Router Starting["']/, "degraded state label must be 'Router Starting'");
      assert.match(surfaceSource, /label:\s*["']Router Disconnected["']/, "offline state label must be 'Router Disconnected'");
    });

    it("verifies compact unified top header bar (#424)", () => {
      assert.match(
        surfaceSource,
        /export\s+function\s+UppidiTopHeaderBar/,
        "must export UppidiTopHeaderBar component",
      );
      assert.match(
        surfaceSource,
        /<UppidiBrandMark\s+size=\{density\s*===\s*["']dense["']\s*\?\s*18\s*:\s*20\}/,
        "UppidiTopHeaderBar must render compact brand mark",
      );
      assert.match(
        surfaceSource,
        /label=["']Dense["'][\s\S]*label=["']Standard["']/,
        "UppidiTopHeaderBar must render Dense and Standard density selector buttons",
      );
      assert.match(
        surfaceSource,
        /<Select[\s\S]*value=\{selectedRepo\}[\s\S]*options=\{repoOptions\}/,
        "UppidiTopHeaderBar must render global repository Select dropdown",
      );
    });

    it("verifies workspace dropdown selector renders on desktop viewports (#449)", () => {
      assert.match(
        surfaceSource,
        /selectedWorkspace\?:\s*string/,
        "UppidiTopHeaderBarProps must define selectedWorkspace",
      );
      assert.match(
        surfaceSource,
        /workspaceOptions\?:\s*SelectOption\[\]/,
        "UppidiTopHeaderBarProps must define workspaceOptions",
      );
      assert.match(
        surfaceSource,
        /onWorkspaceChange\?:\s*\(workspace:\s*string\)\s*=>\s*void/,
        "UppidiTopHeaderBarProps must define onWorkspaceChange",
      );
      assert.match(
        surfaceSource,
        /<Select[\s\S]*value=\{selectedWorkspace\}[\s\S]*options=\{workspaceOptions\}[\s\S]*onValueChange=\{onWorkspaceChange\}/,
        "UppidiTopHeaderBar must render workspace Select dropdown selector alongside repo selector",
      );
      assert.match(
        surfaceSource,
        /<UppidiTopHeaderBar[\s\S]*selectedWorkspace=\{selectedWorkspace\}[\s\S]*workspaceOptions=\{workspaceOptions\}[\s\S]*onWorkspaceChange=\{handleWorkspaceChange\}/,
        "UppidiFleetSurface must pass workspace options and selection handlers to UppidiTopHeaderBar",
      );
      assert.match(
        surfaceSource,
        /<UppidiFleetTreeView[\s\S]*selectedWorkspace=\{selectedWorkspace\}/,
        "UppidiFleetSurface must wire selectedWorkspace to UppidiFleetTreeView",
      );
    });

    it("verifies dense metrics bar strip (#424)", () => {
      // Must contain all 4 key metrics in horizontal strip
      assert.match(
        surfaceSource,
        /Open issues:/,
        "dense metrics bar must include 'Open issues:'",
      );
      assert.match(
        surfaceSource,
        /Needs your attention:/,
        "dense metrics bar must include 'Needs your attention:'",
      );
      assert.match(
        surfaceSource,
        /Awaiting review:/,
        "dense metrics bar must include 'Awaiting review:'",
      );
      assert.match(
        surfaceSource,
        /Hook queued:/,
        "dense metrics bar must include 'Hook queued:'",
      );

      // Must support click-to-filter
      assert.match(
        surfaceSource,
        /setFilter\(\s*["']needs-attention["']\s*\)/,
        "dense metrics bar must support click-to-filter for needs-attention",
      );
      assert.match(
        surfaceSource,
        /setFilter\(\s*["']triage-review["']\s*\)/,
        "dense metrics bar must support click-to-filter for triage-review",
      );
    });

    it("verifies center modal for selected work and full-width work queue (#425)", () => {
      // 1. Full-width work queue card (no Grid columns={3} side-split)
      assert.doesNotMatch(
        surfaceSource,
        /<Grid\s+columns=\{3\}[^>]*>\s*<Stack[^>]*>\s*<Card[^>]*>\s*<CardHeader[^>]*title=["']Work queue["']/,
        "must not use 3-column side-split pane for work queue and selected work",
      );

      assert.match(
        surfaceSource,
        /<Card\s+variant=["']elevated["']\s+style=\{\{\s*width:\s*["']100%["']\s*\}\}>/,
        "Work queue Card must take 100% full width",
      );

      // 2. Selected work opens in centered Modal with ModalContent size='large'
      assert.match(
        surfaceSource,
        /<Modal[\s\S]*open=\{selectedNumber\s*!==\s*null\}[\s\S]*<ModalContent\s+size=["']large["']>/,
        "selected work must open in centered Modal with ModalContent size='large'",
      );

      // 3. Modal contains key actions and branch info
      assert.match(
        surfaceSource,
        /label=["']Dispatch Worktree["']/,
        "modal must render Dispatch Worktree action button",
      );
      assert.match(
        surfaceSource,
        /label=["']Close["'][\s\S]*setSelectedNumber\(null\)/,
        "modal must render Close button that sets selectedNumber to null",
      );
      assert.match(
        surfaceSource,
        /label=["']Worktree branch["']/,
        "modal must display worktree branch with copyable afforance",
      );
    });

    it("verifies tree-view supports density and selectedRepo filtering (#425)", () => {
      const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
      const treeViewSource = fs.readFileSync(treeViewPath, "utf8");

      assert.match(
        treeViewSource,
        /density\?:?\s*["']dense["']\s*\|\s*["']standard["']/,
        "UppidiFleetTreeViewProps must declare density prop",
      );
      assert.match(
        treeViewSource,
        /selectedRepo\?:?\s*string/,
        "UppidiFleetTreeViewProps must declare selectedRepo prop",
      );
      assert.match(
        treeViewSource,
        /selectedWorkspace\?:?\s*string/,
        "UppidiFleetTreeViewProps must declare selectedWorkspace prop (#449)",
      );
      assert.match(
        treeViewSource,
        /isRepoMatching\(\s*g\.projectName,\s*selectedRepo\s*\)/,
        "tree-view must filter enrolled and detached groups with isRepoMatching",
      );
      assert.match(
        treeViewSource,
        /agent\.workspaceId\s*!==\s*selectedWorkspace/,
        "tree-view must filter agents by selectedWorkspace (#449)",
      );
    });

    it("verifies Dashboard tab does not contain old Agents & Fleet Hierarchy collapsible and lives in dedicated tab (#441)", () => {
      // 1. Must not contain the old Agents & Fleet Hierarchy collapsible in dashboard
      assert.doesNotMatch(
        surfaceSource,
        /<Collapsible[\s\S]*title=\{`Agents & Fleet \(\$\{visibleAgents\.length\}/,
        "must not contain old collapsible Agents & Fleet section in dashboard",
      );
      assert.doesNotMatch(
        surfaceSource,
        /title=\{`Front Desk \(/,
        "must not contain Front Desk collapsible in dashboard",
      );
      assert.doesNotMatch(
        surfaceSource,
        /title=\{`Orchestrators \(/,
        "must not contain Orchestrators collapsible in dashboard",
      );
      assert.doesNotMatch(
        surfaceSource,
        /title=\{`Coding & Task Agents \(/,
        "must not contain Coding & Task Agents collapsible in dashboard",
      );

      // 2. Unused agent filter states and memos removed
      assert.doesNotMatch(
        surfaceSource,
        /const \[fleetExpanded, setFleetExpanded\]/,
        "must not have fleetExpanded state",
      );
      assert.doesNotMatch(
        surfaceSource,
        /const \[agentPreset, setAgentPreset\]/,
        "must not have agentPreset state",
      );
      assert.doesNotMatch(
        surfaceSource,
        /const visibleAgents = useMemo/,
        "must not have visibleAgents memo",
      );

      // 3. Agents & Fleet lives in its dedicated tab (activeTab === "tree")
      assert.match(
        surfaceSource,
        /activeTab === "tree"\s*\?\s*\(\s*<UppidiFleetTreeView/,
        "Agents & Fleet must be rendered in its dedicated 'tree' tab via UppidiFleetTreeView",
      );
    });

    it("verifies settings integration via registerHelperSettingsScreen and surface tab (#444)", () => {
      const entryPath = path.resolve(__dirname, "../index.client.tsx");
      const clientSource = fs.readFileSync(entryPath, "utf8");

      assert.match(
        clientSource,
        /registerHelperSettingsScreen\s*\(\s*client,\s*uppidiFleetSettingsContract/,
        "index.client.tsx must register settings screen with registerHelperSettingsScreen and uppidiFleetSettingsContract",
      );

      assert.match(
        surfaceSource,
        /usePluginSettings\s*\(\s*uppidiFleetSettingsContract\s*\)/,
        "surface.tsx must bind to settings via usePluginSettings",
      );

      assert.match(
        surfaceSource,
        /id:\s*["'"]settings["'"],\s*label:\s*["'"]Settings["'"]/,
        "surface.tsx must register dedicated Settings tab",
      );
    });
  });
});

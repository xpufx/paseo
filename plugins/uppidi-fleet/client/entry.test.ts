import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFleetHarness as getHarness } from "./testing/fleet-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fleet-page crash regression harness (#510).
 *
 * The original bug — "Cannot read properties of undefined (reading
 * 'prototype')" — is the read-a-property-off-undefined class. We reproduce it by
 * driving the real render path (`UppidiFleetSurface` / `UppidiFleetTreeView`)
 * with undefined and partial RPC payloads. The render harness and its
 * `react-native` stub live in `client/testing/fleet-harness.ts`, shared with the
 * mobile-layout measurement harness.
 */

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

  it("renders a single small Add Orchestrator button for unstaffed enrolled repos (#528)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    const buttonMatches = source.match(/label="\+ Add Orchestrator"/g) ?? [];
    assert.equal(
      buttonMatches.length,
      1,
      "tree-view.tsx must render exactly one Add Orchestrator button",
    );

    assert.match(
      source,
      /label="\+ Add Orchestrator"[\s\S]*?size="sm"/,
      "the Add Orchestrator button must be small (size='sm')",
    );

    const unstaffedIdx = source.indexOf("Enrolled repository is unstaffed");
    assert.ok(unstaffedIdx >= 0, "tree-view.tsx must render the unstaffed placeholder message");
    const placeholderRowEnd = source.indexOf("</Row>", unstaffedIdx);
    assert.ok(placeholderRowEnd > unstaffedIdx, "unstaffed placeholder Row must be locatable");
    const placeholderSource = source.slice(unstaffedIdx, placeholderRowEnd);
    assert.doesNotMatch(
      placeholderSource,
      /Add Orchestrator/,
      "the unstaffed placeholder Row must not render a duplicate Add Orchestrator button",
    );
    assert.doesNotMatch(
      placeholderSource,
      /<Button/,
      "the unstaffed placeholder Row must not render any button",
    );
  });

  it("verifies ProjectGroupCard mute toggle passes inverted target state and renders stateful label/icon (#532)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    // 1. onToggleMute must receive the target inverted state, never the current state.
    assert.match(
      source,
      /onToggleMute\(\s*group\.projectName,\s*!group\.isMuted\s*\)/,
      "onToggleMute must be invoked with !group.isMuted (target state)",
    );
    assert.doesNotMatch(
      source,
      /onToggleMute\(\s*group\.projectName,\s*group\.isMuted\s*\)/,
      "onToggleMute must not be invoked with the current group.isMuted state",
    );

    // 2. Button label/icon must reflect the current muted state.
    assert.match(
      source,
      /label=\{group\.isMuted\s*\?\s*["']Unmute["']\s*:\s*["']Mute["']\}/,
      "mute button label must be 'Unmute' when muted and 'Mute' when unmuted",
    );
    assert.match(
      source,
      /icon=\{group\.isMuted\s*\?\s*["']Volume2["']\s*:\s*["']VolumeX["']\}/,
      "mute button icon must be 'Volume2' when muted and 'VolumeX' when unmuted",
    );

    // 3. A visible muted indicator must render when group.isMuted is true.
    assert.match(
      source,
      /group\.isMuted\s*&&\s*\(\s*<Badge[\s\S]*?label=["'][^"']*Muted[^"']*["']/,
      "ProjectGroupCard must render a visible Muted badge when group.isMuted is true",
    );

    // 4. Toast must reflect the authoritative returned mute state.
    assert.match(
      source,
      /res\.message\s*\|\|\s*`Repo \$\{repo\} \$\{res\.isMuted\s*\?\s*["']muted["']\s*:\s*["']unmuted["']\}`/,
      "handleToggleRepoMute toast must reflect res.isMuted rather than the requested input",
    );
  });

  it("verifies AgentStatusLight renders floating tooltip with agent name on hover (#410)", () => {    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
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

    // 2. Interactive hover tracking and conditional floating tooltip rendering.
    // Hover is delegated to the helper-owned InteractiveRow (#580): the row
    // reports its hover state back through onHoverChange.
    assert.match(
      source,
      /<InteractiveRow[\s\S]*?onHoverChange=\{setHovered\}/,
      "AgentStatusLight must delegate hover tracking to InteractiveRow via onHoverChange",
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

  it("verifies tree-view renders prominent permission and attention indicators (#534)", () => {
    const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
    assert.ok(fs.existsSync(treeViewPath), "client/tree-view.tsx must exist");
    const source = fs.readFileSync(treeViewPath, "utf8");

    // Exported attention banner component built on AttentionBeacon.
    assert.match(
      source,
      /export\s+function\s+AgentAttentionBanner\s*\(/,
      "tree-view.tsx must export AgentAttentionBanner",
    );
    assert.match(
      source,
      /<AttentionBeacon/,
      "AgentAttentionBanner must wrap its content in AttentionBeacon",
    );

    // Permission prompt renders a prominent badge with the tool/action.
    assert.match(
      source,
      /Permission Needed:/,
      "tree-view.tsx must render a 'Permission Needed:' indicator",
    );
    assert.match(
      source,
      /getPendingPermissionAction\(permissions\[0\]!?\)/,
      "permission badge must name the pending tool/action via getPendingPermissionAction",
    );

    // Awaiting input badge with contextual reason.
    assert.match(
      source,
      /Awaiting Input/,
      "tree-view.tsx must render an 'Awaiting Input' badge",
    );
    assert.match(
      source,
      /getAgentAttentionReason\(agent\)/,
      "awaiting-input badge must include the contextual reason via getAgentAttentionReason",
    );

    // Adjudication command is rendered for permission prompts.
    assert.match(
      source,
      /getPermissionAdjudicationCommand\(agent\.id,\s*permissions\[0\]\)/,
      "tree-view.tsx must render the Front Desk adjudication command",
    );

    // The banner is actually rendered by the row components.
    assert.match(
      source,
      /<AgentAttentionBanner\s+agent=\{agent\}\s+compact\s*\/>/,
      "DenseAgentRow must render the attention banner",
    );
    assert.match(
      source,
      /<AgentAttentionBanner\s+agent=\{primaryAgent\}\s*\/>/,
      "FrontDeskHero must render the attention banner for the primary agent",
    );
  });

  it("verifies Cockpit surface renders the fleet attention board and header badge (#534)", () => {
    const surfacePath = path.resolve(__dirname, "surface.tsx");
    const source = fs.readFileSync(surfacePath, "utf8");

    assert.match(
      source,
      /export\s+function\s+AttentionAgentCard\s*\(/,
      "surface.tsx must export AttentionAgentCard",
    );
    assert.match(
      source,
      /<AttentionBeacon[\s\S]*?tone=\{tone\}/,
      "AttentionAgentCard must wrap its content in an AttentionBeacon with a tone",
    );
    assert.match(
      source,
      /Permission Needed:/,
      "surface.tsx must render a 'Permission Needed:' indicator",
    );
    assert.match(
      source,
      /Awaiting Input/,
      "surface.tsx must render an 'Awaiting Input' indicator",
    );
    assert.match(
      source,
      /Fleet Needs Attention/,
      "surface.tsx must render the 'Fleet Needs Attention' board",
    );
    assert.match(
      source,
      /collectAttentionAgents\(allAgents\)/,
      "surface.tsx must collect attention agents via collectAttentionAgents",
    );
    assert.match(
      source,
      /permissionAttentionCount=\{permissionAgentCount\}/,
      "UppidiTopHeaderBar must receive the permission attention count",
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

      // 2. Tab order: tree first, then dashboard, then settings
      assert.match(
        surfaceSource,
        /id:\s*["']tree["'][\s\S]*id:\s*["']dashboard["'][\s\S]*id:\s*["']settings["']/,
        "tabs order must be tree, dashboard, settings",
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

    it("removes the static mockup tab, component, and wiring (#465)", () => {
      assert.doesNotMatch(
        surfaceSource,
        /Static mockup/,
        "surface.tsx must not register the 'Static mockup' tab",
      );
      assert.doesNotMatch(
        surfaceSource,
        /UppidiFleetStaticMockup|UppidiForgeStaticMockup/,
        "surface.tsx must not import or render the static mockup components",
      );
      assert.doesNotMatch(
        surfaceSource,
        /["']mockup["']/,
        "surface.tsx must not reference the mockup tab id",
      );
      assert.ok(
        !fs.existsSync(path.resolve(__dirname, "static-mockup.tsx")),
        "client/static-mockup.tsx must be removed",
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

    it("freezes density to dense and removes density controls/wiring (#465)", () => {
      assert.doesNotMatch(
        surfaceSource,
        /DENSITY_STORAGE_KEY|getStoredDensity|setStoredDensity|SurfaceDensity/,
        "surface.tsx must not keep density state, storage helpers, or types",
      );
      assert.doesNotMatch(
        surfaceSource,
        /onDensityChange|handleDensityChange|Cockpit Display Density/,
        "surface.tsx must not keep density toggle wiring or settings card",
      );
      assert.doesNotMatch(
        surfaceSource,
        /label=["']Standard["']/,
        "surface.tsx must not render a Standard density toggle",
      );
    });

    it("defaults the global repo selector to All Repositories (#484)", () => {
      assert.match(
        surfaceSource,
        /const\s+\[selectedRepo,\s*setSelectedRepo\]\s*=\s*useState<string>\(\s*["']all["']\s*\)/,
        "selectedRepo must default to 'all' on initial mount",
      );

      assert.match(
        surfaceSource,
        /repoOptions\s*=\s*useMemo<SelectOption\[\]>\(\(\)\s*=>\s*\[\s*\{\s*label:\s*["']All Repositories["'],\s*value:\s*["']all["']\s*\}/,
        "repoOptions must start with the All Repositories / 'all' option",
      );
    });

    it("verifies compact unified top header bar (#424, #466)", () => {
      assert.match(
        surfaceSource,
        /export\s+function\s+UppidiTopHeaderBar/,
        "must export UppidiTopHeaderBar component",
      );
      assert.match(
        surfaceSource,
        /<UppidiBrandMark\s+size=\{18\}/,
        "UppidiTopHeaderBar must render compact brand mark",
      );
      assert.match(
        surfaceSource,
        /<Select[\s\S]*value=\{selectedRepo\}[\s\S]*options=\{repoOptions\}/,
        "UppidiTopHeaderBar must render global repository Select dropdown",
      );
      assert.match(
        surfaceSource,
        /label="Refresh"[\s\S]*onPress=\{onRefresh\}/,
        "UppidiTopHeaderBar must render the authoritative Refresh button",
      );
    });

    it("elevates the header bar stacking context above the Tabs bar (#484)", () => {
      const start = surfaceSource.indexOf("export function UppidiTopHeaderBar");
      const end = surfaceSource.indexOf("export function UppidiFleetSurface");
      const header = surfaceSource.slice(start, end);
      assert.match(
        header,
        /<Row[\s\S]*?style=\{\{\s*paddingVertical:\s*2,\s*position:\s*["']relative["'],\s*zIndex:\s*\d+\s*\}\}/,
        "UppidiTopHeaderBar's outer Row must create a stacking context above the Tabs bar",
      );
    });

    it("removes the workspace dropdown and its surface/tree-view wiring (#465)", () => {
      assert.doesNotMatch(
        surfaceSource,
        /selectedWorkspace|workspaceOptions|onWorkspaceChange|handleWorkspaceChange|availableWorkspaces/,
        "surface.tsx must not keep workspace dropdown state or wiring",
      );
    });

    it("verifies dense metrics bar strip (#424)", () => {
      // Must contain all 3 issue backlog metrics in horizontal strip
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

      // Must support click-to-filter
      assert.match(
        surfaceSource,
        /setFilter\(\s*["']needs-you["']\s*\)/,
        "dense metrics bar must support click-to-filter for needs-you (operator attention)",
      );
      assert.match(
        surfaceSource,
        /setFilter\(\s*["']triage-review["']\s*\)/,
        "dense metrics bar must support click-to-filter for triage-review",
      );
    });

    it("removes the dead hook queue depth and Front Desk routing pill from the Work Queue filter bar (#476)", () => {
      const workQueueStart = surfaceSource.indexOf("{/* Dense Metrics Bar");
      const settingsStart = surfaceSource.indexOf('activeTab === "settings"');
      assert.ok(
        workQueueStart >= 0 && settingsStart >= 0 && settingsStart < workQueueStart,
        "settings and dense metrics bar must be locatable",
      );

      const workQueueSource = surfaceSource.slice(workQueueStart);
      assert.ok(
        !workQueueSource.includes("Hook queued:"),
        "Work Queue filter bar must not render the hook queue depth pill",
      );
      assert.ok(
        !workQueueSource.includes("Toggle hook queues"),
        "Work Queue filter bar must not render the dead hook queues toggle",
      );
      assert.ok(
        !workQueueSource.includes("setHookQueuesExpanded"),
        "Work Queue filter bar must not toggle hookQueuesExpanded",
      );

      // Hook queue depth and Front Desk routing status live only in Settings.
      assert.match(
        surfaceSource,
        /Total queued across repos/,
        "Settings must retain hook queue depth",
      );
      assert.match(
        surfaceSource,
        /Front desk agent/,
        "Settings must retain Front Desk routing status",
      );
      assert.match(
        surfaceSource,
        /isExpanded=\{hookQueuesExpanded\}[\s\S]*onToggle=\{\(exp\) => setHookQueuesExpanded\(exp\)\}/,
        "Settings must own the Hook Queues collapsible toggle",
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

    it("verifies tree-view supports selectedRepo filtering and drops density/workspace props (#425, #465)", () => {
      const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
      const treeViewSource = fs.readFileSync(treeViewPath, "utf8");

      assert.doesNotMatch(
        treeViewSource,
        /density\?:?\s*["']dense["']\s*\|\s*["']standard["']/,
        "UppidiFleetTreeViewProps must not declare a density prop",
      );
      assert.doesNotMatch(
        treeViewSource,
        /selectedWorkspace/,
        "UppidiFleetTreeViewProps must not declare or use selectedWorkspace (#465)",
      );
      assert.match(
        treeViewSource,
        /selectedRepo\?:?\s*string/,
        "UppidiFleetTreeViewProps must declare selectedRepo prop",
      );
      assert.match(
        treeViewSource,
        /isRepoMatching\(\s*g\.projectName,\s*selectedRepo\s*\)/,
        "tree-view must filter enrolled and detached groups with isRepoMatching",
      );
    });

    it("removes the duplicate Refresh button from the tree-view toolbar (#466)", () => {
      const treeViewPath = path.resolve(__dirname, "tree-view.tsx");
      const treeViewSource = fs.readFileSync(treeViewPath, "utf8");

      assert.doesNotMatch(
        treeViewSource,
        /label=["']Refresh(?: Fleet)?["']/,
        "tree-view must not render its own Refresh button; the header bar is authoritative",
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

    it("verifies management cards live in Settings and not in the Work Queue (#462)", () => {
      const settingsStart = surfaceSource.indexOf('activeTab === "settings"');
      const treeStart = surfaceSource.indexOf('activeTab === "tree"');
      const workQueueStart = surfaceSource.indexOf("{/* Dense Metrics Bar");
      assert.ok(settingsStart >= 0 && treeStart > settingsStart && workQueueStart > treeStart, "tab branches must be locatable");

      const settingsSource = surfaceSource.slice(settingsStart, treeStart);
      const workQueueSource = surfaceSource.slice(workQueueStart);

      const managementTitles = [
        "Hook Service Management",
        "Hook Queues",
        "Hook Log Tail",
        "Agent Role Models & Fallback Groups",
        "CI Runner Fleet",
        "Fleet Capability & Benchmark Matrix",
      ];

      for (const title of managementTitles) {
        assert.ok(
          settingsSource.includes(title),
          `Settings tab must contain management card: ${title}`,
        );
        assert.ok(
          !workQueueSource.includes(title),
          `Work Queue tab must not contain management card: ${title}`,
        );
      }

      // Work Queue renders filters (metrics bar, then filter/action bar) directly above the Work queue table.
      const metricsIdx = workQueueSource.indexOf("{/* Dense Metrics Bar");
      const filterBarIdx = workQueueSource.indexOf("{/* Action Bar & Filter Buttons */}");
      const workQueueTableIdx = workQueueSource.indexOf('title="Work queue"');
      assert.ok(
        metricsIdx >= 0 && filterBarIdx > metricsIdx && workQueueTableIdx > filterBarIdx,
        "Work Queue must render dense metrics bar, filter/action bar, then the Work queue table",
      );
    });
  });

  describe("fleet page crash: undefined prototype/partial-payload class (#510)", () => {
    // Real render-path mounts of the fleet dashboard surface and the tree view
    // with undefined and malformed RPC payloads. Pre-fix each of these threw
    // either "Cannot read properties of undefined (reading 'prototype')" or a
    // sibling read-off-undefined error and blanked the page.
    const validAgents = (tree: unknown[], over: Record<string, unknown> = {}) => ({
      tree,
      totalCount: tree.length,
      runningCount: 0,
      idleCount: tree.length,
      errorCount: 0,
      enrolledRepos: ["r"],
      mutedRepos: [],
      repoQueuedHooks: {},
      ...over,
    });
    const agent = (over: Record<string, unknown> = {}) => ({
      id: "a1",
      shortId: "a1",
      name: "Agent",
      status: "idle",
      deterministicState: "idle:waiting",
      category: "worker",
      labels: {},
      ...over,
    });

    it("mounts UppidiFleetSurface with all RPC payloads undefined", async () => {
      const { React, UppidiFleetSurface, render } = await getHarness();
      const tree = await render(React.createElement(UppidiFleetSurface, {}));
      assert.ok(tree, "surface must mount and render a fallback tree, not crash");
      assert.ok(JSON.stringify(tree).length > 100, "surface fallback must be non-trivial");
    });

    it("mounts UppidiFleetTreeView with undefined agentsData and partial payloads", async () => {
      const { React, UppidiFleetTreeView, render } = await getHarness();
      const cases: Array<[string, unknown]> = [
        ["undefined agentsData", undefined],
        ["empty payload", {}],
        ["tree node missing children", validAgents([{ agent: agent({ category: "orchestrator" }), depth: 0 }])],
        ["tree node children is an object", validAgents([{ agent: agent(), depth: 0, children: {} }])],
        ["tree is an object", { tree: { bad: true }, totalCount: 0 }],
        ["null tree node", { tree: [null], totalCount: 0 }],
        ["node without agent", { tree: [{ depth: 0, children: [] }], totalCount: 0 }],
        ["non-array workers", { workers: "not-an-array", totalCount: 0 }],
        ["non-array orchestrators", { orchestrators: 42, totalCount: 0 }],
        ["non-array enrolledRepos", validAgents([{ agent: agent(), depth: 0, children: [] }], { enrolledRepos: { bad: 1 } })],
        ["non-array mutedRepos", validAgents([{ agent: agent(), depth: 0, children: [] }], { mutedRepos: { bad: 1 } })],
        ["partial agent (missing name/shortId/state)", validAgents([{ agent: { id: "a", labels: {} }, depth: 0, children: [] }])],
        ["non-string deterministicState", validAgents([{ agent: agent({ deterministicState: 123 }), depth: 0, children: [] }])],
      ];

      for (const [label, agentsData] of cases) {
        const tree = await render(
          React.createElement(UppidiFleetTreeView, { agentsData: agentsData as any }),
        );
        assert.ok(
          tree,
          `UppidiFleetTreeView must not crash for: ${label}`,
        );
      }
    });

    it("mounts UppidiFleetSurface with partial/undefined RPC payloads per contract", async () => {
      const { React, UppidiFleetSurface, render, payloads } = await getHarness();
      const contracts = await import("../shared/contracts.js");

      const cases: Array<[string, Record<string, unknown>]> = [
        ["all payloads undefined", {}],
        [
          "agents tree node missing children",
          { [contracts.uppidiAgentsContract.name]: validAgents([{ agent: agent({ category: "orchestrator" }), depth: 0 }]) },
        ],
        [
          "agents tree children is an object",
          { [contracts.uppidiAgentsContract.name]: validAgents([{ agent: agent(), depth: 0, children: {} }]) },
        ],
        [
          "role models entry missing config",
          { [contracts.uppidiRoleModelsContract.name]: { roles: { worker: undefined }, availableModels: [] } },
        ],
        [
          "metrics candidate missing profiles/failureBreakdown",
          {
            [contracts.uppidiFleetMetricsContract.name]: {
              candidates: [{ model: "m", overallPassRate: 90, medianWallMs: 1000, totalTrials: 1, recommendedRoles: [], profiles: [{ taskProfile: "x" }] }],
              totalEvaluatedTrials: 1,
            },
          },
        ],
        [
          "runner missing labels",
          { [contracts.uppidiRunnersContract.name]: { runners: [{ id: "r", name: "R", status: "online" }], totalCount: 1, onlineCount: 1 } },
        ],
        [
          "queue missing messages",
          { [contracts.uppidiHookQueuesContract.name]: { queues: [{ key: "k", paused: false, isBusy: false, depth: 1 }] } },
        ],
        [
          "issue missing labels",
          {
            [contracts.uppidiIssuesContract.name]: {
              issues: [{ number: 1, title: "t", repo: "r", status: "open", comments: 0, attention: "attention/1-agent" }],
              openCount: 1,
              needsYouCount: 0,
              reviewCount: 0,
            },
          },
        ],
        [
          "non-array collections",
          {
            [contracts.uppidiAgentsContract.name]: { tree: {}, workers: "x", orchestrators: 5, totalCount: 0 },
            [contracts.uppidiRunnersContract.name]: { runners: "x", totalCount: 0 },
            [contracts.uppidiFleetMetricsContract.name]: { candidates: 7, totalEvaluatedTrials: 0 },
          },
        ],
      ];

      for (const [label, nextPayloads] of cases) {
        for (const key of Object.keys(payloads)) delete payloads[key];
        Object.assign(payloads, nextPayloads);
        const tree = await render(React.createElement(UppidiFleetSurface, {}));
        assert.ok(tree, `UppidiFleetSurface must not crash for: ${label}`);
      }
    });

    it("never dereferences .prototype off a possibly-undefined value", () => {
      // The crash class is a property read off undefined. The fleet client and
      // shared render helpers must not contain a bare `.prototype` dereference;
      // the only safe form is the guarded `Object.prototype.hasOwnProperty.call`.
      const sources = [
        path.resolve(__dirname, "surface.tsx"),
        path.resolve(__dirname, "tree-view.tsx"),
        path.resolve(__dirname, "panel.tsx"),
        path.resolve(__dirname, "../shared/sort-filter.ts"),
        path.resolve(__dirname, "../shared/contracts.ts"),
      ];
      for (const file of sources) {
        const source = fs.readFileSync(file, "utf8");
        const prototypeReads = source.match(/[A-Za-z0-9_$.\)\]]\s*\.\s*prototype/g) ?? [];
        for (const read of prototypeReads) {
          assert.ok(
            read.includes("Object.prototype"),
            `${path.basename(file)} must not dereference .prototype off an unguarded value: ${read}`,
          );
        }
      }
    });
  });

  describe("compact agent health gauge and metrics card (#560)", () => {
    const agentWithMetrics = (over: Record<string, unknown> = {}) => ({
      id: "gauge-1",
      shortId: "gauge-1",
      name: "Gauge Agent",
      status: "idle",
      deterministicState: "idle:waiting",
      category: "worker",
      labels: {},
      metrics: {
        contextUsedTokens: 96000,
        contextMaxTokens: 128000,
        cachedTokens: 600,
        inputTokens: 1200,
        outputTokens: 800,
        costUsd: 1.23,
        activeTurnStartedAt: "2026-09-25T10:00:00.000Z",
        attentionTimestamp: "2026-09-25T10:05:00.000Z",
      },
      ...over,
    });
    const legacyAgent = (over: Record<string, unknown> = {}) => ({
      id: "legacy-1",
      shortId: "legacy-1",
      name: "Legacy Agent",
      status: "idle",
      deterministicState: "idle:waiting",
      category: "worker",
      labels: {},
      ...over,
    });

    const flatten = (node: any, out: any[] = []): any[] => {
      if (!node || typeof node !== "object") return out;
      out.push(node);
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) flatten(child, out);
      return out;
    };

    const findByTestID = (node: any, testID: string): any[] =>
      flatten(node).filter((n) => n?.props?.testID === testID);

    it("renders no gauge for agents without a metrics block", async () => {
      const { React, DenseAgentRow, render } = await getHarness();
      const node = { agent: legacyAgent(), depth: 1, children: [] };
      const tree = await render(
        React.createElement(DenseAgentRow, {
          node,
          colors: {},
          typography: {},
          onArchiveAgent: async () => {},
        }),
      );
      assert.equal(
        findByTestID(tree, "agent-health-gauge-legacy-1").length,
        0,
        "legacy agents must render no health gauge",
      );
      assert.equal(
        findByTestID(tree, "agent-metrics-card-legacy-1").length,
        0,
        "legacy agents must render no metrics card",
      );
    });

    it("renders the gauge for agents with metrics and keeps the collapsed line height stable", async () => {
      // Render two rows via the tree view so we can compare line structure.
      const payload = {
        ok: true,
        tree: [
          { agent: agentWithMetrics(), depth: 0, children: [] },
          { agent: legacyAgent(), depth: 0, children: [] },
        ],
        totalCount: 2,
        runningCount: 0,
        idleCount: 2,
        errorCount: 0,
        enrolledRepos: [],
        mutedRepos: [],
        repoQueuedHooks: {},
      };
      const { React, UppidiFleetTreeView, render } = await getHarness();
      const tree = await render(
        React.createElement(UppidiFleetTreeView, { agentsData: payload }),
      );
      const gauge = findByTestID(tree, "agent-health-gauge-gauge-1");
      assert.equal(gauge.length, 1, "agent with metrics must render the gauge");

      // Collapsed: no metrics card until the gauge is tapped.
      assert.equal(
        findByTestID(tree, "agent-metrics-card-gauge-1").length,
        0,
        "metrics card must stay collapsed until tapped",
      );

      // The gauge bar itself is 4px tall — the agent line does not grow.
      const track = findByTestID(tree, "agent-health-gauge-track-gauge-1");
      assert.equal(track.length, 1, "collapsed gauge renders its thin track");
      const heights = [].concat(track[0].props.style ?? [])
        .map((s: any) => s?.height)
        .filter((h: any) => typeof h === "number");
      assert.ok(
        heights.length > 0 && heights.every((h: number) => h <= 4),
        `collapsed gauge must stay <=4px tall, saw ${JSON.stringify(heights)}`,
      );
    });

    it("opens the metrics card with metric rows on tap and closes on second tap", async () => {
      const { React, DenseAgentRow, renderWithRoot, TestRenderer } = await getHarness();
      const node = { agent: agentWithMetrics(), depth: 1, children: [] };
      const { tree, root, renderer } = await renderWithRoot(
        React.createElement(DenseAgentRow, {
          node,
          colors: {},
          typography: {},
          onArchiveAgent: async () => {},
        }),
      );

      assert.equal(
        findByTestID(tree, "agent-metrics-card-gauge-1").length,
        0,
        "card starts collapsed",
      );

      const gaugeRoot = root.find(
        (n: any) => n.props?.testID === "agent-health-gauge-gauge-1",
      );
      assert.ok(gaugeRoot, "gauge pressable must exist to toggle the card");

      await TestRenderer.act(async () => {
        gaugeRoot.props.onPress();
      });

      let opened = findByTestID(
        renderer.toJSON(),
        "agent-metrics-card-gauge-1",
      );
      assert.equal(opened.length, 1, "tapping the gauge opens the metrics card");

      // The metric inventory renders as key/value rows.
      const openedText = JSON.stringify(renderer.toJSON());
      for (const label of [
        "Context",
        "Cached ratio",
        "Cost",
        "Turn duration",
        "Session lifetime",
        "Permission wait",
        "Errors",
      ]) {
        assert.ok(openedText.includes(label), `metrics card must include the ${label} row`);
      }

      // Second tap collapses it again.
      const gaugeRootAgain = root.find(
        (n: any) => n.props?.testID === "agent-health-gauge-gauge-1",
      );
      await TestRenderer.act(async () => {
        gaugeRootAgain.props.onPress();
      });
      opened = findByTestID(renderer.toJSON(), "agent-metrics-card-gauge-1");
      assert.equal(opened.length, 0, "second tap collapses the metrics card");
    });

    it("renders the clock-arc variant for a running agent with an active turn", async () => {
      const { React, DenseAgentRow, render } = await getHarness();
      const node = {
        agent: agentWithMetrics({ status: "running", deterministicState: "running" }),
        depth: 1,
        children: [],
      };
      const tree = await render(
        React.createElement(DenseAgentRow, {
          node,
          colors: {},
          typography: {},
          onArchiveAgent: async () => {},
        }),
      );
      // Clock variant omits the stacked micro-bar segments.
      assert.equal(
        findByTestID(tree, "agent-health-gauge-segment-context").length,
        0,
        "running agent with an active turn must render the clock-arc, not the bar",
      );
      assert.equal(
        findByTestID(tree, "agent-health-gauge-gauge-1").length,
        1,
        "clock-arc gauge remains on the trailing edge",
      );
    });
  });
});

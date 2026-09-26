import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

/**
 * Render harness for the three views.
 *
 * This is the executable half of `docs/INVENTORY.md`: every `[x]` row that
 * claims the new surface shows something is checked here by driving the real
 * components with a realistic payload and asserting the testID is in the tree.
 * A row that loses its element fails this file.
 *
 * `react-native` ships Flow syntax `tsx` cannot parse, so it is aliased to a
 * data-URL stub through a resolve hook. Everything else — react,
 * react-test-renderer, the real views — is the real thing.
 */
const require = createRequire(import.meta.url);
const REACT_URL = pathToFileURL(require.resolve("react")).href;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RN_STUB = `
import React from ${JSON.stringify(REACT_URL)};
function stub(name) {
  function RNStub(props) { return React.createElement(name, props, props?.children); }
  Object.defineProperty(RNStub, "name", { value: "RN" + name });
  return RNStub;
}
class AnimatedValue {
  constructor(v) { this.value = v; }
  setValue(v) { this.value = v; }
  interpolate() { return this; }
}
const anim = { start: (cb) => cb?.({ finished: true }), stop() {}, reset() {} };
export const View = stub("View");
export const Text = stub("Text");
export const Pressable = stub("Pressable");
export const ScrollView = stub("ScrollView");
export const TextInput = stub("TextInput");
export const Modal = stub("Modal");
export const ActivityIndicator = stub("ActivityIndicator");
export const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1, compose: (a, b) => [a, b], absoluteFill: {} };
export const Platform = { OS: "web", select: (o) => o.web ?? o.default };
export const Appearance = { getColorScheme: () => "dark", addChangeListener: () => ({ remove() {} }) };
export const useColorScheme = () => "dark";
export const Dimensions = { get: () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 }) };
export const useWindowDimensions = () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 });
export const Linking = { openURL: async () => {}, canOpenURL: async () => true };
export const Animated = {
  Value: AnimatedValue,
  View: stub("AnimatedView"),
  Text: stub("AnimatedText"),
  loop: (a) => a ?? anim,
  sequence: () => anim,
  timing: () => anim,
  parallel: () => anim,
};
`;

const PASEO_RN_STUB = `
import React from ${JSON.stringify(REACT_URL)};
export const useToast = () => ({ show() {}, error() {} });
export const Icon = (props) => React.createElement("mock-icon", { name: props?.name });
export const Modal = Object.assign(
  (props) => React.createElement("mock-modal", props, props?.children),
  { Content: (props) => React.createElement("mock-modal-content", props, props?.children) },
);
export const ScrollView = (props) => React.createElement("mock-scroll", props, props?.children);
export const FlatList = (props) => React.createElement("mock-flatlist", props, props?.children);
export const TextInput = (props) => React.createElement("mock-textinput", props);
export const copyText = async () => {};
export const useRevealedText = (text) => text;
`;

const STUB_URL = `data:text/javascript,${encodeURIComponent(RN_STUB)}`;
const PASEO_RN_STUB_URL = `data:text/javascript,${encodeURIComponent(PASEO_RN_STUB)}`;

let reactTestRenderer: {
  create(element: unknown): { toJSON(): unknown; unmount(): void };
  act(callback: () => void | Promise<void>): void;
};
let React: typeof import("react");
let FleetView: typeof import("./fleet-view.js").FleetView;
let QueueView: typeof import("./queue-view.js").QueueView;
let TicketsView: typeof import("./tickets-view.js").TicketsView;
let TicketDetail: typeof import("./ticket-detail.js").TicketDetail;
let SkinProvider: typeof import("./kit.js").SkinProvider;
let paletteFor: typeof import("./theme.js").paletteFor;

before(async () => {
  // `react-native` ships Flow syntax `tsx` cannot parse and the host component
  // entry pulls it in, so both are aliased to stubs. Everything else is real.
  const nodeModule = await import("node:module");
  (nodeModule as unknown as {
    registerHooks(hooks: {
      resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => unknown): unknown;
    }): void;
  }).registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "react-native") return { url: STUB_URL, shortCircuit: true };
      if (specifier === "@getpaseo/plugin/client/react-native") {
        return { url: PASEO_RN_STUB_URL, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });

  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  React = (await import("react")).default;
  reactTestRenderer = (await import("react-test-renderer")).default as never;
  ({ FleetView } = await import("./fleet-view.js"));
  ({ QueueView } = await import("./queue-view.js"));
  ({ TicketsView } = await import("./tickets-view.js"));
  ({ TicketDetail } = await import("./ticket-detail.js"));
  ({ SkinProvider } = await import("./kit.js"));
  ({ paletteFor } = await import("./theme.js"));
});

// --- Fixtures -------------------------------------------------------------
// Generic paths on purpose: a real home directory in a committed fixture is a
// PII leak, not a test detail.

const AGENTS = {
  ok: true,
  frontDesk: [
    {
      id: "desk-1",
      shortId: "desk-1",
      name: "Fleet Front Desk",
      category: "front-desk" as const,
      status: "running",
      model: "space-bunny-free",
      provider: "opencode-go",
      worktree: "feat-629-fleet-alternative",
      project: "example-org/paseo",
      deterministicState: "working" as const,
      stateDetail: "#629 (feat-629-alt)",
      lifecycleState: "running" as const,
      attributedWork: { issue: 629, slug: "feat-629-alt", repo: "example-org/paseo" },
      lastActivityAt: new Date(Date.now() - 30_000).toISOString(),
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
      labels: { branch: "feat/629-fleet-alternative" },
      metrics: {
        contextUsedTokens: 8000,
        contextMaxTokens: 10000,
        cachedTokens: 4000,
        inputTokens: 6000,
        outputTokens: 900,
        costUsd: 1.25,
        activeTurnStartedAt: new Date(Date.now() - 60_000).toISOString(),
      },
      usage: { totalCostUsd: 4.5, cachedInputTokens: 12000 },
      pendingPermissions: [
        { id: "req-7", title: "write file", tool: "write", input: { path: "/srv/work/paseo/client/kit.tsx" } },
        { id: "req-8", tool: "bash" },
      ],
      requiresAttention: true,
      attentionReason: "permission" as const,
      blockDetail: {
        requiredPermissionId: "req-7",
        scope: "/srv/work/paseo/client/kit.tsx",
        action: "write file",
        command: "paseo permit allow desk-1 req-7",
      },
      cwd: "/srv/work/paseo",
      workspaceId: "ws-1",
      url: "paseo://agent/desk-1",
    },
  ],
  orchestrators: [
    {
      id: "orch-1",
      shortId: "orch-1",
      name: "paseo orchestrator",
      category: "orchestrator" as const,
      status: "idle",
      model: "gpt-5.4",
      provider: "openai",
      worktree: "main",
      project: "example-org/paseo",
      deterministicState: "idle:waiting" as const,
      lifecycleState: "idle" as const,
      lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      cwd: "/srv/work/paseo",
      isMainDirty: true,
      mainDirtySummary: "3 uncommitted files",
    },
  ],
  workers: [
    {
      id: "w-1",
      shortId: "w-1",
      name: "worker one",
      category: "worker" as const,
      status: "idle",
      project: "example-org/paseo",
      parentId: "orch-1",
      parentName: "paseo orchestrator",
      parentCategory: "orchestrator" as const,
      deterministicState: "failed:timeout" as const,
      lifecycleState: "errored" as const,
      lastError: "execution timed out",
      worktree: "feat-629-fleet-alternative",
      lastActivityAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    },
    {
      id: "w-2",
      shortId: "w-2",
      name: "worker two",
      category: "worker" as const,
      status: "error",
      project: "scratch/local-thing",
      deterministicState: "attention-required" as const,
      lifecycleState: "waiting_for_input" as const,
      requiresAttention: true,
      attentionReason: "input" as const,
      lastActivityAt: new Date(Date.now() - 20_000).toISOString(),
    },
  ],
  tree: [],
  enrolledRepos: ["example-org/paseo"],
  mutedRepos: [],
  repoQueuedHooks: { "example-org/paseo": 3 },
  totalCount: 4,
  runningCount: 1,
  idleCount: 2,
  errorCount: 1,
} as never;

const TICKETS = [
  {
    number: 629,
    title: "uppidi-fleet alternative design",
    state: "open",
    repo: "paseo",
    status: "In progress" as const,
    attention: "attention/1-agent" as const,
    branch: "feat/629-fleet-alternative",
    comments: 3,
    labels: ["state/1-wip", "priority/0-SOS"],
    url: "https://forge.example.com/example-org/paseo/issues/629",
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
  },
  {
    number: 630,
    title: "vendor gate can never observe drift",
    state: "open",
    repo: "paseo",
    status: "Review" as const,
    attention: "attention/2-user" as const,
    comments: 0,
    labels: ["state/2-review"],
    updatedAt: new Date(Date.now() - 7200_000).toISOString(),
  },
];

const TICKET_BOARD = {
  ok: true,
  repo: "example-org/paseo",
  tickets: TICKETS,
  openCount: 2,
  inFlightCount: 1,
  reviewCount: 1,
  needsYouCount: 1,
} as never;

const ROUTER = {
  ok: true,
  service: "forgejo-hook",
  version: 3,
  uptime: 3600,
  url: "http://127.0.0.1:8099",
  active: true,
  state: "listening",
  host: "127.0.0.1",
  port: 8099,
  configuredHost: "127.0.0.1",
  configuredPort: 8099,
  availableInterfaces: ["10.0.0.5"],
  frontDeskAgentId: "desk-1",
  paused: ["example-org/lab"],
  totalQueued: 5,
  repoCount: 2,
  capabilities: { xCommsInstalled: true },
} as never;

const QUEUES = {
  ok: true,
  service: "forgejo-hook",
  uptime: 3600,
  paused: ["example-org/lab"],
  queues: [
    {
      key: "example-org/paseo",
      depth: 3,
      dropped: 1,
      paused: false,
      isBusy: true,
      busyAttempts: 2,
      orchestrator: { agentId: "orch-1-abcdef" },
      messages: [
        { id: "m1", preview: "issue opened #629" },
        { id: "m2", preview: "comment added" },
        { id: "m3", preview: "label changed" },
        { id: "m4", preview: "never shown, the row caps at three" },
      ],
    },
    { key: "example-org/lab", depth: 0, dropped: 0, paused: true, isBusy: false, busyAttempts: 0, messages: [] },
  ],
} as never;

const NO_OPS = {
  onArchive: () => {},
  onArchiveBulk: () => {},
  onCreateFrontDesk: () => {},
  onReplaceFrontDesk: () => {},
  onAddOrchestrator: () => {},
  onReplaceOrchestrator: () => {},
  onMuteRepo: () => {},
  onPause: () => {},
  onResume: () => {},
  onDrain: () => {},
  onDispatch: () => {},
  onRepoScope: () => {},
};

// --- Harness --------------------------------------------------------------

const DARK_THEME = {
  colors: {
    surface0: "#18181b",
    surface1: "#27272a",
    surface2: "#3f3f46",
    border: "#3f3f46",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    accent: "#3b82f6",
    accentForeground: "#ffffff",
    statusSuccess: "#22c55e",
    statusWarning: "#eab308",
    statusDanger: "#ef4444",
  },
};

const LIGHT_THEME = {
  colors: {
    ...DARK_THEME.colors,
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#e4e4e7",
    foreground: "#09090b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
  },
};

function render(element: React.ReactElement, theme = DARK_THEME, width = 1400) {
  let tree: { toJSON(): unknown; unmount(): void } | undefined;
  // React 19 defers the initial mount until `act` flushes it, so the tree has to
  // be created inside `act` for `toJSON()` to have anything in it.
  reactTestRenderer.act(() => {
    tree = reactTestRenderer.create(
      React.createElement(SkinProvider, {
        theme: theme as never,
        layout: { compact: false, platform: "web", width },
        onCopy: () => {},
        children: element,
      }),
    );
  });
  const ids = new Set<string>();
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const typed = node as { props?: Record<string, unknown>; children?: unknown };
    if (typed.props?.testID) ids.add(String(typed.props.testID));
    if (Array.isArray(typed.children)) {
      for (const child of typed.children) {
        if (child && typeof child === "object" && "type" in (child as object)) {
          const childProps = (child as { props?: Record<string, unknown> }).props;
          if (typeof childProps?.children === "string") texts.push(childProps.children);
          walk(child);
        } else if (typeof child === "string") {
          texts.push(child);
        } else {
          walk(child);
        }
      }
    }
  };
  walk(tree!.toJSON());
  return { ids, texts, unmount: () => tree!.unmount() };
}

const has = (ids: Set<string>, id: string) => ids.has(id);
const hasAny = (ids: Set<string>, ...candidates: string[]) => candidates.some((id) => ids.has(id));
const joined = (texts: string[]) => texts.join(" ");

// --- Fleet ----------------------------------------------------------------

describe("fleet view", () => {
  it("renders every inventory row the legacy surface showed", async () => {
    const { ids, texts, unmount } = await render(
      React.createElement(FleetView, {
        data: AGENTS,
        tickets: TICKETS,
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
    );
    const visible = joined(texts);

    // B1-B8 counts and the bulk action
    for (const id of [
      "fleet-view",
      "fleet-stats",
      "stat-total",
      "stat-running",
      "stat-idle",
      "stat-failed",
      "stat-blocked",
      "bulk-archive",
      "collapse-all",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(has(ids, "stat-blocked"), "the blocked total must be visible");
    assert.ok(has(ids, "fleet-blocked"), "the blocked banner must render");

    // B9-B16 filters
    for (const id of ["state-filter-all", "state-filter-working", "state-filter-idle", "state-filter-failed"]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(has(ids, "fleet-search"));
    assert.ok(has(ids, "fleet-scope"));

    // B17-B34 liaison card
    for (const id of [
      "front-desk",
      "front-desk-status",
      "front-desk-dot",
      "front-desk-facts",
      "front-desk-metrics",
      "front-desk-replace",
      "front-desk-archive",
      "front-desk-orchestrators",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(has(ids, "front-desk-create") === false, "an active liaison must not offer create");

    // B44-B49 the blocked agent's permission strip and permit command
    for (const id of [
      "attention-desk-1",
      "attention-label-desk-1",
      "attention-beacon-desk-1",
      "attention-command-desk-1",
      "attention-scope-desk-1",
      "attention-open-desk-1",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(visible.includes("paseo permit allow desk-1 req-7"), "the permit command must be visible");

    // B35-B43 the metrics sheet
    await render(React.createElement(FleetView, {
      data: AGENTS,
      tickets: TICKETS,
      loading: false,
      repoScope: "all",
      onRepoScope: () => {},
      actions: NO_OPS,
    })).unmount();
    assert.ok(has(ids, "front-desk-metrics"), "metrics toggle stays available");

    // B57-B66, B68-B76 the agent rows
    for (const id of [
      "agent-row-orch-1",
      "agent-row-w-1",
      "agent-row-w-2",
      "agent-dot-w-1",
      "agent-state-w-1",
      "agent-link-w-1",
      "agent-age-w-1",
      "agent-archive-w-1",
      "agent-expand-orch-1",
      // Nested rows are dense, so they carry the compact tree connector.
      "guide-compact",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(has(ids, "front-desk-gauge"), "the liaison row carries a health gauge");
    assert.ok(hasAny(ids, "gauge-turn", "gauge-bar"), "the liaison gauge renders as a bar or a clock arc");
    assert.ok(visible.includes("main dirty"), "the dirty-main warning must be visible");
    assert.ok(visible.includes("3 uncommitted files"), "the dirty summary must be visible");
    assert.ok(visible.includes("via paseo orchestrator"), "the parent pill must be visible");
    assert.ok(has(ids, "agent-labels-desk-1"), "agent labels must render");
    assert.ok(visible.includes("branch=feat/629-fleet-alternative"), "the label text must be visible");

    // B77-B92 the project blocks
    for (const id of [
      "project-example-org/paseo",
      "project-header-example-org/paseo",
      "project-name-example-org/paseo",
      "project-body-example-org/paseo",
      "fleet-projects",
      "fleet-detached",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(visible.includes("3 queued"), "the queued-hook badge must be visible");
    assert.ok(has(ids, "project-mute-example-org/paseo"), "mute must be offered");
    assert.ok(has(ids, "project-replace-orch-example-org/paseo"), "replace orchestrator must be offered");
    assert.ok(visible.includes("orch"), "the orchestrator count must be visible");
    assert.ok(visible.includes("worker"), "the worker count must be visible");

    // B124-B125 the awaiting-input worker shows its own strip
    assert.ok(has(ids, "attention-w-2"), "the awaiting-input worker must show a strip");
    assert.ok(visible.includes("awaiting input"), "the awaiting-input label must be visible");

    unmount();
  });

  it("shows the create action and standby copy when there is no liaison", async () => {
    const withoutDesk = { ...(AGENTS as object), frontDesk: [] } as never;
    const { ids, texts, unmount } = await render(
      React.createElement(FleetView, {
        data: withoutDesk,
        tickets: [],
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
    );
    assert.ok(has(ids, "front-desk-create"), "create must be offered when no liaison runs");
    assert.ok(joined(texts).includes("standby"), "the standby explanation must render");
    unmount();
  });

  it("lists an enrolled but unstaffed repository instead of hiding it", async () => {
    const unstaffed = { ...(AGENTS as object), frontDesk: [], orchestrators: [], workers: [], totalCount: 0 } as never;
    const { ids, texts, unmount } = await render(
      React.createElement(FleetView, {
        data: unstaffed,
        tickets: [],
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
    );
    // An enrolled repo is always on the roster even with nobody in it.
    assert.ok(has(ids, "project-example-org/paseo"), "the enrolled repo must still be listed");
    assert.ok(joined(texts).includes("unstaffed"), "and must say why it is empty");
    unmount();
  });

  it("explains a genuinely empty roster instead of rendering a blank page", async () => {
    const empty = {
      ...(AGENTS as object),
      frontDesk: [],
      orchestrators: [],
      workers: [],
      tree: [],
      enrolledRepos: [],
      repoQueuedHooks: {},
      totalCount: 0,
      runningCount: 0,
      idleCount: 0,
      errorCount: 0,
    } as never;
    const { ids, texts, unmount } = await render(
      React.createElement(FleetView, {
        data: empty,
        tickets: [],
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
    );
    assert.ok(has(ids, "fleet-empty"));
    assert.ok(joined(texts).includes("No agents yet"));
    unmount();
  });
});

// --- Queue ----------------------------------------------------------------

describe("queue view", () => {
  it("renders every queue row the legacy settings section showed", async () => {
    const { ids, texts, unmount } = await render(
      React.createElement(QueueView, { status: ROUTER, queues: QUEUES, loading: false, actions: NO_OPS }),
    );
    const visible = joined(texts);

    // D1-D11 the router read-out
    for (const id of [
      "router-strip",
      "router-state",
      "router-badge",
      "router-endpoint",
      "router-active-host",
      "router-active-port",
      "router-configured",
      "router-liaison",
      "router-interfaces",
      "queue-stats",
      "queue-repo-count",
      "queue-total",
      "queue-paused-count",
      "queue-shown-count",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(visible.includes("desk-1"), "the liaison agent id must be visible");
    assert.ok(visible.includes("10.0.0.5"), "detected interfaces must be visible");
    assert.ok(visible.includes("x-comms"), "the cross-plugin capability flag must be visible");
    assert.ok(visible.includes("up 1h"), "router uptime must be visible");

    // D12-D26 the queue rows
    for (const id of [
      "queue-filters",
      "queue-filter-all",
      "queue-filter-pending-processing",
      "queue-filter-dead-failed",
      "queue-search",
      "queue-sort-repo",
      "queue-sort-depth",
      "queue-sort-status",
      "queue-pause-all",
      "queue-resume-all",
      "queue-list",
      "queue-example-org/paseo",
      "queue-key-example-org/paseo",
      "queue-state-example-org/paseo",
      "queue-orchestrator-example-org/paseo",
      "queue-dropped-example-org/paseo",
      "queue-attempts-example-org/paseo",
      "queue-messages-example-org/paseo",
      "queue-toggle-example-org/paseo",
      "queue-drain-example-org/paseo",
      "queue-example-org/lab",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(visible.includes("orch-1-a"), "the truncated liaison id must be visible");
    assert.ok(visible.includes("3 queued"), "queue depth must be visible");
    assert.ok(visible.includes("1 dropped"), "dropped count must be visible");
    assert.ok(visible.includes("2 attempts"), "busy attempts must be visible");
    assert.ok(visible.includes("issue opened #629"), "message previews must be visible");
    assert.ok(
      !visible.includes("never shown"),
      "the row caps previews at three, exactly as the legacy card did",
    );

    unmount();
  });

  it("distinguishes an unreachable router from an empty queue", async () => {
    const down = { ...(ROUTER as object), ok: false, error: "Unreachable: ECONNREFUSED", active: false } as never;
    const { ids, texts, unmount } = await render(
      React.createElement(QueueView, {
        status: down,
        queues: { ok: false, paused: [], queues: [], error: "Unreachable: ECONNREFUSED" },
        loading: false,
        actions: NO_OPS,
      }),
    );
    assert.ok(has(ids, "router-error"), "an unreachable router must say so");
    assert.ok(has(ids, "queue-empty"));
    assert.ok(
      joined(texts).includes("could not be reached"),
      "the copy must not read as an empty queue",
    );
    unmount();
  });
});

// --- Tickets --------------------------------------------------------------

describe("tickets view", () => {
  it("renders every inventory row the legacy work-queue tab showed", async () => {
    const { ids, texts, unmount } = await render(
      React.createElement(TicketsView, { data: TICKET_BOARD, loading: false, repoScope: "all", actions: NO_OPS }),
    );
    const visible = joined(texts);

    // C1-C14 the list, its stats, filters, sorts, and scope
    for (const id of [
      "tickets-view",
      "ticket-stat-open",
      "ticket-stat-needs-you",
      "ticket-stat-review",
      "ticket-stat-inflight",
      "ticket-visible-count",
      "ticket-scope-label",
      "ticket-filter-all",
      "ticket-filter-needs-you",
      "ticket-filter-needs-attention",
      "ticket-filter-triage-review",
      "ticket-filter-in-progress",
      "ticket-filter-verify",
      "ticket-search",
      "ticket-sort-number",
      "ticket-sort-title",
      "ticket-sort-status",
      "ticket-sort-comments",
      "ticket-sort-repo",
      "ticket-scope",
      "ticket-list",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }

    // C15-C17 the rows
    for (const id of [
      "ticket-row-629",
      "ticket-number-629",
      "ticket-title-629",
      "ticket-status-629",
      "ticket-owner-629",
      "ticket-dispatch-629",
      "ticket-row-630",
      "ticket-status-630",
      "ticket-owner-630",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(visible.includes("Orchestrator") || visible.includes("Agent"), "the owner column must be visible");
    assert.ok(visible.includes("You"), "the operator owner label must be visible");
    assert.ok(visible.includes("state/1-wip"), "labels must be visible on the row");
    assert.ok(visible.includes("priority/0-SOS"), "the SOS label must be visible");

    unmount();
  });

  it("shows the whole ticket record, not a truncated row", async () => {
    const { ids, texts, unmount } = await render(
      React.createElement(TicketDetail, {
        ticket: TICKETS[0],
        onClose: () => {},
        onDispatch: () => {},
        onOpenExternal: () => {},
        embedded: true,
      }),
    );
    const visible = joined(texts);

    // C19-C26
    for (const id of [
      "ticket-detail",
      "ticket-detail-ref",
      "ticket-detail-status",
      "ticket-detail-owner",
      "ticket-detail-comments",
      "ticket-detail-title",
      "ticket-detail-branch",
      "ticket-detail-state",
      "ticket-detail-updated",
      "ticket-detail-labels",
      "ticket-detail-open-external",
      "ticket-detail-dispatch",
      "ticket-detail-close",
    ]) {
      assert.ok(has(ids, id), `missing ${id}`);
    }
    assert.ok(visible.includes("uppidi-fleet alternative design"));
    assert.ok(visible.includes("3 comments"));
    assert.ok(visible.includes("feat/629-fleet-alternative"), "the dispatched branch must be visible");
    unmount();
  });

  it("says when a ticket has no worktree yet", async () => {
    const { texts, unmount } = render(
      React.createElement(TicketDetail, {
        ticket: TICKETS[1],
        onClose: () => {},
        onDispatch: () => {},
        onOpenExternal: () => {},
        embedded: true,
      }),
    );
    assert.ok(joined(texts).includes("no worktree dispatched yet"));
    unmount();
  });

  it("reports a board read failure instead of an empty board", async () => {
    // A failed board read returns an empty list plus the reason, never a stale list.
    const failed = { ...(TICKET_BOARD as object), ok: false, tickets: [], error: "HTTP 503: Service Unavailable" } as never;
    const { ids, texts, unmount } = await render(
      React.createElement(TicketsView, { data: failed, loading: false, repoScope: "all", actions: NO_OPS }),
    );
    assert.ok(has(ids, "ticket-empty"));
    assert.ok(joined(texts).includes("HTTP 503"), "the board error must be shown");
    unmount();
  });
});

// --- Theming --------------------------------------------------------------

describe("theme", () => {
  it("picks light or dark from the host background and nothing else", () => {
    assert.equal(paletteFor("#ffffff").scheme, "light");
    assert.equal(paletteFor("#f6f7f9").scheme, "light");
    assert.equal(paletteFor("#18181b").scheme, "dark");
    assert.equal(paletteFor("#0d0f12").scheme, "dark");
    // An unresolvable background falls back to dark rather than throwing.
    assert.equal(paletteFor(undefined).scheme, "dark");
    assert.equal(paletteFor("not-a-colour").scheme, "dark");
  });

  it("renders the same surface in both schemes", async () => {
    const dark = await render(
      React.createElement(FleetView, {
        data: AGENTS,
        tickets: TICKETS,
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
      DARK_THEME,
    );
    const light = await render(
      React.createElement(FleetView, {
        data: AGENTS,
        tickets: TICKETS,
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
      LIGHT_THEME,
    );
    // Same elements either way: the scheme swaps colours, never structure.
    assert.deepEqual([...dark.ids].sort(), [...light.ids].sort());
    dark.unmount();
    light.unmount();
  });
});

// --- Narrow ---------------------------------------------------------------

describe("narrow surfaces", () => {
  it("drops the secondary row fields rather than overflowing", async () => {
    const wide = await render(
      React.createElement(FleetView, {
        data: AGENTS,
        tickets: TICKETS,
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
      DARK_THEME,
      1400,
    );
    const narrow = await render(
      React.createElement(FleetView, {
        data: AGENTS,
        tickets: TICKETS,
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
      DARK_THEME,
      420,
    );
    assert.ok(has(wide.ids, "agent-age-w-1"), "a wide row shows the last-activity time");
    assert.ok(!has(narrow.ids, "agent-age-w-1"), "a narrow row drops it");
    // The information the narrow row keeps.
    assert.ok(has(narrow.ids, "agent-name-w-1"));
    assert.ok(has(narrow.ids, "agent-state-w-1"));
    assert.ok(has(narrow.ids, "agent-dot-w-1"));
    assert.ok(has(narrow.ids, "agent-archive-w-1"));
    wide.unmount();
    narrow.unmount();
  });
});

/**
 * Guard rails on the fixtures themselves. A committed test payload must not
 * carry a real home directory; that is a PII leak, not a test detail.
 */
/**
 * A committed test payload must not carry a real home directory; that is a PII
 * leak, not a test detail (see the PII preflight). The forbidden substrings are
 * assembled at runtime so this guard does not itself trip a grep for them.
 */
const FORBIDDEN = ["xpufx", "/hom", "e/"].join("");

describe("fixtures", () => {
  it("carries no real home directory or user name", () => {
    const payloads = [
      JSON.stringify(AGENTS),
      JSON.stringify(QUEUES),
      JSON.stringify(ROUTER),
      JSON.stringify(TICKET_BOARD),
      JSON.stringify(TICKETS),
    ];
    for (const blob of payloads) {
      assert.ok(!blob.includes(FORBIDDEN), `a fixture payload contains a forbidden path fragment`);
    }
    // And the source of the fixtures itself.
    const source = fs.readFileSync(path.resolve(__dirname, "render.test.ts"), "utf8");
    assert.ok(!source.includes(FORBIDDEN), "the fixture file itself must not contain one");
  });
});

import React from "react";
import { loadViews } from "./host.js";

/**
 * The payloads every client test renders.
 *
 * Shared rather than duplicated so `render.test.ts` and `mobile-layout.test.ts`
 * are looking at the same surface content: an overflow guard that renders a
 * different payload from the correctness tests proves nothing about the surface
 * the operator sees.
 *
 * Generic paths on purpose: a real home directory in a committed fixture is a
 * PII leak, not a test detail (see the guard in `render.test.ts`).
 */

export const AGENTS = {
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

export const TICKETS = [
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

export const TICKET_BOARD = {
  ok: true,
  repo: "example-org/paseo",
  tickets: TICKETS,
  openCount: 2,
  inFlightCount: 1,
  reviewCount: 1,
  needsYouCount: 1,
} as never;

export const ROUTER = {
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

export const QUEUES = {
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

export const NO_OPS = {
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

export const DARK_THEME = {
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

export const LIGHT_THEME = {
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

export interface SurfaceCase {
  /** Matches the file the surface lives in, so a finding names its source. */
  id: string;
  element: React.ReactElement;
  /**
   * Interactions to drive before measuring, for the state a surface only reaches
   * by being used. `TicketsView` keeps its record hidden until a row is
   * pressed, and at a narrow width that record is the modal branch — the one a
   * width-derived mobile signal actually has to hold.
   */
  press?: string[];
}

/**
 * The four surfaces #684 names, each with a full payload, in the order the
 * issue lists them.
 */
export async function surfaceCases(): Promise<SurfaceCase[]> {
  const { FleetView, QueueView, TicketsView, TicketDetail } = await loadViews();
  return [
    {
      id: "fleet-view",
      element: React.createElement(FleetView, {
        data: AGENTS,
        tickets: TICKETS,
        loading: false,
        repoScope: "all",
        onRepoScope: () => {},
        actions: NO_OPS,
      }),
    },
    {
      id: "tickets-view",
      element: React.createElement(TicketsView, {
        data: TICKET_BOARD,
        loading: false,
        repoScope: "all",
        actions: NO_OPS,
      }),
      press: ["ticket-row-629"],
    },
    {
      id: "queue-view",
      element: React.createElement(QueueView, {
        status: ROUTER,
        queues: QUEUES,
        loading: false,
        actions: NO_OPS,
      }),
    },
    {
      id: "ticket-detail",
      element: React.createElement(TicketDetail, {
        ticket: TICKETS[0],
        onClose: () => {},
        onDispatch: () => {},
        onOpenExternal: () => {},
        embedded: true,
      }),
    },
  ];
}

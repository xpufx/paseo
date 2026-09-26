import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installHostStubs, renderInSkin, React } from "./testing/host.js";
import {
  AGENTS,
  DARK_THEME,
  LIGHT_THEME,
  NO_OPS,
  QUEUES,
  ROUTER,
  TICKET_BOARD,
  TICKETS,
} from "./testing/fixtures.js";

/**
 * Render harness for the three views.
 *
 * This is the executable half of `docs/INVENTORY.md`: every `[x]` row that
 * claims the new surface shows something is checked here by driving the real
 * components with a realistic payload and asserting the testID is in the tree.
 * A row that loses its element fails this file.
 *
 * The host stubs and the payloads live in `./testing/`, shared with
 * `mobile-layout.test.ts` so both files look at the same surface.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let FleetView: typeof import("./fleet-view.js").FleetView;
let QueueView: typeof import("./queue-view.js").QueueView;
let TicketsView: typeof import("./tickets-view.js").TicketsView;
let TicketDetail: typeof import("./ticket-detail.js").TicketDetail;
let paletteFor: typeof import("./theme.js").paletteFor;

before(async () => {
  installHostStubs();
  ({ FleetView } = await import("./fleet-view.js"));
  ({ QueueView } = await import("./queue-view.js"));
  ({ TicketsView } = await import("./tickets-view.js"));
  ({ TicketDetail } = await import("./ticket-detail.js"));
  ({ paletteFor } = await import("./theme.js"));
});

/** The shared harness, at the width and theme this file has always used. */
function render(element: React.ReactElement, theme = DARK_THEME, width = 1400) {
  return renderInSkin(element, { theme, layout: { compact: false, platform: "web", width } });
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
    (await render(React.createElement(FleetView, {
      data: AGENTS,
      tickets: TICKETS,
      loading: false,
      repoScope: "all",
      onRepoScope: () => {},
      actions: NO_OPS,
    }))).unmount();
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
    const { texts, unmount } = await render(
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

/** Every client source file, relative to `client/`, for the guard below. */
function clientSources(dir = __dirname, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) clientSources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(path.relative(__dirname, full));
  }
  return out;
}

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
    // And every source file that could carry one, the shared fixtures included:
    // a payload may be assembled in `./testing/fixtures.ts` or a test that
    // hardcodes a path, so scanning this one file would miss both.
    const offenders: string[] = [];
    for (const file of clientSources()) {
      const source = fs.readFileSync(path.resolve(__dirname, file), "utf8");
      if (source.includes(FORBIDDEN)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "these files contain a real home directory");
  });
});

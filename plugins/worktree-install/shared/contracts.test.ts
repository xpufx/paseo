import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineContract } from "./contracts.js";

/**
 * The contracts are the plugin's only public surface with the daemon, so their
 * names, defaults, and tolerances are worth pinning: a field that quietly stops
 * defaulting turns into a `?? 0` in a view, and a renamed method orphans a
 * handler at load time.
 */
describe("contracts", () => {
  it("names every method with the plugin's own namespace", () => {
    const methods = [
      "worktree-install.fleet",
      "worktree-install.tickets",
      "worktree-install.router-status",
      "worktree-install.queue",
      "worktree-install.queue-pause",
      "worktree-install.queue-resume",
      "worktree-install.queue-drain",
      "worktree-install.archive-agent",
      "worktree-install.archive-inactive-agents",
      "worktree-install.create-front-desk",
      "worktree-install.replace-front-desk",
      "worktree-install.add-orchestrator",
      "worktree-install.replace-orchestrator",
      "worktree-install.mute-repo",
    ];
    for (const name of methods) {
      assert.match(name, /^worktree-install\.[a-z][a-z0-9-]*$/, name);
      // A method belonging to another plugin would collide in the RPC table.
      assert.ok(!name.startsWith("uppidi-fleet."), `${name} belongs to another plugin`);
    }
  });

  it("rejects a method name the daemon's RPC table would not accept", () => {
    assert.throws(
      () => defineContract({ name: "Not A Method", input: { parse: (v: unknown) => v } as never, output: { parse: (v: unknown) => v } as never }),
      /Invalid plugin RPC method/,
    );
  });

  it("exposes the description without making it enumerable-configurable", async () => {
    const { fleetContract, TicketSchema, FleetOutputSchema, RouterStatusOutputSchema } = await import("./contracts.js");
    assert.equal(typeof fleetContract.description, "string");
    assert.ok((fleetContract.description ?? "").length > 0);
    const descriptor = Object.getOwnPropertyDescriptor(fleetContract, "description");
    assert.equal(descriptor?.writable, false);
    assert.equal(descriptor?.configurable, false);

    // A payload with defaulted fields omitted still parses.
    const ticket = TicketSchema.parse({ number: 1, title: "t", state: "open", repo: "org/repo", status: "Backlog" });
    assert.equal(ticket.attention, "attention/1-agent");
    assert.deepEqual(ticket.labels, []);
    assert.equal(ticket.comments, 0);

    // An empty queue board parses to zeroes rather than undefined.
    const queues = FleetOutputSchema.parse({ ok: true });
    assert.deepEqual(queues.frontDesk, []);
    assert.equal(queues.totalCount, 0);
    assert.deepEqual(queues.repoQueuedHooks, {});

    // Router read-out tolerates a bare `{ ok: true }`.
    const router = RouterStatusOutputSchema.parse({ ok: true });
    assert.equal(router.active, false);
    assert.equal(router.totalQueued, 0);
    assert.deepEqual(router.capabilities, { xCommsInstalled: false });
  });
});

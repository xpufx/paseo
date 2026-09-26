import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFER_EXPIRY_MS,
  DEFER_MAX_DEPTH_PER_TARGET,
} from "./server/defer-queue.ts";
import { RECIPIENT_INSTRUCTIONS } from "./server/recipient-instructions.ts";

/**
 * The x-comms guidance that reaches an agent, on all three surfaces, in one
 * place (#709).
 *
 * ## Why one test and three surfaces
 *
 * The same rule — what to do about a busy target — is written down in three
 * shipped places, in three different files, in three different registers:
 *
 *   1. `mcp/paseo-x-comms.mjs`      the MCP server's `INSTRUCTIONS`, which the
 *                                   daemon hands to the client on initialize.
 *   2. `server/recipient-instructions.ts`
 *                                   `RECIPIENT_INSTRUCTIONS`, folded into an
 *                                   agent's `config.systemPrompt`.
 *   3. `skills/recipient-envelope/SKILL.md`
 *                                   the distributable copy of the same
 *                                   contract, for manual installation.
 *
 * #709 is what happens when one of them drifts. The MCP string had been
 * rewritten when the defer queue landed (#598) and said, in as many words, *"Do
 * not call x_comms_wait first to avoid preemption — that is no longer
 * required."* Surfaces 2 and 3 still said *"Before messaging a potentially busy
 * agent, `x_comms_wait`."* Neither transport has a slot for the `instructions`
 * field, so the text that actually reached an agent's system prompt was the
 * stale one: an agent that obeyed it blocked its own turn on every outbound
 * message, to avoid a preemption the queue had already made impossible.
 *
 * `recipient-instructions.test.ts` could not have caught that, and did not try
 * to: it asserts phrases against `RECIPIENT_INSTRUCTIONS` in isolation and never
 * opens the skill. Both files claimed a suite "pins the load-bearing phrases in
 * both", which was true of neither. A contract asserted in prose and enforced
 * nowhere is the actual defect, so this suite enforces it.
 *
 * ## What is pinned, and what is deliberately not
 *
 * The queue is canonical: `defer-queue.ts` is normative and the busy gate in
 * `server/handlers.ts` defers rather than preempts, so a pre-wait cannot change
 * what happens to the message. `x_comms_wait` stays, as the tool for waiting on
 * a *result*. So each surface must state the never-interrupt rule and the queue
 * bounds, must not tell the reader to pre-wait, and must keep pointing at
 * `x_comms_wait` for the thing `x_comms_wait` is for.
 *
 * The bounds are asserted against the exported constants rather than against
 * literals, so changing a bound in `defer-queue.ts` without updating the prose
 * that states it fails here. That link is the point: the constants are the
 * implementation, and three instruction surfaces are the documentation of them.
 *
 * Exact wording is not pinned, deliberately. A test that diffed the surfaces
 * against each other would fail on a harmless rewording and pass on a rewording
 * that inverts the rule, which is the opposite of what a contract test is for.
 * What is pinned is the rule: each surface names it, none of them contradicts
 * it, and no surface may carry the retired advice.
 *
 * The MCP surface is read out of the source module rather than by starting a
 * server, for the same reason `protocol.test.mjs` reads `defer-queue.ts` off
 * disk: the string is a template literal, and the bundle that ships it is
 * already guarded byte-for-byte by `bundle-reproducible.test.mjs`, so pinning it
 * here as well would only add a second place for a correct edit to be missed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The MCP server's `INSTRUCTIONS` literal, lifted out of the source module.
 *
 * The template holds no backtick and no `${`, so the first `` `; `` after the
 * opening delimiter closes it. The anchors asserted below exist so a failed
 * extraction fails loudly instead of handing the assertions an empty string.
 */
function readMcpInstructions(): string {
  const source = readFileSync(join(HERE, "mcp", "paseo-x-comms.mjs"), "utf8");
  const open = "const INSTRUCTIONS = `";
  const start = source.indexOf(open);
  assert.notEqual(start, -1, "mcp/paseo-x-comms.mjs no longer declares INSTRUCTIONS");
  const end = source.indexOf("`;", start + open.length);
  assert.notEqual(end, -1, "the INSTRUCTIONS literal is no longer a plain template literal");
  const instructions = source.slice(start + open.length, end);
  assert.match(instructions, /x_comms_send/, "extracted the wrong span out of the MCP module");
  return instructions;
}

function readSkill(): string {
  return readFileSync(join(HERE, "skills", "recipient-envelope", "SKILL.md"), "utf8");
}

const SURFACES = [
  {
    name: "mcp/paseo-x-comms.mjs (INSTRUCTIONS)",
    text: readMcpInstructions(),
    // The MCP string is the one that names the retired advice explicitly, so
    // this is its exact wording rather than a shared shape.
    forbidsPreWait: /Do not call x_comms_wait first to avoid preemption/,
  },
  {
    name: "server/recipient-instructions.ts (RECIPIENT_INSTRUCTIONS)",
    text: RECIPIENT_INSTRUCTIONS,
    forbidsPreWait: /never pre-wait with x_comms_wait to avoid preemption/,
  },
  {
    name: "skills/recipient-envelope/SKILL.md",
    text: readSkill(),
    forbidsPreWait: /\*\*Never pre-wait\.\*\*/,
  },
] as const;

/**
 * The rule, in the one wording all three surfaces are expected to share.
 *
 * The tool-name patterns tolerate a missing `x_comms_` prefix because the MCP
 * surface deliberately drops it: its first line tells the model to "match the
 * tools actually exposed", since a client prefixes the names with its own
 * registration name. That is a difference of register, not of rule, and a
 * contract test must not fail on it.
 */
const SHARED_RULES = [
  { name: "says a send never interrupts a running turn", re: /never interrupts a running turn/i },
  { name: "says a mid-turn target is queued", re: /queue/i },
  { name: "keeps x_comms_wait for waiting on a result", re: /x_comms_wait/ },
  { name: "keeps the permission-stall path", re: /(?:x_comms_)?list_permissions/ },
] as const;

/**
 * The retired advice, in every wording it has shipped in. Each is a phrase that
 * can only be advice to pre-wait: none of them is a substring of a sentence
 * that forbids pre-waiting, which is why a bare `/x_comms_wait first/` match
 * cannot be used here — the MCP string legitimately contains that substring
 * inside its own prohibition.
 */
const RETIRED_ADVICE = [
  { name: "pre-wait before messaging a busy agent", re: /before messaging a (?:potentially )?busy agent/i },
  { name: "pre-wait to avoid preemption", re: /use x_comms_wait first/i },
  { name: "a send is preemptive", re: /x_comms_send is preemptive/i },
  { name: "a target may be busy, so wait first", re: /target may be busy,? (?:use |x_comms_wait )?wait first/i },
] as const;

describe("every agent-facing x-comms surface states the same busy-target rule", () => {
  for (const surface of SURFACES) {
    describe(surface.name, () => {
      for (const rule of SHARED_RULES) {
        it(rule.name, () => {
          assert.match(surface.text, rule.re);
        });
      }

      it("states the queue bounds, and they are the bounds in defer-queue.ts", () => {
        // Spelled out rather than interpolated so a wrong number in the prose
        // cannot be satisfied by a wrong number here.
        assert.match(surface.text, /8 deep per target/);
        assert.match(surface.text, /30[- ]minute window/);
        assert.equal(DEFER_MAX_DEPTH_PER_TARGET, 8, "the depth the prose states");
        assert.equal(DEFER_EXPIRY_MS, 30 * 60 * 1000, "the window the prose states");
      });

      it("forbids pre-waiting, in its own register", () => {
        assert.match(surface.text, surface.forbidsPreWait);
      });

      for (const retired of RETIRED_ADVICE) {
        it(`carries no ${retired.name}`, () => {
          assert.doesNotMatch(surface.text, retired.re);
        });
      }
    });
  }
});

describe("the surfaces cover the same ground, not just the same rule", () => {
  // The contradiction #709 reported was found by reading one surface against
  // another, so the cheap generalisation of that read is pinned here: the load-
  // bearing reply facts every surface states, each asserted on all of them. A
  // surface that stops saying one is no longer mirroring the others.
  // The registration step is absent from the MCP surface, which says "Register
  // the sender's daemon first" without naming `x_comms_add_daemon`. That is an
  // omission in the tersest of the three surfaces rather than a contradiction,
  // so it is not asserted here: this suite exists to pin the shared rule, and a
  // fact only two surfaces carry would turn it into a wish list.
  const LOAD_BEARING = [
    { name: "x_comms_send", re: /x_comms_send/ },
    { name: "x_comms_list_permissions", re: /(?:x_comms_)?list_permissions/ },
    { name: "x_comms_allow_permission", re: /(?:x_comms_)?allow_permission/ },
    { name: "x_comms_deny_permission", re: /(?:x_comms_)?deny_permission/ },
    { name: "sender.agentId", re: /sender\.agentId/ },
  ] as const;

  for (const surface of SURFACES) {
    describe(surface.name, () => {
      for (const fact of LOAD_BEARING) {
        it(`names ${fact.name}`, () => {
          assert.match(
            surface.text,
            fact.re,
            `${surface.name} no longer mentions ${fact.name}, so it has stopped mirroring the others`,
          );
        });
      }
    });
  }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "handlers.ts"), "utf8");

/**
 * `resolveDaemonEnabled`'s own contract (absent-means-enabled, explicit false
 * disables) is asserted in settings.test.ts, which runs. This file covers the
 * half that suite cannot: that the function is actually *called* from the send
 * and presence paths. A defined-but-uncalled resolver is the #639 regression —
 * the settings toggle was stored and then ignored.
 */
describe("daemonEnabled is enforced, not just stored (#639)", () => {
  it("is called from the send lookup and from presence probing", () => {
    // Before this change the function existed and had exactly one hit in the
    // source: its own definition. The settings toggle was a no-op.
    const calls = src.match(/resolveDaemonEnabled\(/g) ?? [];
    // 1 in the comment-adjacent helper, 1 in validPeerTargets, minus the import.
    assert.ok(calls.length >= 2, `expected >=2 call sites, found ${calls.length}`);
  });

  it("filters the shared gate/drain lookup, not one side of it", () => {
    // targetRegistryEntry's contract is that the gate and the drain agree. A
    // filter applied to only one reintroduces the preemption bug it prevents.
    const body = src.slice(
      src.indexOf("function targetRegistryEntry"),
      src.indexOf("function chatEnabledDaemon"),
    );
    assert.ok(
      body.includes("chatEnabledDaemon"),
      "targetRegistryEntry must filter on chatEnabledDaemon",
    );
  });

  it("is filtered in presence by the same registry name the UI persists under", () => {
    // settings-prototype.tsx writes daemonEnabled[daemon.name]; a mismatch here
    // would make the toggle work for one spelling of the daemon and not another.
    assert.ok(
      /resolveDaemonEnabled\(readUiPrefs\(\), daemon\.name\)/.test(src),
      "presence must filter on the same daemon.name the UI writes",
    );
  });
});

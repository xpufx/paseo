import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDaemonEnabled } from "./settings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "handlers.ts"), "utf8");

describe("daemonEnabled is enforced, not just stored (#639)", () => {
  it("is called from the send lookup and from presence probing", () => {
    // Before this change the function existed and had exactly one hit in the
    // source: its own definition. The settings toggle was a no-op.
    const calls = src.match(/resolveDaemonEnabled\(/g) ?? [];
    // 1 in the comment-adjacent helper, 1 in validPeerTargets, minus the import.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("filters the shared gate/drain lookup, not one side of it", () => {
    // targetRegistryEntry's contract is that the gate and the drain agree. A
    // filter applied to only one reintroduces the preemption bug it prevents.
    const body = src.slice(
      src.indexOf("function targetRegistryEntry"),
      src.indexOf("function chatEnabledDaemon")
    );
    expect(body).toContain("chatEnabledDaemon");
  });

  it("keeps absent-means-enabled", () => {
    // The existing contract: a missing key is enabled, only an explicit false
    // disables. Silently flipping this would mute every user's mesh on upgrade.
    expect(resolveDaemonEnabled({}, "anything")).toBe(true);
    expect(resolveDaemonEnabled({ daemonEnabled: {} }, "anything")).toBe(true);
    expect(resolveDaemonEnabled({ daemonEnabled: { a: true } }, "a")).toBe(true);
    expect(resolveDaemonEnabled({ daemonEnabled: { a: false } }, "a")).toBe(false);
  });

  it("does not disable presence for a daemon the user left on", () => {
    expect(resolveDaemonEnabled({ daemonEnabled: { b: false } }, "a")).toBe(true);
  });

  it("is filtered in presence by the same registry name the UI persists under", () => {
    // settings-prototype.tsx writes daemonEnabled[daemon.name]; a mismatch here
    // would make the toggle work for one spelling of the daemon and not another.
    expect(src).toMatch(/resolveDaemonEnabled\(readUiPrefs\(\), daemon\.name\)/);
  });
});

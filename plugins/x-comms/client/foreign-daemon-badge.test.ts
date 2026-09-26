import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "settings-prototype.tsx"), "utf8");

describe("foreign daemons are labelled as manual externals (#639 pillar b)", () => {
  it("badges only registry-file daemons, not configured hosts", () => {
    // The distinction the operator drew: the registry file is useful for a
    // FOREIGN daemon. Badging everything would make the badge meaningless.
    expect(src).toContain('daemon.source === "registry"');
    expect(src).toContain('label="manual external"');
  });

  it("keeps the health badge alongside the source badge", () => {
    // Both matter; replacing one with the other would lose reachability.
    expect(src).toContain("ReachabilityBadge");
    expect(src).toMatch(/manual external[\s\S]{0,400}ReachabilityBadge/);
  });

  it("no longer presents the registry file as required or primary", () => {
    // Under the 0.9.2 model a configured host needs no registry entry at all,
    // so an empty file is a normal state, not a missing setup step.
    expect(src).not.toContain("No registry file yet.");
    expect(src).not.toContain("Add your first daemon below.");
    expect(src).toContain("The registry file is optional.");
  });

  it("names the add form for what it adds", () => {
    expect(src).toContain('title="Add foreign daemon"');
    expect(src).not.toContain('title="Add daemon"');
  });
});

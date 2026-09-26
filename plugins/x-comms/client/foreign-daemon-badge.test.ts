import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "settings-prototype.tsx"), "utf8");

describe("foreign daemons are labelled as manual externals (#639 pillar b)", () => {
  it("badges only registry-file daemons, not configured hosts", () => {
    // The distinction the operator drew: the registry file is useful for a
    // FOREIGN daemon. Badging everything would make the badge meaningless.
    assert.ok(
      src.includes('daemon.source === "registry"'),
      "the badge must be gated on the registry source",
    );
    assert.ok(src.includes('label="manual external"'), "the badge label must be present");
  });

  it("keeps the health badge alongside the source badge", () => {
    // Both matter; replacing one with the other would lose reachability.
    assert.ok(src.includes("ReachabilityBadge"), "the health badge must survive");
    assert.ok(
      /manual external[\s\S]{0,400}ReachabilityBadge/.test(src),
      "the source badge and the health badge must render together",
    );
  });

  it("no longer presents the registry file as required or primary", () => {
    // Under the 0.9.2 model a configured host needs no registry entry at all,
    // so an empty file is a normal state, not a missing setup step.
    assert.ok(!src.includes("No registry file yet."), "the empty-state nag must be gone");
    assert.ok(!src.includes("Add your first daemon below."), "the setup nag must be gone");
    assert.ok(
      src.includes("The registry file is optional."),
      "the file must be described as optional",
    );
  });

  it("names the add form for what it adds", () => {
    assert.ok(src.includes('title="Add foreign daemon"'), "the form title must name the action");
    assert.ok(!src.includes('title="Add daemon"'), "the vague form title must be gone");
  });
});

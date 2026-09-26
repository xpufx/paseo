import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginIds, manifestFor } from "./publish-npm.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const src = readFileSync(join(ROOT, "scripts", "npm-acquisition-smoke.mjs"), "utf8");

/**
 * Regression for #623.
 *
 * The smoke kept its own hand-maintained array of eight plugins while
 * `pluginIds()` derives eleven, so `uppidi-fleet`, `wellbeing` and
 * `worktree-install` were published but never packed. `uppidi-fleet` is exactly
 * where the #621 leak survived: 33KB of `client/testing/` would have shipped
 * inside the tarball and nothing in CI assembled that tarball to notice.
 */

test("the smoke derives its plugin set instead of listing it", () => {
  assert.match(
    src,
    /function publishablePackages\(\)/,
    "a new publishable plugin must not need a second edit to be covered",
  );
  assert.doesNotMatch(
    src,
    /const PACKAGES = \[/,
    "a literal package array is what let three plugins go uncovered",
  );
});

test("every publishable plugin is covered", () => {
  // By construction today; asserted so a future filter or allowlist that
  // narrows the set fails here rather than silently in production.
  const covered = new Set(pluginIds());
  assert.ok(covered.size >= 11, `expected the full publishable set, got ${covered.size}`);
});

test("the three plugins the hardcoded array omitted are covered", () => {
  for (const id of ["uppidi-fleet", "wellbeing", "worktree-install"]) {
    assert.ok(pluginIds().includes(id), `${id} must be a publishable plugin`);
    assert.ok(
      !src.includes(`id: "${id}"`) || src.includes("publishablePackages"),
      `${id} must be covered by derivation, not by an ad-hoc entry`,
    );
  }
});

test("the Paseo floor is read from requirements, not a top-level field", () => {
  // Most manifests have no top-level `paseo`, so reading it yielded the
  // ">=0.8.0" default for every plugin and the floor assertion passed by
  // comparing a default against itself.
  assert.match(src, /meta\.requirements\?\.paseo/);
  assert.doesNotMatch(src, /meta\.paseo === "string"/);
});

test("uppidi-fleet's testing harness stays out of the published tarball", () => {
  // The leak #621 actually shipped. Asserted on the allowlist rather than by
  // packing, so it is a fast check that does not need a network-free npm run.
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "plugins", "uppidi-fleet", "package.json"), "utf8"),
  );
  assert.ok(
    pkg.files.includes("!client/testing"),
    "uppidi-fleet must exclude client/testing from its published files",
  );
  // And the derived allowlist the smoke actually packs from must exclude it too,
  // not just the raw package.json entry.
  const allowlist = manifestFor("uppidi-fleet").files;
  assert.ok(
    !allowlist.some((f) => f === "client/testing"),
    "the packed file set must not include client/testing",
  );
});

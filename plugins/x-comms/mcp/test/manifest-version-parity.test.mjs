// Drift guard for the nested mcp/package.json version (#604).
//
// mcp/package.json reuses the plugin's npm name, so it and the plugin root
// manifest describe ONE npm package — but a release bump only ever edits the
// root (chore(release): bump existing published plugin package versions), and
// the root's `files` ships `mcp/` inside the tarball. Nothing reconciled the two
// copies, so the nested one sat at 0.3.0 while the plugin published 0.3.2, and
// the same blind spot is what kept a wrong `license` value in the nested copy
// for months (#595).
//
// A release bump now syncs the nested version at stage time
// (scripts/publish-npm.mjs -> syncNestedManifestVersions), so the shipped
// tarball cannot carry a stale version. This test guards the committed source
// so the drift is caught in ordinary CI instead of by a consumer.
//
// Fix a failure by bumping the root manifest and letting the stage step sync
// the nested copy, never by loosening these assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const readManifest = (relative) => JSON.parse(readFileSync(join(HERE, relative), "utf8"));
const plugin = readManifest("../../package.json");
const mcp = readManifest("../package.json");

test("the nested mcp manifest is published, so its version is what consumers see (#604)", () => {
  assert.ok(
    plugin.files?.includes("mcp"),
    "plugins/x-comms/package.json must ship `mcp` for this guard to mean anything; it stopped shipping the nested manifest",
  );
  assert.equal(
    mcp.name,
    plugin.name,
    "mcp/package.json must reuse the plugin's npm name — that shared identity is what makes the two versions describe one package",
  );
});

test("the nested mcp manifest reports the plugin's version (#604)", () => {
  assert.equal(
    mcp.version,
    plugin.version,
    `mcp/package.json is at ${mcp.version} but the plugin publishes ${plugin.version}. ` +
      "The nested manifest ships inside the tarball, so consumers see the stale value. " +
      "Bump the root manifest; `make npm-stage` syncs the nested copy at pack time.",
  );
});

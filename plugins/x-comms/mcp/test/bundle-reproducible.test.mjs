// The committed mcp/paseo-x-comms.bundled.mjs is the shipped artifact:
// server/injection.ts copies it to a stable path and the daemon injects that
// into agents. Nobody runs plugins/x-comms/mcp/paseo-x-comms.mjs in production.
//
// So a source fix that is not reflected in the bundle is a fix that does not
// ship (#600). This test regenerates the bundle with the pinned toolchain and
// fails on any divergence from what is committed, which is what makes the
// artifact auditable instead of whatever the last person happened to install.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { bundle, COMMITTED } from "../bundle.mjs";

const require = createRequire(import.meta.url);

// A bounded report of where the two artifacts diverge. The bundles are 37k
// lines, so printing all of it helps nobody; pointing at the first difference
// with context is enough to see which source edit was missed.
function firstDivergence(expected, actual, context = 3) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const window = (lines) => lines.slice(i, i + context).map((line, n) => `  ${i + n + 1} | ${line}`).join("\n");
  return [
    `first divergence at line ${i + 1} (committed has ${a.length} lines, regenerated has ${b.length})`,
    "committed:",
    window(a),
    "regenerated:",
    window(b),
  ].join("\n");
}

test("committed MCP bundle is byte-identical to a fresh build with the pinned esbuild (#600)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paseo-x-comms-bundle-"));
  const regenerated = join(dir, "paseo-x-comms.bundled.mjs");
  try {
    await bundle(regenerated);
    const committed = readFileSync(COMMITTED, "utf8");
    const fresh = readFileSync(regenerated, "utf8");
    assert.equal(
      fresh,
      committed,
      "mcp/paseo-x-comms.bundled.mjs is not reproducible from mcp/paseo-x-comms.mjs with the pinned esbuild.\n" +
        "Run `npm run bundle:mcp -w @xpufx/paseo-x-comms` and commit the result.\n\n" +
        firstDivergence(committed, fresh),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the bundle build uses an explicitly declared, exactly pinned esbuild (#600)", () => {
  const dev = require("../../package.json").devDependencies ?? {};
  assert.equal(
    dev.esbuild,
    require("esbuild/package.json").version,
    "plugins/x-comms must declare the esbuild it builds the shipped bundle with",
  );
  assert.match(
    dev.esbuild,
    /^\d+\.\d+\.\d+$/,
    `esbuild must be pinned to an exact version, got ${dev.esbuild}`,
  );
});

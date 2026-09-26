/**
 * The gate for #633: a plugin served from this checkout's helper must be able to
 * say which revision of the helper it is running, and the answer must be checked
 * rather than declared.
 *
 * The failure this exists for is not a lint. PR #622 merged a fix that bound six
 * shared primitives; the daemon serving uppidi-fleet was 15 commits behind, the
 * plugin bound none of it, CI went green, and a reload three minutes after the
 * merge reported success and changed nothing. Nothing in the tree noticed,
 * because a plugin bundling `paseo-plugin-helper/client` gets this checkout's
 * helper *source* — there is no copy of it inside the plugin to compare against.
 *
 * So each plugin is checked on four things, all re-derived from files on disk:
 *   1. what it actually serves (a bare specifier means this checkout; a relative
 *      ./vendor/paseo-plugin-helper/... means the plugin's own committed copy);
 *   2. a declared helper version, so there is something to disagree with;
 *   3. a generated PLUGIN_VERSION stamp, so the served tree is attributable to a
 *      commit — without it "which helper is this process running" has no answer
 *      that survives the process;
 *   4. that the checkout's helper is at least as new as the helper the plugin was
 *      stamped against, and still the version the plugin declares.
 *
 * Every assertion fails with the plugin named and the remedy stated. The last
 * tests assert the suite is not vacuous: a plugin with no declaration, no stamp,
 * a mismatched version, or a resolution it does not have must be reported `stale`
 * by the same code the other tests rely on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELPER_ROOT,
  evaluateHelperIdentity,
  isAncestorOrEqual,
  readHelperVersion,
  resolveServedFrom,
} from "./lib/helper-identity.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_VERSION = readHelperVersion(path.join(REPO_ROOT, HELPER_ROOT));

/**
 * Plugins discovered on disk, minus the committed alias symlink
 * `plugins/uppidi-forge -> uppidi-fleet`. Following it would evaluate one tree
 * twice under two names and report its findings twice.
 */
const PLUGIN_DIRS = fs
  .readdirSync(path.join(REPO_ROOT, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  .map((entry) => entry.name)
  .sort();

/**
 * Plugins that mix both helper forms in their runtime sources, mapped to the
 * file that does it. `mixed` is reported stale, so every entry here is a known
 * failure this gate is carrying rather than one it has fixed. Asserted in both
 * directions below: a new mixed plugin fails, and fixing one demands dropping
 * the entry instead of letting the exemption rot.
 */
const KNOWN_MIXED_RESOLUTIONS = {
  slash: "client/commands.ts imports ./vendor/paseo-plugin-helper/host while the rest of the plugin imports the bare specifier",
};

function evaluateAll() {
  return PLUGIN_DIRS.map((name) => ({
    name,
    identity: evaluateHelperIdentity(path.join(REPO_ROOT, "plugins", name), REPO_ROOT),
  }));
}

function withScratchPlugin(prefix, write, run) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const pluginDir = path.join(scratch, "plugins", "probe");
  fs.mkdirSync(path.join(pluginDir, "client"), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, "shared"), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "index.client.tsx"),
    'import { Card } from "paseo-plugin-helper/client";\nexport default Card;\n',
  );
  fs.writeFileSync(
    path.join(pluginDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: {
          "paseo-plugin-helper/client": [`../../${HELPER_ROOT}/src/client/index.ts`],
        },
      },
    }),
  );
  try {
    write(pluginDir);
    return run(evaluateHelperIdentity(pluginDir, REPO_ROOT));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("the helper this gate measures against is a real, readable version", () => {
  assert.match(
    HELPER_VERSION ?? "",
    /^[0-9]+\.[0-9]+\.[0-9]+/,
    `expected a real version in ${HELPER_ROOT}/package.json, got ${JSON.stringify(HELPER_VERSION)}`,
  );
});

test("plugin discovery is not vacuous: every workspace plugin is evaluated", () => {
  const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.ok(PLUGIN_DIRS.length > 1, `expected several plugins, found ${PLUGIN_DIRS.length}`);
  for (const workspace of root.workspaces ?? []) {
    if (!workspace.startsWith("plugins/")) continue;
    const name = workspace.slice("plugins/".length);
    assert.ok(PLUGIN_DIRS.includes(name), `${name} was not discovered by the gate`);
  }
  assert.ok(
    !PLUGIN_DIRS.includes("uppidi-forge"),
    "plugins/uppidi-forge is a symlink alias of uppidi-fleet and must stay out of the sweep",
  );
});

test("every checkout-served plugin declares the helper it serves", () => {
  const offenders = evaluateAll()
    .filter(({ identity }) => identity.servedFrom === "checkout")
    .filter(({ identity }) => !identity.declared?.version)
    .map(
      ({ name }) =>
        `plugins/${name} resolves the bare paseo-plugin-helper specifier into ${HELPER_ROOT}/src but declares no helper version; add shared/helper-version.ts (HELPER_VERSION + HELPER_SERVED_FROM)`,
    );
  assert.deepEqual(offenders, []);
});

test("every declared HELPER_SERVED_FROM matches what the plugin actually serves", () => {
  const offenders = evaluateAll()
    .filter(({ identity }) => identity.declared?.servedFrom)
    .filter(({ identity }) => identity.declared.servedFrom !== identity.servedFrom)
    .map(
      ({ name, identity }) =>
        `plugins/${name} declares HELPER_SERVED_FROM="${identity.declared.servedFrom}" but serves "${identity.servedFrom}"`,
    );
  assert.deepEqual(offenders, []);
});

test("every checkout-served plugin carries a generated PLUGIN_VERSION stamp", () => {
  const offenders = evaluateAll()
    .filter(({ identity }) => identity.servedFrom === "checkout" || identity.servedFrom === "mixed")
    .filter(({ identity }) => !identity.stamped?.sha)
    .map(
      ({ name, identity }) =>
        `plugins/${name} is served from this checkout's helper and cannot attribute it to a commit` +
        (identity.stamped
          ? ` (stamp carries no "+<sha>": ${identity.stamped.full})`
          : " (no shared/version.ts)") +
        "; add a `stamp` script and commit the generated shared/version.ts",
    );
  assert.deepEqual(offenders, []);
});

test("the helper a checkout serves is the version the plugin declares", () => {
  const offenders = evaluateAll()
    .filter(({ identity }) => identity.declared?.version && identity.resolved.version)
    .filter(({ identity }) => identity.declared.version !== identity.resolved.version)
    .map(
      ({ name, identity }) =>
        `plugins/${name} declares helper ${identity.declared.version} but ${HELPER_ROOT} is ${identity.resolved.version}`,
    );
  assert.deepEqual(offenders, []);
});

test("the helper a checkout serves is not older than the plugin's own stamp", () => {
  const offenders = evaluateAll()
    .filter(({ identity }) => identity.servedFrom === "checkout")
    .filter(({ identity }) => identity.stamped?.helperRevision && identity.resolved.revision)
    .filter(
      ({ identity }) =>
        !isAncestorOrEqual(REPO_ROOT, identity.stamped.helperRevision, identity.resolved.revision),
    )
    .map(
      ({ name, identity }) =>
        `plugins/${name} was stamped at ${identity.stamped.sha} (helper ${identity.stamped.helperRevision}) ` +
        `but this checkout only serves helper ${identity.resolved.revision}: the plugin's code is newer than the helper it runs against`,
    );
  assert.deepEqual(offenders, []);
});

test("no plugin mixes the bare specifier with its own vendored copy", () => {
  const mixed = evaluateAll()
    .filter(({ identity }) => identity.servedFrom === "mixed")
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(
    mixed,
    Object.keys(KNOWN_MIXED_RESOLUTIONS).sort(),
    "the set of mixed-resolution plugins changed. A new one must import the helper through a single " +
      "form (bare specifier, or the relative vendored path) — two copies in one bundle means nothing in " +
      "the log can say which one ran. A fixed one must have its entry removed from " +
      "KNOWN_MIXED_RESOLUTIONS in scripts/helper-resolution.test.mjs. Currently known: " +
      JSON.stringify(KNOWN_MIXED_RESOLUTIONS),
  );
});

test("nothing is reported stale once the gate's own conditions hold", () => {
  const offenders = evaluateAll()
    .filter(({ identity }) => identity.status === "stale" || identity.status === "unknown")
    .filter(({ name }) => !KNOWN_MIXED_RESOLUTIONS[name])
    .map(({ name, identity }) => `plugins/${name}: ${identity.reasons.join("; ")}`);
  assert.deepEqual(offenders, []);
});

test("the reported identity is a real measurement, not a passthrough", () => {
  const identity = evaluateHelperIdentity(path.join(REPO_ROOT, "plugins", "uppidi-fleet"), REPO_ROOT);
  assert.equal(identity.servedFrom, "checkout");
  assert.equal(identity.route, "tsconfig-paths:src");
  assert.ok(identity.bareImports > 0, "expected uppidi-fleet to import the bare helper specifier");
  assert.equal(identity.resolved.version, HELPER_VERSION);
  assert.match(identity.resolved.revision ?? "", /^[0-9a-f]{7,}$/);
  assert.equal(identity.stamped.sha, identity.stamped.full.split("+").pop());
  assert.equal(identity.declared.servedFrom, "checkout");
  // `behind` is the healthy direction of travel — the checkout's helper moved
  // past the plugin's stamp — and only a genuine failure may report stale.
  assert.ok(
    identity.status === "ok" || identity.status === "behind",
    `uppidi-fleet must not be stale: ${identity.reasons.join("; ")}`,
  );
});

test("a plugin that resolves no helper is not asked to declare one", () => {
  // worktree-install exists to prove the shared UI kit is not required (#629)
  // and enforces the absence of any helper import in its own client test, so
  // requiring a declaration from it would invert the intent of that plugin.
  const identity = evaluateHelperIdentity(
    path.join(REPO_ROOT, "plugins", "worktree-install"),
    REPO_ROOT,
  );
  assert.equal(identity.servedFrom, "none");
  assert.equal(identity.declared, null);
  assert.deepEqual(identity.reasons, []);
  assert.equal(identity.status, "ok");
});

test("a committed vendored tree is the publish artifact, not the runtime resolution", () => {
  // The fact that makes "just vendor the helper" the wrong fix for #633: these
  // plugins carry a committed copy *and* still run this checkout's helper, so
  // the copy would not have changed one byte of what the daemon served.
  for (const name of [
    "demo",
    "forges",
    "mcp-tools",
    "plugin-updates",
    "top",
    "twofado",
    "wellbeing",
  ]) {
    const observed = resolveServedFrom(path.join(REPO_ROOT, "plugins", name));
    assert.equal(observed.servedFrom, "checkout", `plugins/${name} is expected to be checkout-served`);
    assert.ok(
      observed.vendoredTrees.length > 0,
      `plugins/${name} is expected to also carry a publish-only vendored tree`,
    );
  }

  // x-comms is the one plugin that really does serve its own copy.
  const xComms = resolveServedFrom(path.join(REPO_ROOT, "plugins", "x-comms"));
  assert.equal(xComms.servedFrom, "vendored");
  assert.equal(xComms.route, null);

  // slash is the one plugin that serves both, which is why it is carried in
  // KNOWN_MIXED_RESOLUTIONS rather than here. One file imports the vendored
  // path; the rest import the bare specifier, so the bundle carries two copies.
  const slash = resolveServedFrom(path.join(REPO_ROOT, "plugins", "slash"));
  assert.equal(slash.servedFrom, "mixed");
  assert.deepEqual(slash.vendoredSources, ["client/commands.ts"]);
  assert.ok(slash.bareSources.length > 1);
});

test("the gate reports drift instead of passing vacuously", () => {
  // A plugin that bundles this checkout's helper, declares nothing and carries no
  // stamp is precisely the pre-fix uppidi-fleet. It must come back stale with
  // both reasons, or this gate cannot be trusted to catch the real thing.
  withScratchPlugin(
    "helper-resolution-bare-",
    () => {},
    (identity) => {
      assert.equal(identity.servedFrom, "checkout");
      assert.equal(identity.status, "stale");
      assert.ok(
        identity.reasons.some((reason) => reason.includes("no declared helper expectation")),
        `expected a missing-declaration reason, got: ${identity.reasons.join("; ")}`,
      );
      assert.ok(
        identity.reasons.some((reason) => reason.includes("no shared/version.ts stamp")),
        `expected a missing-stamp reason, got: ${identity.reasons.join("; ")}`,
      );
    },
  );
});

test("a declared helper version the checkout does not carry is reported", () => {
  withScratchPlugin(
    "helper-resolution-mismatch-",
    (pluginDir) =>
      fs.writeFileSync(
        path.join(pluginDir, "shared", "helper-version.ts"),
        'export const HELPER_VERSION = "0.0.0-not-a-real-helper";\nexport const HELPER_SERVED_FROM = "checkout";\n',
      ),
    (identity) => {
      assert.equal(identity.status, "stale");
      assert.ok(
        identity.reasons.some(
          (reason) => reason.includes("0.0.0-not-a-real-helper") && reason.includes(HELPER_VERSION),
        ),
        `expected the version mismatch to be named, got: ${identity.reasons.join("; ")}`,
      );
    },
  );
});

test("a plugin declaring a vendored copy it does not have is reported", () => {
  withScratchPlugin(
    "helper-resolution-wrongmode-",
    (pluginDir) =>
      fs.writeFileSync(
        path.join(pluginDir, "shared", "helper-version.ts"),
        `export const HELPER_VERSION = ${JSON.stringify(HELPER_VERSION)};\nexport const HELPER_SERVED_FROM = "vendored";\n`,
      ),
    (identity) => {
      assert.equal(identity.servedFrom, "checkout");
      assert.equal(identity.status, "stale");
      assert.ok(
        identity.reasons.some((reason) => reason.includes('declares HELPER_SERVED_FROM="vendored"')),
        `expected the declared resolution to be contradicted, got: ${identity.reasons.join("; ")}`,
      );
    },
  );
});

test("a helper older than the plugin's stamp is reported", () => {
  // The rollback shape: the plugin's code postdates the helper this checkout
  // serves, so the plugin is running against older primitives than it was written
  // for — #622 with the branches reversed.
  withScratchPlugin(
    "helper-resolution-old-helper-",
    (pluginDir) => {
      fs.writeFileSync(
        path.join(pluginDir, "shared", "helper-version.ts"),
        `export const HELPER_VERSION = ${JSON.stringify(HELPER_VERSION)};\nexport const HELPER_SERVED_FROM = "checkout";\n`,
      );
      fs.writeFileSync(
        path.join(pluginDir, "shared", "version.ts"),
        'export const PLUGIN_VERSION = "0.0.0+0000000";\n',
      );
    },
    (identity) => {
      assert.equal(identity.servedFrom, "checkout");
      // The scratch plugin lives outside the repository, so git cannot resolve a
      // revision for it; that must be reported as undecidable, never as a pass.
      assert.ok(
        identity.status === "stale" || identity.status === "unknown",
        `expected stale/unknown, got ${identity.status}`,
      );
    },
  );
});

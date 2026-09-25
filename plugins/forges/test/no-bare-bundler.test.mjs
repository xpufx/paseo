// `npm test` used to pre-bundle every test file with a bare `esbuild` on $PATH.
// No package.json declared which esbuild that was, so the suite ran against
// whatever the machine happened to provide -- 0.20.1 from Debian against the
// lockfile's 0.27.7, and neither is what the tests are meant to pin (#603, the
// same class of bug #600 fixed for x-comms' shipped bundle).
//
// The fix was to stop bundling: these tests run directly under node's type
// stripping, so the runner is node itself. That leaves no bundler version to
// drift, which is only true as long as nothing reintroduces one -- so assert it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

// Bundler/transpiler commands, mapped to the package that provides each. A
// command is only acceptable if that package is a declared dependency, so
// `tsc` (from the declared `typescript`) passes while a bare `esbuild` does not.
const TOOLCHAIN_PROVIDERS = {
  esbuild: "esbuild",
  parcel: "parcel",
  rollup: "rollup",
  "ts-node": "ts-node",
  tsx: "tsx",
  tsc: "typescript",
  vite: "vite",
  vitest: "vitest",
  webpack: "webpack",
};

// npm puts node_modules/.bin ahead of the system PATH, so a declared package's
// bin always wins. The defect is an *undeclared* tool, not a declared one.
function leadingCommands(script) {
  return script
    .split(/&&|\|\||;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.match(/^([A-Za-z0-9_./-]+)/) ?? [])[1])
    .filter(Boolean)
    .map((cmd) => cmd.split("/").pop());
}

test("no npm script runs a bundler/transpiler that is not a declared dependency", () => {
  const offenders = Object.entries(pkg.scripts ?? {}).flatMap(([name, script]) =>
    leadingCommands(script)
      .filter((cmd) => cmd in TOOLCHAIN_PROVIDERS)
      .filter((cmd) => !declared.has(TOOLCHAIN_PROVIDERS[cmd]))
      .map((cmd) => `scripts.${name} runs \`${cmd}\` but does not declare ${TOOLCHAIN_PROVIDERS[cmd]}`),
  );
  assert.deepEqual(
    offenders,
    [],
    "an npm script must not resolve a toolchain from $PATH. Add the package to " +
      "devDependencies pinned exactly, or drop the step (see test/resolve-ts-hooks.mjs). (#603)",
  );
});

test("no npm script uses a bare esbuild CLI", () => {
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    assert.doesNotMatch(
      script,
      /(?:^|[\s;&|(])esbuild\s/,
      `scripts.${name} calls bare \`esbuild\`, which resolves from $PATH, not from the lockfile (#603)`,
    );
  }
});

test("tests run under node directly, so a PATH lookup cannot change the result", () => {
  assert.equal(pkg.scripts.test.startsWith("node "), true, "tests must run under node directly");
  assert.match(pkg.scripts.test, /register-ts-hooks\.mjs/, "tests need the TS resolve hooks");
});

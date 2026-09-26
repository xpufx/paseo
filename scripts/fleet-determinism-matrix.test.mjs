/**
 * Negative tests for scripts/fleet-determinism-matrix.mjs (#705).
 *
 * ## Why this file exists, and why it is mostly negative
 *
 * The generator's entire value is that it refuses to describe code that is not
 * there. A validator with no tests is a validator nobody has watched fail, and
 * an unverified validator is indistinguishable from a validator that always
 * agrees with you -- which is the exact shape of the #702 defect this matrix
 * was written to end: a check that reports green forever without ever having
 * been shown to go red.
 *
 * So nearly every test here feeds `validate` a deliberately wrong judgement map
 * and asserts it says so. The one positive test pins the other half: a correct
 * map must produce no errors, or a validator that rejects everything would
 * satisfy every test below.
 *
 * ## The test that justified the file
 *
 * The generator's first draft validated `part.exports` while the judgement map
 * was written at `part.anchors.exports`. The export-anchor check therefore
 * validated nothing at all, and a renamed export passed clean. Nothing about
 * reading the code revealed it -- the check looked correct, was covered by
 * being present, and reported success indefinitely.
 *
 * It was found by mutating an anchor and watching for a non-zero exit, which is
 * what `anchors must be written under \`anchors\`` below now pins forever. A
 * guard written from the shape of the code would have shipped that bug. The
 * lesson generalises past this generator: write the mutation tests first, and
 * treat "the check exists" as a claim that needs evidence rather than a fact.
 *
 * ## Placement
 *
 * `scripts/` beside the generator, matching the sibling guards
 * (`declared-tooling.test.mjs`, `unreachable-tests.test.mjs`). Invoked by
 * `check:fleet-matrix` in the root package.json, chained into `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validate,
  parseExports,
  DETERMINISTIC,
  CONTESTED,
  LABELS,
} from "./fleet-determinism-matrix.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "plugins/uppidi-fleet";
const OUT = `${PLUGIN}/docs/determinism-matrix.md`;
const GENERATOR = "scripts/fleet-determinism-matrix.mjs";

/**
 * Build an inventory entry from real source text, parsing exports with the
 * generator's own parser. Using the real parser matters: a fixture that
 * hand-wrote its export list would agree with a broken parser.
 */
function entry(src, { test: isTest = false } = {}) {
  return {
    src,
    test: isTest,
    layer: "server",
    loc: src.replace(/\n$/, "").split("\n").length,
    exports: parseExports(src),
  };
}

const GOOD_SRC = [
  "export function alphaHandler(input: string): string {",
  "  return input;",
  "}",
  "export const ALPHA_CONST = 1;",
  "class Internal {",
  "  private deliverInternal() {",
  "    return true;",
  "  }",
  "}",
  "",
].join("\n");

const GOOD_FILE = `${PLUGIN}/server/good.ts`;

/** An inventory with one describable source file, one described part, no suites. */
function baseInventory() {
  return new Map([[GOOD_FILE, entry(GOOD_SRC)]]);
}

/** A judgement map that is correct in every respect the validator checks. */
function goodPart(over = {}) {
  return {
    file: GOOD_FILE,
    part: "A described part",
    label: DETERMINISTIC,
    anchors: { exports: ["alphaHandler", "ALPHA_CONST"], symbols: ["deliverInternal"] },
    evidence: [[`good.ts:1-3`, "the handler body"]],
    note: "n/a",
    ...over,
  };
}

const run = (parts, inv, suiteNotes = {}) => validate(parts, inv, suiteNotes);

test("parseExports finds every declaration form the plugin uses", () => {
  const e = entry(GOOD_SRC);
  assert.deepEqual(e.exports, ["ALPHA_CONST", "alphaHandler"]);
  // A class member is not a top-level export, which is why the map has a
  // separate `symbols` anchor kind for internals.
  assert.ok(!e.exports.includes("deliverInternal"));
});

test("parseExports handles re-export barrels in block and inline form", () => {
  assert.deepEqual(
    parseExports('export {\n  aSchema,\n  bContract,\n} from "./contracts.js";'),
    ["aSchema", "bContract"],
  );
  assert.deepEqual(parseExports('export { a as b } from "./x.js";'), ["b"]);
});

test("a correct judgement map produces no errors", () => {
  assert.deepEqual(run([goodPart()], baseInventory()), []);
});

test("a renamed top-level export is rejected", () => {
  const parts = [goodPart({ anchors: { exports: ["alphaHandlerRenamed"], symbols: [] } })];
  const errors = run(parts, baseInventory());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /anchor export "alphaHandlerRenamed" is not a top-level export/);
});

test("a removed internal symbol is rejected", () => {
  const parts = [goodPart({ anchors: { exports: [], symbols: ["deliverInternalGone"] } })];
  const errors = run(parts, baseInventory());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /anchor symbol "deliverInternalGone" does not appear in the file/);
});

test("anchors written at the top level instead of under `anchors` are rejected", () => {
  // The regression test for the bug this file exists to prevent: the validator
  // read `part.exports`, the map was written at `part.anchors.exports`, and the
  // export check silently validated nothing. This asserts the mismatch is now
  // loud rather than inert.
  const parts = [
    goodPart({ exports: ["alphaHandlerRenamed"], anchors: undefined }),
  ];
  const errors = run(parts, baseInventory());
  assert.ok(
    errors.some((e) => /anchors are written under `anchors`/.test(e)),
    `expected a misplaced-anchor error, got ${JSON.stringify(errors)}`,
  );
  // Crucially, the bogus export must be reported as unvalidated rather than
  // quietly passing. If this assertion ever fails, the guard is dead again.
  assert.ok(
    errors.some((e) => /silently unvalidated/.test(e)),
    "the misplaced export must be reported as unvalidated, not ignored",
  );
});

test("an unknown anchor kind is rejected instead of ignored", () => {
  const parts = [goodPart({ anchors: { symbolz: ["deliverInternal"] } })];
  const errors = run(parts, baseInventory());
  assert.ok(errors.some((e) => /unknown anchor kind "symbolz"/.test(e)));
});

test("evidence past EOF is rejected", () => {
  const parts = [goodPart({ evidence: [[`good.ts:1-9999`, "too far"]] })];
  const errors = run(parts, baseInventory());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /has 9 lines/);
});

test("evidence with a backwards range is rejected", () => {
  const parts = [goodPart({ evidence: [[`good.ts:3-1`, "backwards"]] })];
  const errors = run(parts, baseInventory());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /range runs backwards/);
});

test("evidence citing a file that is not in scope is rejected", () => {
  const parts = [goodPart({ evidence: [[`ghost.ts:1-2`, "no such file"]] })];
  const errors = run(parts, baseInventory());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /resolves to no file in scope/);
});

test("evidence with no line number is rejected", () => {
  const parts = [goodPart({ evidence: [[`good.ts`, "unpinned"]] })];
  const errors = run(parts, baseInventory());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not file:LINE\[-END\] form/);
});

test("a part with no evidence at all is rejected", () => {
  const parts = [goodPart({ evidence: [] })];
  const errors = run(parts, baseInventory());
  assert.ok(errors.some((e) => /needs a name and at least one evidence citation/.test(e)));
});

test("a part naming a file outside the inventory is rejected", () => {
  const parts = [goodPart({ file: `${PLUGIN}/server/nope.ts` })];
  const errors = run(parts, baseInventory());
  assert.ok(errors.some((e) => /not a tracked source file in scope/.test(e)));
});

test("an unknown label is rejected", () => {
  const parts = [goodPart({ label: "probably-fine" })];
  const errors = run(parts, baseInventory());
  assert.ok(errors.some((e) => /unknown label "probably-fine"/.test(e)));
});

test("a new source file nobody described is rejected", () => {
  const inv = baseInventory();
  inv.set(`${PLUGIN}/server/undocumented.ts`, entry("export const NEW = 1;\n"));
  const errors = run([goodPart()], inv);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /in scope but no part describes it/);
});

test("a stale SUITE_NOTES key left by a renamed suite is rejected", () => {
  const errors = run(
    [goodPart()],
    baseInventory(),
    { "shared/contracts.test.ts": "Contract schema validation" },
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SUITE_NOTES has "shared\/contracts\.test\.ts"/);
});

test("test files need no declared part, so suites do not trip the coverage check", () => {
  const inv = baseInventory();
  inv.set(`${PLUGIN}/server/good.test.ts`, entry("import test from 'node:test';\n", { test: true }));
  assert.deepEqual(run([goodPart()], inv), []);
});

test("the generated document is exempt from its own coverage check", () => {
  // The output file is a markdown doc inside the plugin but not a source file;
  // without this exemption the generator would demand a part describing itself.
  const inv = baseInventory();
  assert.ok(fs.existsSync(path.join(ROOT, OUT)));
  assert.deepEqual(run([goodPart()], inv), []);
});

// ---------------------------------------------------------------------------
// End to end: the committed document matches a fresh render
// ---------------------------------------------------------------------------

test("the committed matrix is current", () => {
  // The gate `check:fleet-matrix` exists to run, asserted here so a stale doc
  // fails as a named test rather than as a non-zero exit with no explanation.
  const out = execFileSync(process.execPath, [GENERATOR, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.match(out, /is current/);
});

test("a bare run is idempotent, so regenerating changes nothing", () => {
  const before = fs.readFileSync(path.join(ROOT, OUT), "utf8");
  execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, encoding: "utf8" });
  assert.equal(fs.readFileSync(path.join(ROOT, OUT), "utf8"), before);
});

test("the generator uses no dependencies outside node builtins", () => {
  // "Dependency-free" is a claim in the generator's header and a constraint the
  // repo's own history argues for (see resolve-ts-hooks.mjs on `npx tsx`
  // silently downloading whatever was current). Assert it rather than trust it.
  const src = fs.readFileSync(path.join(ROOT, GENERATOR), "utf8");
  const imports = [...src.matchAll(/^import\s+.*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "expected the generator to import something");
  for (const spec of imports) {
    assert.ok(
      spec.startsWith("node:"),
      `${GENERATOR} imports "${spec}"; only node: builtins are allowed`,
    );
  }
});

test("all four labels are real labels, so none can be a typo", () => {
  assert.deepEqual(LABELS, ["deterministic", "hybrid", "ai-llm", "contested"]);
  assert.equal(new Set(LABELS).size, LABELS.length);
  assert.ok(LABELS.includes(CONTESTED));
});

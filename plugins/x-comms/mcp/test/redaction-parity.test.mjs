// Drift guard for the MCP server's redaction mirror (#597).
//
// mcp/redact.mjs is a hand-maintained JS copy of the plugin helper's server
// redaction, because the MCP server is a standalone single-file Node bin and
// cannot load the helper's TypeScript at runtime. A copy is only safe if
// something fails when the two diverge, so this test imports BOTH — the mirror
// and the canonical vendored redact.ts — and asserts identical output across a
// corpus that covers every branch of the helper's rules.
//
// If a helper-side rule changes, this fails. Fix it by updating mcp/redact.mjs
// to match, never by loosening the corpus or the assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { redactSecrets as mirrorRedact } from "../redact.mjs";
import { redactSecrets as canonicalRedact } from "../../server/vendor/paseo-plugin-helper/redact.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// Values chosen to hit every branch: the offer rules (standard and url-safe
// base64, plus a truncated tail), Bearer and basic-auth in a string, the
// sensitive-key walk, the short-vs-long maskString split, nested objects and
// arrays, and the non-string passthroughs.
const OFFER_STD = "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9fbE9WSEIyMjNoelQifQ==";
const OFFER_URLSAFE = "https://app.paseo.sh/#offer=abcDEF123_-xyz";
const OFFER_TRUNCATED = "connect to https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXI";

const STRING_CASES = [
  "",
  "no secrets here at all",
  OFFER_STD,
  `pair me: ${OFFER_STD} and https://example.com/docs`,
  OFFER_URLSAFE,
  OFFER_TRUNCATED,
  `first: ${OFFER_STD} second: ${OFFER_URLSAFE}`,
  "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc-123_x.y~z+/==",
  "postgres://admin:hunter2@db.internal:5432/paseo",
  "https://user:hunter2@example.com/path",
  "mixed Bearer and offer: Bearer abc123 and " + OFFER_STD,
];

const VALUE_CASES = [
  null,
  undefined,
  42,
  0,
  true,
  false,
  "",
  "plain",
  OFFER_STD,
  { note: `see ${OFFER_STD}`, nested: { link: OFFER_URLSAFE } },
  { list: [OFFER_STD, { deep: OFFER_URLSAFE }] },
  { password: "supersecretvalue", api_key: "abcdefghijklmnop" },
  { Authorization: "Bearer abcdefghijklmnop", auth: "short" },
  { privateKey: "x".repeat(64), certificate: "cert-material-here" },
  { count: 7, enabled: true, missing: null },
  { empty: {}, list: [] },
  { "weird key-with_underscore": OFFER_STD },
];

const OPTION_CASES = [
  {},
  { mask: "***" },
  { customSensitiveKeys: ["sessionid", "tenant"] },
  { mask: "XXX", customSensitiveKeys: ["sessionid"] },
];

test("mcp/redact.mjs matches the canonical helper redact.ts on strings", () => {
  for (const value of STRING_CASES) {
    for (const options of OPTION_CASES) {
      assert.equal(
        mirrorRedact(value, options),
        canonicalRedact(value, options),
        `divergence on string ${JSON.stringify(value)} with ${JSON.stringify(options)}`,
      );
    }
  }
});

test("mcp/redact.mjs matches the canonical helper redact.ts on non-strings and objects", () => {
  for (const value of VALUE_CASES) {
    for (const options of OPTION_CASES) {
      assert.deepEqual(
        mirrorRedact(value, options),
        canonicalRedact(value, options),
        `divergence on value ${JSON.stringify(value) ?? String(value)} with ${JSON.stringify(options)}`,
      );
    }
  }
});

test("the mirror masks the offer, so this test cannot pass by comparing two leaks", () => {
  assert.equal(mirrorRedact(OFFER_STD), "https://app.paseo.sh/#offer=[REDACTED]");
  assert.equal(mirrorRedact(OFFER_URLSAFE), "https://app.paseo.sh/#offer=[REDACTED]");
  assert.equal(mirrorRedact(OFFER_TRUNCATED), "connect to https://app.paseo.sh/#offer=[REDACTED]");
  for (const value of [OFFER_STD, OFFER_URLSAFE, OFFER_TRUNCATED]) {
    assert.ok(!/#offer=[A-Za-z0-9\-_+/=]/.test(mirrorRedact(value)), "mirror left a raw offer tail");
  }
});

// Structural backstop: the mirror must not quietly grow or lose rules. The
// offer pattern is the security-relevant one, so pin it by shape rather than by
// full text, which would break on harmless comment edits.
test("the mirror still carries the helper's offer and auth patterns", () => {
  const source = readFileSync(join(HERE, "..", "redact.mjs"), "utf-8");
  const canonical = readFileSync(
    join(HERE, "..", "..", "server", "vendor", "paseo-plugin-helper", "redact.ts"),
    "utf-8",
  );
  for (const pattern of [
    /app\\\.paseo\\\.sh/,
    /Bearer\\s\+/,
    /DEFAULT_SENSITIVE_KEYS/,
    /maskString/,
  ]) {
    assert.ok(pattern.test(source), `mirror is missing ${pattern}`);
    assert.ok(pattern.test(canonical), `canonical helper changed shape: ${pattern}`);
  }
});

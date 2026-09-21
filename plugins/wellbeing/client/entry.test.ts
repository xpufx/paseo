import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("wellbeing client entry contract", () => {
  it("statically verifies initClientHelpers() is invoked with all required host deps", () => {
    const entryPath = path.resolve(__dirname, "../index.client.tsx");
    assert.ok(fs.existsSync(entryPath), "index.client.tsx must exist");
    const source = fs.readFileSync(entryPath, "utf8");

    assert.match(
      source,
      /initClientHelpers\s*\(\s*\{[\s\S]*\}\s*\)/,
      "index.client.tsx must call initClientHelpers() before registering surfaces",
    );

    const requiredDeps = ["Icon", "Modal", "useRpc", "useToast"];
    for (const dep of requiredDeps) {
      assert.ok(
        source.includes(dep),
        `initClientHelpers() must inject host dependency '${dep}'`,
      );
    }
  });
});

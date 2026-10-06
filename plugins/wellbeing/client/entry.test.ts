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

  it("registers the wellbeing sidebar surface via registerSidebarSurface()", () => {
    const entryPath = path.resolve(__dirname, "../index.client.tsx");
    const source = fs.readFileSync(entryPath, "utf8");

    assert.match(
      source,
      /registerSidebarSurface\s*\(\s*client,\s*\{[\s\S]*id:\s*["']wellbeing["'][\s\S]*\}\s*\)/,
      "index.client.tsx must register sidebar surface using registerSidebarSurface() with id 'wellbeing'",
    );

    assert.match(
      source,
      /icon:\s*["']Heart["']/,
      "sidebar surface must specify icon 'Heart'",
    );
  });

  it("keeps non-vendored client code off the frozen paseo-plugin-helper/client kit", () => {
    // #937: the bespoke client/ UI kit is deprecated. Rendering code composes
    // the handful of pieces it needs locally over the host SDK and the
    // lifecycle theme seam, so no non-vendored file may import the frozen
    // barrel (the committed vendor copies are the publish artifact).
    const pluginDir = path.resolve(__dirname, "..");
    const files = ["index.client.tsx", "client/surface.tsx", "client/host-ui.tsx"];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(pluginDir, file), "utf8");
      assert.doesNotMatch(
        source,
        /from\s*["']paseo-plugin-helper\/client["']/,
        `${file} must not import from paseo-plugin-helper/client`,
      );
    }

    // Import-graph smoke test: the local host-ui shim must now re-export the
    // shared package (xpufx-org/paseo#976) rather than re-implement the
    // Pressable/StyleSheet seam, and the lifecycle entry must still register
    // the surface.
    const hostUi = fs.readFileSync(path.resolve(pluginDir, "client/host-ui.tsx"), "utf8");
    assert.match(
      hostUi,
      /from\s*["']@xpufx\/paseo-plugin-ui["']/,
      "host-ui.tsx must re-export the shared @xpufx/paseo-plugin-ui package",
    );
    assert.doesNotMatch(
      hostUi,
      /from\s*["']react-native["']/,
      "host-ui.tsx must not compose react-native primitives locally",
    );

    const entry = fs.readFileSync(path.resolve(pluginDir, "index.client.tsx"), "utf8");
    assert.match(
      entry,
      /import\s*\{[^}]*registerSidebarSurface[^}]*\}\s*from\s*["']paseo-plugin-helper\/lifecycle["']/,
      "index.client.tsx must register the surface from paseo-plugin-helper/lifecycle",
    );

    // The referenced lifecycle/shared exports must be real in the vendored
    // copies the published plugin tree ships.
    const vendored = path.resolve(pluginDir, "client/vendor/paseo-plugin-helper");
    assert.match(
      fs.readFileSync(path.join(vendored, "lifecycle/host-theme.tsx"), "utf8"),
      /export\s+function\s+useHostTheme/,
      "vendored lifecycle must export useHostTheme",
    );
    assert.match(
      fs.readFileSync(
        path.resolve(pluginDir, "shared/vendor/paseo-plugin-helper/formatters.ts"),
        "utf8",
      ),
      /export\s+function\s+resolveMetricStatus/,
      "vendored shared must export resolveMetricStatus",
    );
  });

  it("never touches DOM event APIs without a runtime function check", () => {
    // The client bundle runs inside Hermes on mobile where `window` exists
    // (global alias) but `window.addEventListener` does not. Gating on
    // `typeof window !== "undefined"` alone crashes the surface with
    // "undefined is not a function".
    const surfacePath = path.resolve(__dirname, "surface.tsx");
    const source = fs.readFileSync(surfacePath, "utf8");
    const withoutComments = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const firstCall = withoutComments.indexOf("window.addEventListener(");
    assert.ok(firstCall !== -1, "surface should register window listeners when available");
    const prefix = withoutComments.slice(0, firstCall);
    assert.match(
      prefix,
      /typeof\s+window\??\.addEventListener\s*===?\s*"function"/,
      "window.addEventListener calls must sit behind a typeof function check (Hermes defines window without DOM APIs)",
    );
    assert.doesNotMatch(
      prefix,
      /typeof\s+window\s*!==\s*"undefined"/,
      "must not gate on bare `typeof window !== \"undefined\"` — RN defines window without DOM APIs",
    );
  });
});
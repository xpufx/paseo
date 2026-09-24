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

  it("imports every helper export the client entry and surface reference", () => {
    // Import-graph smoke test for the "called function is not defined at
    // runtime" class: every named import from `paseo-plugin-helper/client`
    // must be a real export of the helper's client barrel.
    const clientDir = path.resolve(__dirname, "..");
    const files = ["index.client.tsx", "client/surface.tsx"];
    // The helper barrel re-exports via `export * from`, so collect names one
    // level deep from the modules it re-exports.
    const helperRoot = path.resolve(clientDir, "client/vendor/paseo-plugin-helper");
    const exportNames = new Set<string>();
    const collectFrom = (modulePath: string) => {
      if (!fs.existsSync(modulePath)) return;
      const source = fs.readFileSync(modulePath, "utf8");
      for (const match of source.matchAll(/export\s+\{([^}]+)\}/g)) {
        for (const name of match[1].split(",")) {
          const cleaned = name.replace(/\s+as\s+.*/, "").trim();
          if (cleaned && !cleaned.startsWith("type ")) exportNames.add(cleaned);
        }
      }
      // `export function name` / `export const name` declarations
      for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_]+)/g)) {
        exportNames.add(match[1]);
      }
    };
    const visited = new Set<string>();
    const walk = (modulePath: string) => {
      if (visited.has(modulePath)) return;
      visited.add(modulePath);
      collectFrom(modulePath);
      const source = fs.readFileSync(modulePath, "utf8");
      for (const match of source.matchAll(/export\s+\*\s+from\s+["']\.\/([^"']+)["']/g)) {
        const base = path.join(path.dirname(modulePath), match[1]);
        for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
          if (fs.existsSync(candidate)) {
            walk(candidate);
            break;
          }
        }
      }
    };
    walk(path.join(helperRoot, "index.ts"));
    assert.ok(exportNames.has("initClientHelpers"), "helper barrel must export initClientHelpers");
    assert.ok(exportNames.has("registerSidebarSurface"), "helper barrel must export registerSidebarSurface");
    assert.ok(exportNames.has("usePluginTheme"), "helper barrel must export usePluginTheme");
    assert.ok(exportNames.has("useRpcQuery"), "helper barrel must export useRpcQuery");
    assert.ok(exportNames.has("useRpcMutation"), "helper barrel must export useRpcMutation");
    assert.ok(exportNames.has("ProgressBar"), "helper barrel must export ProgressBar");

    for (const file of files) {
      const source = fs.readFileSync(path.resolve(clientDir, file), "utf8");
      for (const match of source.matchAll(
        /import\s*\{([^}]+)\}\s*from\s*["']paseo-plugin-helper\/client["']/g,
      )) {
        for (const name of match[1].split(",")) {
          const cleaned = name.replace(/\s+as\s+.*/, "").trim();
          if (!cleaned || cleaned.startsWith("type ")) continue;
          assert.ok(
            exportNames.has(cleaned),
            `${file} imports '${cleaned}' from paseo-plugin-helper/client but the helper does not export it`,
          );
        }
      }
    }
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
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

function readSource(relative: string): string {
  return fs.readFileSync(path.join(pluginDir, relative), "utf8");
}

describe("permission-logger client entry", () => {
  it("initializes client helpers before registering surfaces", () => {
    const source = readSource("index.client.tsx");
    expect(source).toMatch(/initClientHelpers\s*\(\s*\{[\s\S]*\}\s*\)/);
    for (const dep of ["Icon", "Modal", "useRpc", "useToast", "copyText", "ScrollView", "FlatList"]) {
      expect(source).toContain(dep);
    }
    expect(source).toMatch(/registerSidebarSurface/);
  });
});

describe("permission-logger surface", () => {
  it("renders the shared audit view as a scrolling page", () => {
    const source = readSource("client/surface.tsx");
    expect(source).toContain("PermissionAuditView");
    expect(source).toContain("permission-audit/client");
    expect(source).toContain('"page"');
  });

  it("forwards the host theme and layout into the shared audit view", () => {
    const source = readSource("client/surface.tsx");
    expect(source).toContain("theme={theme}");
    expect(source).toContain("layout={layout}");
  });
});

describe("permission-logger client/ migration (paseo#847 Phase 3)", () => {
  it("keeps lifecycle engines and the host seam off paseo-plugin-helper/client", () => {
    const entry = readSource("index.client.tsx");
    const surface = readSource("client/surface.tsx");
    for (const source of [entry, surface]) {
      expect(source).not.toMatch(/from\s*["']paseo-plugin-helper\/client["']/);
    }
    expect(entry).toContain('from "paseo-plugin-helper/lifecycle"');
    expect(entry).toContain('from "paseo-plugin-helper/core"');
    expect(entry).toContain("initClientHelpers");
    expect(entry).toContain("registerSidebarSurface");
    expect(surface).toContain("PluginSurfaceProps");
  });
});

describe("permission-logger server entry", () => {
  it("wires the shared audit server with query RPCs and event subscription", () => {
    const source = readSource("index.server.ts");
    expect(source.includes("createPermissionAuditFeature") || source.includes("registerPermissionAuditServer")).toBe(true);
    expect(source).toContain("permission-audit/server");
  });

  it("declares the plugin manifest with paseo >=0.9 and npm install build", () => {
    const manifest = JSON.parse(readSource("paseo-plugin.json"));
    expect(manifest.id).toBe("permission-logger");
    expect(manifest.requirements.paseo).toBe(">=0.9.0");
    expect(manifest.build).toContainEqual(["npm", "install"]);
  });
});

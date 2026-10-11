// Lives in shared/ on purpose: a test file under client/ shifts TypeScript's
// global-lib ordering and trips pre-existing vendor setTimeout errors.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");

function nonVendoredClientSources(): Array<{ file: string; source: string }> {
  const clientDir = path.join(pluginRoot, "client");
  const sources: Array<{ file: string; source: string }> = [];
  for (const entry of readdirSync(clientDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const file = path.join("client", entry.name);
    sources.push({ file, source: readFileSync(path.join(pluginRoot, file), "utf8") });
  }
  sources.push({
    file: "index.client.tsx",
    source: readFileSync(path.join(pluginRoot, "index.client.tsx"), "utf8"),
  });
  return sources;
}

describe("slash is off the frozen helper client kit (#937)", () => {
  it("has no non-vendored paseo-plugin-helper/client import", () => {
    for (const { file, source } of nonVendoredClientSources()) {
      expect(
        /from\s+["']paseo-plugin-helper\/client["']/.test(source),
        `${file} must not import paseo-plugin-helper/client`,
      ).toBe(false);
    }
  });

  it("renders the console through the plugin-local host-ui composition", () => {
    const consoleSource = readFileSync(path.join(pluginRoot, "client", "console.tsx"), "utf8");
    expect(consoleSource).toContain('from "./host-ui"');
  });

  it("delegates host-ui directly to @xpufx/paseo-plugin-ui with zero bespoke react-native imports (#1233)", () => {
    const hostUiSource = readFileSync(path.join(pluginRoot, "client", "host-ui.tsx"), "utf8");
    expect(hostUiSource).toContain('from "@xpufx/paseo-plugin-ui"');
    expect(hostUiSource).not.toMatch(/from\s+["']react-native["']/);
  });

  it("mounts the console wrapped in HostThemeProvider for host theme propagation", () => {
    const indexSource = readFileSync(path.join(pluginRoot, "index.client.tsx"), "utf8");
    expect(indexSource).toContain("<HostThemeProvider");
    expect(indexSource).toContain("<SlashConsole");
  });
});

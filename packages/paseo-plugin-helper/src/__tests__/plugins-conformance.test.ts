import { describe, it, expect } from "vitest";
import {
  auditAllPlugins,
  auditPluginConformance,
  findPluginDirectories,
} from "../cli/conformance.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const pluginsDir = path.join(repoRoot, "plugins");

describe("Monorepo plugin UI conformance", () => {
  for (const pluginDir of findPluginDirectories(pluginsDir)) {
    it(`${path.basename(pluginDir)} has no UI conformance findings`, () => {
      expect(auditPluginConformance(pluginDir).issues).toEqual([]);
    });
  }

  it("audits every plugin without a plugin-specific allowlist", () => {
    const reports = auditAllPlugins(pluginsDir);
    expect(reports).toHaveLength(findPluginDirectories(pluginsDir).length);
    expect(reports.every((report) => report.passed)).toBe(true);
  });
});

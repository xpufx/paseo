import { describe, it, expect } from "vitest";
import { auditProject } from "../cli/scanner.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const UI_RULES = new Set(["no-bare-react-native-ui", "no-hardcoded-modal-dimensions"]);

describe("Monorepo plugin UI conformance", () => {
  for (const plugin of ["top", "mcp-tools", "x-comms", "forgejo"]) {
    it(`${plugin} has no bare RN UI or rigid modal dimension warnings`, () => {
      const report = auditProject(path.join(repoRoot, "plugins", plugin));
      const uiIssues = report.issues.filter((i) => UI_RULES.has(i.ruleId));
      expect(uiIssues).toEqual([]);
    });
  }
});

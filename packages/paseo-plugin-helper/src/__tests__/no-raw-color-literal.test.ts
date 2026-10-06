import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditProject } from "../cli/scanner.js";

/** Builds a throwaway plugin under a named directory and returns its path. */
function makePlugin(name: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-raw-color-"));
  const pluginDir = path.join(root, name);
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(pluginDir, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return pluginDir;
}

function rawColorIssues(pluginDir: string) {
  return auditProject(pluginDir).issues.filter((issue) => issue.ruleId === "no-raw-color-literal");
}

describe("no-raw-color-literal", () => {
  it("flags a quoted hex literal in client code", () => {
    const pluginDir = makePlugin("example", {
      "client/card.tsx": `export const Card = () => <View style={{ backgroundColor: "#ff00ff" }} />;\n`,
    });
    const issues = rawColorIssues(pluginDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.line).toBe(1);
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });

  it("flags a quoted rgba() literal and a named color next to a color property", () => {
    const pluginDir = makePlugin("example", {
      "client/card.tsx": [
        `export const A = () => <View style={{ borderColor: "rgba(1, 2, 3, 0.4)" }} />;`,
        `export const B = () => <View style={{ color: "white" }} />;`,
      ].join("\n"),
    });
    expect(rawColorIssues(pluginDir)).toHaveLength(2);
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });

  it("does not flag host theme reads or the transparent escape", () => {
    const pluginDir = makePlugin("example", {
      "client/card.tsx": `export const Card = ({ colors }) => <View style={{ backgroundColor: colors.surface1, borderColor: "transparent" }} />;\n`,
    });
    expect(rawColorIssues(pluginDir)).toEqual([]);
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });

  it("does not flag color mentions inside comments", () => {
    const pluginDir = makePlugin("example", {
      "client/card.tsx": `// taxonomy was #10b981 / #f59e0b / #ef4444\nexport const x = 1; // was "#ff00ff"\n`,
    });
    expect(rawColorIssues(pluginDir)).toEqual([]);
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });

  it("exempts the documented appearance module by plugin path", () => {
    const pluginDir = makePlugin("worktree-install", {
      "client/theme.ts": `export const PALETTES = { dark: { canvas: "#0d0f12", text: "#e8ebf0" } };\n`,
    });
    expect(rawColorIssues(pluginDir)).toEqual([]);
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });

  it("does not let a conformance.json exemption hide the rule, and reports it", () => {
    const pluginDir = makePlugin("example", {
      "conformance.json": JSON.stringify({ exempt: { "no-raw-color-literal": "trust me" } }),
      "client/card.tsx": `export const Card = () => <View style={{ backgroundColor: "#ff00ff" }} />;\n`,
    });
    const issues = rawColorIssues(pluginDir);
    // The literal is still reported, and the attempted exemption is an error.
    expect(issues.some((issue) => issue.file === "client/card.tsx")).toBe(true);
    expect(issues.some((issue) => issue.file === "conformance.json" && issue.severity === "error")).toBe(
      true,
    );
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });

  it("exempts hex inside an addTheme contribution", () => {
    const pluginDir = makePlugin("example", {
      "index.client.tsx": [
        `export function register(client) {`,
        `  client.addTheme({`,
        `    id: "custom",`,
        `    name: "Custom",`,
        `    appearance: "dark",`,
        `    colors: { surface0: "#010101", foreground: "#fafafa" },`,
        `  });`,
        `}`,
      ].join("\n"),
    });
    expect(rawColorIssues(pluginDir)).toEqual([]);
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true });
  });
});

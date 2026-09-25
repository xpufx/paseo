import { describe, it, expect, vi } from "vitest";
import { readPluginConformanceExemptions } from "../cli/conformance-exemptions.js";
import { auditProject, doctorProject } from "../cli/scanner.js";
import { formatReportPretty, formatReportJson } from "../cli/formatter.js";
import { runCli } from "../cli/index.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Audit CLI & Scanner", () => {
  it("runs UI conformance for one plugin directory or all plugin directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-conformance-test-"));
    const pluginsDir = path.join(root, "plugins");
    const pluginDir = path.join(pluginsDir, "example");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      fs.mkdirSync(path.join(pluginDir, "client"), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "client", "index.tsx"),
        `import { Text, View } from "react-native";
import { Button } from "paseo-plugin-helper/client";
export const Example = () => <View><Text>Example</Text><Button label="OK" /></View>;`,
      );

      expect(runCli(["conformance", pluginDir, "--format", "json"])).toBe(0);
      expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string).targetDir).toBe(pluginDir);

      log.mockClear();
      expect(runCli(["conformance", "--all", pluginsDir, "--format", "json"])).toBe(0);
      expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toHaveLength(1);
    } finally {
      log.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects bespoke patterns in sample plugin files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-test-"));

    try {
      // 1. Write bespoke client file with raw agent subscription
      fs.writeFileSync(
        path.join(tmpDir, "pill.client.tsx"),
        `
        export function contributeClient(client) {
          client.paseo.agents.subscribe((update) => {});
          client.addComposerPill({ id: "test", title: "Test" });
        }
        `,
      );

      // 2. Write bespoke server file with raw file persistence and console.log
      fs.writeFileSync(
        path.join(tmpDir, "resources.server.ts"),
        `
        import fs from "node:fs";
        export function saveStatus(status) {
          console.log("Saving status", status);
          fs.writeFileSync("~/.paseo/status.json", JSON.stringify(status));
        }
        `,
      );

      // 3. Write bespoke version reading
      fs.writeFileSync(
        path.join(tmpDir, "index.ts"),
        `
        import fs from "node:fs";
        const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
        console.log(pkg.version);
        `,
      );

      const report = auditProject(tmpDir);

      expect(report.scannedFiles).toBe(3);
      expect(report.issues.length).toBeGreaterThanOrEqual(3);

      const ruleIds = report.issues.map((i) => i.ruleId);
      expect(ruleIds).toContain("no-manual-agent-subscription");
      expect(ruleIds).toContain("no-raw-file-persistence");
      expect(ruleIds).toContain("no-raw-console-in-server");

      const pretty = formatReportPretty(report);
      expect(pretty).toContain("no-manual-agent-subscription");
      expect(pretty).toContain("Audit Summary:");

      const json = JSON.parse(formatReportJson(report));
      expect(json.scannedFiles).toBe(3);
      expect(json.issues.length).toBe(report.issues.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes clean projects with helper imports", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-clean-"));

    try {
      fs.writeFileSync(
        path.join(tmpDir, "pill.client.tsx"),
        `
        import { registerComposerPill, initClientHelpers } from "paseo-plugin-helper/client";
        initClientHelpers({ Icon: {}, Modal: {}, useRpc: () => async () => ({}), useToast: () => ({}) });
        export function contributeClient(client) {
          return registerComposerPill(client, { id: "test", title: "Clean" });
        }
        `,
      );

      fs.writeFileSync(
        path.join(tmpDir, "resources.server.ts"),
        `
        import { createPluginLogger, PluginStorage } from "paseo-plugin-helper/server";
        const log = createPluginLogger("test");
        const storage = new PluginStorage("test", "status.json");
        `,
      );

      const report = auditProject(tmpDir, { strict: true });
      expect(report.scannedFiles).toBe(2);
      expect(report.issues.length).toBe(0);
      expect(report.passed).toBe(true);

      const pretty = formatReportPretty(report);
      expect(pretty).toContain("[PASS]");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("doctorProject alias works identically and ignores bundled/minified files", () => {    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-doctor-test-"));

    try {
      // Bundled file with raw regex exec or spawn shouldn't trigger warnings
      fs.writeFileSync(
        path.join(tmpDir, "server.bundled.js"),
        `
        const m = /regex/.exec("data");
        const s = spawn("node", ["server.js"]);
        `,
      );

      // Clean client file
      fs.writeFileSync(
        path.join(tmpDir, "client.tsx"),
        `
        import { registerComposerPill, initClientHelpers } from "paseo-plugin-helper/client";
        initClientHelpers({ Icon: {}, Modal: {}, useRpc: () => async () => ({}), useToast: () => ({}) });
        export const setup = (client) => registerComposerPill(client, { id: "test", title: "OK" });
        `,
      );

      const report = doctorProject(tmpDir, { strict: true });
      // Only client.tsx was scanned, bundled was excluded
      expect(report.scannedFiles).toBe(1);
      expect(report.issues.length).toBe(0);
      expect(report.passed).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags missing requirements.paseo as error for v8 layouts, warn otherwise", () => {
    const v8Dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-v8-"));
    const v7Dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-v7-"));

    try {
      fs.writeFileSync(
        path.join(v8Dir, "paseo-plugin.json"),
        JSON.stringify({ id: "demo", build: [["npm", "install"]] }),
      );
      fs.writeFileSync(path.join(v8Dir, "index.client.tsx"), "export default function c() {}");

      const v8Report = auditProject(v8Dir);
      const v8Issue = v8Report.issues.find((i) => i.ruleId === "v8-missing-requirements");
      expect(v8Issue).toBeDefined();
      expect(v8Issue?.severity).toBe("error");

      fs.writeFileSync(
        path.join(v7Dir, "paseo-plugin.json"),
        JSON.stringify({ id: "demo", build: [["npm", "install"]] }),
      );
      fs.writeFileSync(path.join(v7Dir, "index.ts"), "export default function c() {}");

      const v7Report = auditProject(v7Dir);
      const v7Issue = v7Report.issues.find((i) => i.ruleId === "v8-missing-requirements");
      expect(v7Issue).toBeDefined();
      expect(v7Issue?.severity).toBe("warn");
    } finally {
      fs.rmSync(v8Dir, { recursive: true, force: true });
      fs.rmSync(v7Dir, { recursive: true, force: true });
    }
  });

  it("flags root modules and crossed imports in v8 layouts", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-v8b-"));

    try {
      fs.writeFileSync(
        path.join(tmpDir, "paseo-plugin.json"),
        JSON.stringify({ id: "demo", requirements: { paseo: ">=0.8.0" } }),
      );
      fs.writeFileSync(path.join(tmpDir, "index.client.tsx"), "export default function c() {}");
      fs.writeFileSync(path.join(tmpDir, "leftover.ts"), "export const x = 1;");
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "view.tsx"),
        `import { thing } from "../server/thing";\nexport const v = thing;`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "client", "sysinfo.tsx"),
        `import os from "node:os";\nexport const platform = os.platform();`,
      );
      fs.mkdirSync(path.join(tmpDir, "server"));
      fs.writeFileSync(
        path.join(tmpDir, "server", "ops.ts"),
        `import { theme } from "../client/theme";\nexport const present = typeof theme === "object";`,
      );

      const report = auditProject(tmpDir);
      const ruleIds = report.issues.map((i) => i.ruleId);
      expect(ruleIds).toContain("v8-root-module");
      expect(ruleIds.filter((id) => id === "v8-crossed-import")).toHaveLength(3);
      expect(ruleIds).not.toContain("v8-missing-requirements");
      expect(ruleIds).not.toContain("missing-client-init");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags helper client usage without initClientHelpers", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-init-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "pill.tsx"),
        `
        import { ModalBody } from "paseo-plugin-helper/client";
        export function view() { return ModalBody; }
        `,
      );

      const report = auditProject(tmpDir);
      const issue = report.issues.find((i) => i.ruleId === "missing-client-init");
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("warn");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags bare Node builtins in client code, not just node: prefix", () => {    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-bare-"));

    try {
      fs.writeFileSync(
        path.join(tmpDir, "paseo-plugin.json"),
        JSON.stringify({ id: "demo", requirements: { paseo: ">=0.8.0" } }),
      );
      fs.writeFileSync(path.join(tmpDir, "index.client.tsx"), "export default function c() {}");
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "loader.tsx"),
        `import fs from "fs";\nexport const present = typeof fs === "object";`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "client", "joins.tsx"),
        `import path from "path/posix";\nexport const sep = path.sep;`,
      );

      const report = auditProject(tmpDir);
      expect(report.issues.filter((i) => i.ruleId === "v8-crossed-import")).toHaveLength(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags bare React Native UI primitives in client code", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-rnui-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "bad.tsx"),
        `import { ScrollView, Switch, TextInput, Button, Text, View } from "react-native";\nexport const v = 1;`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "client", "type-only.tsx"),
        `import type { ScrollView, TextInput } from "react-native";\nimport { Text, View, StyleSheet } from "react-native";\nexport const v = 1;`,
      );

      const report = auditProject(tmpDir);
      const uiIssues = report.issues.filter((i) => i.ruleId === "no-bare-react-native-ui");
      expect(uiIssues).toHaveLength(1);
      expect(uiIssues[0].file).toContain("bad.tsx");
      expect(uiIssues[0].severity).toBe("warn");
      expect(uiIssues[0].message).toBe("Bare React Native UI primitive imported in plugin client code.");
      expect(uiIssues[0].replacement).toContain("paseo-plugin-helper/client");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags raw interactions and bespoke StyleSheet imports in client code", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-bespoke-ui-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "bad.tsx"),
        `import { Pressable, StyleSheet, Text, View } from "react-native";\nexport const styles = StyleSheet.create({ row: {} });\nexport const item = <Pressable><Text>Open</Text></Pressable>;`,
      );
      const report = auditProject(tmpDir);
      expect(report.issues.map((issue) => issue.ruleId)).toEqual([
        "no-bespoke-react-native-interactions",
        "no-bespoke-style-system",
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes clean client code using paseo-plugin-helper/client", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-rnui-clean-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "good.tsx"),
        `import { Text, View } from "react-native";\nimport { ModalBody, Toggle, TextInput, Button } from "paseo-plugin-helper/client";\nexport const v = 1;`,
      );

      const report = auditProject(tmpDir);
      expect(report.issues.filter((i) => i.ruleId === "no-bare-react-native-ui")).toHaveLength(0);
      expect(report.issues.filter((i) => i.ruleId === "no-hardcoded-modal-dimensions")).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags hardcoded rigid modal dimensions in client styles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-dims-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "bad.tsx"),
        `import { View } from "react-native";\nexport const styles = { modal: { minWidth: 460 } };\nexport const tall = { minHeight: 600 };`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "client", "good.tsx"),
        `import { View } from "react-native";\nexport const styles = { fluid: { minWidth: 0, flexShrink: 1 }, btn: { minWidth: 44, minHeight: 44 } };`,
      );

      const report = auditProject(tmpDir);
      const dimIssues = report.issues.filter((i) => i.ruleId === "no-hardcoded-modal-dimensions");
      expect(dimIssues).toHaveLength(2);
      expect(dimIssues.every((i) => i.severity === "warn")).toBe(true);
      expect(dimIssues[0].replacement).toContain("ModalBody");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags host width caps and scroll hijacks, pointing at paseo-plugin-helper/ui", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-host-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "client"));
      fs.writeFileSync(
        path.join(tmpDir, "client", "bad.tsx"),
        `import { ModalBody } from "paseo-plugin-helper/client";\nexport const a = <ModalBody maxContentWidth={600} />;\nexport const b = <Modal.Content scrollable={false} />;`,
      );

      const report = auditProject(tmpDir);
      const widthIssues = report.issues.filter((i) => i.ruleId === "no-helper-width-cap");
      expect(widthIssues).toHaveLength(1);
      expect(widthIssues[0].replacement).toContain("paseo-plugin-helper/ui");
      const scrollIssues = report.issues.filter((i) => i.ruleId === "no-host-scroll-hijack");
      expect(scrollIssues).toHaveLength(1);
      expect(scrollIssues[0].replacement).toContain("paseo-plugin-helper/ui");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("conformance exemptions", () => {
  function scaffold(manifest: Record<string, unknown>, clientSource?: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-exempt-test-"));
    fs.writeFileSync(path.join(root, "paseo-plugin.json"), JSON.stringify(manifest));
    if (clientSource !== undefined) {
      fs.mkdirSync(path.join(root, "client"), { recursive: true });
      fs.writeFileSync(path.join(root, "client", "view.tsx"), clientSource);
    }
    return root;
  }

  const BASE = { id: "x", requirements: { paseo: ">=0.9.0" } };
  const SCROLLVIEW_CLIENT =
    'import { ScrollView, Pressable, View } from "react-native";\nexport const V = () => <ScrollView><Pressable><View /></Pressable></ScrollView>;\n';

  it("honours a declared per-rule exemption and leaves other rules firing", () => {
    const dir = scaffold(
      { ...BASE, conformance: { exempt: { "no-bare-react-native-ui": "built to a different standard on purpose" } } },
      SCROLLVIEW_CLIENT,
    );
    const report = auditProject(dir);

    expect(report.issues.filter((i) => i.ruleId === "no-bare-react-native-ui")).toEqual([]);
    expect(
      report.issues.filter((i) => i.ruleId === "no-bespoke-react-native-interactions"),
    ).not.toEqual([]);
    expect(report.exemptions).toEqual([
      { ruleId: "no-bare-react-native-ui", reason: "built to a different standard on purpose" },
    ]);
    expect(report.passed).toBe(true);
  });

  it("prints the exemption so a clean audit is never silently indistinguishable", () => {
    const dir = scaffold(
      { ...BASE, conformance: { exempt: { "no-bare-react-native-ui": "on purpose" } } },
      SCROLLVIEW_CLIENT,
    );
    const output = formatReportPretty(auditProject(dir));
    expect(output).toContain("[EXEMPT ] no-bare-react-native-ui");
    expect(output).toContain("on purpose");
  });

  it("refuses an exemption with no reason", () => {
    const dir = scaffold({ ...BASE, conformance: { exempt: { "no-bare-react-native-ui": "   " } } });
    expect(readPluginConformanceExemptions(dir).exemptions.size).toBe(0);
  });

  it("reports an exemption naming a rule that does not exist", () => {
    const dir = scaffold({ ...BASE, conformance: { exempt: { "no-such-rule": "typo" } } });
    const report = auditProject(dir);
    expect(report.unknownExemptions).toEqual(["no-such-rule"]);
    // Its own rule id, not a borrowed one: filtering audit output by rule id has
    // to mean something.
    const finding = report.issues.find((i) => i.ruleId === "unknown-conformance-exemption");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("no-such-rule");
    expect(report.issues.filter((i) => i.ruleId === "v8-missing-requirements")).toEqual([]);
    expect(report.passed).toBe(false);
  });

  it("cannot be used to exempt the whole audit away", () => {
    const dir = scaffold({ ...BASE, conformance: { exempt: { "*": "everything" } } }, SCROLLVIEW_CLIENT);
    const report = auditProject(dir);
    expect(report.exemptions).toEqual([]);
    expect(report.unknownExemptions).toEqual(["*"]);
    expect(report.issues.some((i) => i.ruleId === "no-bare-react-native-ui")).toBe(true);
  });

  it("gives a plugin with no manifest no exemptions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-exempt-none-"));
    expect(readPluginConformanceExemptions(root).exemptions.size).toBe(0);
  });
});

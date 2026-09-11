import { describe, it, expect } from "vitest";
import { auditProject, doctorProject } from "../cli/scanner.js";
import { formatReportPretty, formatReportJson } from "../cli/formatter.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Audit CLI & Scanner", () => {
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

  it("flags bare Node builtins in client code, not just node: prefix", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-audit-bare-"));

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
});

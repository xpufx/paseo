import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { adoptProject } from "../cli/adopt.js";

function makeScaffold(sdkVersion: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-test-"));
  const typeImport =
    sdkVersion.includes("0.8") || sdkVersion.includes("8.")
      ? `import type { PluginClientContext } from "@getpaseo/plugin/client";`
      : `import type { PluginClientContext } from "@getpaseo/plugin";`;
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "test-plugin",
        private: true,
        version: "0.0.0",
        devDependencies: { "@getpaseo/plugin": sdkVersion },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "index.client.tsx"),
    `${typeImport}\n\nexport default function contribute(client: PluginClientContext) {\n  return () => {};\n}\n`,
  );
  return dir;
}

describe("adopt", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adopts a v8 scaffold with v8 import specifiers", () => {
    const dir = makeScaffold("0.8.0-beta.1");
    dirs.push(dir);
    const result = adoptProject(dir);
    expect(result.sdkMajor).toBe(8);
    expect(result.addedDependency).toBe(true);
    expect(result.addedInit).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies["paseo-plugin-helper"]).toMatch(/^\^0\./);

    const entry = fs.readFileSync(path.join(dir, "index.client.tsx"), "utf8");
    expect(entry).toContain("initClientHelpers({ Icon, Modal, useRpc, useToast });");
    expect(entry).toContain("@getpaseo/plugin/client/react-native");
  });

  it("adopts a v7 scaffold with v7 import specifiers", () => {
    const dir = makeScaffold("^0.7.2");
    dirs.push(dir);
    const result = adoptProject(dir);
    expect(result.sdkMajor).toBe(7);

    const entry = fs.readFileSync(path.join(dir, "index.client.tsx"), "utf8");
    expect(entry).toContain('from "@getpaseo/plugin/react-native"');
    expect(entry).not.toContain("@getpaseo/plugin/client");
  });

  it("is idempotent on the second run", () => {
    const dir = makeScaffold("0.8.0-beta.1");
    dirs.push(dir);
    adoptProject(dir);
    const entryBefore = fs.readFileSync(path.join(dir, "index.client.tsx"), "utf8");
    const second = adoptProject(dir);
    expect(second.alreadyAdopted).toBe(true);
    const entryAfter = fs.readFileSync(path.join(dir, "index.client.tsx"), "utf8");
    expect(entryAfter).toBe(entryBefore);
  });

  it("fails without package.json or client entry", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-empty-"));
    dirs.push(dir);
    expect(() => adoptProject(dir)).toThrow(/package\.json/);

    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(() => adoptProject(dir)).toThrow(/index\.client\.tsx/);
  });
});

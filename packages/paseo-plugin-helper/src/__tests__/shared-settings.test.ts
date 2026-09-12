import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { createSharedPluginSettings } from "../server/shared-settings.js";
import {
  SuiteSettingsContract,
  SuiteSettingsSchema,
  type SuiteSettings,
} from "../shared/suite-settings.js";
import { createMockServerContext } from "../testing/mock-server.js";

const DemoSuiteSchema = z.object({
  accentColor: z.string().default("#6366f1"),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  showTabs: z.boolean().default(true),
});

type DemoSuiteSettings = z.infer<typeof DemoSuiteSchema>;

function makeTmpDir(): string {
  return path.join(
    os.tmpdir(),
    `paseo-shared-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

const dirs: string[] = [];
const sharedInstances: Array<{ dispose(): void }> = [];

function trackDir(dir: string): string {
  dirs.push(dir);
  return dir;
}

function siblingPair(baseDir: string, suite = "xpufx-suite") {
  const pluginA = createSharedPluginSettings<DemoSuiteSettings>({
    suite,
    schema: DemoSuiteSchema,
    baseDir,
    watchDebounceMs: 10,
  });
  const pluginB = createSharedPluginSettings<DemoSuiteSettings>({
    suite,
    schema: DemoSuiteSchema,
    baseDir,
    watchDebounceMs: 10,
  });
  sharedInstances.push(pluginA, pluginB);
  return { pluginA, pluginB };
}

afterEach(() => {
  for (const instance of sharedInstances.splice(0)) {
    try {
      instance.dispose();
    } catch {}
  }
  for (const dir of dirs.splice(0)) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
  stepMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for shared-settings condition");
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

describe("Architecture B: shared plugin settings", () => {
  it("exposes the canonical SuiteSettingsContract with defaults", () => {
    expect(SuiteSettingsContract.name).toBe("xpufx.suite.settings");
    expect(SuiteSettingsContract.get.name).toBe("xpufx.suite.settings.get");
    expect(SuiteSettingsContract.update.name).toBe("xpufx.suite.settings.update");
    expect(SuiteSettingsContract.reset.name).toBe("xpufx.suite.settings.reset");
    expect(SuiteSettingsContract.defaultSettings).toEqual({
      suiteTitle: "xpufx Suite",
      accentColor: "#6366f1",
      density: "comfortable",
      showSuiteTabs: true,
    });
  });

  it("stores the suite file under the shared namespace directory", () => {
    const baseDir = trackDir(makeTmpDir());
    const shared = createSharedPluginSettings<SuiteSettings>({
      suite: "xpufx-suite",
      schema: SuiteSettingsSchema,
      baseDir,
    });
    sharedInstances.push(shared);

    expect(shared.suite).toBe("xpufx-suite");
    expect(shared.filePath).toBe(path.join(baseDir, "xpufx-suite", "settings.json"));
    expect(shared.contract.name).toBe("xpufx-suite.shared-settings");
    expect(shared.read()).toEqual(SuiteSettingsContract.defaultSettings);
  });

  it("lets Plugin B read updates written by Plugin A (shared file)", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA, pluginB } = siblingPair(baseDir);

    expect(pluginA.filePath).toBe(pluginB.filePath);

    await pluginA.update({ accentColor: "#ff0000" });

    expect(pluginB.read()).toMatchObject({ accentColor: "#ff0000" });
    expect(await pluginB.get()).toMatchObject({ accentColor: "#ff0000" });
    expect(pluginB.reload()).toMatchObject({
      accentColor: "#ff0000",
      density: "comfortable",
      showTabs: true,
    });
  });

  it("preserves untouched fields across partial sibling updates", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA, pluginB } = siblingPair(baseDir);

    await pluginA.update({ showTabs: false });
    await pluginB.update({ density: "spacious" });

    const current = pluginA.reload();
    expect(current).toEqual({
      accentColor: "#6366f1",
      density: "spacious",
      showTabs: false,
    });
  });

  it("registers get/update/reset RPC helpers on the server context", async () => {
    const baseDir = trackDir(makeTmpDir());
    const server = createMockServerContext();
    const { pluginA, pluginB } = siblingPair(baseDir);

    let updatedEvent: DemoSuiteSettings | null = null;
    let resetEvent: DemoSuiteSettings | null = null;
    pluginA.register(server, {
      onUpdate: (next) => {
        updatedEvent = next;
      },
      onReset: (fresh) => {
        resetEvent = fresh;
      },
    });

    const initial = await server.callRpc(pluginA.contract.get, undefined);
    expect(initial).toMatchObject({ accentColor: "#6366f1", density: "comfortable" });

    const updated = await server.callRpc(pluginA.contract.update, {
      density: "compact",
    });
    expect(updated).toMatchObject({ density: "compact" });
    expect(updatedEvent).toEqual(updated);
    expect(pluginB.reload()).toMatchObject({ density: "compact" });

    const resetResult = await server.callRpc(pluginA.contract.reset, undefined);
    expect(resetResult).toEqual(pluginA.contract.defaultSettings);
    expect(resetEvent).toEqual(resetResult);
    expect(pluginB.reload()).toEqual(pluginA.contract.defaultSettings);
  });

  it("supports standalone handler functions for root index.ts registration", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA, pluginB } = siblingPair(baseDir);
    const handlers = pluginA.createHandlers();

    await handlers.update({ accentColor: "#00ff00" });
    expect(await handlers.get()).toMatchObject({ accentColor: "#00ff00" });
    expect(pluginB.reload()).toMatchObject({ accentColor: "#00ff00" });

    await handlers.reset();
    expect(pluginB.reload()).toEqual(pluginA.contract.defaultSettings);
  });

  it("notifies fs watchers when a sibling writes outside this instance", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA, pluginB } = siblingPair(baseDir);

    const seen: DemoSuiteSettings[] = [];
    const unsubscribe = pluginB.subscribe((next) => {
      seen.push(next);
    });

    try {
      await pluginA.update({ accentColor: "#0000ff", density: "spacious" });
      await waitFor(() => seen.some((s) => s.accentColor === "#0000ff"));
      expect(seen.at(-1)).toMatchObject({
        accentColor: "#0000ff",
        density: "spacious",
      });
    } finally {
      unsubscribe();
    }
  });

  it("notifies local subscribers on local update and reset", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA } = siblingPair(baseDir);

    const seen: DemoSuiteSettings[] = [];
    const unsubscribe = pluginA.watch((next) => {
      seen.push(next);
    });

    try {
      await pluginA.update({ density: "compact" });
      expect(seen.at(-1)).toMatchObject({ density: "compact" });

      await pluginA.reset();
      expect(seen.at(-1)).toEqual(pluginA.contract.defaultSettings);
    } finally {
      unsubscribe();
    }
  });

  it("stops notifying after unsubscribe", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA, pluginB } = siblingPair(baseDir);

    let calls = 0;
    const unsubscribe = pluginB.subscribe(() => {
      calls += 1;
    });
    unsubscribe();
    await pluginA.update({ density: "spacious" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(0);
  });

  it("reset from one sibling is visible to the other", async () => {
    const baseDir = trackDir(makeTmpDir());
    const { pluginA, pluginB } = siblingPair(baseDir);

    await pluginA.update({ accentColor: "#123456", showTabs: false });
    expect(pluginB.reload().showTabs).toBe(false);

    await pluginB.reset();
    expect(pluginA.reload()).toEqual(pluginA.contract.defaultSettings);
  });

  it("supports custom suite, filename, contract name, and default overrides", () => {
    const baseDir = trackDir(makeTmpDir());
    const shared = createSharedPluginSettings<DemoSuiteSettings>({
      suite: "demo-suite",
      filename: "suite.json",
      schema: DemoSuiteSchema,
      defaultData: { accentColor: "#111111" },
      contractName: "demo.suite",
      description: "Demo suite",
      baseDir,
    });
    sharedInstances.push(shared);

    expect(shared.filePath).toBe(path.join(baseDir, "demo-suite", "suite.json"));
    expect(shared.contract.name).toBe("demo.suite");
    expect(shared.read()).toMatchObject({ accentColor: "#111111" });
  });
});

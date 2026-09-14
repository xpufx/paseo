import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSharedPluginSettings } from "../dist/server/index.js";
import { SuiteSettingsSchema } from "../dist/shared/index.js";

const isLive = process.argv.includes("--live");
const baseDir = isLive ? undefined : path.join(os.tmpdir(), `suite-demo-${Date.now()}`);
const suite = "xpufx-suite";

const pluginA = createSharedPluginSettings({
  suite,
  schema: SuiteSettingsSchema,
  ...(baseDir ? { baseDir } : {}),
  description: "Shared xpufx suite settings (Plugin A: demo side)",
});
const pluginB = createSharedPluginSettings({
  suite,
  schema: SuiteSettingsSchema,
  ...(baseDir ? { baseDir } : {}),
  description: "Shared xpufx suite settings (Plugin B: top side)",
});

console.log(`mode: ${isLive ? "LIVE (~/.paseo storage)" : "ISOLATED TEMP DIR (pass --live to target ~/.paseo)"}`);
console.log(`shared file: ${pluginA.filePath}`);
console.log(`same file for both plugins: ${pluginA.filePath === pluginB.filePath}`);
console.log("initial (B):", JSON.stringify(pluginB.read()));

const initial = pluginB.read();
const targetColor = initial.accentColor === "#10b981" ? "#6366f1" : "#10b981";
const targetDensity = initial.density === "spacious" ? "compact" : "spacious";

const seen = [];
const unsubscribe = pluginB.subscribe((next) => {
  seen.push(next);
  console.log("watcher (B) saw update:", JSON.stringify(next));
});

await pluginA.update({ accentColor: targetColor, density: targetDensity });
console.log(`Plugin A wrote update (accentColor -> ${targetColor}, density -> ${targetDensity})`);

const deadline = Date.now() + 3000;
while (!seen.some((s) => s.accentColor === targetColor) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 25));
}
unsubscribe();

console.log("after A update, B reads:", JSON.stringify(pluginB.reload()));

const synced =
  pluginB.read().accentColor === targetColor &&
  seen.some((s) => s.accentColor === targetColor);
console.log(synced ? "OK: Plugin B reflects Plugin A via shared suite file" : "FAIL: siblings diverged");

pluginA.dispose();
pluginB.dispose();
if (baseDir) {
  fs.rmSync(baseDir, { recursive: true, force: true });
}
process.exit(synced ? 0 : 1);

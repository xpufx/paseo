import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSharedPluginSettings } from "../dist/server/index.js";
import { SuiteSettingsSchema } from "../dist/shared/index.js";

const baseDir = path.join(os.tmpdir(), `suite-demo-${Date.now()}`);
const suite = "xpufx-suite";

const pluginA = createSharedPluginSettings({
  suite,
  schema: SuiteSettingsSchema,
  baseDir,
  description: "Shared xpufx suite settings (Plugin A: demo side)",
});
const pluginB = createSharedPluginSettings({
  suite,
  schema: SuiteSettingsSchema,
  baseDir,
  description: "Shared xpufx suite settings (Plugin B: top side)",
});

console.log(`shared file: ${pluginA.filePath}`);
console.log(`same file for both plugins: ${pluginA.filePath === pluginB.filePath}`);
console.log("initial (B):", JSON.stringify(pluginB.read()));

const seen = [];
const unsubscribe = pluginB.subscribe((next) => {
  seen.push(next);
  console.log("watcher (B) saw update:", JSON.stringify(next));
});

await pluginA.update({ accentColor: "#10b981", density: "spacious" });
console.log("Plugin A wrote update (Plugin B has not re-read yet)");

const deadline = Date.now() + 3000;
while (!seen.some((s) => s.accentColor === "#10b981") && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 25));
}
unsubscribe();

console.log("after A update, B reads:", JSON.stringify(pluginB.reload()));

const synced =
  pluginB.read().accentColor === "#10b981" &&
  seen.some((s) => s.accentColor === "#10b981");
console.log(synced ? "OK: Plugin B reflects Plugin A via shared suite file" : "FAIL: siblings diverged");

pluginA.dispose();
pluginB.dispose();
fs.rmSync(baseDir, { recursive: true, force: true });
process.exit(synced ? 0 : 1);

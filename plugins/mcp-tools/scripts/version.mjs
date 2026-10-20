const { stampVersion } = await import("../../../packages/paseo-plugin-helper/src/server/version.ts");

const { version, updated } = stampVersion({ targetFile: "./shared/version.ts" });
console.log(`[build] PLUGIN_VERSION ${updated ? "stamped" : "up to date"}: "${version}" in shared/version.ts`);

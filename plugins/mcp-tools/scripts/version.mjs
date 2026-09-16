const { stampVersion } = await import("../server/vendor/paseo-plugin-helper/version.ts");

const { version, updated } = stampVersion({ targetFile: "./shared/version.ts" });
console.log(`[build] PLUGIN_VERSION ${updated ? "stamped" : "up to date"}: "${version}" in shared/version.ts`);

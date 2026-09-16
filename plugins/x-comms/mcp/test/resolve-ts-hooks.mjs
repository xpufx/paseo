// Dev-only ESM resolution hook for `node --test` (see package.json test script).
// The vendored helper (client/server/shared/vendor/paseo-plugin-helper/) uses
// extensionless relative imports, which the daemon's esbuild bundler and tsc
// resolve fine but plain node (type-stripping, no loader) does not. This hook
// maps extensionless relative specifiers to their .ts/.tsx/index files.
// Track B of issue #71 (plugin #101).
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSIONS = [".ts", ".tsx"];
const INDEXES = ["index.ts", "index.tsx"];

function tryFile(url) {
  try {
    if (fs.statSync(url, { throwIfNoEntry: false })?.isFile()) return url.href;
  } catch {
    // fall through
  }
  return null;
}

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (
      err?.code !== "ERR_MODULE_NOT_FOUND" ||
      !specifier.startsWith(".") ||
      /\.[a-z]+$/i.test(specifier)
    ) {
      throw err;
    }
    const parentPath = fileURLToPath(context.parentURL);
    const base = new URL(specifier, pathToFileURL(parentPath));
    const basePath = base.pathname;
    for (const ext of EXTENSIONS) {
      const hit = tryFile(new URL(`file://${basePath}${ext}`));
      if (hit) return { url: hit, shortCircuit: true };
    }
    for (const index of INDEXES) {
      const hit = tryFile(new URL(`file://${basePath}/${index}`));
      if (hit) return { url: hit, shortCircuit: true };
    }
    throw err;
  }
}

// Dev-only ESM resolution hook for `node --test` (see package.json test script).
//
// The forges sources are TypeScript that tsc and the daemon's esbuild pass both
// resolve, but that plain node (type-stripping, no transpile) does not:
//
// 1. First-party code uses the ESM idiom of naming a `.ts` file's import specifier
//    with its compiled `.js` extension (`../shared/issues.js`).
// 2. The vendored helper (client|server|shared/vendor/paseo-plugin-helper/) uses
//    extensionless relative imports and `/index` re-exports.
//
// Previously `npm test` shelled out to a bare `esbuild` seven times to pre-bundle
// each test file into $TMPDIR and run that. That is what #603 removed: nothing
// declared which esbuild would run, so it silently resolved to whatever was on
// $PATH (0.20.1 from Debian here) rather than a declared version. Running the
// `.ts` tests directly under node's type stripping removes the bundler from the
// test path entirely, so there is no version left to get wrong (#600).
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

// The import specifier is missing its real target only when node's own resolution
// fails, so probing is deferred to the catch below: this hook is pure fallback
// and never shadows a specifier node can already resolve.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) {
      throw err;
    }
    const parentPath = fileURLToPath(context.parentURL);
    // `resolved` is the specifier already resolved against the importer, so probe
    // from its full path rather than re-joining the relative prefix.
    const resolved = new URL(specifier, pathToFileURL(parentPath));
    // Only rewrite an extension that is absent ("./x") or the compiled-name form
    // ("./x.js"). A real ".json" or ".node" specifier must keep failing loudly.
    if (!/\.[cm]?js$/i.test(specifier) && /\.[a-z]+$/i.test(specifier)) throw err;
    const stem = resolved.href.replace(/\.[cm]?js$/i, "");

    for (const ext of EXTENSIONS) {
      const hit = tryFile(new URL(`${stem}${ext}`));
      if (hit) return { url: hit, shortCircuit: true };
    }
    for (const index of INDEXES) {
      const hit = tryFile(new URL(`${stem}/${index}`));
      if (hit) return { url: hit, shortCircuit: true };
    }
    throw err;
  }
}

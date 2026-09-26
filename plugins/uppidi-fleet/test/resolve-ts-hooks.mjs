// Dev-only ESM resolution hook for `node --test`, shared by symlink across the
// plugins whose suites need it (see the package.json test script of each).
// The plugin sources are TypeScript that tsc and the daemon's esbuild both
// resolve, but that plain node (type stripping, no transpile) does not. A
// first-party import here names its target either by its compiled `.js`
// extension (`../shared/contracts.js`, `../server/presence.js`) or not at all
// (`./updates`), and node looks for either literally and does not find it;
// `moduleResolution: Bundler` in tsconfig.json is what makes the extensionless
// form legal for tsc. Which of a plugin's suites run through this hook, and
// which need a JSX-capable runner instead, is per-plugin: each package.json test
// script names both groups.
//
// Previously `npm test` shelled out to `npx tsx`, which is declared in no
// package.json and absent from the lockfile, so it silently downloaded whatever
// tsx was current on the day of the run. #609 replaced it with node's own type
// stripping, which leaves no transpiler to get wrong.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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

    // No ".tsx" probe: node's type stripping does not transform JSX, so a
    // ".tsx" candidate could not load here even when the file exists. Probing
    // one converts an honest ERR_MODULE_NOT_FOUND into a baffling
    // ERR_UNKNOWN_FILE_EXTENSION that blames a file which does exist. So no
    // plugin sharing this file can import JSX through it, whichever runner its
    // own test script gives those suites.
    for (const ext of [".ts"]) {
      const hit = tryFile(new URL(`${stem}${ext}`));
      if (hit) return { url: hit, shortCircuit: true };
    }
    for (const index of ["index.ts"]) {
      const hit = tryFile(new URL(`${stem}/${index}`));
      if (hit) return { url: hit, shortCircuit: true };
    }
    throw err;
  }
}

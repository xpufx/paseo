// Dev-only ESM resolution hook for `node --test` (see package.json test script).
// The plugin sources are TypeScript that tsc and the daemon's esbuild both
// resolve, but that plain node (type stripping, no transpile) does not. Every
// first-party import here names a `.ts` file by its compiled `.js` extension
// (`../shared/contracts.js`, `./hook-router.js`), which node looks for
// literally and does not find.
//
// This covers the seven server/shared suites only. `client/entry.test.ts` is
// deliberately not run through here: it renders `client/surface.tsx` for real,
// and node's type stripping does not transform JSX, so that one file still
// needs a JSX-capable runner (see package.json test script and #609).
//
// Previously `npm test` shelled out to `npx tsx`, which is declared in no
// package.json and absent from the lockfile, so it silently downloaded whatever
// tsx was current on the day of the run.
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

    // No ".tsx" probe: node's type stripping does not transform JSX, so handing
    // back a ".tsx" url would only convert an honest ERR_MODULE_NOT_FOUND into a
    // baffling ERR_UNKNOWN_FILE_EXTENSION. The one JSX test is on tsx instead.
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

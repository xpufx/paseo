// Single source of truth for the bundle that production actually ships.
//
// `server/injection.ts` copies mcp/paseo-x-comms.bundled.mjs to a stable path
// and the daemon injects *that* into agents, so the committed bundle is the
// artifact, not mcp/paseo-x-comms.mjs. Keeping the build in one module (rather
// than a bare `esbuild` line in package.json) is what lets
// mcp/test/bundle-reproducible.test.mjs regenerate with the identical toolchain
// and flags: a flag added here can never silently drift away from the guard.
//
// The esbuild version is not a bare PATH lookup. It is the exact devDependency
// declared in this package, resolved through Node resolution, so a machine-level
// esbuild on PATH can never produce the committed artifact (#600).
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MCP_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(MCP_DIR);

export const SOURCE = join(MCP_DIR, "paseo-x-comms.mjs");
export const COMMITTED = join(MCP_DIR, "paseo-x-comms.bundled.mjs");

// Deliberately no `banner`: esbuild already hoists the entry point's hashbang,
// and adding one produced the duplicate shebang from #359. The regression
// guard for that is server/injection.test.ts.
export const BUNDLE_FLAGS = Object.freeze({
  entryPoints: [SOURCE],
  bundle: true,
  platform: "node",
  format: "esm",
  // esbuild embeds every dependency's resolved path as a comment, computed
  // relative to absWorkingDir. Left to default it inherits process.cwd(), so
  // running the script from the repo root instead of this package emitted
  // `node_modules/...` where the workspace script emits
  // `../../node_modules/...` -- ~600 lines of pure cwd churn in the committed
  // artifact. Pinning it makes the output identical from any directory.
  absWorkingDir: PACKAGE_ROOT,
});

/** Build the MCP server bundle to `outfile`, overwriting it. */
export async function bundle(outfile = COMMITTED) {
  await build({ ...BUNDLE_FLAGS, outfile });
  return outfile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outfile = process.argv[2] ?? COMMITTED;
  await bundle(outfile);
  console.log(`bundled ${outfile}`);
}

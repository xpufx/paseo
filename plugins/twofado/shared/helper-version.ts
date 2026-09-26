// Declared paseo-plugin-helper expectation for twofado.
//
// This plugin carries a committed vendored helper at <tree>/vendor/, but that
// tree is the *publish* artifact: every runtime import here uses the bare
// `paseo-plugin-helper/<tree>` specifier, which each plugin's tsconfig `paths`
// aliases into ../../packages/paseo-plugin-helper/src. A locally-loaded twofado
// therefore runs whatever helper the checkout it was installed from holds, and
// the vendored copy is not what the daemon served (#633).
//
// So the two are declared separately: HELPER_VERSION is the version this plugin
// expects, and HELPER_SERVED_FROM records that the running copy comes from the
// checkout. scripts/helper-resolution.test.mjs re-derives HELPER_SERVED_FROM from
// this plugin's own imports rather than trusting this line, so vendoring the
// helper later without updating it fails the gate instead of quietly changing
// what is served. HELPER_VERSION is the helper's own package.json `version` — the
// same value the vendored trees pin in their READMEs.
export const HELPER_VERSION = "0.4.0-beta.12";
export const HELPER_SERVED_FROM = "checkout";

// Content digest of packages/paseo-plugin-helper/src at stamp time (#649).
// This is the authoritative check that the helper being served is the helper
// this plugin was built with. The "+<sha>" in shared/version.ts identifies the
// plugin's checkout, but a squash-merge deletes the very commit it names, so
// resolving it fails in any clean clone while passing on a machine that still
// holds the branch worktree. A digest of the files cannot be invalidated that
// way. Re-stamp with `npm run stamp` in the plugin after a helper change.
export const HELPER_REVISION = "sha256:b16c1bc8113a";

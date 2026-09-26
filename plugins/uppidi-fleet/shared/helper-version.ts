// Declared paseo-plugin-helper expectation for uppidi-fleet.
//
// This plugin has no committed vendored helper, and importing the bare
// specifier is what makes it checkout-served: each plugin's tsconfig `paths`
// aliases `paseo-plugin-helper/<tree>` into ../../packages/paseo-plugin-helper/
// src, so the daemon bundles whatever helper the checkout it was installed from
// happens to hold. That is how PR #622's fix merged, went green, and left the
// running plugin on the old primitives (#633).
//
// Nothing travelled with the plugin to disagree with that, so the expectation is
// declared here and *recomputed* by scripts/helper-resolution.test.mjs and
// reported by scripts/doctor-live.mjs. Neither reads this file and believes it:
// both re-derive HELPER_SERVED_FROM from the plugin's own imports, so vendoring
// the helper later without updating this line fails the gate instead of quietly
// changing what is served.
//
// HELPER_VERSION is the helper's own package.json `version` — the same value the
// vendored trees pin in their READMEs, not a scheme invented for this plugin.
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

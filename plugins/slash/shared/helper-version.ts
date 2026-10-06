// Declared paseo-plugin-helper expectation for slash.
//
// This plugin's `paseo-plugin-helper/<tree>` imports resolve through this
// checkout's tsconfig `paths` alias into ../../packages/paseo-plugin-helper/src,
// so what it runs comes from the checkout (#633, #649). It used to import the
// helper's vendored `host` from one file, which made the resolution "mixed";
// xpufx-org/paseo#938 removed that frozen tree, so the whole plugin now serves
// the checkout.
//
// HELPER_VERSION is the helper's own package.json `version` — the same value the
// vendored READMEs pin, not a scheme invented for this plugin.
// HELPER_REVISION is a content digest of packages/paseo-plugin-helper/src at
// stamp time. It is the authoritative check, and it is preferred over the
// checkout sha in shared/version.ts because a squash-merge deletes the very
// commit that sha names, orphaning it in every clean clone while it still
// resolves on any machine holding the branch worktree.
export const HELPER_VERSION = "0.4.0-beta.12";
export const HELPER_SERVED_FROM = "checkout";
export const HELPER_REVISION = "sha256:c06bd8a2894e";

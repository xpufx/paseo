// Declared paseo-plugin-helper expectation for slash.
//
// This plugin imports its vendored helper copies directly (xpufx-org/paseo#1100),
// so what it runs comes from its committed vendored tree rather than the checkout.
// Resolution is therefore "vendored".
//
// HELPER_VERSION is the helper's own package.json `version` — the same value the
// vendored READMEs pin, not a scheme invented for this plugin.
// HELPER_REVISION is a content digest of packages/paseo-plugin-helper/src at
// stamp time. It is the authoritative check, and it is preferred over the
// checkout sha in shared/version.ts because a squash-merge deletes the very
// commit that sha names, orphaning it in every clean clone while it still
// resolves on any machine holding the branch worktree.
export const HELPER_VERSION = "0.4.0-beta.12";
export const HELPER_SERVED_FROM = "vendored";
export const HELPER_REVISION = "sha256:3fced8c27529";

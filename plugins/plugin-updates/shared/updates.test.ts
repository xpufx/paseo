import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSourceUrl,
  GENERIC_SOURCE_ICON,
  normalizeRepoUrl,
  resolveSourceRef,
  sourceIconName,
} from "./updates";

// ---------------------------------------------------------------------------
// Remote → browse URL normalization
// ---------------------------------------------------------------------------

test("normalizes ssh:// remotes, dropping userinfo and port", () => {
  assert.equal(
    normalizeRepoUrl("ssh://git@forge.example.com:222/xpufx/paseo.git"),
    "https://forge.example.com/xpufx/paseo",
  );
  assert.equal(
    normalizeRepoUrl("ssh://git@github.com/xpufx/paseo.git"),
    "https://github.com/xpufx/paseo",
  );
});

test("normalizes scp-like remotes", () => {
  assert.equal(normalizeRepoUrl("git@github.com:xpufx/paseo.git"), "https://github.com/xpufx/paseo");
  assert.equal(normalizeRepoUrl("git@forge.example.com:xpufx/paseo"), "https://forge.example.com/xpufx/paseo");
});

test("normalizes https/http/git scheme remotes and strips a trailing .git", () => {
  assert.equal(normalizeRepoUrl("https://github.com/xpufx/paseo.git"), "https://github.com/xpufx/paseo");
  assert.equal(normalizeRepoUrl("http://github.com/xpufx/paseo.git"), "https://github.com/xpufx/paseo");
  assert.equal(normalizeRepoUrl("git://github.com/xpufx/paseo.git"), "https://github.com/xpufx/paseo");
  assert.equal(normalizeRepoUrl("https://github.com/xpufx/paseo"), "https://github.com/xpufx/paseo");
});

test("collapses duplicate slashes and trailing slashes", () => {
  assert.equal(normalizeRepoUrl("https://github.com//xpufx//paseo.git"), "https://github.com/xpufx/paseo");
  assert.equal(normalizeRepoUrl("https://github.com/xpufx/paseo/"), "https://github.com/xpufx/paseo");
});

test("drops https userinfo and does not treat credentials as a host", () => {
  assert.equal(
    normalizeRepoUrl("https://user:token@github.com/xpufx/paseo.git"),
    "https://github.com/xpufx/paseo",
  );
});

test("only the trailing .git is stripped", () => {
  assert.equal(normalizeRepoUrl("https://host/owner/repo.git.git"), "https://host/owner/repo.git");
  assert.equal(normalizeRepoUrl("https://host/owner.gitlab/repo"), "https://host/owner.gitlab/repo");
});

test("returns null for empty or non-URL input", () => {
  assert.equal(normalizeRepoUrl(null), null);
  assert.equal(normalizeRepoUrl(undefined), null);
  assert.equal(normalizeRepoUrl("   "), null);
  assert.equal(normalizeRepoUrl("/home/user/code/paseo"), null);
  assert.equal(normalizeRepoUrl("https://github.com"), null);
});

// ---------------------------------------------------------------------------
// Source URL derivation
// ---------------------------------------------------------------------------

test("returns null when nothing yields a URL", () => {
  assert.equal(deriveSourceUrl({}), null);
  assert.equal(deriveSourceUrl({ repositoryUrl: "", homepage: "", remoteUrl: "not-a-url" }), null);
});

test("prefers the install remote over package.json repository.url and homepage", () => {
  // Real case: x-comms declares its own (old) standalone GitHub repo, but the
  // install remote — the monorepo it is installed from — is Forgejo. The
  // declared repo must never override the source the plugin was installed from.
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "git@github.com:xpufx/paseo-cross-daemon-comms.git",
      homepage: "https://example.test/docs",
      remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git",
    }),
    "https://forge.example.com/xpufx/paseo",
  );
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "https://github.com/xpufx/paseo.git",
      remoteUrl: "https://github.com/xpufx/other.git",
    }),
    "https://github.com/xpufx/other",
  );
});

test("falls back to package.json repository.url then homepage without an install remote", () => {
  assert.equal(
    deriveSourceUrl({ repositoryUrl: "git@github.com:xpufx/standalone.git", homepage: "https://example.test/docs" }),
    "https://github.com/xpufx/standalone",
  );
  assert.equal(
    deriveSourceUrl({ homepage: "https://example.test/docs" }),
    "https://example.test/docs",
  );
  assert.equal(deriveSourceUrl({ remoteUrl: "not-a-url", homepage: "https://example.test/docs" }), "https://example.test/docs");
});

test("prefers the install remote and deep-links the subdir over a differing package.json repo", () => {
  // Real case: x-comms is a directory install inside the paseo monorepo
  // (Forgejo origin) while its package.json points at its old standalone home.
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "https://github.com/xpufx/paseo-cross-daemon-comms.git",
      remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git",
      ref: "main",
      subdir: "plugins/x-comms",
    }),
    "https://forge.example.com/xpufx/paseo/src/branch/main/plugins/x-comms",
  );
});

test("does not deep-link a subdir onto a package.json repo when there is no install remote", () => {
  // Without an install remote the ref/subdir come from the local checkout, which
  // need not be the declared repo; the path would 404, so keep the repo root.
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "https://github.com/xpufx/paseo-cross-daemon-comms.git",
      ref: "main",
      subdir: "plugins/x-comms",
    }),
    "https://github.com/xpufx/paseo-cross-daemon-comms",
  );
});

test("deep-links the install remote even when package.json declares the same repo", () => {
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "https://github.com/xpufx/paseo.git",
      remoteUrl: "https://github.com/xpufx/paseo.git",
      ref: "main",
      subdir: "plugins/demo",
    }),
    "https://github.com/xpufx/paseo/tree/main/plugins/demo",
  );
});

test("deep-links a subdir with the GitHub tree shape", () => {
  assert.equal(
    deriveSourceUrl({
      remoteUrl: "git@github.com:xpufx/paseo.git",
      ref: "main",
      subdir: "plugins/x-comms",
    }),
    "https://github.com/xpufx/paseo/tree/main/plugins/x-comms",
  );
});

test("deep-links a subdir with the Forgejo/Gitea src/branch shape", () => {
  assert.equal(
    deriveSourceUrl({
      remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git",
      ref: "main",
      subdir: "plugins/plugin-updates",
    }),
    "https://forge.example.com/xpufx/paseo/src/branch/main/plugins/plugin-updates",
  );
});

test("keeps slashes in branch refs and trims a wrapped subdir", () => {
  assert.equal(
    deriveSourceUrl({
      remoteUrl: "https://github.com/xpufx/paseo.git",
      ref: "feature/nested-name",
      subdir: "/plugins/demo/",
    }),
    "https://github.com/xpufx/paseo/tree/feature/nested-name/plugins/demo",
  );
});

test("falls back to the repo root without a ref or subdir", () => {
  const base = "https://forge.example.com/xpufx/paseo";
  assert.equal(deriveSourceUrl({ remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git", ref: "main" }), base);
  assert.equal(deriveSourceUrl({ remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git", subdir: "plugins/demo" }), base);
  assert.equal(
    deriveSourceUrl({ remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git", ref: "main", subdir: "" }),
    base,
  );
  assert.equal(
    deriveSourceUrl({ remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git", ref: "main", subdir: null }),
    base,
  );
});

// ---------------------------------------------------------------------------
// Source presentation (per-forge glyph + host label)
// ---------------------------------------------------------------------------

test("maps known forge hosts to their brand glyph, case-insensitively", () => {
  assert.equal(sourceIconName("github.com"), "Github");
  assert.equal(sourceIconName("GitHub.com"), "Github");
  assert.equal(sourceIconName("  github.com  "), "Github");
  assert.equal(sourceIconName("gitlab.com"), "Gitlab");
});

test("falls back to the generic glyph for Codeberg, self-hosted and unknown hosts", () => {
  assert.equal(sourceIconName("codeberg.org"), GENERIC_SOURCE_ICON);
  assert.equal(sourceIconName("forge.example.com"), GENERIC_SOURCE_ICON);
  assert.equal(sourceIconName("gitea.example.test"), GENERIC_SOURCE_ICON);
  assert.equal(sourceIconName("example.test"), GENERIC_SOURCE_ICON);
  assert.equal(sourceIconName(null), GENERIC_SOURCE_ICON);
  assert.equal(sourceIconName(undefined), GENERIC_SOURCE_ICON);
  assert.equal(sourceIconName(""), GENERIC_SOURCE_ICON);
});

test("resolves host, label and glyph from the derived source URL", () => {
  assert.deepEqual(resolveSourceRef("https://github.com/xpufx/paseo/tree/main/plugins/demo"), {
    url: "https://github.com/xpufx/paseo/tree/main/plugins/demo",
    host: "github.com",
    label: "github.com",
    icon: "Github",
  });
  assert.deepEqual(resolveSourceRef("https://codeberg.org/xpufx/paseo"), {
    url: "https://codeberg.org/xpufx/paseo",
    host: "codeberg.org",
    label: "codeberg.org",
    icon: GENERIC_SOURCE_ICON,
  });
  assert.deepEqual(resolveSourceRef("https://forge.example.com/xpufx/paseo/src/branch/main/plugins/plugin-updates"), {
    url: "https://forge.example.com/xpufx/paseo/src/branch/main/plugins/plugin-updates",
    host: "forge.example.com",
    label: "forge.example.com",
    icon: GENERIC_SOURCE_ICON,
  });
});

test("returns null without a URL so the affordance stays hidden", () => {
  assert.equal(resolveSourceRef(null), null);
  assert.equal(resolveSourceRef(undefined), null);
  assert.equal(resolveSourceRef("   "), null);
});

test("falls back to the raw URL when the host cannot be parsed", () => {
  const ref = resolveSourceRef("not a url");
  assert.equal(ref?.host, null);
  assert.equal(ref?.label, "not a url");
  assert.equal(ref?.icon, GENERIC_SOURCE_ICON);
});

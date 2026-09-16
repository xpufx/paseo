import assert from "node:assert/strict";
import test from "node:test";
import { deriveSourceUrl, normalizeRepoUrl } from "./updates";

// ---------------------------------------------------------------------------
// Remote → browse URL normalization
// ---------------------------------------------------------------------------

test("normalizes ssh:// remotes, dropping userinfo and port", () => {
  assert.equal(
    normalizeRepoUrl("ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git"),
    "https://forge.mrs.aager.de/xpufx/paseo",
  );
  assert.equal(
    normalizeRepoUrl("ssh://git@github.com/xpufx/paseo.git"),
    "https://github.com/xpufx/paseo",
  );
});

test("normalizes scp-like remotes", () => {
  assert.equal(normalizeRepoUrl("git@github.com:xpufx/paseo.git"), "https://github.com/xpufx/paseo");
  assert.equal(normalizeRepoUrl("git@forge.mrs.aager.de:xpufx/paseo"), "https://forge.mrs.aager.de/xpufx/paseo");
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
  assert.equal(normalizeRepoUrl("/home/xpufx/code/paseo"), null);
  assert.equal(normalizeRepoUrl("https://github.com"), null);
});

// ---------------------------------------------------------------------------
// Source URL derivation
// ---------------------------------------------------------------------------

test("returns null when nothing yields a URL", () => {
  assert.equal(deriveSourceUrl({}), null);
  assert.equal(deriveSourceUrl({ repositoryUrl: "", homepage: "", remoteUrl: "not-a-url" }), null);
});

test("prefers package.json repository.url over homepage and the git remote", () => {
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "git@github.com:xpufx/paseo-cross-daemon-comms.git",
      homepage: "https://example.test/docs",
      remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git",
    }),
    "https://github.com/xpufx/paseo-cross-daemon-comms",
  );
});

test("falls back to homepage then the git remote", () => {
  assert.equal(
    deriveSourceUrl({ homepage: "https://example.test/docs", remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git" }),
    "https://example.test/docs",
  );
  assert.equal(
    deriveSourceUrl({ remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git" }),
    "https://forge.mrs.aager.de/xpufx/paseo",
  );
});

test("does not deep-link a subdir onto a package.json repo that differs from the checked-out remote", () => {
  // Real case: x-comms declares its own standalone repository, while the local
  // checkout (and its subdir) belongs to the paseo monorepo. The path would 404.
  assert.equal(
    deriveSourceUrl({
      repositoryUrl: "https://github.com/xpufx/paseo-cross-daemon-comms.git",
      remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git",
      ref: "main",
      subdir: "plugins/x-comms",
    }),
    "https://github.com/xpufx/paseo-cross-daemon-comms",
  );
});

test("deep-links a package.json repo that matches the checked-out remote", () => {
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
      remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git",
      ref: "main",
      subdir: "plugins/plugin-updates",
    }),
    "https://forge.mrs.aager.de/xpufx/paseo/src/branch/main/plugins/plugin-updates",
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
  const base = "https://forge.mrs.aager.de/xpufx/paseo";
  assert.equal(deriveSourceUrl({ remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git", ref: "main" }), base);
  assert.equal(deriveSourceUrl({ remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git", subdir: "plugins/demo" }), base);
  assert.equal(
    deriveSourceUrl({ remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git", ref: "main", subdir: "" }),
    base,
  );
  assert.equal(
    deriveSourceUrl({ remoteUrl: "ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git", ref: "main", subdir: null }),
    base,
  );
});

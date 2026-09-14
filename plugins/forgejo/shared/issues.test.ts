import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseForgejoRemote, resolveForgejoRepo } from "./issues.ts";

const ALIAS_REMOTE = "mrs-forge:xpufx/paseo.git";
const REAL_HOST = "forge.mrs.aager.de";

describe("parseForgejoRemote accepted forms", () => {
  it("parses scp-like SSH-alias remotes", () => {
    assert.deepEqual(parseForgejoRemote(ALIAS_REMOTE), {
      host: "mrs-forge",
      owner: "xpufx",
      repo: "paseo",
    });
  });

  it("parses full ssh:// URLs", () => {
    assert.deepEqual(parseForgejoRemote(`ssh://git@${REAL_HOST}:222/xpufx/paseo.git`), {
      host: REAL_HOST,
      owner: "xpufx",
      repo: "paseo",
    });
  });

  it("parses https URLs", () => {
    assert.deepEqual(parseForgejoRemote(`https://${REAL_HOST}/xpufx/paseo.git`), {
      host: REAL_HOST,
      owner: "xpufx",
      repo: "paseo",
    });
  });

  it("rejects garbage input", () => {
    assert.equal(parseForgejoRemote(null), null);
    assert.equal(parseForgejoRemote(""), null);
    assert.equal(parseForgejoRemote("not-a-remote"), null);
  });
});

describe("resolveForgejoRepo precedence", () => {
  it("explicit full URL beats the git remote", () => {
    assert.deepEqual(
      resolveForgejoRepo(`https://${REAL_HOST}/xpufx/paseo.git`, ALIAS_REMOTE),
      { host: REAL_HOST, repo: "xpufx/paseo" },
    );
  });

  it("explicit scp-like URL beats the git remote", () => {
    assert.deepEqual(
      resolveForgejoRepo("git@forge.example.com:other/project.git", ALIAS_REMOTE),
      { host: "forge.example.com", repo: "other/project" },
    );
  });

  it("explicit bare owner/repo borrows the git-remote host", () => {
    assert.deepEqual(resolveForgejoRepo("xpufx/paseo", ALIAS_REMOTE), {
      host: "mrs-forge",
      repo: "xpufx/paseo",
    });
  });

  it("falls back to the git remote when no explicit value", () => {
    assert.deepEqual(resolveForgejoRepo(undefined, ALIAS_REMOTE), {
      host: "mrs-forge",
      repo: "xpufx/paseo",
    });
    assert.deepEqual(resolveForgejoRepo("  ", ALIAS_REMOTE), {
      host: "mrs-forge",
      repo: "xpufx/paseo",
    });
  });

  it("explicit wins even without a git remote", () => {
    assert.deepEqual(
      resolveForgejoRepo(`https://${REAL_HOST}/xpufx/paseo`, null),
      { host: REAL_HOST, repo: "xpufx/paseo" },
    );
  });

  it("returns null when nothing resolves", () => {
    assert.equal(resolveForgejoRepo(null, null), null);
    assert.equal(resolveForgejoRepo("garbage!!!", undefined), null);
    assert.equal(resolveForgejoRepo("xpufx/paseo", null), null);
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gitOriginForDirectory,
  parseGitDirPointer,
  parseOriginUrl,
} from "./git-origin.ts";

const ROOT = mkdtempSync(join(tmpdir(), "forges-git-origin-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
function scratch(): string {
  const dir = join(ROOT, `case-${seq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeGitConfig(gitDir: string, url: string): void {
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(
    join(gitDir, "config"),
    `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    "utf8",
  );
}

const ORIGIN = "ssh://git@forge.example.com:222/your-org/your-repo.git";

describe("gitOriginForDirectory (issue #160)", () => {
  it("reads the origin from a normal .git directory", async () => {
    const repo = scratch();
    writeGitConfig(join(repo, ".git"), ORIGIN);
    assert.equal(await gitOriginForDirectory(repo), ORIGIN);
  });

  it("follows a linked worktree's .git file to the common repo config", async () => {
    const main = scratch();
    writeGitConfig(join(main, ".git"), ORIGIN);
    const worktreeGitDir = join(main, ".git", "worktrees", "feature-x");
    mkdirSync(worktreeGitDir, { recursive: true });
    writeFileSync(join(worktreeGitDir, "commondir"), "../..\n", "utf8");

    const worktree = scratch();
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");

    assert.equal(await gitOriginForDirectory(worktree), ORIGIN);
  });

  it("falls back to the gitdir config when commondir is absent", async () => {
    const moduleGitDir = join(scratch(), "sub", ".git", "modules", "dep");
    writeGitConfig(moduleGitDir, ORIGIN);
    const checkout = scratch();
    writeFileSync(join(checkout, ".git"), `gitdir: ${moduleGitDir}\n`, "utf8");

    assert.equal(await gitOriginForDirectory(checkout), ORIGIN);
  });

  it("returns null for a missing, non-git or origin-less directory", async () => {
    assert.equal(await gitOriginForDirectory(join(ROOT, "does-not-exist")), null);

    const empty = scratch();
    assert.equal(await gitOriginForDirectory(empty), null);

    const noOrigin = scratch();
    mkdirSync(join(noOrigin, ".git"), { recursive: true });
    writeFileSync(join(noOrigin, ".git", "config"), "[core]\n\tbare = false\n", "utf8");
    assert.equal(await gitOriginForDirectory(noOrigin), null);
  });
});

describe("git origin parsing", () => {
  it("extracts the origin url and trims whitespace", () => {
    assert.equal(parseOriginUrl(`[remote "origin"]\n\turl = ${ORIGIN}  \n`), ORIGIN);
    assert.equal(parseOriginUrl(`[remote "upstream"]\n\turl = ${ORIGIN}\n`), null);
    assert.equal(parseOriginUrl(""), null);
  });

  it("parses the gitdir pointer from a worktree .git file", () => {
    assert.equal(parseGitDirPointer("gitdir: /main/.git/worktrees/x\n"), "/main/.git/worktrees/x");
    assert.equal(parseGitDirPointer("not a pointer"), null);
  });
});

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const ORIGIN_SECTION = /\[remote\s+"origin"\][^\[]*?url\s*=\s*(.+)/;
const GITDIR_POINTER = /^\s*gitdir:\s*(.+?)\s*$/m;

/** `[remote "origin"]` URL from git config text, or null when absent. */
export function parseOriginUrl(config: string | null | undefined): string | null {
  if (!config) return null;
  const match = ORIGIN_SECTION.exec(config);
  const url = match?.[1]?.trim();
  return url || null;
}

/** `gitdir:` target from a linked-worktree `.git` file, or null. */
export function parseGitDirPointer(contents: string | null | undefined): string | null {
  if (!contents) return null;
  const match = GITDIR_POINTER.exec(contents);
  return match?.[1]?.trim() || null;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** Resolve a gitdir/commondir value relative to the directory that held it. */
function resolveGitPath(value: string, base: string): string {
  return isAbsolute(value) ? value : resolve(base, value);
}

/**
 * Git directory that holds the shared config for a checkout.
 * A normal checkout's `.git` is a directory. A linked worktree's `.git` is a
 * file `gitdir: <path>`; that gitdir carries a `commondir` pointing at the main
 * repo's git dir. Submodule-style gitdirs have no `commondir`, so the gitdir
 * itself is used. Null when there is no usable git pointer.
 */
async function commonGitDir(directory: string): Promise<string | null> {
  const dotGit = join(directory, ".git");
  if (!(await isFile(dotGit))) return dotGit;
  const pointer = parseGitDirPointer(await readText(dotGit));
  if (!pointer) return null;
  const gitDir = resolveGitPath(pointer, directory);
  const commondir = (await readText(join(gitDir, "commondir")))?.trim();
  if (commondir) return resolveGitPath(commondir, gitDir);
  return gitDir;
}

/**
 * Read the workspace's git origin URL without shelling out. Handles both a
 * normal `.git` directory and a linked-worktree `.git` file. Never throws:
 * an unreadable or non-git directory yields null.
 */
export async function gitOriginForDirectory(directory: string): Promise<string | null> {
  const gitDir = await commonGitDir(directory);
  if (!gitDir) return null;
  return parseOriginUrl(await readText(join(gitDir, "config")));
}

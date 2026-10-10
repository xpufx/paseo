import fs from "node:fs";
import type { PathLike } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export class ScopedStorageViolationError extends Error {
  readonly code = "ERR_SCOPED_STORAGE_VIOLATION";
  readonly attemptedPath: string;
  readonly allowedRoots: string[];

  constructor(message: string, attemptedPath: string, allowedRoots: string[]) {
    super(message);
    this.name = "ScopedStorageViolationError";
    this.attemptedPath = attemptedPath;
    this.allowedRoots = allowedRoots;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface InstallStorageGuardOptions {
  pluginId: string;
  namespace?: string; // defaults to "plugin-data/xpufx"
  allowTmp?: boolean; // defaults to true
  mode?: "enforce" | "warn"; // defaults to "enforce"
  onViolation?: (violation: { path: string; operation: string; allowedRoots: string[] }) => void;
}

function resolvePathString(target: PathLike | number): string | null {
  if (typeof target === "string") {
    return path.resolve(target);
  }
  if (Buffer.isBuffer(target)) {
    return path.resolve(target.toString("utf8"));
  }
  if (target instanceof URL) {
    if (target.protocol === "file:") {
      const pathname = decodeURIComponent(target.pathname);
      return path.resolve(pathname);
    }
    return null;
  }
  return null;
}

function isPathWithinRoot(targetPath: string, rootDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootDir);

  if (resolvedTarget === resolvedRoot) {
    return true;
  }

  const relative = path.relative(resolvedRoot, resolvedTarget);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function installStorageGuard(options: InstallStorageGuardOptions): () => void {
  const pluginId = options.pluginId;
  const namespace = options.namespace ?? "plugin-data/xpufx";
  const allowTmp = options.allowTmp ?? true;
  const mode = options.mode ?? "enforce";

  const pluginStorageDir = path.resolve(os.homedir(), ".paseo", namespace, pluginId);
  const allowedRoots: string[] = [pluginStorageDir];

  if (allowTmp) {
    allowedRoots.push(path.resolve(os.tmpdir()));
    allowedRoots.push(path.resolve(process.cwd(), ".tmp"));
  }

  function validateTarget(target: PathLike | number, operation: string): void {
    const resolved = resolvePathString(target);
    if (!resolved) {
      return;
    }

    const isAllowed = allowedRoots.some((root) => isPathWithinRoot(resolved, root));
    if (!isAllowed) {
      options.onViolation?.({
        path: resolved,
        operation,
        allowedRoots: [...allowedRoots],
      });

      const message = `Scoped storage violation: write operation '${operation}' on '${resolved}' is outside permitted scopes: [${allowedRoots.join(", ")}]`;

      if (mode === "enforce") {
        throw new ScopedStorageViolationError(message, resolved, [...allowedRoots]);
      } else {
        console.warn(`[WARN] ${message}`);
      }
    }
  }

  // Backup originals
  const origWriteFile = fs.writeFile;
  const origWriteFileSync = fs.writeFileSync;
  const origAppendFile = fs.appendFile;
  const origAppendFileSync = fs.appendFileSync;
  const origMkdir = fs.mkdir;
  const origMkdirSync = fs.mkdirSync;
  const origRmdir = fs.rmdir;
  const origRmdirSync = fs.rmdirSync;
  const origUnlink = fs.unlink;
  const origUnlinkSync = fs.unlinkSync;
  const origRm = fs.rm;
  const origRmSync = fs.rmSync;
  const origRename = fs.rename;
  const origRenameSync = fs.renameSync;
  const origCopyFile = fs.copyFile;
  const origCopyFileSync = fs.copyFileSync;
  const origCreateWriteStream = fs.createWriteStream;

  const origPromisesWriteFile = fsp.writeFile;
  const origPromisesAppendFile = fsp.appendFile;
  const origPromisesMkdir = fsp.mkdir;
  const origPromisesRmdir = fsp.rmdir;
  const origPromisesUnlink = fsp.unlink;
  const origPromisesRm = fsp.rm;
  const origPromisesRename = fsp.rename;
  const origPromisesCopyFile = fsp.copyFile;

  // Intercept node:fs sync & async
  const anyFs = fs as any;

  anyFs.writeFile = function (file: PathLike | number, ...args: unknown[]) {
    validateTarget(file, "writeFile");
    return Reflect.apply(origWriteFile, fs, [file, ...args]);
  };

  anyFs.writeFileSync = function (file: PathLike | number, ...args: unknown[]) {
    validateTarget(file, "writeFileSync");
    return Reflect.apply(origWriteFileSync, fs, [file, ...args]);
  };

  anyFs.appendFile = function (file: PathLike | number, ...args: unknown[]) {
    validateTarget(file, "appendFile");
    return Reflect.apply(origAppendFile, fs, [file, ...args]);
  };

  anyFs.appendFileSync = function (file: PathLike | number, ...args: unknown[]) {
    validateTarget(file, "appendFileSync");
    return Reflect.apply(origAppendFileSync, fs, [file, ...args]);
  };

  anyFs.mkdir = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "mkdir");
    return Reflect.apply(origMkdir, fs, [pathArg, ...args]);
  };

  anyFs.mkdirSync = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "mkdirSync");
    return Reflect.apply(origMkdirSync, fs, [pathArg, ...args]);
  };

  anyFs.rmdir = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "rmdir");
    return Reflect.apply(origRmdir, fs, [pathArg, ...args]);
  };

  anyFs.rmdirSync = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "rmdirSync");
    return Reflect.apply(origRmdirSync, fs, [pathArg, ...args]);
  };

  anyFs.unlink = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "unlink");
    return Reflect.apply(origUnlink, fs, [pathArg, ...args]);
  };

  anyFs.unlinkSync = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "unlinkSync");
    return Reflect.apply(origUnlinkSync, fs, [pathArg, ...args]);
  };

  anyFs.rm = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "rm");
    return Reflect.apply(origRm, fs, [pathArg, ...args]);
  };

  anyFs.rmSync = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "rmSync");
    return Reflect.apply(origRmSync, fs, [pathArg, ...args]);
  };

  anyFs.rename = function (oldPath: PathLike, newPath: PathLike, ...args: unknown[]) {
    validateTarget(oldPath, "rename:source");
    validateTarget(newPath, "rename:destination");
    return Reflect.apply(origRename, fs, [oldPath, newPath, ...args]);
  };

  anyFs.renameSync = function (oldPath: PathLike, newPath: PathLike, ...args: unknown[]) {
    validateTarget(oldPath, "renameSync:source");
    validateTarget(newPath, "renameSync:destination");
    return Reflect.apply(origRenameSync, fs, [oldPath, newPath, ...args]);
  };

  anyFs.copyFile = function (src: PathLike, dest: PathLike, ...args: unknown[]) {
    validateTarget(dest, "copyFile:destination");
    return Reflect.apply(origCopyFile, fs, [src, dest, ...args]);
  };

  anyFs.copyFileSync = function (src: PathLike, dest: PathLike, ...args: unknown[]) {
    validateTarget(dest, "copyFileSync:destination");
    return Reflect.apply(origCopyFileSync, fs, [src, dest, ...args]);
  };

  anyFs.createWriteStream = function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "createWriteStream");
    return Reflect.apply(origCreateWriteStream, fs, [pathArg, ...args]);
  };

  // Intercept node:fs/promises
  const anyFsp = fsp as any;

  anyFsp.writeFile = async function (file: PathLike | number | fsp.FileHandle, ...args: unknown[]) {
    if (typeof file === "string" || Buffer.isBuffer(file) || file instanceof URL) {
      validateTarget(file as unknown as PathLike, "fsp.writeFile");
    }
    return Reflect.apply(origPromisesWriteFile, fsp, [file, ...args]);
  };

  anyFsp.appendFile = async function (file: PathLike | number | fsp.FileHandle, ...args: unknown[]) {
    if (typeof file === "string" || Buffer.isBuffer(file) || file instanceof URL) {
      validateTarget(file as unknown as PathLike, "fsp.appendFile");
    }
    return Reflect.apply(origPromisesAppendFile, fsp, [file, ...args]);
  };

  anyFsp.mkdir = async function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "fsp.mkdir");
    return Reflect.apply(origPromisesMkdir, fsp, [pathArg, ...args]);
  };

  anyFsp.rmdir = async function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "fsp.rmdir");
    return Reflect.apply(origPromisesRmdir, fsp, [pathArg, ...args]);
  };

  anyFsp.unlink = async function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "fsp.unlink");
    return Reflect.apply(origPromisesUnlink, fsp, [pathArg, ...args]);
  };

  anyFsp.rm = async function (pathArg: PathLike, ...args: unknown[]) {
    validateTarget(pathArg, "fsp.rm");
    return Reflect.apply(origPromisesRm, fsp, [pathArg, ...args]);
  };

  anyFsp.rename = async function (oldPath: PathLike, newPath: PathLike) {
    validateTarget(oldPath, "fsp.rename:source");
    validateTarget(newPath, "fsp.rename:destination");
    return Reflect.apply(origPromisesRename, fsp, [oldPath, newPath]);
  };

  anyFsp.copyFile = async function (src: PathLike, dest: PathLike, ...args: unknown[]) {
    validateTarget(dest, "fsp.copyFile:destination");
    return Reflect.apply(origPromisesCopyFile, fsp, [src, dest, ...args]);
  };

  return function uninstallStorageGuard(): void {
    fs.writeFile = origWriteFile;
    fs.writeFileSync = origWriteFileSync;
    fs.appendFile = origAppendFile;
    fs.appendFileSync = origAppendFileSync;
    fs.mkdir = origMkdir;
    fs.mkdirSync = origMkdirSync;
    fs.rmdir = origRmdir;
    fs.rmdirSync = origRmdirSync;
    fs.unlink = origUnlink;
    fs.unlinkSync = origUnlinkSync;
    fs.rm = origRm;
    fs.rmSync = origRmSync;
    fs.rename = origRename;
    fs.renameSync = origRenameSync;
    fs.copyFile = origCopyFile;
    fs.copyFileSync = origCopyFileSync;
    fs.createWriteStream = origCreateWriteStream;

    fsp.writeFile = origPromisesWriteFile;
    fsp.appendFile = origPromisesAppendFile;
    fsp.mkdir = origPromisesMkdir;
    fsp.rmdir = origPromisesRmdir;
    fsp.unlink = origPromisesUnlink;
    fsp.rm = origPromisesRm;
    fsp.rename = origPromisesRename;
    fsp.copyFile = origPromisesCopyFile;
  };
}

#!/usr/bin/env node

/**
 * Platform-aware binary acquisition script for 2fado.
 *
 * Downloads, verifies SHA256 checksums, and unpacks the 2fado daemon/CLI binary
 * for the host OS and architecture. Can be run during Paseo plugin build phase
 * (`paseo-plugin.json` build step), npm scripts, or on-demand via plugin RPC.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");

export const SUPPORTED_TARGETS = {
  "linux-x64": { os: "linux", arch: "amd64" },
  "linux-arm64": { os: "linux", arch: "arm64" },
  "darwin-x64": { os: "darwin", arch: "amd64" },
  "darwin-arm64": { os: "darwin", arch: "arm64" },
};

export function detectPlatform() {
  const key = `${process.platform}-${process.arch}`;
  const target = SUPPORTED_TARGETS[key];
  if (!target) {
    throw new Error(
      `Unsupported platform: ${process.platform} (${process.arch}). Supported: ${Object.keys(SUPPORTED_TARGETS).join(", ")}`
    );
  }
  return target;
}

export async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function verifySha256(data, expectedHash) {
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash.toLowerCase() !== expectedHash.trim().toLowerCase()) {
    throw new Error(`SHA256 checksum mismatch: computed ${hash}, expected ${expectedHash}`);
  }
  return hash;
}

export function parseChecksumManifest(manifestText, filename) {
  for (const line of manifestText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const hash = parts[0];
      const name = parts[1].replace(/^\*/, "");
      if (name === filename || name.endsWith("/" + filename)) {
        return hash;
      }
    }
  }
  throw new Error(`Checksum for ${filename} not found in SHA256SUMS manifest`);
}

export async function installCompanion(options = {}) {
  const target = detectPlatform();
  const version = options.version || process.env.TWOFADO_VERSION || "0.1.0-dev";
  const binDir = resolve(options.binDir || process.env.TWOFADO_BIN_DIR || join(ROOT_DIR, "bin"));
  const binPath = join(binDir, "2fado");
  const force = Boolean(options.force || process.env.TWOFADO_FORCE_INSTALL === "1");

  // Check if binary already exists and is executable
  if (!force && existsSync(binPath)) {
    try {
      const probe = spawnSync(binPath, ["version"], { encoding: "utf8" });
      if (probe.status === 0) {
        console.log(`[2fado-install] Found existing working binary at ${binPath}`);
        return { binPath, status: "already_installed", version };
      }
    } catch {
      // Re-install if probe fails
    }
  }

  mkdirSync(binDir, { recursive: true });

  const archiveName = `2fado-${version}-${target.os}-${target.arch}.tar.gz`;
  const baseUrl = options.baseUrl || process.env.TWOFADO_RELEASE_BASE_URL ||
    `https://github.com/xpufx/2fado/releases/download/v${version}`;

  console.log(`[2fado-install] Target: ${target.os}/${target.arch} (version: ${version})`);
  console.log(`[2fado-install] Downloading archive: ${archiveName}...`);

  let archiveBuffer;
  let checksumManifest;

  // Attempt download or fallback to local dist/ if present (e.g. dev build)
  const localDistArchive = join(ROOT_DIR, "dist", archiveName);
  const localDistSums = join(ROOT_DIR, "dist", "SHA256SUMS");

  if (existsSync(localDistArchive) && existsSync(localDistSums)) {
    console.log(`[2fado-install] Found local build in dist/, using local archive`);
    archiveBuffer = readFileSync(localDistArchive);
    checksumManifest = readFileSync(localDistSums, "utf8");
  } else {
    const archiveUrl = `${baseUrl}/${archiveName}`;
    const sumsUrl = `${baseUrl}/SHA256SUMS`;

    console.log(`[2fado-install] Fetching checksums from ${sumsUrl}...`);
    const sumsBuffer = await fetchBuffer(sumsUrl);
    checksumManifest = sumsBuffer.toString("utf8");

    console.log(`[2fado-install] Fetching archive from ${archiveUrl}...`);
    archiveBuffer = await fetchBuffer(archiveUrl);
  }

  const expectedHash = parseChecksumManifest(checksumManifest, archiveName);
  console.log(`[2fado-install] Verifying SHA256 checksum (${expectedHash})...`);
  verifySha256(archiveBuffer, expectedHash);
  console.log(`[2fado-install] Checksum verified OK.`);

  // Write temporary tarball and extract
  const tempArchive = join(binDir, `.tmp-${archiveName}`);
  const fs = await import("node:fs/promises");
  await fs.writeFile(tempArchive, archiveBuffer);

  try {
    console.log(`[2fado-install] Unpacking archive into ${binDir}...`);
    const tarResult = spawnSync("tar", ["-xzf", tempArchive, "-C", binDir], { stdio: "inherit" });
    if (tarResult.status !== 0) {
      throw new Error(`tar extraction failed with exit code ${tarResult.status}`);
    }
  } finally {
    rmSync(tempArchive, { force: true });
  }

  if (!existsSync(binPath)) {
    // If the archive placed it as 2fado-${target.os}-${target.arch}, rename to 2fado
    const suffixedBin = join(binDir, `2fado-${target.os}-${target.arch}`);
    if (existsSync(suffixedBin)) {
      const fsSync = await import("node:fs");
      fsSync.renameSync(suffixedBin, binPath);
    }
  }

  chmodSync(binPath, 0o755);
  console.log(`[2fado-install] Successfully installed 2fado binary at ${binPath}`);
  return { binPath, status: "installed", version };
}

// Direct CLI execution
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const force = process.argv.includes("--force");
  installCompanion({ force })
    .then((res) => {
      console.log(`[2fado-install] Done: ${res.binPath} (${res.status})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[2fado-install] Error: ${err.message}`);
      process.exit(1);
    });
}

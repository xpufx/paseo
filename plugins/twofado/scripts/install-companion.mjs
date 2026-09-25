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
  "win32-x64": { os: "windows", arch: "amd64", exe: true },
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
  const emit = options.log || ((msg) => console.log(msg));
  const target = detectPlatform();
  const exeSuffix = target.exe || target.os === "windows" ? ".exe" : "";
  const version = options.version || process.env.TWOFADO_VERSION || "0.1.3";
  const binName = `2fado${exeSuffix}`;
  const binDir = resolve(options.binDir || process.env.TWOFADO_BIN_DIR || join(ROOT_DIR, "bin"));
  const binPath = join(binDir, binName);
  const force = Boolean(options.force || process.env.TWOFADO_FORCE_INSTALL === "1");

  // Check if binary already exists and is executable
  if (!force && existsSync(binPath)) {
    try {
      const probe = spawnSync(binPath, ["version"], { encoding: "utf8" });
      if (probe.status === 0) {
        emit(`[2fado-install] Found existing working binary at ${binPath}`);
        return { binPath, status: "already_installed", version };
      }
    } catch {
      // Re-install if probe fails
    }
  }

  mkdirSync(binDir, { recursive: true });

  const assetName = `2fado-${version}-${target.os}-${target.arch}${exeSuffix}`;
  const baseUrl = options.baseUrl || process.env.TWOFADO_RELEASE_BASE_URL ||
    `https://github.com/xpufx/2fado/releases/download/v${version}`;

  emit(`[2fado-install] Target: ${target.os}/${target.arch} (version: ${version})`);
  emit(`[2fado-install] Downloading binary: ${assetName}...`);

  let binBuffer;
  let checksumManifest;

  // Attempt download or fallback to local dist/ if present (e.g. dev build)
  // Legacy .tar.gz archives are still accepted when the bare asset is absent.
  const localDistBin = join(ROOT_DIR, "dist", assetName);
  const localDistArchive = join(ROOT_DIR, "dist", `${assetName}.tar.gz`);
  const localDistSums = join(ROOT_DIR, "dist", "SHA256SUMS");

  if (existsSync(localDistBin) && existsSync(localDistSums)) {
    emit(`[2fado-install] Found local build in dist/, using local binary`);
    binBuffer = readFileSync(localDistBin);
    checksumManifest = readFileSync(localDistSums, "utf8");
  } else if (existsSync(localDistArchive) && existsSync(localDistSums)) {
    emit(`[2fado-install] Found local legacy archive in dist/, using local archive`);
    binBuffer = readFileSync(localDistArchive);
    checksumManifest = readFileSync(localDistSums, "utf8");
  } else {
    const binUrl = `${baseUrl}/${assetName}`;
    const sumsUrl = `${baseUrl}/SHA256SUMS`;

    emit(`[2fado-install] Fetching checksums from ${sumsUrl}...`);
    const sumsBuffer = await fetchBuffer(sumsUrl);
    checksumManifest = sumsBuffer.toString("utf8");

    emit(`[2fado-install] Fetching binary from ${binUrl}...`);
    try {
      binBuffer = await fetchBuffer(binUrl);
    } catch (err) {
      const legacyName = `${assetName}.tar.gz`;
      emit(`[2fado-install] Bare binary not found, trying legacy archive ${legacyName}...`);
      binBuffer = await fetchBuffer(`${baseUrl}/${legacyName}`);
    }
  }

  const expectedHash = parseChecksumManifest(checksumManifest, assetName);
  emit(`[2fado-install] Verifying SHA256 checksum (${expectedHash})...`);
  verifySha256(binBuffer, expectedHash);
  emit(`[2fado-install] Checksum verified OK.`);

  const fs = await import("node:fs/promises");
  if (binBuffer.length > 0 && binBuffer[0] === 0x1f && binBuffer[1] === 0x8b) {
    throw new Error("Downloaded asset is a gzip archive; this installer expects bare binaries. Re-run make dist from a version with bare-binary assets.");
  }

  await fs.writeFile(binPath, binBuffer);

  if (!existsSync(binPath)) {
    const suffixedBin = join(binDir, `2fado-${target.os}-${target.arch}${exeSuffix}`);
    if (existsSync(suffixedBin)) {
      const fsSync = await import("node:fs");
      fsSync.renameSync(suffixedBin, binPath);
    }
  }

  if (process.platform !== "win32") chmodSync(binPath, 0o755);
  emit(`[2fado-install] Successfully installed 2fado binary at ${binPath}`);
  return { binPath, status: "installed", version };
}

// Direct CLI execution
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const force = process.argv.includes("--force");
  const soft = process.argv.includes("--soft") || process.argv.includes("--optional") || process.env.TWOFADO_INSTALL_OPTIONAL === "1";
  installCompanion({ force })
    .then((res) => {
      emit(`[2fado-install] Done: ${res.binPath} (${res.status})`);
      process.exit(0);
    })
    .catch((err) => {
      if (soft) {
        console.warn(`[2fado-install] Warning (soft-install): ${err.message}. Binary acquisition skipped; plugin will run with on-demand install / external daemon mode.`);
        process.exit(0);
      }
      console.error(`[2fado-install] Error: ${err.message}`);
      process.exit(1);
    });
}

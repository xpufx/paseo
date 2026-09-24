#!/usr/bin/env node
/** Best-effort 2fado notification after doctor-live's reload path. */
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** On by default in this repo; PASEO_RELOAD_NOTIFY=0 opts out. */
export function reloadNotifyEnabled(env = process.env) {
  return env.PASEO_RELOAD_NOTIFY !== "0";
}

export function reloadNotifySummary({ reloaded = [], failed = [], repoHead = "-" } = {}) {
  const parts = [];
  if (reloaded.length > 0) parts.push(`reloaded ${reloaded.join(", ")}`);
  if (failed.length > 0) parts.push(`failed: ${failed.join(", ")}`);
  if (parts.length === 0) return "";
  return `Paseo ${parts.join("; ")} @ ${repoHead}`;
}

/**
 * Send one 2fado notify for the whole reload batch. Resolves to true when the
 * daemon accepted it, false when skipped/unreachable — never throws.
 */
export async function notifyReloadOutcome({ reloaded = [], failed = [], repoHead = "-", env = process.env, run } = {}) {
  if (!reloadNotifyEnabled(env)) return false;
  const summary = reloadNotifySummary({ reloaded, failed, repoHead });
  if (!summary) return false;
  const link = env.PASEO_RELOAD_NOTIFY_LINK || "http://localhost:3000";
  const notifyBin = env.TWOFADO_NOTIFY_BIN || "2fado";
  try {
    if (run) {
      run(notifyBin, ["notify", "--link", link, "--summary", summary]);
    } else {
      await execFileAsync(notifyBin, ["notify", "--link", link, "--summary", summary], { timeout: 10000 });
    }
    console.log(`[reload-notify] sent 2fado notify: ${summary}`);
    return true;
  } catch (err) {
    console.warn(`[reload-notify] 2fado notify failed (continuing): ${err.message}`);
    return false;
  }
}
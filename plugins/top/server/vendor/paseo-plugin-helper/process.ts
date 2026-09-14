import { spawn, type SpawnOptions } from "node:child_process";

export interface SafeSpawnOptions extends SpawnOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

/**
 * Kills a spawned child together with everything it started. Plain
 * child.kill() only signals the direct child, so grandchildren (df, git
 * helpers, shell pipelines) orphan and accumulate. Negative-pid kill targets
 * the whole process group, which requires the child to lead its own group
 * (detached spawn, POSIX only).
 */
function killProcessGroup(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  try {
    if (
      process.platform !== "win32" &&
      child.pid !== undefined
    ) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // Group kill missed (already gone or no permission); fall through.
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
}

export interface SafeSpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

/**
 * Spawns a process safely with timeout management, stdout/stderr capture,
 * and clean process group termination without shell vulnerabilities.
 */
export function safeSpawn(
  command: string,
  args: string[] = [],
  options: SafeSpawnOptions = {},
): Promise<SafeSpawnResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 15000;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB

    const child = spawn(command, args, {
      ...options,
      shell: false,
      detached: options.detached ?? process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let exited = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGTERM");
        setTimeout(() => {
          if (!exited) killProcessGroup(child, "SIGKILL");
        }, 2000);
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString();
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      exited = true;
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (timedOut) {
        reject(new Error(`Command '${command}' timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        signal,
        durationMs,
      });
    });
  });
}

/**
 * Executes a shell command line string with timeout protection, stdout/stderr capture,
 * and clean process termination.
 */
export function safeExec(
  command: string,
  options: SafeSpawnOptions = {},
): Promise<SafeSpawnResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 15000;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB

    const child = spawn(command, {
      ...options,
      shell: true,
      detached: options.detached ?? process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let exited = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGTERM");
        setTimeout(() => {
          if (!exited) killProcessGroup(child, "SIGKILL");
        }, 2000);
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString();
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      exited = true;
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (timedOut) {
        reject(new Error(`Command '${command}' timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        signal,
        durationMs,
      });
    });
  });
}

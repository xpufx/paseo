import { spawn, type ChildProcess } from "node:child_process";

/**
 * Cross-platform process tree killer.
 * On POSIX, signals the entire process group (-pid).
 * On Windows, executes taskkill /T /F to terminate parent and descendants.
 */
export function killProcessTree(child: ChildProcess, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (!child || !child.pid || child.killed) {
      resolve();
      return;
    }

    const pid = child.pid;

    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.on("close", () => resolve());
        killer.on("error", () => {
          try {
            child.kill("SIGKILL");
          } catch {}
          resolve();
        });
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve();
      }
      return;
    }

    // POSIX process group termination
    try {
      // Signal negative PID for process group
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    const timer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
      resolve();
    }, timeoutMs);

    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

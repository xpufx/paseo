#!/usr/bin/env node

/**
 * 2fado Daemon Supervisor module.
 *
 * Provides lifecycle supervision (check-socket-first, start, stop, restart,
 * status probe, and in-memory log ring buffer) without requiring systemd.
 * Suitable for embedded execution in Node.js server contexts (such as Paseo plugins).
 */

import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");

const MAX_LOG_LINES = 150;

export class DaemonSupervisor {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT_DIR;
    this.managedBinDir = options.binDir || null;
    this.binDir = this.managedBinDir || join(this.rootDir, "bin");
    this.stateDir = options.stateDir || null;
    this.userConfigPath = options.userConfigPath || null;
    this.defaultBinPath = join(this.binDir, "2fado");
    this.configuredSocket = options.socketPath || process.env.TWOFADO_SOCKET;
    this.child = null;
    this.childPid = null;
    this.startedAt = null;
    this.logs = [];
  }

  appendLog(stream, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      stream,
      message: message.trimEnd(),
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.shift();
    }
  }

  getLogs(limit = 50) {
    return this.logs.slice(-Math.min(limit, this.logs.length));
  }

  resolveSocketPath(custom) {
    const trimmed = typeof custom === "string" ? custom.trim() : "";
    if (trimmed) return trimmed;
    if (this.configuredSocket) return this.configuredSocket;
    if (this.managedBinDir) return join(dirname(this.managedBinDir), "run", "2fado.sock");
    if (process.env.XDG_RUNTIME_DIR) {
      return join(process.env.XDG_RUNTIME_DIR, "2fado", "2fado.sock");
    }
    return "/tmp/2fado.sock";
  }

  resolveBinary(custom) {
    if (custom && existsSync(custom)) return custom;
    const exeSuffix = process.platform === "win32" ? ".exe" : "";
    const binName = `2fado${exeSuffix}`;
    const managedBin = join(this.binDir, binName);
    if (existsSync(managedBin)) return managedBin;
    if (process.env.TWOFADO_BIN_DIR) {
      const envBin = join(process.env.TWOFADO_BIN_DIR, binName);
      if (existsSync(envBin)) return envBin;
    }
    const checkoutBin = join(this.rootDir, "bin", binName);
    if (checkoutBin !== managedBin && existsSync(checkoutBin)) return checkoutBin;
    return null;
  }

  async probeSocket(socketPath, timeoutMs = 1500) {
    return new Promise((resolve) => {
      let settled = false;
      const sock = net.createConnection(socketPath);

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({ reachable: false, reason: "timeout" });
      }, timeoutMs);

      sock.setEncoding("utf8");

      sock.on("connect", () => {
        sock.write(JSON.stringify({ version: {} }) + "\n");
      });

      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          try {
            const data = JSON.parse(buf.slice(0, nl));
            finish({
              reachable: true,
              version: data.version,
              pid: data.pid,
              gitCommit: data.git_commit,
              buildTime: data.build_time,
            });
          } catch (err) {
            finish({ reachable: true, raw: buf });
          }
        }
      });

      sock.on("error", (err) => {
        finish({ reachable: false, error: err.message });
      });
    });
  }

  async status(customSocket) {
    const sockPath = this.resolveSocketPath(customSocket);
    const probe = await this.probeSocket(sockPath);

    if (probe.reachable) {
      const isSupervised = Boolean(this.child && !this.child.killed);
      return {
        state: "online",
        managed: isSupervised ? "supervisor" : "external",
        pid: probe.pid || this.childPid,
        socketPath: sockPath,
        version: probe.version,
        gitCommit: probe.gitCommit,
        uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : null,
      };
    }

    if (this.child && !this.child.killed) {
      return {
        state: "starting",
        managed: "supervisor",
        pid: this.childPid,
        socketPath: sockPath,
      };
    }

    return {
      state: "offline",
      managed: "none",
      socketPath: sockPath,
    };
  }

  async start(options = {}) {
    const sockPath = this.resolveSocketPath(options.socketPath);
    const currentStatus = await this.status(sockPath);

    if (currentStatus.state === "online") {
      this.appendLog("system", `Daemon already online at ${sockPath} (managed: ${currentStatus.managed})`);
      return {
        success: true,
        alreadyRunning: true,
        managed: currentStatus.managed,
        pid: currentStatus.pid,
        socketPath: sockPath,
      };
    }

    let bin = this.resolveBinary(options.binPath);
    if (!bin) {
      this.appendLog("system", "companion binary not found; installing in-process...");
      try {
        const installer = await import("./install-companion.mjs");
        const emit = (msg) => this.appendLog("stdout", String(msg).replace(/^\[2fado-install\] /, ""));
        const result = await installer.installCompanion({
          version: process.env.TWOFADO_VERSION,
          binDir: this.binDir,
          log: emit,
        });
        this.appendLog("system", `install finished: ${result.binPath} (${result.status})`);
        bin = this.resolveBinary(options.binPath);
      } catch (err) {
        const msg = `companion install failed: ${err.message}; run daemonInstall to retry`;
        this.appendLog("stderr", msg);
        return { success: false, socketPath: sockPath, error: msg, needsInstall: true };
      }
    }
    if (!bin) {
      const msg = "2fado companion binary not installed; run daemonInstall first";
      this.appendLog("stderr", msg);
      return { success: false, socketPath: sockPath, error: msg, needsInstall: true };
    }
    this.appendLog("system", `Spawning 2fado daemon (${bin})...`);

    const stateDir = options.stateDir || this.stateDir;
    const userConfigPath = options.userConfigPath || this.userConfigPath;
    const env = {
      ...process.env,
      TWOFADO_SOCKET: sockPath,
      ...(stateDir ? { TWOFADO_STATE_DIR: stateDir } : {}),
      ...(userConfigPath ? { TWOFADO_USER_CONFIG: userConfigPath } : {}),
      ...(options.runDir ? { TWOFADO_RUN_DIR: options.runDir } : {}),
      ...(options.conf ? { TWOFADO_CONF: options.conf } : {}),
    };

    const { mkdir } = await import("node:fs/promises");
    await mkdir(dirname(sockPath), { recursive: true });

    try {
      this.child = spawn(bin, ["daemon"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child.on("error", (err) => {
        this.appendLog("stderr", `Failed to spawn daemon: ${err.message}`);
        this.spawnError = err;
        this.child = null;
        this.childPid = null;
        this.startedAt = null;
      });
    } catch (err) {
      this.appendLog("stderr", `Failed to spawn daemon: ${err.message}`);
      throw err;
    }

    this.childPid = this.child.pid;
    this.startedAt = Date.now();
    this.appendLog("system", `Daemon child process spawned with PID ${this.childPid}`);

    this.child.stdout.on("data", (chunk) => {
      this.appendLog("stdout", chunk.toString());
    });

    this.child.stderr.on("data", (chunk) => {
      this.appendLog("stderr", chunk.toString());
    });

    this.child.on("exit", (code, signal) => {
      this.appendLog("system", `Daemon child process exited with code ${code}, signal ${signal}`);
      this.child = null;
      this.childPid = null;
      this.startedAt = null;
    });

    // Wait up to 3.5s for socket to become ready
    const startWait = Date.now();
    while (Date.now() - startWait < 3500) {
      await new Promise((r) => setTimeout(r, 200));
      const check = await this.probeSocket(sockPath);
      if (check.reachable) {
        this.appendLog("system", `Daemon socket ready and verified at ${sockPath}`);
        return {
          success: true,
          pid: this.childPid,
          socketPath: sockPath,
          version: check.version,
        };
      }
      if (!this.child) {
        if (this.spawnError) {
          const err = this.spawnError;
          this.spawnError = null;
          return { success: false, socketPath: sockPath, error: `spawn failed: ${err.message}` };
        }
        break;
      }
    }

    throw new Error(`Daemon failed to bind socket at ${sockPath} within timeout`);
  }

  async stop(timeoutMs = 3000) {
    if (!this.child || this.child.killed) {
      this.appendLog("system", "No supervised child process to stop");
      return { stopped: true, alreadyStopped: true };
    }

    this.appendLog("system", `Sending SIGTERM to child process PID ${this.childPid}...`);
    this.child.kill("SIGTERM");

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!this.child) {
        this.appendLog("system", "Daemon child stopped cleanly");
        return { stopped: true };
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.child) {
      this.appendLog("system", "Daemon did not exit in time, sending SIGKILL...");
      this.child.kill("SIGKILL");
      this.child = null;
      this.childPid = null;
    }

    return { stopped: true, forced: true };
  }

  async restart(options = {}) {
    await this.stop();
    return this.start(options);
  }
}

// Direct CLI test execution
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const supervisor = new DaemonSupervisor();
  const cmd = process.argv[2] || "status";

  (async () => {
    if (cmd === "status") {
      const s = await supervisor.status();
      console.log(JSON.stringify(s, null, 2));
    } else if (cmd === "start") {
      const res = await supervisor.start();
      console.log("Started:", res);
      await new Promise((r) => setTimeout(r, 1000));
      await supervisor.stop();
    }
  })().catch((err) => {
    console.error("Supervisor error:", err);
    process.exit(1);
  });
}

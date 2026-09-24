import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

/**
 * Companion daemon lifecycle and binary acquisition contracts.
 *
 * The 2fado companion binary and the `daemon-supervisor.mjs` module ship inside
 * this plugin package (`scripts/`). Paseo runs the acquisition script during the
 * plugin `build` step and the server supervises the daemon process in Node. The
 * contracts below expose that supervision to the client so a surface can show
 * daemon state and offer explicit start/stop/restart/logs/install actions.
 */

const socketPath = z.string().min(1).optional();

export const daemonStatus = defineContract({
  name: "daemon.status",
  input: z.object({ socketPath }),
  output: z.object({
    state: z.enum(["online", "offline", "starting"]),
    managed: z.enum(["supervisor", "external", "none"]),
    pid: z.number().nullable().optional(),
    socketPath: z.string(),
    version: z.string().optional(),
    gitCommit: z.string().optional(),
    uptimeSeconds: z.number().nullable().optional(),
  }),
  description: "Probe 2fadod state, adopting an externally managed daemon when present",
});

export const daemonStart = defineContract({
  name: "daemon.start",
  input: z.object({ socketPath }),
  output: z.object({
    success: z.boolean(),
    alreadyRunning: z.boolean().optional(),
    managed: z.enum(["supervisor", "external"]).optional(),
    pid: z.number().nullable().optional(),
    socketPath: z.string(),
    version: z.string().optional(),
    error: z.string().optional(),
  }),
  description: "Start (or adopt) the 2fado daemon, checking the socket first",
});

export const daemonStop = defineContract({
  name: "daemon.stop",
  input: z.object({}),
  output: z.object({
    stopped: z.boolean(),
    alreadyStopped: z.boolean().optional(),
    forced: z.boolean().optional(),
  }),
  description: "Stop the 2fado daemon child process this plugin supervises",
});

export const daemonRestart = defineContract({
  name: "daemon.restart",
  input: z.object({ socketPath }),
  output: daemonStart.output,
  description: "Restart the supervised 2fado daemon",
});

export const daemonLogs = defineContract({
  name: "daemon.logs",
  input: z.object({ limit: z.number().int().min(1).max(150).optional() }),
  output: z.object({
    entries: z.array(
      z.object({
        timestamp: z.string(),
        stream: z.string(),
        message: z.string(),
      }),
    ),
  }),
  description: "Read the in-memory ring buffer of supervised daemon stdout/stderr",
});

export const daemonInstall = defineContract({
  name: "daemon.install",
  input: z.object({ force: z.boolean().optional() }),
  output: z.object({
    success: z.boolean(),
    binPath: z.string().optional(),
    status: z.string().optional(),
    version: z.string().optional(),
    error: z.string().optional(),
  }),
  description: "Acquire the platform 2fado binary on demand when the build step was skipped",
});

export type DaemonStatus = z.output<typeof daemonStatus.output>;
export type DaemonStartResult = z.output<typeof daemonStart.output>;
export type DaemonStopResult = z.output<typeof daemonStop.output>;
export type DaemonLogEntry = z.output<typeof daemonLogs.output>["entries"][number];
export type DaemonInstallResult = z.output<typeof daemonInstall.output>;

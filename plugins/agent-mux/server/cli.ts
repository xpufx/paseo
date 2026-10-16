import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getPathEnv(): string {
  const home = process.env.HOME || "";
  const localBin = `${home}/.local/bin`;
  const existingPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  if (existingPath.includes(localBin)) {
    return existingPath;
  }
  return `${localBin}:${existingPath}`;
}

export async function runAgentMux(args: string[], timeoutMs = 15_000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("agent-mux", args, {
      timeout: timeoutMs,
      env: {
        ...process.env,
        PATH: getPathEnv(),
      },
      maxBuffer: 4 * 1024 * 1024,
    });
    return (stdout || stderr || "").trim();
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: string };
    if (execErr.code === "ENOENT") {
      throw new Error(
        "agent-mux CLI was not found in PATH or ~/.local/bin. Ensure agent-mux is installed."
      );
    }
    const combined = ((execErr.stdout ?? "") + (execErr.stderr ?? "")).trim();
    if (combined) {
      return combined;
    }
    throw new Error(`agent-mux failed: ${execErr.message ?? String(err)}`);
  }
}

export async function runBwrapVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("bwrap", ["--version"], {
      timeout: 5_000,
      env: {
        ...process.env,
        PATH: getPathEnv(),
      },
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

export async function runStatus(probe?: boolean, provider?: string): Promise<string> {
  const args = ["status"];
  if (provider) args.push(provider);
  if (probe) args.push("--probe");
  return runAgentMux(args);
}

export async function runProfiles(provider?: string): Promise<string> {
  const args = ["profile", "list"];
  if (provider) args.push(provider);
  return runAgentMux(args);
}

export async function runCooldowns(): Promise<string> {
  return runAgentMux(["cooldowns", "list"]);
}

export async function runLogs(tail = 50): Promise<string> {
  return runAgentMux(["logs", "--tail", String(tail)]);
}

export async function runConfig(): Promise<string> {
  return runAgentMux(["config", "list"]);
}

export async function runWrappers(): Promise<string> {
  return runAgentMux(["wrappers"]);
}

export async function runProbe(provider: string, profile?: string, pool?: string): Promise<string> {
  const args = ["probe", provider];
  if (profile) args.push(profile);
  if (pool) args.push(pool);
  return runAgentMux(args, 25_000);
}

export async function runClearCooldown(
  provider?: string,
  profile?: string,
  pool?: string
): Promise<string> {
  const args = ["cooldowns", "clear"];
  if (provider) args.push(provider);
  if (profile) args.push(profile);
  if (pool) args.push(pool);
  return runAgentMux(args);
}

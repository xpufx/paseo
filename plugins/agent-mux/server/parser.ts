import type {
  CooldownItem,
  CooldownsPayload,
  ConfigPayload,
  LogEntry,
  LogsPayload,
  ProbePayload,
  ProbeResult,
  ProfileInventoryItem,
  ProfilesPayload,
  ProviderProfiles,
  ProviderStatus,
  QuotaHealth,
  SystemStatus,
  WrapperInfo,
} from "../shared/types.js";

/**
 * Strips ANSI escape codes from terminal output.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Parses time remaining strings like "46h 19m 21s" into total seconds.
 */
export function parseRemainingSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const hours = timeStr.match(/(\d+)\s*h/i)?.[1];
  const mins = timeStr.match(/(\d+)\s*m/i)?.[1];
  const secs = timeStr.match(/(\d+)\s*s/i)?.[1];

  let total = 0;
  if (hours) total += parseInt(hours, 10) * 3600;
  if (mins) total += parseInt(mins, 10) * 60;
  if (secs) total += parseInt(secs, 10);
  return total;
}

/**
 * Parses `bwrap --version` output (e.g. "bubblewrap 0.9.0").
 */
export function parseBwrapVersion(raw: string): string | undefined {
  const clean = stripAnsi(raw).trim();
  const match = clean.match(/bubblewrap\s+([0-9.]+)/i);
  return match?.[1];
}

/**
 * Parses `agent-mux status [--probe]` output.
 */
export function parseStatusOutput(
  raw: string,
  extra?: { bwrapVersion?: string; profileOverride?: string | null }
): SystemStatus {
  const clean = stripAnsi(raw);
  const lines = clean.split("\n");

  const isoMatch = clean.match(/\[Isolation Mode:\s*([^\]]+)\]/i);
  const isolationMode = isoMatch ? isoMatch[1].trim() : "unknown";

  const providers: ProviderStatus[] = [];
  let currentProvider: ProviderStatus | null = null;
  let currentProfile: {
    profile: string;
    authenticated: boolean;
    accountIdentity?: string;
    pools: Array<{ pool: string; state: string; details?: string }>;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const provMatch = line.match(/^Provider:\s*(.+?)\s*\(([^)]+)\)/i);
    if (provMatch) {
      if (currentProvider) {
        if (currentProfile) currentProvider.profiles.push(currentProfile);
        currentProfile = null;
        providers.push(currentProvider);
      }
      currentProvider = {
        name: provMatch[1].trim(),
        id: provMatch[2].trim(),
        profiles: [],
      };
      continue;
    }

    if (!currentProvider) continue;

    if (line.includes("No profiles configured")) {
      continue;
    }

    const profMatch = line.match(/^\s*[•*]\s*(\S+)\s*\[([^\]]+)\](?:\s*\(([^)]+)\))?:/);
    if (profMatch) {
      if (currentProfile) {
        currentProvider.profiles.push(currentProfile);
      }
      const authStr = profMatch[2].toLowerCase();
      currentProfile = {
        profile: profMatch[1].trim(),
        authenticated: authStr.includes("authenticated"),
        accountIdentity: profMatch[3]?.trim(),
        pools: [],
      };
      continue;
    }

    const poolMatch = line.match(/^\s*-\s*Pool\s*'([^']+)':\s*\[([^\]]+)\]/);
    if (poolMatch && currentProfile) {
      const poolName = poolMatch[1].trim();
      const rawState = poolMatch[2].trim();
      const stateMatch = rawState.match(/^([A-Z_0-9-]+)(?:\s*\((.*?)\))?$/i);
      const state = (stateMatch?.[1] || rawState).toUpperCase();
      const details = stateMatch?.[2]?.trim();
      currentProfile.pools.push({
        pool: poolName,
        state,
        details: details || undefined,
      });
    }
  }

  if (currentProvider) {
    if (currentProfile) currentProvider.profiles.push(currentProfile);
    providers.push(currentProvider);
  }

  let totalPools = 0;
  let cooldownPools = 0;
  let activeCooldownsCount = 0;

  for (const prov of providers) {
    for (const prof of prov.profiles) {
      for (const pl of prof.pools) {
        totalPools++;
        if (pl.state.includes("COOLDOWN") || pl.state.includes("EXHAUSTED") || pl.state.includes("429")) {
          cooldownPools++;
          activeCooldownsCount++;
        }
      }
    }
  }

  let quotaHealth: QuotaHealth = "green";
  if (cooldownPools > 0) {
    if (cooldownPools >= totalPools && totalPools > 0) {
      quotaHealth = "red";
    } else {
      quotaHealth = "yellow";
    }
  }

  return {
    isolationMode,
    bwrapVersion: extra?.bwrapVersion,
    profileOverride: extra?.profileOverride ?? null,
    providers,
    activeCooldownsCount,
    quotaHealth,
    rawOutput: clean,
  };
}

/**
 * Parses `agent-mux profile list [provider]` output.
 */
export function parseProfileListOutput(raw: string): ProfilesPayload {
  const clean = stripAnsi(raw);
  const lines = clean.split("\n");

  const sandboxedWarning = clean.includes("Detected active sandboxed session");
  const isoMatch = clean.match(/\[Isolation Mode:\s*([^\]]+)\]/i);
  const isolationMode = isoMatch ? isoMatch[1].trim() : "unknown";

  const providers: ProviderProfiles[] = [];
  let currentProvider: ProviderProfiles | null = null;

  for (const line of lines) {
    const provMatch = line.match(/^Provider:\s*(.+?)\s*\(([^)]+)\)/i);
    if (provMatch) {
      if (currentProvider) providers.push(currentProvider);
      currentProvider = {
        name: provMatch[1].trim(),
        id: provMatch[2].trim(),
        profiles: [],
      };
      continue;
    }

    if (!currentProvider) continue;
    if (line.includes("No profiles configured")) continue;

    // Line format: "  • <name> [<status>] (<identity>) [unregistered] -> <directory>"
    const itemMatch = line.match(
      /^\s*[•*]\s*(\S+)\s*\[([^\]]+)\](?:\s*\(([^)]+)\))?(?:\s*\[(unregistered)\])?\s*->\s*(.+)$/
    );
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const status = itemMatch[2].trim();
      const accountIdentity = itemMatch[3]?.trim();
      const registered = itemMatch[4] !== "unregistered";
      const directory = itemMatch[5].trim();

      currentProvider.profiles.push({
        name,
        status,
        accountIdentity,
        registered,
        directory,
        enabled: true,
      });
    }
  }

  if (currentProvider) {
    providers.push(currentProvider);
  }

  return {
    isolationMode,
    sandboxedWarning,
    providers,
  };
}

/**
 * Parses `agent-mux cooldowns [list]` output.
 */
export function parseCooldownsOutput(raw: string): CooldownsPayload {
  const clean = stripAnsi(raw);
  const lines = clean.split("\n");
  const cooldowns: CooldownItem[] = [];

  let currentItem: Partial<CooldownItem> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^\s*[•*]\s*([^:]+):(\S+)\s*\(pool:\s*([^)]+)\)/);
    if (headerMatch) {
      if (currentItem && currentItem.provider && currentItem.profile && currentItem.pool) {
        cooldowns.push(currentItem as CooldownItem);
      }
      currentItem = {
        provider: headerMatch[1].trim(),
        profile: headerMatch[2].trim(),
        pool: headerMatch[3].trim(),
        remainingSeconds: 0,
        remainingDisplay: "0s",
        reason: "Rate limited",
        resetAt: new Date().toISOString(),
      };
      continue;
    }

    if (!currentItem) continue;

    const remMatch = line.match(/^\s*Remaining:\s*(.+)$/i);
    if (remMatch) {
      const display = remMatch[1].trim();
      currentItem.remainingDisplay = display;
      currentItem.remainingSeconds = parseRemainingSeconds(display);
      continue;
    }

    const reasonMatch = line.match(/^\s*Reason:\s*(.+)$/i);
    if (reasonMatch) {
      currentItem.reason = reasonMatch[1].trim();
      continue;
    }

    const resetMatch = line.match(/^\s*Reset At:\s*(.+)$/i);
    if (resetMatch) {
      currentItem.resetAt = resetMatch[1].trim();
      continue;
    }
  }

  if (currentItem && currentItem.provider && currentItem.profile && currentItem.pool) {
    cooldowns.push(currentItem as CooldownItem);
  }

  return {
    cooldowns,
    totalCount: cooldowns.length,
  };
}

/**
 * Parses `agent-mux config list` output.
 */
export function parseConfigListOutput(raw: string): ConfigPayload {
  const clean = stripAnsi(raw);

  const fileMatch = clean.match(/Config file:\s*(.+)/i);
  const configFile = fileMatch ? fileMatch[1].trim() : "";

  const surfMatch = clean.match(/Active surface_account:\s*(\S+)(.*)/i);
  const activeSurfaceAccount = surfMatch ? surfMatch[1].trim() : "none";
  const surfaceAccountOverridden = Boolean(surfMatch?.[2]?.includes("overridden by"));

  const routeMatch = clean.match(/Active routingPolicy:\s*(\S+)(.*)/i);
  const activeRoutingPolicy = routeMatch ? routeMatch[1].trim() : "pool-strict";
  const routingPolicyOverridden = Boolean(routeMatch?.[2]?.includes("overridden by"));

  let settings: Record<string, unknown> = {};
  const jsonIndex = clean.indexOf("Settings in config file:");
  if (jsonIndex !== -1) {
    const jsonStr = clean.slice(jsonIndex + "Settings in config file:".length).trim();
    try {
      settings = JSON.parse(jsonStr);
    } catch {
      settings = {};
    }
  }

  return {
    configFile,
    activeSurfaceAccount,
    activeRoutingPolicy,
    surfaceAccountOverridden,
    routingPolicyOverridden,
    settings,
    wrappers: [],
  };
}

/**
 * Parses `agent-mux wrappers` output.
 */
export function parseWrappersOutput(raw: string): WrapperInfo[] {
  const clean = stripAnsi(raw);
  const lines = clean.split("\n");
  const wrappers: WrapperInfo[] = [];

  for (const line of lines) {
    const match = line.match(
      /^\s*[•*]\s*(\S+)\s*\[(WRAPPED|UNWRAPPED|NOT FOUND(?:\s+in\s+PATH)?)\](?:\s*(\S+?)(?:\s*->\s*(\S+))?)?$/i
    );
    if (match) {
      const binaryName = match[1].trim();
      const rawStatus = match[2].toUpperCase();
      const status: "WRAPPED" | "UNWRAPPED" | "NOT FOUND" = rawStatus.includes("WRAPPED")
        ? rawStatus.includes("UNWRAPPED")
          ? "UNWRAPPED"
          : "WRAPPED"
        : "NOT FOUND";
      const sourcePath = match[3]?.trim();
      const targetPath = match[4]?.trim();

      wrappers.push({
        binaryName,
        status,
        sourcePath,
        targetPath,
      });
    }
  }

  return wrappers;
}

/**
 * Parses `agent-mux logs [--tail N]` output.
 */
export function parseLogsOutput(raw: string, filterType?: string): LogsPayload {
  const clean = stripAnsi(raw);
  const lines = clean.split("\n");

  let logFile = "agent-mux.log";
  const headerMatch = clean.match(/=== agent-mux Logs \(([^)]+)\) ===/i);
  if (headerMatch) {
    logFile = headerMatch[1].trim();
  } else {
    const missingMatch = clean.match(/No logs found at (\S+)/i);
    if (missingMatch) logFile = missingMatch[1].trim();
  }

  const entries: LogEntry[] = [];
  const normalizedFilter = filterType?.toUpperCase();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("===") || trimmed.startsWith("No logs found")) {
      continue;
    }

    const logMatch = trimmed.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(.*)$/);
    if (logMatch) {
      const timestamp = logMatch[1].trim();
      const level = logMatch[2].trim().toUpperCase();
      const message = logMatch[3].trim();

      if (normalizedFilter && normalizedFilter !== "ALL" && !level.includes(normalizedFilter)) {
        continue;
      }

      entries.push({
        raw: trimmed,
        timestamp,
        level,
        message,
      });
    } else {
      if (!normalizedFilter || normalizedFilter === "ALL") {
        entries.push({
          raw: trimmed,
          message: trimmed,
        });
      }
    }
  }

  return {
    logFile,
    entries,
  };
}

/**
 * Parses `agent-mux probe <provider>` output.
 */
export function parseProbeOutput(raw: string, provider: string): ProbePayload {
  const clean = stripAnsi(raw);
  const lines = clean.split("\n");
  const results: ProbeResult[] = [];

  let currentProfile = "";

  for (const line of lines) {
    const profMatch = line.match(/^[•*]?\s*Profile:\s*(\S+)/i);
    if (profMatch) {
      currentProfile = profMatch[1].trim();
      continue;
    }

    const probeLineMatch = line.match(
      /\[Probing\s*(\S+)(?:\s*\(([^)]+)\))?\]\.\.\.\s*\[([^:]+):\s*(.*?)\]/i
    );
    if (probeLineMatch) {
      results.push({
        profile: probeLineMatch[1].trim() || currentProfile,
        pool: probeLineMatch[2]?.trim(),
        state: probeLineMatch[3].trim(),
        details: probeLineMatch[4].trim(),
      });
    }
  }

  return {
    provider,
    results,
    rawOutput: clean,
  };
}

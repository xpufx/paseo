import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, watch, type FSWatcher } from "node:fs";
export { directHostMismatch } from "../shared/registry.ts";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";

// All plugin state lives under a single namespaced subdir of paseo's home
// (~/.paseo/paseo-x-comms/) rather than littering ~/.paseo root.
export function stateDir(): string {
  return join(homedir(), ".paseo", "paseo-x-comms");
}

export const REGISTRY_DEFAULT = join(stateDir(), "registry.json");

// One-time migration: move a file from the old ~/.paseo root location into the
// namespaced state dir. Deterministic and forward-only; never a fallback path.
export function migrateFromRoot(oldName: string, newPath: string): void {
  const oldPath = join(homedir(), ".paseo", oldName);
  if (!existsSync(oldPath) || existsSync(newPath)) return;
  mkdirSync(stateDir(), { recursive: true });
  renameSync(oldPath, newPath);
}

export interface RegistryDaemon {
  name: string;
  value: string;
  valid: boolean;
  error: string | null;
  source?: "registry" | "configured-host";
  serverId?: string | null;
  status?: string | null;
}

export function currentHostsPath(): string {
  const env = process.env.PASEO_HOSTS_FILE;
  if (env && env.length > 0) return env;
  return join(homedir(), ".paseo", "hosts.json");
}

export function parseConfiguredHosts(content: string): {
  ok: boolean;
  hosts: RegistryDaemon[];
  parseError: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      hosts: [],
      parseError: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const items: Array<Record<string, unknown>> = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === "string") {
        items.push({ endpoint: item });
      } else if (item && typeof item === "object") {
        items.push(item as Record<string, unknown>);
      }
    }
  } else if (parsed && typeof parsed === "object") {
    const rawObj = parsed as Record<string, unknown>;
    if (Array.isArray(rawObj.hosts)) {
      for (const item of rawObj.hosts) {
        if (item && typeof item === "object") {
          items.push(item as Record<string, unknown>);
        }
      }
    } else {
      for (const [key, val] of Object.entries(rawObj)) {
        if (typeof val === "string") {
          items.push({ name: key, endpoint: val });
        } else if (val && typeof val === "object") {
          items.push({ name: key, ...(val as Record<string, unknown>) });
        }
      }
    }
  } else {
    return { ok: false, hosts: [], parseError: "configured hosts must be a JSON array or object" };
  }

  const hosts: RegistryDaemon[] = [];
  for (const item of items) {
    const endpointRaw = item.endpoint ?? item.target ?? item.url ?? item.offer;
    const value = typeof endpointRaw === "string" ? endpointRaw.trim() : "";
    const serverId = typeof item.serverId === "string" ? item.serverId.trim() : (deriveHostFromValue(value) ?? null);
    const status = typeof item.status === "string" ? item.status.trim() : "online";
    const rawName = item.label ?? item.name ?? serverId;
    const name =
      typeof rawName === "string" && rawName.trim().length > 0
        ? rawName.trim()
        : (serverId ?? "unnamed-host");

    if (!value) {
      hosts.push({
        name,
        value: "",
        valid: false,
        error: "missing endpoint / host value",
        source: "configured-host",
        serverId,
        status,
      });
      continue;
    }

    const checked = validateDaemonHost(value);
    hosts.push({
      name,
      value,
      valid: checked.valid,
      error: checked.error,
      source: "configured-host",
      serverId,
      status,
    });
  }

  return { ok: true, hosts, parseError: null };
}

export function loadConfiguredHosts(hostsPath: string = currentHostsPath()): RegistryDaemon[] {
  if (!existsSync(hostsPath)) return [];
  try {
    const content = readFileSync(hostsPath, "utf8");
    const parsed = parseConfiguredHosts(content);
    return parsed.ok ? parsed.hosts : [];
  } catch {
    return [];
  }
}

let activeWatcher: FSWatcher | null = null;

export function startConfiguredHostsWatcher(
  hostsPath: string = currentHostsPath(),
  onChange?: (hosts: RegistryDaemon[]) => void,
): () => void {
  stopConfiguredHostsWatcher();
  const dir = dirname(hostsPath);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
  }

  const reload = () => {
    const hosts = loadConfiguredHosts(hostsPath);
    onChange?.(hosts);
  };

  try {
    activeWatcher = watch(dir, (eventType, filename) => {
      if (!filename || filename === basename(hostsPath)) {
        reload();
      }
    });
  } catch {}

  return () => stopConfiguredHostsWatcher();
}

export function stopConfiguredHostsWatcher(): void {
  if (activeWatcher) {
    try {
      activeWatcher.close();
    } catch {}
    activeWatcher = null;
  }
}

/** The plausible canonical forms paseo classifies as --host targets. */
export function validateDaemonHost(value: string): { valid: boolean; error: string | null } {
  const v = value.trim();
  if (v.length === 0) return { valid: false, error: "empty value" };

  // Relay offer: any value containing #offer= (E2EE via relay).
  if (v.includes("#offer=")) {
    if (/^https?:\/\//.test(v)) return { valid: true, error: null };
    return { valid: false, error: "#offer= value must be a full pairing URL (https://…)" };
  }

  // tcp://host:port with optional query (ssl, password).
  if (v.startsWith("tcp://")) {
    if (/^tcp:\/\/[^/]+\/\?.*$|^tcp:\/\/[^/]+$/.test(v)) return { valid: true, error: null };
    return { valid: false, error: "tcp:// must include host[:port] (tcp://host:port?ssl=true…) " };
  }

  // unix:///path or pipe://…
  if (v.startsWith("unix://") || v.startsWith("pipe://")) {
    if (v.length > 7) return { valid: true, error: null };
    return { valid: false, error: "missing path after scheme" };
  }

  // absolute paths
  if (v.startsWith("/")) return { valid: true, error: null };

  // bare port → 127.0.0.1:port
  if (/^\d+$/.test(v)) return { valid: true, error: null };

  // host:port, IPv6 [::1]:6767
  if (/^\[[0-9a-fA-F:.]+\]:\d+$/.test(v)) return { valid: true, error: null };
  if (/^[^/:]+:\d+$/.test(v)) return { valid: true, error: null };

  return { valid: false, error: "not a canonical form (relay URL, host:port, tcp://, unix://, bare port)" };
}

export function parseRegistry(content: string): {
  ok: boolean;
  daemons: Array<{ name: string; value: string; valid: boolean; error: string | null }>;
  parseError: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      daemons: [],
      parseError: cause instanceof Error ? cause.message : String(cause),
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, daemons: [], parseError: "registry must be a JSON object of name → host" };
  }
  const daemons = Object.entries(parsed as Record<string, unknown>).map(([name, value]) => {
    if (typeof value !== "string") {
      return { name, value: String(value), valid: false, error: "value must be a string" };
    }
    const checked = validateDaemonHost(value);
    return { name, value, ...checked };
  });
  return { ok: true, daemons, parseError: null };
}

export function currentRegistryPath(): string {
  const env = process.env.PASEO_X_COMMS_REMOTES;
  if (env && env.length > 0) return env;
  return REGISTRY_DEFAULT;
}

export function validateDaemonName(name: string): { valid: boolean; error: string | null } {
  const n = name.trim();
  if (n.length === 0) return { valid: false, error: "name is required" };
  if (!/^[A-Za-z0-9._-]+$/.test(n)) {
    return { valid: false, error: "name may only contain letters, digits, '.', '_', '-'" };
  }
  return { valid: true, error: null };
}

export interface ReadRegistryOptions {
  includeConfiguredHosts?: boolean;
  hostsPath?: string;
}

/** Reads + validates the registry file, merging configured hosts unless excluded. */
export function readRegistry(
  path: string,
  options?: ReadRegistryOptions,
): { ok: boolean; exists: boolean; parseError: string | null; daemons: RegistryDaemon[] } {
  const includeHosts = options?.includeConfiguredHosts !== false;
  if (!existsSync(path)) {
    const configuredHosts = includeHosts ? loadConfiguredHosts(options?.hostsPath) : [];
    return { ok: true, exists: false, parseError: null, daemons: configuredHosts };
  }
  const content = readFileSync(path, "utf8");
  const parsed = parseRegistry(content);
  if (!parsed.ok) {
    return { ok: false, exists: true, parseError: parsed.parseError, daemons: [] };
  }
  const manualDaemons: RegistryDaemon[] = parsed.daemons.map((d) => ({
    ...d,
    source: "registry" as const,
    serverId: deriveHostFromValue(d.value) ?? null,
  }));

  if (!includeHosts) {
    return { ok: true, exists: true, parseError: null, daemons: manualDaemons };
  }

  const configuredHosts = loadConfiguredHosts(options?.hostsPath);
  const manualNames = new Set(manualDaemons.map((d) => d.name));
  const merged: RegistryDaemon[] = [...manualDaemons];

  for (const host of configuredHosts) {
    if (!manualNames.has(host.name)) {
      merged.push(host);
    }
  }

  return { ok: true, exists: true, parseError: null, daemons: merged };
}

/**
 * Applies a mutation to the registry and writes it only when every entry is
 * valid. Returns fresh state plus whether the write happened; on any invalid
 * entry the file is left untouched.
 */
export function mutateRegistry(
  path: string,
  mutate: (daemons: Record<string, string>) => Record<string, string>,
): {
  saved: boolean;
  error: string | null;
  registryPath: string;
  daemons: RegistryDaemon[];
} {
  const current = readRegistry(path, { includeConfiguredHosts: false });
  if (!current.ok) {
    return {
      saved: false,
      error: `existing registry is not valid JSON: ${current.parseError}`,
      registryPath: path,
      daemons: [],
    };
  }
  const existing: Record<string, string> = {};
  for (const daemon of current.daemons) existing[daemon.name] = daemon.value;

  let next: Record<string, string>;
  try {
    next = mutate(existing);
  } catch (cause) {
    return {
      saved: false,
      error: cause instanceof Error ? cause.message : String(cause),
      registryPath: path,
      daemons: current.daemons,
    };
  }

  const entries: RegistryDaemon[] = Object.entries(next).map(([name, value]) => ({
    name,
    value,
    ...validateDaemonHost(value),
    source: "registry" as const,
    serverId: deriveHostFromValue(value) ?? null,
  }));
  const invalid = entries.find((entry) => !entry.valid);
  if (invalid) {
    return {
      saved: false,
      error: `${invalid.name} is not a valid daemon host: ${invalid.error}`,
      registryPath: path,
      daemons: entries,
    };
  }
  // Two names must not point at the same host; that is almost always a copy
  // bug, not an intentional alias.
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const prior = seen.get(entry.value);
    if (prior !== undefined) {
      return {
        saved: false,
        error: `${entry.name} and ${prior} use the same host value`,
        registryPath: path,
        daemons: entries,
      };
    }
    seen.set(entry.value, entry.name);
  }
  if (JSON.stringify(sortEntries(current.daemons)) === JSON.stringify(sortEntries(entries))) {
    // No change; still report success so the UI can settle.
    return { saved: true, error: null, registryPath: path, daemons: readRegistry(path).daemons };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { saved: true, error: null, registryPath: path, daemons: readRegistry(path).daemons };
  } catch (cause) {
    return {
      saved: false,
      error: cause instanceof Error ? cause.message : String(cause),
      registryPath: path,
      daemons: entries,
    };
  }
}

function sortEntries(daemons: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return [...daemons].sort((left, right) => left.name.localeCompare(right.name));
}
/**
 * Derives the canonical host for a registry value, when it can be done
 * deterministically. Relay offers embed their serverId, so the real host is
 * that id. Direct/local hosts carry no identity, so nothing is derived and the
 * user must supply the name themselves.
 */
export function deriveHostFromValue(value: string): string | null {
  const offer = value.match(/#offer=([A-Za-z0-9_-]+)/);
  if (offer) {
    try {
      const payload = JSON.parse(Buffer.from(offer[1], "base64").toString("utf8"));
      return typeof payload.serverId === "string" ? payload.serverId : null;
    } catch {
      return null;
    }
  }
  return null;
}

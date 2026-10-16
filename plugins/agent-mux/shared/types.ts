export type QuotaHealth = "green" | "yellow" | "red";

export interface PoolStatus {
  pool: string;
  state: string; // e.g. "HEALTHY" | "COOLDOWN" | "ERROR" | "UNKNOWN"
  details?: string;
}

export interface ProfileStatus {
  profile: string;
  authenticated: boolean;
  accountIdentity?: string;
  pools: PoolStatus[];
  enabled?: boolean;
}

export interface ProviderStatus {
  id: string;
  name: string;
  profiles: ProfileStatus[];
}

export interface SystemStatus {
  isolationMode: string;
  bwrapVersion?: string;
  profileOverride?: string | null;
  providers: ProviderStatus[];
  activeCooldownsCount: number;
  quotaHealth: QuotaHealth;
  rawOutput?: string;
}

export interface ProfileInventoryItem {
  name: string;
  status: "Authenticated" | "Pending login" | "missing directory" | string;
  accountIdentity?: string;
  registered: boolean;
  directory: string;
  enabled: boolean;
}

export interface ProviderProfiles {
  id: string;
  name: string;
  profiles: ProfileInventoryItem[];
}

export interface ProfilesPayload {
  isolationMode: string;
  sandboxedWarning: boolean;
  providers: ProviderProfiles[];
}

export interface CooldownItem {
  provider: string;
  profile: string;
  pool: string;
  remainingSeconds: number;
  remainingDisplay: string;
  reason: string;
  resetAt: string;
}

export interface CooldownsPayload {
  cooldowns: CooldownItem[];
  totalCount: number;
}

export interface LogEntry {
  raw: string;
  timestamp?: string;
  level?: "SUPERVISOR" | "ROUTER" | "FALLBACK" | "FAILOVER" | "ERROR" | "INFO" | string;
  message: string;
}

export interface LogsPayload {
  logFile: string;
  entries: LogEntry[];
}

export interface WrapperInfo {
  binaryName: string;
  status: "WRAPPED" | "UNWRAPPED" | "NOT FOUND";
  sourcePath?: string;
  targetPath?: string;
}

export interface ConfigPayload {
  configFile: string;
  activeSurfaceAccount: string;
  activeRoutingPolicy: string;
  surfaceAccountOverridden: boolean;
  routingPolicyOverridden: boolean;
  settings: Record<string, unknown>;
  wrappers: WrapperInfo[];
}

export interface ProbeResult {
  profile: string;
  pool?: string;
  state: string;
  details: string;
}

export interface ProbePayload {
  provider: string;
  results: ProbeResult[];
  rawOutput: string;
}

export interface PluginSettingsValues {
  autoRefreshInterval: number; // in seconds, 0 = disabled
  logTailDepth: number; // default 50
  autoProbeOnLoad: boolean; // default false
  showLiveCountdown: boolean; // default true
}

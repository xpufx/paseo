import type { PluginLogger } from "./logger.js";

export const DEFAULT_BEACON_LABEL_PREFIX = "beacon:";

export const BEACON_COLORS = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

export type BeaconColor = (typeof BEACON_COLORS)[number];

export interface BeaconLabelState {
  name: string;
  color?: string;
  titleSuffix?: string;
  title?: string;
  workspaceId?: string;
}

export interface BeaconSetOptions extends BeaconLabelState {
  workspaceId: string;
}

export interface BeaconBlinkOptions {
  workspaceId?: string;
  a: BeaconLabelState;
  b: BeaconLabelState;
  intervalMs?: number;
  rounds?: number;
  restoreOnDone?: boolean;
}

export interface BeaconClearOptions {
  workspaceId?: string;
  name?: string;
  restoreTitle?: boolean;
}

export interface WorkspaceTitleHandle {
  setTitle?: (title: string) => unknown;
}

export interface BeaconDaemonClient {
  setWorkspaceLabel?: (args: unknown) => unknown;
  updateWorkspaceLabel?: (args: unknown) => unknown;
  removeWorkspaceLabel?: (args: unknown) => unknown;
  [key: string]: unknown;
}

export interface WorkspaceBeaconOptions {
  workspaceHandle?: WorkspaceTitleHandle | null;
  daemonClient?: BeaconDaemonClient | null;
  labelPrefix?: string;
  baseTitle?: string;
  logger?: PluginLogger;
}

export interface BeaconSetResult {
  labelApplied: boolean;
  titleApplied: boolean;
  labelName?: string;
  title?: string;
}

export interface BeaconClearResult {
  labelCleared: boolean;
  titleRestored: boolean;
}

export interface BeaconBlinkHandle {
  stop: () => void;
  done: Promise<void>;
}

export function resolveBeaconLabelName(
  name: string,
  prefix: string = DEFAULT_BEACON_LABEL_PREFIX,
): string {
  const trimmed = (name ?? "").trim();
  if (!prefix) return trimmed;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed;
  return `${prefix}${trimmed}`;
}

export function normalizeBeaconColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const normalized = color.trim().toLowerCase();
  if ((BEACON_COLORS as readonly string[]).includes(normalized)) return normalized;
  return undefined;
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

async function safeInvoke(
  fn: () => unknown,
  logger?: PluginLogger,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    logger?.debug?.(
      `WorkspaceBeacon host call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

function toTimerKey(workspaceId: string | undefined): string {
  return workspaceId ?? "__default__";
}

export class WorkspaceBeacon {
  private workspaceHandle?: WorkspaceTitleHandle | null;
  private daemonClient?: BeaconDaemonClient | null;
  private labelPrefix: string;
  private baseTitle?: string;
  private logger?: PluginLogger;
  private originalTitles = new Map<string, string>();
  private blinkTimers = new Map<string, { timer: ReturnType<typeof setInterval>; finish: () => void }>();

  constructor(options: WorkspaceBeaconOptions = {}) {
    this.workspaceHandle = options.workspaceHandle ?? null;
    this.daemonClient = options.daemonClient ?? null;
    this.labelPrefix = options.labelPrefix ?? DEFAULT_BEACON_LABEL_PREFIX;
    this.baseTitle = options.baseTitle;
    this.logger = options.logger;
  }

  setOptions(options: Partial<WorkspaceBeaconOptions>): void {
    if ("workspaceHandle" in options) this.workspaceHandle = options.workspaceHandle ?? null;
    if ("daemonClient" in options) this.daemonClient = options.daemonClient ?? null;
    if (options.labelPrefix !== undefined) this.labelPrefix = options.labelPrefix;
    if (options.baseTitle !== undefined) this.baseTitle = options.baseTitle;
    if (options.logger !== undefined) this.logger = options.logger;
  }

  get activeBlinks(): number {
    return this.blinkTimers.size;
  }

  async set(options: BeaconSetOptions): Promise<BeaconSetResult> {
    const result: BeaconSetResult = { labelApplied: false, titleApplied: false };
    try {
      const workspaceId = options.workspaceId;
      const labelName = options.name ? resolveBeaconLabelName(options.name, this.labelPrefix) : undefined;
      result.labelName = labelName;

      if (workspaceId && labelName) {
        result.labelApplied = await this.applyLabel(workspaceId, labelName, options.color);
      }

      const title = this.resolveTitle(options);
      if (title !== undefined) {
        result.titleApplied = await this.applyTitle(workspaceId, title);
        if (result.titleApplied) result.title = title;
      }
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon.set failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return result;
  }

  blink(options: BeaconBlinkOptions): BeaconBlinkHandle {
    const intervalMs = Math.max(50, options.intervalMs ?? 3000);
    const totalRounds = options.rounds ?? Number.POSITIVE_INFINITY;
    const workspaceId = options.workspaceId ?? options.a.workspaceId ?? options.b.workspaceId;
    const key = toTimerKey(workspaceId);
    this.stopBlink(key);
    let stopped = false;
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      const current = this.blinkTimers.get(key);
      if (current?.finish === finish) this.blinkTimers.delete(key);
      if (options.restoreOnDone) {
        void this.clear({
          workspaceId,
          name: options.a.name ?? options.b.name,
          restoreTitle: true,
        }).catch((err) =>
          this.logger?.debug?.(
            `WorkspaceBeacon blink restore failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      resolveDone();
    };

    try {
      const states: BeaconLabelState[] = [options.a, options.b];
      const tick = () => {
        if (stopped) {
          finish();
          return;
        }
        if (count >= totalRounds) {
          finish();
          return;
        }
        const state = states[count % 2];
        count += 1;
        void this.set({ ...state, workspaceId: state.workspaceId ?? workspaceId ?? "" }).catch((err) =>
          this.logger?.debug?.(
            `WorkspaceBeacon blink tick failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        if (count >= totalRounds) {
          finish();
        }
      };
      let count = 0;
      void this.set({ ...states[0], workspaceId: states[0].workspaceId ?? workspaceId ?? "" }).catch(
        (err) =>
          this.logger?.debug?.(
            `WorkspaceBeacon blink tick failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
      count = 1;
      if (count >= totalRounds) {
        finish();
      } else {
        timer = setInterval(tick, intervalMs);
        this.blinkTimers.set(key, { timer, finish });
      }
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon blink setup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      finish();
    }

    return {
      stop: () => {
        stopped = true;
        finish();
      },
      done,
    };
  }

  async clear(options: BeaconClearOptions = {}): Promise<BeaconClearResult> {
    const result: BeaconClearResult = { labelCleared: false, titleRestored: false };
    try {
      this.stopBlink(toTimerKey(options.workspaceId));
      if (options.workspaceId && options.name) {
        result.labelCleared = await this.detachLabel(
          options.workspaceId,
          resolveBeaconLabelName(options.name, this.labelPrefix),
        );
      } else if (options.workspaceId && !options.name) {
        result.labelCleared = false;
      }
      if (options.restoreTitle !== false) {
        result.titleRestored = await this.restoreTitle(options.workspaceId);
      }
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon.clear failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return result;
  }

  stopAll(): void {
    for (const entry of this.blinkTimers.values()) {
      clearInterval(entry.timer);
      try {
        entry.finish();
      } catch (err) {
        this.logger?.debug?.(
          `WorkspaceBeacon stopAll finish failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.blinkTimers.clear();
  }

  private resolveTitle(options: BeaconLabelState): string | undefined {
    if (options.title !== undefined) return options.title;
    if (options.titleSuffix === undefined) return undefined;
    const base = this.originalTitles.get(options.workspaceId ?? "") ?? this.baseTitle ?? "";
    return `${base}${options.titleSuffix}`;
  }

  private async applyLabel(workspaceId: string, labelName: string, color?: string): Promise<boolean> {
    const client = this.daemonClient;
    if (!client || !isFunction(client.setWorkspaceLabel)) return false;
    const label: Record<string, string> = { name: labelName };
    const normalized = normalizeBeaconColor(color);
    if (normalized) label.color = normalized;
    else if (color) label.color = color;
    return safeInvoke(
      () =>
        (client.setWorkspaceLabel as (args: unknown) => unknown)({
          workspaceId,
          label,
          assigned: true,
        }),
      this.logger,
    );
  }

  private async detachLabel(workspaceId: string, labelName: string): Promise<boolean> {
    const client = this.daemonClient as BeaconDaemonClient | null | undefined;
    if (!client) return false;
    try {
      if (isFunction(client.setWorkspaceLabel)) {
        return await safeInvoke(
          () =>
            (client.setWorkspaceLabel as (args: unknown) => unknown)({
              workspaceId,
              label: { name: labelName },
              assigned: false,
            }),
          this.logger,
        );
      }
      if (isFunction(client.removeWorkspaceLabel)) {
        return await safeInvoke(
          () =>
            (client.removeWorkspaceLabel as (args: unknown) => unknown)({
              workspaceId,
              name: labelName,
            }),
          this.logger,
        );
      }
      return false;
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon detachLabel failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  setOriginalTitle(workspaceId: string, title: string): void {
    this.originalTitles.set(workspaceId, title);
  }

  hasOriginalTitle(workspaceId: string): boolean {
    return this.originalTitles.has(workspaceId);
  }

  getOriginalTitle(workspaceId: string): string | undefined {
    return this.originalTitles.get(workspaceId);
  }

  private async applyTitle(workspaceId: string | undefined, title: string): Promise<boolean> {
    const handle = this.workspaceHandle;
    if (!handle || !isFunction(handle.setTitle)) return false;
    const key = workspaceId ?? "";
    if (!this.originalTitles.has(key)) {
      if (this.baseTitle !== undefined) {
        this.originalTitles.set(key, this.baseTitle);
      }
    }
    return safeInvoke(() => (handle.setTitle as (t: string) => unknown)(title), this.logger);
  }

  private async restoreTitle(workspaceId: string | undefined): Promise<boolean> {
    const handle = this.workspaceHandle;
    if (!handle || !isFunction(handle.setTitle)) return false;
    const key = workspaceId ?? "";
    const original = this.originalTitles.get(key) ?? this.baseTitle;
    if (original === undefined) return false;
    const ok = await safeInvoke(
      () => (handle.setTitle as (t: string) => unknown)(original),
      this.logger,
    );
    if (ok) {
      this.originalTitles.delete(key);
      if (this.baseTitle === original) {
        this.baseTitle = undefined;
      }
    }
    return ok;
  }

  private stopBlink(key: string): void {
    const entry = this.blinkTimers.get(key);
    if (entry) {
      clearInterval(entry.timer);
      this.blinkTimers.delete(key);
      try {
        entry.finish();
      } catch (err) {
        this.logger?.debug?.(
          `WorkspaceBeacon stopBlink finish failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

export function createWorkspaceBeacon(options: WorkspaceBeaconOptions = {}): WorkspaceBeacon {
  return new WorkspaceBeacon(options);
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  WellbeingSettings,
  WellbeingStatus,
  OperatorPhase,
  FleetPosture,
  ActivitySource,
} from "../shared/contracts.js";

const execFileAsync = promisify(execFile);

export interface PresenceStateData {
  lastActivityTs: number | null;
  lastActivitySource: ActivitySource | null;
  streakStartTs: number | null;
  longestStretchSeconds: number;
  breaksTakenToday: number;
  snoozedUntilTs: number | null;
  dailyUsageSeconds: number;
  lastDayStamp: string;
  lastFatigueAlertTs: number | null;
  fatigueAlertCount: number;
  manualBedMode: boolean | null;
}

export function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

export function isTimeInWindow(
  currentMinutes: number,
  startHhmm: string,
  endHhmm: string
): boolean {
  const start = parseMinutes(startHhmm);
  const end = parseMinutes(endHhmm);
  if (start <= end) {
    return currentMinutes >= start && currentMinutes <= end;
  }
  // Wraps past midnight (e.g. 22:30 -> 07:30)
  return currentMinutes >= start || currentMinutes <= end;
}

export function getTodayStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class PresenceTracker {
  private settings: WellbeingSettings;
  private state: PresenceStateData;
  private stateFilePath: string;

  constructor(
    settings: WellbeingSettings,
    options?: { stateFilePath?: string; initialState?: Partial<PresenceStateData> }
  ) {
    this.settings = settings;
    const baseDir = path.join(os.homedir(), ".config", "paseo");
    this.stateFilePath = options?.stateFilePath ?? path.join(baseDir, "wellbeing-state.json");
    this.state = {
      lastActivityTs: null,
      lastActivitySource: null,
      streakStartTs: null,
      longestStretchSeconds: 0,
      breaksTakenToday: 0,
      snoozedUntilTs: null,
      dailyUsageSeconds: 0,
      lastDayStamp: getTodayStamp(),
      lastFatigueAlertTs: null,
      fatigueAlertCount: 0,
      manualBedMode: null,
      ...options?.initialState,
    };
    this.loadState();
  }

  public updateSettings(newSettings: WellbeingSettings): void {
    this.settings = newSettings;
    if (newSettings.bedMode !== undefined && this.state.manualBedMode === null) {
      this.state.manualBedMode = newSettings.bedMode;
    }
  }

  public getSettings(): WellbeingSettings {
    return this.settings;
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, "utf8");
        const parsed = JSON.parse(raw);
        this.state = { ...this.state, ...parsed };
      }
    } catch {
      // Missing or unparseable: defaults hold
    }
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${this.stateFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
      fs.renameSync(tmp, this.stateFilePath);
    } catch {
      // Best-effort disk write
    }
  }

  public recordActivity(
    source: ActivitySource = "client_interaction",
    now = Date.now()
  ): {
    activeStretchMinutes: number;
    fatigueAlertTriggered: boolean;
    source: ActivitySource;
  } {
    const today = getTodayStamp(new Date(now));
    if (this.state.lastDayStamp !== today) {
      this.state.dailyUsageSeconds = 0;
      this.state.longestStretchSeconds = 0;
      this.state.breaksTakenToday = 0;
      this.state.lastDayStamp = today;
      this.state.fatigueAlertCount = 0;
      this.state.lastFatigueAlertTs = null;
    }

    if (this.state.lastActivityTs === null) {
      this.state.streakStartTs = now;
      this.state.lastActivityTs = now;
      this.state.lastActivitySource = source;
    } else {
      const idleMs = now - this.state.lastActivityTs;
      const idleMinutes = idleMs / 60000;

      if (idleMinutes > this.settings.idleTimeoutMinutes) {
        // Idle timeout exceeded: break recorded and streak resets
        this.state.breaksTakenToday += 1;
        this.state.streakStartTs = now;
      } else if (idleMs > 0) {
        this.state.dailyUsageSeconds += Math.min(idleMs, this.settings.idleTimeoutMinutes * 60000) / 1000;
      }
      this.state.lastActivityTs = now;
      this.state.lastActivitySource = source;
    }

    const activeMinutes = this.getActiveStretchMinutes(now);
    const activeSeconds = activeMinutes * 60;
    if (activeSeconds > this.state.longestStretchSeconds) {
      this.state.longestStretchSeconds = activeSeconds;
    }

    let fatigueAlertTriggered = false;
    const isSnoozed = this.state.snoozedUntilTs !== null && now < this.state.snoozedUntilTs;

    if (activeMinutes >= this.settings.maxSessionContinuousMinutes && !isSnoozed) {
      const cooldownMs = this.settings.fatigueAlertCooldownMinutes * 60000;
      const canAlert =
        this.state.lastFatigueAlertTs === null ||
        now - this.state.lastFatigueAlertTs >= cooldownMs;

      if (canAlert) {
        this.state.lastFatigueAlertTs = now;
        this.state.fatigueAlertCount += 1;
        fatigueAlertTriggered = true;
      }
    }

    this.saveState();
    return {
      activeStretchMinutes: Math.round(activeMinutes),
      fatigueAlertTriggered,
      source,
    };
  }

  public snooze(minutes: number, now = Date.now()): { ok: boolean; snoozedUntil: string } {
    this.state.snoozedUntilTs = now + minutes * 60000;
    this.saveState();
    return {
      ok: true,
      snoozedUntil: new Date(this.state.snoozedUntilTs).toISOString(),
    };
  }

  public snoozeAlert(minutes: number, now = Date.now()): { ok: boolean; snoozedUntil: string } {
    return this.snooze(minutes, now);
  }

  public toggleBedMode(enabled?: boolean, now = Date.now()): {
    isBedMode: boolean;
    phase: OperatorPhase;
    fleetPosture: FleetPosture;
    fleetDirective: string;
  } {
    if (enabled !== undefined) {
      this.state.manualBedMode = enabled;
    } else {
      const current = this.isBedModeActive(now);
      this.state.manualBedMode = !current;
    }
    this.saveState();
    return {
      isBedMode: this.isBedModeActive(now),
      phase: this.calculatePhase(now),
      fleetPosture: this.getFleetPosture(now),
      fleetDirective: this.getFleetDirective(now),
    };
  }

  public getActiveStretchMinutes(now = Date.now()): number {
    if (!this.state.streakStartTs || !this.state.lastActivityTs) {
      return 0;
    }
    const idleMs = now - this.state.lastActivityTs;
    if (idleMs > this.settings.idleTimeoutMinutes * 60000) {
      return 0;
    }
    return Math.max(0, (now - this.state.streakStartTs) / 60000);
  }

  public getIdleMinutes(now = Date.now()): number {
    if (!this.state.lastActivityTs) {
      return 0;
    }
    return Math.max(0, (now - this.state.lastActivityTs) / 60000);
  }

  public isBedModeActive(now = Date.now()): boolean {
    if (this.state.manualBedMode !== null) {
      return this.state.manualBedMode;
    }
    const date = new Date(now);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    return isTimeInWindow(
      currentMinutes,
      this.settings.windDownTime,
      this.settings.wakeUpTime
    );
  }

  public calculatePhase(now = Date.now()): OperatorPhase {
    if (this.isBedModeActive(now)) {
      return "bed-mode";
    }
    const idleMinutes = this.getIdleMinutes(now);
    if (idleMinutes > this.settings.idleTimeoutMinutes) {
      return "idle";
    }
    const activeMinutes = this.getActiveStretchMinutes(now);
    const isSnoozed = this.state.snoozedUntilTs !== null && now < this.state.snoozedUntilTs;
    if (activeMinutes >= this.settings.maxSessionContinuousMinutes && !isSnoozed) {
      return "extended-stretch";
    }
    const date = new Date(now);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    const isWindDown = isTimeInWindow(
      currentMinutes,
      this.settings.windDownTime,
      this.settings.wakeUpTime
    );
    if (isWindDown) {
      return "wind-down";
    }
    return "working";
  }

  public getFleetPosture(now = Date.now()): FleetPosture {
    if (this.isBedModeActive(now)) {
      return "bed-mode-custodial";
    }
    const idleMinutes = this.getIdleMinutes(now);
    if (idleMinutes > this.settings.idleTimeoutMinutes) {
      return "idle-standby";
    }
    const activeMinutes = this.getActiveStretchMinutes(now);
    const isSnoozed = this.state.snoozedUntilTs !== null && now < this.state.snoozedUntilTs;
    if (activeMinutes >= this.settings.maxSessionContinuousMinutes && !isSnoozed) {
      return "extended-stretch";
    }
    const date = new Date(now);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    if (isTimeInWindow(currentMinutes, this.settings.windDownTime, this.settings.wakeUpTime)) {
      return "wind-down";
    }
    return "active-focus";
  }

  public getFleetDirective(now = Date.now()): string {
    const posture = this.getFleetPosture(now);
    switch (posture) {
      case "bed-mode-custodial":
        return "Operator Status: Bed Mode (Rest/Mobile). Front Desk holds autonomous custody. Fleet maintains composer silence. Escalate ONLY priority/0-SOS to Front Desk.";
      case "wind-down":
        return "Operator Status: Circadian Wind-Down. Prefer async batching and issue updates over interactive interruptions. Silence non-blockers.";
      case "extended-stretch":
        return "Operator Status: Extended High-Intensity Session. Operator fatigue threshold exceeded; keep messages ultra-concise.";
      case "idle-standby":
        return "Operator Status: Away / Idle. Batch non-urgent notifications.";
      case "active-focus":
      default:
        return "Operator Status: Active (Desk Focus). Interactive prompts and quick turnarounds.";
    }
  }

  public getStatus(now = Date.now()): WellbeingStatus {
    const isBed = this.isBedModeActive(now);
    const phase = this.calculatePhase(now);
    const activeStretch = Math.round(this.getActiveStretchMinutes(now));
    const longestStretch = Math.round(this.state.longestStretchSeconds / 60);
    const idle = Math.round(this.getIdleMinutes(now));
    const daily = Math.round(this.state.dailyUsageSeconds / 60);

    return {
      phase,
      fleetPosture: this.getFleetPosture(now),
      fleetDirective: this.getFleetDirective(now),
      isBedMode: isBed,
      activeStretchMinutes: activeStretch,
      longestStretchMinutes: longestStretch,
      breaksTaken: this.state.breaksTakenToday,
      idleMinutes: idle,
      dailyUsageMinutes: daily,
      lastActivityAt: this.state.lastActivityTs
        ? new Date(this.state.lastActivityTs).toISOString()
        : null,
      lastActivitySource: this.state.lastActivitySource,
      streakStartedAt: this.state.streakStartTs
        ? new Date(this.state.streakStartTs).toISOString()
        : null,
      fatigueAlertTriggered: phase === "extended-stretch",
      fatigueAlertCount: this.state.fatigueAlertCount,
      snoozedUntil: this.state.snoozedUntilTs
        ? new Date(this.state.snoozedUntilTs).toISOString()
        : null,
      settings: this.settings,
    };
  }

  public async send2fadoNotice(summary: string, link = "http://localhost:3000"): Promise<boolean> {
    try {
      await execFileAsync("2fado", ["notify", "--summary", summary, "--link", link]);
      return true;
    } catch {
      return false;
    }
  }
}

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
} from "../shared/contracts.js";

const execFileAsync = promisify(execFile);

export interface PresenceStateData {
  lastActivityTs: number | null;
  streakStartTs: number | null;
  dailyUsageSeconds: number;
  lastDayStamp: string;
  lastFatigueAlertTs: number | null;
  fatigueAlertCount: number;
  manualBedMode: boolean | null;
  longestStretchMinutes: number;
  breaksTaken: number;
  snoozedUntilTs: number | null;
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
      streakStartTs: null,
      dailyUsageSeconds: 0,
      lastDayStamp: getTodayStamp(),
      lastFatigueAlertTs: null,
      fatigueAlertCount: 0,
      manualBedMode: null,
      longestStretchMinutes: 0,
      breaksTaken: 0,
      snoozedUntilTs: null,
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

  public recordActivity(now = Date.now()): {
    activeStretchMinutes: number;
    fatigueAlertTriggered: boolean;
  } {
    const today = getTodayStamp(new Date(now));
    if (this.state.lastDayStamp !== today) {
      this.state.dailyUsageSeconds = 0;
      this.state.lastDayStamp = today;
      this.state.fatigueAlertCount = 0;
      this.state.lastFatigueAlertTs = null;
      this.state.longestStretchMinutes = 0;
      this.state.breaksTaken = 0;
      this.state.snoozedUntilTs = null;
    }

    if (this.state.lastActivityTs === null) {
      this.state.streakStartTs = now;
      this.state.lastActivityTs = now;
    } else {
      const idleMs = now - this.state.lastActivityTs;
      const idleMinutes = idleMs / 60000;

      if (idleMinutes > this.settings.idleTimeoutMinutes) {
        // Idle timeout exceeded: break recorded and streak resets
        this.state.breaksTaken += 1;
        this.state.streakStartTs = now;
      } else if (idleMs > 0) {
        this.state.dailyUsageSeconds += Math.min(idleMs, this.settings.idleTimeoutMinutes * 60000) / 1000;
      }
      this.state.lastActivityTs = now;
    }

    const activeMinutes = this.getActiveStretchMinutes(now);
    if (activeMinutes > this.state.longestStretchMinutes) {
      this.state.longestStretchMinutes = Math.round(activeMinutes);
    }

    let fatigueAlertTriggered = false;
    const isSnoozed = this.state.snoozedUntilTs !== null && now < this.state.snoozedUntilTs;

    if (!isSnoozed && activeMinutes >= this.settings.maxSessionContinuousMinutes) {
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
    };
  }

  public snooze(minutes: number, now = Date.now()): { ok: boolean; snoozedUntil: string } {
    return this.snoozeAlert(minutes, now);
  }

  public snoozeAlert(minutes: number, now = Date.now()): { ok: boolean; snoozedUntil: string } {
    const snoozedUntilTs = now + minutes * 60000;
    this.state.snoozedUntilTs = snoozedUntilTs;
    this.saveState();
    return {
      ok: true,
      snoozedUntil: new Date(snoozedUntilTs).toISOString(),
    };
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
    const isBed = this.isBedModeActive(now);
    const phase = this.calculatePhase(now);
    const fleetPosture = this.calculateFleetPosture(now);
    return {
      isBedMode: isBed,
      phase,
      fleetPosture,
      fleetDirective: this.getFleetDirective(fleetPosture),
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
    if (activeMinutes >= this.settings.maxSessionContinuousMinutes) {
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

  public calculateFleetPosture(now = Date.now()): FleetPosture {
    const phase = this.calculatePhase(now);
    switch (phase) {
      case "bed-mode":
        return "bed-mode-custodial";
      case "wind-down":
        return "wind-down";
      case "extended-stretch":
        return "extended-stretch";
      case "idle":
        return "idle-standby";
      case "working":
      default:
        return "active-focus";
    }
  }

  public getFleetDirective(posture: FleetPosture): string {
    switch (posture) {
      case "bed-mode-custodial":
        return "Operator Status: Bed Mode (Mobile). Front Desk holds custody. Escalate ONLY priority/0-SOS.";
      case "wind-down":
        return "Operator Status: Wind-Down. Prefer async digests; avoid non-blocking questions.";
      case "extended-stretch":
        return "Operator Status: Extended Stretch (Fatigue Warning). Recommend break before complex refactors.";
      case "idle-standby":
        return "Operator Status: Away / Idle. Batch non-urgent notifications.";
      case "active-focus":
      default:
        return "Operator Status: Active / Desk Mode.";
    }
  }

  public getStatus(now = Date.now()): WellbeingStatus {
    const isBed = this.isBedModeActive(now);
    const phase = this.calculatePhase(now);
    const fleetPosture = this.calculateFleetPosture(now);
    const activeStretch = Math.round(this.getActiveStretchMinutes(now));
    const idle = Math.round(this.getIdleMinutes(now));
    const daily = Math.round(this.state.dailyUsageSeconds / 60);

    return {
      phase,
      fleetPosture,
      fleetDirective: this.getFleetDirective(fleetPosture),
      isBedMode: isBed,
      activeStretchMinutes: activeStretch,
      longestStretchMinutes: this.state.longestStretchMinutes,
      breaksTaken: this.state.breaksTaken,
      idleMinutes: idle,
      dailyUsageMinutes: daily,
      lastActivityAt: this.state.lastActivityTs
        ? new Date(this.state.lastActivityTs).toISOString()
        : null,
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseMinutes,
  isTimeInWindow,
  PresenceTracker,
} from "./presence.js";
import type { WellbeingSettings } from "../shared/contracts.js";

const TEST_SETTINGS: WellbeingSettings = {
  workingHours: { start: "09:00", end: "18:00" },
  windDownTime: "22:30",
  wakeUpTime: "07:30",
  bedMode: false,
  maxSessionContinuousMinutes: 180,
  idleTimeoutMinutes: 15,
  fatigueAlertCooldownMinutes: 60,
  notifyVia2fado: false,
};

describe("wellbeing circadian math", () => {
  it("parses HH:MM into minutes correctly", () => {
    assert.equal(parseMinutes("00:00"), 0);
    assert.equal(parseMinutes("09:30"), 570);
    assert.equal(parseMinutes("22:30"), 1350);
  });

  it("evaluates standard daytime windows", () => {
    // 09:00 (540) to 18:00 (1080)
    assert.equal(isTimeInWindow(600, "09:00", "18:00"), true);
    assert.equal(isTimeInWindow(400, "09:00", "18:00"), false);
    assert.equal(isTimeInWindow(1100, "09:00", "18:00"), false);
  });

  it("evaluates midnight-crossing wind-down windows", () => {
    // 22:30 (1350) to 07:30 (450)
    assert.equal(isTimeInWindow(1360, "22:30", "07:30"), true); // 22:40
    assert.equal(isTimeInWindow(100, "22:30", "07:30"), true);  // 01:40
    assert.equal(isTimeInWindow(400, "22:30", "07:30"), true);  // 06:40
    assert.equal(isTimeInWindow(600, "22:30", "07:30"), false); // 10:00
  });
});

describe("PresenceTracker", () => {
  it("tracks initial interaction and records activity source", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-1.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      const first = tracker.recordActivity("client_interaction", base);
      assert.equal(first.activeStretchMinutes, 0);
      assert.equal(first.source, "client_interaction");
      assert.equal(first.fatigueAlertTriggered, false);

      // 30 minutes later (active continuation within 15m intervals via interactive turns)
      tracker.recordActivity("interactive_turn", base + 10 * 60000);
      tracker.recordActivity("permission_resolved", base + 20 * 60000);
      const third = tracker.recordActivity("client_surface", base + 30 * 60000);

      assert.equal(third.activeStretchMinutes, 30);
      assert.equal(third.source, "client_surface");
      assert.equal(third.fatigueAlertTriggered, false);

      const status = tracker.getStatus(base + 30 * 60000);
      assert.equal(status.lastActivitySource, "client_surface");
      assert.equal(tracker.getIdleMinutes(base + 30 * 60000), 0);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("resets streak and tracks breaks when idle timeout is exceeded", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-2.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      tracker.recordActivity("client_interaction", base);
      tracker.recordActivity("client_interaction", base + 10 * 60000); // 10m streak
      tracker.recordActivity("client_interaction", base + 35 * 60000); // 25m gap > 15m idle timeout -> break!

      const status = tracker.getStatus(base + 35 * 60000);
      assert.equal(status.activeStretchMinutes, 0);
      assert.equal(status.breaksTaken, 1);
      assert.equal(status.longestStretchMinutes, 10);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("triggers fatigue alert and supports snooze mechanics", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-3.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      tracker.recordActivity("client_interaction", base);
      for (let m = 10; m <= 170; m += 10) {
        tracker.recordActivity("client_interaction", base + m * 60000);
      }

      // Hits 180 min fatigue threshold
      const alertTurn = tracker.recordActivity("client_interaction", base + 180 * 60000);
      assert.equal(alertTurn.activeStretchMinutes, 180);
      assert.equal(alertTurn.fatigueAlertTriggered, true);

      let status = tracker.getStatus(base + 180 * 60000);
      assert.equal(status.phase, "extended-stretch");
      assert.equal(status.fleetPosture, "extended-stretch");

      // Snooze for 15 minutes
      const snoozeRes = tracker.snooze(15, base + 180 * 60000);
      assert.equal(snoozeRes.ok, true);

      // During snooze window (5 mins later)
      status = tracker.getStatus(base + 185 * 60000);
      assert.notEqual(status.phase, "extended-stretch");
      assert.ok(status.snoozedUntil);

      // Check recordActivity during snooze
      const snoozedTurn = tracker.recordActivity("client_interaction", base + 185 * 60000);
      assert.equal(snoozedTurn.fatigueAlertTriggered, false);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("toggles manual Bed Mode and provides fleet posture directives", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-4.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      // Active focus
      tracker.recordActivity("client_interaction", base);
      let status = tracker.getStatus(base);
      assert.equal(status.fleetPosture, "active-focus");
      assert.match(status.fleetDirective, /Active \(Desk Focus\)/);

      // Bed Mode
      tracker.toggleBedMode(true, base);
      status = tracker.getStatus(base);
      assert.equal(status.fleetPosture, "bed-mode-custodial");
      assert.match(status.fleetDirective, /Bed Mode/);
      assert.match(status.fleetDirective, /priority\/0-SOS/);

      // Resume
      tracker.toggleBedMode(false, base);
      status = tracker.getStatus(base);
      assert.equal(status.fleetPosture, "active-focus");
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
  it("background fatigue checks do not refresh lastActivityTs or accrue usage (#562)", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-5.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      tracker.recordActivity("client_interaction", base);
      const initial = tracker.getStatus(base);
      assert.equal(initial.dailyUsageMinutes, 0);

      // Simulate the 60s daemon heartbeat for 10 minutes with no human activity.
      for (let m = 1; m <= 10; m++) {
        tracker.evaluateFatigue(base + m * 60000);
      }

      const status = tracker.getStatus(base + 10 * 60000);
      assert.equal(status.lastActivityAt, initial.lastActivityAt);
      assert.equal(status.lastActivitySource, "client_interaction");
      assert.equal(status.dailyUsageMinutes, 0);
      assert.equal(tracker.getIdleMinutes(base + 10 * 60000), 10);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("leaves extended-stretch and returns to idle despite the 60s ticker (#562)", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-6.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      tracker.recordActivity("client_interaction", base);
      for (let m = 10; m <= 180; m += 10) {
        tracker.recordActivity("client_interaction", base + m * 60000);
      }

      let status = tracker.getStatus(base + 180 * 60000);
      assert.equal(status.phase, "extended-stretch");
      assert.equal(status.activeStretchMinutes, 180);

      // Heartbeat keeps ticking every minute, but records no presence activity.
      for (let m = 181; m <= 196; m++) {
        tracker.evaluateFatigue(base + m * 60000);
      }

      status = tracker.getStatus(base + 196 * 60000);
      assert.equal(status.phase, "idle");
      assert.equal(status.fleetPosture, "idle-standby");
      assert.equal(status.activeStretchMinutes, 0);
      assert.equal(tracker.getIdleMinutes(base + 196 * 60000), 16);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

    it("migrates legacy state from ~/.config/paseo to canonical storage dir (#446)", () => {
    const tmpDir = path.join(os.tmpdir(), "wellbeing-migrate-" + String(Date.now()));
    const legacyDir = path.join(tmpDir, ".config", "paseo");
    const canonicalDir = path.join(tmpDir, ".paseo", "plugin-data", "xpufx", "wellbeing");
    fs.mkdirSync(legacyDir, { recursive: true });

    const legacyFile = path.join(legacyDir, "wellbeing-state.json");
    const canonicalFile = path.join(canonicalDir, "wellbeing-state.json");

    fs.writeFileSync(
      legacyFile,
      JSON.stringify({
        lastActivityTs: 1790134570558,
        dailyUsageSeconds: 9435.386,
        breaksTakenToday: 3,
      })
    );

    // Patch os.homedir() temporarily
    const origHomedir = os.homedir;
    try {
      (os as any).homedir = () => tmpDir;
      const tracker = new PresenceTracker(TEST_SETTINGS);
      assert.equal(fs.existsSync(canonicalFile), true);
      const status = tracker.getStatus();
      assert.equal(status.dailyUsageMinutes, Math.round(9435.386 / 60));
      assert.equal(status.breaksTaken, 3);
    } finally {
      (os as any).homedir = origHomedir;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

});

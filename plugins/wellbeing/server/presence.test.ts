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
  it("tracks initial interaction and active streak", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-1.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      const first = tracker.recordActivity(base);
      assert.equal(first.activeStretchMinutes, 0);
      assert.equal(first.fatigueAlertTriggered, false);

      // 30 minutes later (active continuation within 15m intervals)
      tracker.recordActivity(base + 10 * 60000);
      tracker.recordActivity(base + 20 * 60000);
      const third = tracker.recordActivity(base + 30 * 60000);

      assert.equal(third.activeStretchMinutes, 30);
      assert.equal(third.fatigueAlertTriggered, false);
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

      tracker.recordActivity(base);
      tracker.recordActivity(base + 10 * 60000);
      tracker.recordActivity(base + 30 * 60000); // 20m later (idle 20m > 15m timeout) -> break!

      const status = tracker.getStatus(base + 30 * 60000);
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

      tracker.recordActivity(base);
      // Continuous activity up to 170 minutes (under threshold)
      for (let m = 10; m <= 170; m += 10) {
        const turn = tracker.recordActivity(base + m * 60000);
        assert.equal(turn.fatigueAlertTriggered, false);
      }

      // Exactly hits threshold (180 minutes)
      const alertTurn = tracker.recordActivity(base + 180 * 60000);
      assert.equal(alertTurn.activeStretchMinutes, 180);
      assert.equal(alertTurn.fatigueAlertTriggered, true);

      // Snooze alert for 30 minutes
      const snoozeRes = tracker.snoozeAlert(30, base + 180 * 60000);
      assert.equal(snoozeRes.ok, true);
      assert.ok(snoozeRes.snoozedUntil);

      // Activity inside snooze window suppresses alert
      const turnDuringSnooze = tracker.recordActivity(base + 200 * 60000);
      assert.equal(turnDuringSnooze.fatigueAlertTriggered, false);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("toggles manual Bed Mode and provides fleet posture directives", () => {
    const tmpFile = path.join(os.tmpdir(), `wellbeing-test-${Date.now()}-4.json`);
    try {
      const tracker = new PresenceTracker(TEST_SETTINGS, { stateFilePath: tmpFile });
      const base = 1790000000000;

      assert.equal(tracker.isBedModeActive(base), false);
      const res = tracker.toggleBedMode(true, base);
      assert.equal(res.isBedMode, true);
      assert.equal(res.phase, "bed-mode");
      assert.equal(res.fleetPosture, "bed-mode-custodial");
      assert.match(res.fleetDirective, /Bed Mode \(Mobile\)/);

      const status = tracker.getStatus(base);
      assert.equal(status.isBedMode, true);
      assert.equal(status.phase, "bed-mode");
      assert.equal(status.fleetPosture, "bed-mode-custodial");
      assert.match(status.fleetDirective, /priority\/0-SOS/);

      tracker.toggleBedMode(false, base);
      assert.equal(tracker.isBedModeActive(base), false);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});

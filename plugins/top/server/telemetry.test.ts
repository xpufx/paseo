import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { PluginStorage } from "paseo-plugin-helper/server";
import {
  topTimelineTelemetrySchema,
  TopSettingsSchema,
  TOP_TIMELINE_KIND,
  TOP_TIMELINE_VERSION,
  METRIC_IDS,
  METRIC_DEFINITIONS,
  PILL_RENDERED_METRICS,
  MULTIPLE_MODE_RENDERED_METRICS,
  TIMELINE_RENDERED_METRICS,
  DEFAULT_METRIC_SURFACES,
  isMcpSurfaceEnabled,
  customPillEffectiveEnabled,
  resolveTimelineCadence,
  shouldAppendTimelineForTurn,
  type McpStatusSnapshot,
} from "../shared/resources";
import { collectTurnTelemetry, countTurns, customPillPoller, isInterruptEcho, isStaleTurnEnd, parseGitDiffShortstat, setLastLiveUsage, summarizeTurnTimeline } from "./resources";

after(() => {
  customPillPoller.stop();
});

test("topTimelineTelemetrySchema parses completed turn data", () => {
  const sample = {
    turnId: "turn-123",
    agentId: "agent-abc",
    outcomeKind: "completed" as const,
    timestamp: new Date().toISOString(),
    durationMs: 1450,
    cpuPercent: 24,
    memUsedBytes: 4294967296,
    memTotalBytes: 17179869184,
    memPercent: 25,
    loadAvg1m: 0.85,
    mcpHealthy: 4,
    mcpTotal: 4,
  };

  const parsed = topTimelineTelemetrySchema.parse(sample);
  assert.equal(parsed.turnId, "turn-123");
  assert.equal(parsed.outcomeKind, "completed");
  assert.equal(parsed.cpuPercent, 24);
  assert.equal(parsed.durationMs, 1450);
});

test("topTimelineTelemetrySchema parses failed turn with error message", () => {
  const sample = {
    turnId: "turn-456",
    agentId: "agent-def",
    outcomeKind: "failed" as const,
    outcomeError: "Out of memory",
    timestamp: new Date().toISOString(),
    durationMs: 3200,
    cpuPercent: 99,
    memUsedBytes: 16000000000,
    memTotalBytes: 17179869184,
    memPercent: 93,
    loadAvg1m: 4.12,
  };

  const parsed = topTimelineTelemetrySchema.parse(sample);
  assert.equal(parsed.turnId, "turn-456");
  assert.equal(parsed.outcomeKind, "failed");
  assert.equal(parsed.outcomeError, "Out of memory");
});

test("topTimelineTelemetrySchema rejects invalid outcome kind", () => {
  assert.throws(() => {
    topTimelineTelemetrySchema.parse({
      turnId: "turn-789",
      agentId: "agent-ghi",
      outcomeKind: "unknown",
      timestamp: new Date().toISOString(),
      cpuPercent: 10,
      memUsedBytes: 1000,
      memTotalBytes: 2000,
      memPercent: 50,
      loadAvg1m: 0.1,
    });
  });
});

test("TopSettingsSchema migrates to per-metric surfaces with sane defaults", () => {
  const defaults = TopSettingsSchema.parse({});
  assert.equal(defaults.metricSurfaces.cpu_ram, "both");
  assert.equal(defaults.metricSurfaces.changes, "timeline");
  assert.equal(defaults.metricSurfaces.tokens, "timeline");

  const legacy = TopSettingsSchema.parse({ showCpuRam: false, recordTurnTelemetry: false });
  assert.equal(legacy.metricSurfaces.cpu_ram, "none");
  assert.equal(legacy.metricSurfaces.load, "none");

  const legacyOn = TopSettingsSchema.parse({ showCpuRam: true, recordTurnTelemetry: true });
  assert.equal(legacyOn.metricSurfaces.cpu_ram, "both");
  assert.equal(legacyOn.metricSurfaces.load, "timeline");
});

test("collectTurnTelemetry returns valid telemetry data matching schema", async () => {
  const telemetry = await collectTurnTelemetry(
    "turn-live-1",
    "agent-test",
    { kind: "completed" },
    500,
  );

  const validated = topTimelineTelemetrySchema.parse(telemetry);
  assert.equal(validated.turnId, "turn-live-1");
  assert.equal(validated.agentId, "agent-test");
  assert.equal(validated.outcomeKind, "completed");
  assert.equal(validated.durationMs, 500);
  assert.equal(typeof validated.cpuPercent, "number");
  assert.equal(typeof validated.memPercent, "number");
  assert.equal(typeof validated.loadAvg1m, "number");
});

test("timeline constants are correctly defined", () => {
  assert.equal(TOP_TIMELINE_KIND, "top-turn-telemetry");
  assert.equal(TOP_TIMELINE_VERSION, 1);
});

test("every offered metric renders somewhere (no offered-but-invisible gaps)", () => {
  for (const def of METRIC_DEFINITIONS) {
    if (def.pillOnly) continue;
    const visible =
      PILL_RENDERED_METRICS.includes(def.id) ||
      TIMELINE_RENDERED_METRICS.includes(def.id);
    assert.equal(
      visible,
      true,
      `metric ${def.id} is offered in settings but renders nowhere`,
    );
  }
  for (const id of TIMELINE_RENDERED_METRICS) {
    const def = METRIC_DEFINITIONS.find((d) => d.id === id);
    assert.ok(def, `timeline registry references unknown metric ${id}`);
    assert.equal(
      def.pillOnly,
      undefined,
      `pill-only metric ${id} must not be in the timeline registry`,
    );
  }
  for (const id of PILL_RENDERED_METRICS) {
    const def = METRIC_DEFINITIONS.find((d) => d.id === id);
    assert.ok(def, `pill registry references unknown metric ${id}`);
  }
  for (const id of PILL_RENDERED_METRICS) {
    assert.ok(
      MULTIPLE_MODE_RENDERED_METRICS.includes(id),
      `pill metric ${id} has no dedicated pill in multiple mode`,
    );
  }
  for (const id of MULTIPLE_MODE_RENDERED_METRICS) {
    const def = METRIC_DEFINITIONS.find((d) => d.id === id);
    assert.ok(def, `multiple-mode registry references unknown metric ${id}`);
    assert.ok(
      (METRIC_IDS as readonly string[]).includes(id),
      `multiple-mode registry references undefined metric id ${id}`,
    );
  }
  for (const id of METRIC_IDS) {
    assert.ok(
      TIMELINE_RENDERED_METRICS.includes(id) || PILL_RENDERED_METRICS.includes(id),
      `metric id ${id} renders nowhere`,
    );
  }
  for (const id of METRIC_IDS) {
    assert.ok(
      id in DEFAULT_METRIC_SURFACES,
      `metric id ${id} has no default surface selector`,
    );
  }
  assert.deepEqual(
    [...METRIC_IDS].sort(),
    METRIC_DEFINITIONS.map((d) => d.id).sort(),
    "every metric id needs a settings definition",
  );
});

test("collectTurnTelemetry passes model and provider through without fabrication", async () => {
  const withBoth = await collectTurnTelemetry(
    "turn-model-1",
    "agent-test",
    { kind: "completed" },
    100,
    { provider: "openai", model: "gpt-5", title: "T" },
  );
  assert.equal(withBoth.agentModel, "gpt-5");
  assert.equal(withBoth.agentProvider, "openai");

  const withNeither = await collectTurnTelemetry(
    "turn-model-2",
    "agent-test",
    { kind: "completed" },
    100,
  );
  assert.equal(withNeither.agentModel, null);
  assert.equal(withNeither.agentProvider, null);
});

test("collectTurnTelemetry omits MCP fields when mcp-tools is not running", async () => {
  const telemetry = await collectTurnTelemetry(
    "turn-mcp-gone",
    "agent-test",
    { kind: "completed" },
    100,
    { mcpRunning: false, mcpInstalled: false },
  );
  assert.equal(telemetry.mcpHealthy, undefined);
  assert.equal(telemetry.mcpTotal, undefined);
  assert.equal(telemetry.mcpInstalled, false);
  topTimelineTelemetrySchema.parse(telemetry);
});

test("collectTurnTelemetry ignores a leftover snapshot file when mcp-tools is gone", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "top-mcp-leftover-"));
  try {
    const leftover = new PluginStorage<McpStatusSnapshot>("mcp-tools", "status.json", { baseDir });
    await leftover.writeAsync({
      updatedAt: new Date().toISOString(),
      total: 3,
      healthy: 3,
      degraded: 0,
      down: 0,
      servers: [{ name: "ghost", status: "healthy", latencyMs: 1 }],
    });
    assert.equal(leftover.exists(), true);

    const gone = await collectTurnTelemetry(
      "turn-mcp-leftover",
      "agent-test",
      { kind: "completed" },
      100,
      { mcpRunning: false, mcpInstalled: false, mcpStorage: leftover },
    );
    assert.equal(gone.mcpHealthy, undefined);
    assert.equal(gone.mcpTotal, undefined);
    assert.equal(gone.mcpInstalled, false);
    topTimelineTelemetrySchema.parse(gone);

    const live = await collectTurnTelemetry(
      "turn-mcp-live",
      "agent-test",
      { kind: "completed" },
      100,
      { mcpRunning: true, mcpInstalled: true, mcpStorage: leftover },
    );
    assert.equal(live.mcpHealthy, 3);
    assert.equal(live.mcpTotal, 3);
    topTimelineTelemetrySchema.parse(live);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("legacy timeline items without mcpInstalled still parse", () => {  const parsed = topTimelineTelemetrySchema.parse({
    turnId: "turn-legacy-1",
    agentId: "agent-test",
    outcomeKind: "completed",
    timestamp: new Date().toISOString(),
    cpuPercent: 10,
    memUsedBytes: 1000,
    memTotalBytes: 2000,
    memPercent: 50,
    loadAvg1m: 0.5,
    mcpHealthy: 3,
    mcpTotal: 3,
  });
  assert.equal(parsed.mcpInstalled, undefined);
});

test("isMcpSurfaceEnabled gates the mcp surface on positive presence", () => {
  const both = { metricSurfaces: { mcp: "both" as const } };
  const none = { metricSurfaces: { mcp: "none" as const } };
  assert.equal(isMcpSurfaceEnabled(both, "pill", true), true);
  assert.equal(isMcpSurfaceEnabled(both, "timeline", true), true);
  assert.equal(isMcpSurfaceEnabled(none, "pill", true), false);
  assert.equal(isMcpSurfaceEnabled(none, "timeline", true), false);
  assert.equal(isMcpSurfaceEnabled(both, "pill", false), false);
  assert.equal(isMcpSurfaceEnabled(both, "timeline", false), false);
  assert.equal(isMcpSurfaceEnabled(both, "pill", undefined), false);
  assert.equal(isMcpSurfaceEnabled(both, "timeline", undefined), false);
  assert.equal(isMcpSurfaceEnabled({}, "timeline", true), true);
  assert.equal(isMcpSurfaceEnabled({ showMcp: false }, "pill", true), false);
});

test("parseGitDiffShortstat parses insertions, deletions, and files", () => {
  assert.deepEqual(parseGitDiffShortstat("3 files changed, 40 insertions(+), 12 deletions(-)"), {
    filesChanged: 3,
    insertions: 40,
    deletions: 12,
  });
  assert.deepEqual(parseGitDiffShortstat("1 file changed, 5 insertions(+)"), {
    filesChanged: 1,
    insertions: 5,
    deletions: 0,
  });
  assert.equal(parseGitDiffShortstat("nothing to commit"), null);
});

test("summarizeTurnTimeline counts tools and extracts usage", () => {  const activity = summarizeTurnTimeline([
    { type: "tool_call", name: "bash", status: "success" },
    { type: "tool_call", name: "read", status: "failed" },
    { type: "assistant_message", text: "hi" },
    { type: "usage_updated", usage: { inputTokens: 100, outputTokens: 50 } },
  ]);
  assert.equal(activity.toolCalls, 2);
  assert.equal(activity.toolErrors, 1);
  assert.equal(activity.usage?.inputTokens, 100);
  assert.equal(activity.usage?.outputTokens, 50);
});

test("countTurns counts one turn per user message", () => {
  assert.equal(
    countTurns([
      { type: "user_message", text: "first" },
      { type: "assistant_message", text: "reply" },
      { type: "tool_call", name: "bash", status: "success" },
      { type: "user_message", text: "second" },
      { type: "assistant_message", text: "reply" },
    ]),
    2,
  );
});

test("countTurns ignores non-message items and malformed rows", () => {
  assert.equal(
    countTurns([
      { type: "reasoning", text: "hmm" },
      { type: "todo", items: [] },
      { type: "error", message: "boom" },
      { type: "notification", level: "info", message: "hi" },
      null,
      "stray",
      42,
      { noType: true },
    ]),
    0,
  );
  assert.equal(countTurns([]), 0);
  assert.equal(countTurns(undefined), undefined);
});

test("collectTurnTelemetry stamps lifetime turn count from timeline", async () => {
  const telemetry = await collectTurnTelemetry(
    "turn-count-1",
    "agent-test",
    { kind: "completed" },
    100,
    {
      timeline: [
        { type: "user_message", text: "one" },
        { type: "assistant_message", text: "uno" },
        { type: "user_message", text: "two" },
        { type: "assistant_message", text: "dos" },
        { type: "user_message", text: "three" },
      ],
    },
  );
  assert.equal(telemetry.turnCount, 3);
  topTimelineTelemetrySchema.parse(telemetry);
});

test("collectTurnTelemetry includes git delta and usage when provided", async () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "top-git-test-"));
  execSync("git init -q && git config user.email t@t.t && git config user.name t", { cwd: tmpRepo });
  fs.writeFileSync(path.join(tmpRepo, "a.txt"), "one\ntwo\nthree\n");
  execSync("git add -A && git commit -qm init", { cwd: tmpRepo });
  fs.appendFileSync(path.join(tmpRepo, "a.txt"), "four\nfive\n");
  const telemetry = await collectTurnTelemetry(
    "turn-dense-1",
    "agent-test",
    { kind: "completed" },
    500,
    {
      cwd: tmpRepo,
      provider: "test-provider",
      title: "Test",
      timeline: [{ type: "tool_call", name: "x", status: "success" }],
      gitBefore: { insertions: 0, deletions: 0, filesChanged: 0 },
    },
  );
  fs.rmSync(tmpRepo, { recursive: true, force: true });
  const validated = topTimelineTelemetrySchema.parse(telemetry);
  assert.equal(validated.toolCalls, 1);
  assert.equal(validated.agentProvider, "test-provider");
  assert.equal(validated.gitInsertions, 2);
  assert.equal(validated.gitFilesChanged, 1);
  assert.equal(validated.inputTokens, undefined);
});

test("collectTurnTelemetry falls back to lastLiveUsage when timeline omits tokens", async () => {
  setLastLiveUsage({
    inputTokens: 1234,
    outputTokens: 567,
    cachedInputTokens: 890,
    contextWindowUsedTokens: 1801,
    contextWindowMaxTokens: 128000,
    totalCostUsd: 0.015,
  });

  const telemetry = await collectTurnTelemetry(
    "turn-fallback",
    "agent-fallback",
    { kind: "completed" },
    100,
  );

  const validated = topTimelineTelemetrySchema.parse(telemetry);
  assert.equal(validated.inputTokens, 1234);
  assert.equal(validated.outputTokens, 567);
  assert.equal(validated.cachedTokens, 890);
  assert.equal(validated.contextUsedTokens, 1801);
  assert.equal(validated.contextMaxTokens, 128000);
  assert.equal(validated.costUsd, 0.015);

  setLastLiveUsage(null);
});

test("metric definitions, ids, defaults, and pill types stay in sync", () => {
  const defIds = METRIC_DEFINITIONS.map((d) => d.id).sort();
  assert.deepEqual(
    defIds,
    [...METRIC_IDS].sort(),
    "every metric id needs exactly one matrix definition and vice versa",
  );
  for (const def of METRIC_DEFINITIONS) {
    assert.ok(def.title.length > 0, `metric ${def.id} needs a matrix title`);
    assert.ok(def.description.length > 0, `metric ${def.id} needs a description`);
    assert.ok(def.icon.length > 0, `metric ${def.id} needs an icon`);
  }
  for (const id of METRIC_IDS) {
    assert.ok(
      id in DEFAULT_METRIC_SURFACES,
      `metric ${id} needs a default surface target`,
    );
  }
  // PillItemType lives in the RN-free pill-labels module (pill.tsx re-exports
  // it), so it is compared by source text: a metric missing from either side
  // breaks pills or settings.
  const pillSource = fs.readFileSync(
    path.join(__dirname, "..", "client", "pill-labels.ts"),
    "utf8",
  );
  const unionBody = pillSource.split("export type PillItemType =")[1].split(";")[0];
  const pillIds = [...unionBody.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    pillIds,
    [...METRIC_IDS].sort(),
    "PillItemType union must match METRIC_IDS exactly",
  );
});

test("pill render uses definition icons and labels, never hardcoded literals", () => {
  const pillSource = fs.readFileSync(
    path.join(__dirname, "..", "client", "pill.tsx"),
    "utf8",
  );
  const body = pillSource
    .split("function PillItemContent(")[1]
    .split("type SettingsListener")[0];
  const iconLiterals = [...body.matchAll(/Icon name="([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    iconLiterals,
    [],
    `hardcoded Icon names in PillItemContent: ${iconLiterals.join(", ")} (read def.icon instead)`,
  );
  const prefixLiterals = [...body.matchAll(/\{"([A-Za-z\u0394]+ )"\}/g)].map((m) => m[1]);
  assert.deepEqual(
    prefixLiterals,
    [],
    `hardcoded label prefixes in PillItemContent: ${prefixLiterals.join(", ")} (read def.shortLabel instead)`,
  );
  const icons = METRIC_DEFINITIONS.map((d) => d.icon);
  assert.equal(
    new Set(icons).size,
    icons.length,
    "definition icons must be unique per metric",
  );
  const shorts = METRIC_DEFINITIONS.filter((d) => d.shortLabel).map((d) => d.shortLabel as string);
  assert.equal(
    new Set(shorts).size,
    shorts.length,
    "definition shortLabels must be unique",
  );
});

test("every top pill variant shares one centered presentation model", () => {
  const pillSource = fs.readFileSync(
    path.join(__dirname, "..", "client", "pill.tsx"),
    "utf8",
  );
  assert.ok(
    !/presentation:\s*"popover"/.test(pillSource),
    "no pill may force popover presentation; the model is centered",
  );
  assert.equal(
    (pillSource.match(/registerComposerPill</g) ?? []).length,
    1,
    "registerComposerPill must only be called by the shared registerTopPill wrapper",
  );
  assert.equal(
    (pillSource.match(/registerTopPill\(client, \{/g) ?? []).length,
    3,
    "main, per-metric, and custom pills must all register through registerTopPill",
  );
  assert.ok(
    pillSource.includes('scrollMode="always"'),
    "ResourceModal must explicitly specify scrollMode=\"always\" on ModalBody",
  );
});

test("timeline cadence gates the card: never, every turn, every Nth turn", () => {
  assert.equal(shouldAppendTimelineForTurn(0, 1), false);
  assert.equal(shouldAppendTimelineForTurn(0, 10), false);
  assert.equal(shouldAppendTimelineForTurn(1, 1), true);
  assert.equal(shouldAppendTimelineForTurn(1, 7), true);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((i) => shouldAppendTimelineForTurn(3, i)), [
    false, false, true, false, false, true,
  ]);
  assert.equal(resolveTimelineCadence({ timelineCadence: 0 }), 0);
  assert.equal(resolveTimelineCadence({ timelineCadence: 5 }), 5);
  assert.equal(resolveTimelineCadence({}), 1);
  assert.equal(resolveTimelineCadence({ recordTurnTelemetry: false }), 0);
  assert.equal(TopSettingsSchema.parse({}).timelineCadence, 1);
  assert.equal(TopSettingsSchema.parse({ timelineCadence: 4 }).timelineCadence, 4);
  assert.equal(TopSettingsSchema.parse({ recordTurnTelemetry: false }).timelineCadence, 0);
  assert.throws(() => TopSettingsSchema.parse({ timelineCadence: 11 }));
  assert.throws(() => TopSettingsSchema.parse({ timelineCadence: -1 }));
});

test("custom pill effective state follows master, overrides, then file default", () => {
  const pill = { id: "root-disk", enabled: true };
  assert.equal(customPillEffectiveEnabled(false, undefined, pill), false);
  assert.equal(customPillEffectiveEnabled(false, { "root-disk": true }, pill), false);
  assert.equal(customPillEffectiveEnabled(true, undefined, pill), true);
  assert.equal(customPillEffectiveEnabled(true, { "root-disk": false }, pill), false);
  assert.equal(customPillEffectiveEnabled(true, { other: false }, pill), true);
  assert.equal(
    customPillEffectiveEnabled(true, undefined, { id: "x", enabled: false }),
    false,
  );
});

test("stale terminal for a live turn is dropped, real terminals kept", () => {
  // Rescue echo after a newer turn opened: no turnId, so it cannot be that turn.
  assert.equal(isStaleTurnEnd("opencode-turn-5", null), true);
  // Terminal carrying another turn's id.
  assert.equal(isStaleTurnEnd("opencode-turn-5", "opencode-turn-4"), true);
  // The live turn's own terminal is kept.
  assert.equal(isStaleTurnEnd("opencode-turn-5", "opencode-turn-5"), false);
  // Providers without turn ids (codex/pi) end an opened null-id turn normally.
  assert.equal(isStaleTurnEnd(null, null), false);
  // No turn_started observed (e.g. plugin reload mid-turn): keep the terminal.
  assert.equal(isStaleTurnEnd(undefined, "opencode-turn-9"), false);
});

test("interrupt echo is dropped by matching the cancel's user_message count", () => {
  const canceledAt = 1_000;
  // 0-duration completed follow-up on a fresh turnId, no new user message.
  assert.equal(
    isInterruptEcho({
      lastCanceledAt: canceledAt,
      lastCanceledUserMessages: 7,
      eventUserMessages: 7,
      now: canceledAt + 900,
    }),
    true,
  );
  // null-turnId echo arriving ~2s later.
  assert.equal(
    isInterruptEcho({
      lastCanceledAt: canceledAt,
      lastCanceledUserMessages: 7,
      eventUserMessages: 7,
      now: canceledAt + 2_100,
    }),
    true,
  );
  // A real follow-up carries a new user message.
  assert.equal(
    isInterruptEcho({
      lastCanceledAt: canceledAt,
      lastCanceledUserMessages: 7,
      eventUserMessages: 8,
      now: canceledAt + 900,
    }),
    false,
  );
  // No cancel recorded: nothing to echo.
  assert.equal(
    isInterruptEcho({
      lastCanceledAt: null,
      lastCanceledUserMessages: null,
      eventUserMessages: 0,
      now: canceledAt,
    }),
    false,
  );
  // Beyond the rescue window the recorded state no longer applies.
  assert.equal(
    isInterruptEcho({
      lastCanceledAt: canceledAt,
      lastCanceledUserMessages: 7,
      eventUserMessages: 7,
      now: canceledAt + 6_000,
    }),
    false,
  );
});

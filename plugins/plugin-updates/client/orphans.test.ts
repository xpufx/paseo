import assert from "node:assert/strict";
import test from "node:test";
import type { PluginUpdate } from "../shared/updates";
import { buildOrphanSection, partitionedRows } from "./orphans";

function plugin(id: string, status: PluginUpdate["status"], path = `/managed/${id}`): PluginUpdate {
  return {
    id,
    path,
    source: null,
    sourceUrl: null,
    repoRoot: null,
    subdir: null,
    ref: null,
    refKind: null,
    remote: null,
    localCommit: null,
    remoteCommit: null,
    localTree: null,
    remoteTree: null,
    workingTree: null,
    dirty: null,
    updateAvailable: false,
    status,
    error: null,
    detail: status === "orphaned" ? "Leftover managed directory from an uninstalled or failed install — not probed" : null,
    latestChange: null,
  };
}

test("collapses multiple orphans into one section with one item per directory", () => {
  const section = buildOrphanSection([
    plugin("demo", "current", "/repo/plugins/demo"),
    plugin("orphaned:history", "orphaned", "/managed/history"),
    plugin("orphaned:pi-tasks-timeline", "orphaned", "/managed/pi-tasks-timeline"),
    plugin("orphaned:agents-history", "orphaned", "/managed/agents-history"),
  ]);

  assert.ok(section);
  assert.equal(section.title, "Orphaned directories");
  assert.equal(section.items.length, 3);
  assert.deepEqual(
    section.items.map((item) => item.name),
    ["history", "pi-tasks-timeline", "agents-history"],
  );
  assert.deepEqual(
    section.items.map((item) => item.path),
    ["/managed/history", "/managed/pi-tasks-timeline", "/managed/agents-history"],
  );
  // The explanation lives on the section, never repeated per item.
  assert.doesNotMatch(section.detail, /history|pi-tasks-timeline|agents-history/);
  assert.match(section.detail, /^Leftover managed directories /);
});

test("uses singular wording for a single orphan", () => {
  const section = buildOrphanSection([plugin("orphaned:history", "orphaned", "/managed/history")]);

  assert.ok(section);
  assert.equal(section.items.length, 1);
  assert.match(section.detail, /^Leftover managed directory /);
});

test("renders no orphan section when every entry is a real row", () => {
  const plugins = [plugin("demo", "current"), plugin("slash", "behind")];

  assert.equal(buildOrphanSection(plugins), null);
  assert.deepEqual(
    partitionedRows(plugins).map((row) => row.id),
    ["demo", "slash"],
  );
});

test("partitioned rows exclude orphaned entries but keep list order", () => {
  const plugins = [
    plugin("demo", "current"),
    plugin("orphaned:history", "orphaned"),
    plugin("slash", "behind"),
  ];

  assert.deepEqual(
    partitionedRows(plugins).map((row) => row.id),
    ["demo", "slash"],
  );
});

import { describe, it, expect } from "vitest";
import {
  normalizeSnapshotScope,
  sharedSnapshotKey,
  shallowEqualRecord,
  shouldEmitSnapshotUpdate,
} from "../client/snapshot.js";

describe("client/snapshot shared keys", () => {
  it("normalizes blank scopes to host-wide", () => {
    expect(normalizeSnapshotScope(undefined)).toBe("");
    expect(normalizeSnapshotScope(null)).toBe("");
    expect(normalizeSnapshotScope("   ")).toBe("");
    expect(normalizeSnapshotScope("  /tmp/ws  ")).toBe("/tmp/ws");
  });

  it("builds one stable key per workspace scope", () => {
    expect(sharedSnapshotKey("top.resources.get", "/tmp/ws")).toEqual([
      "top.resources.get",
      { directory: "/tmp/ws" },
    ]);
    expect(sharedSnapshotKey("top.resources.get", undefined)).toEqual([
      "top.resources.get",
      {},
    ]);
    expect(sharedSnapshotKey("top.resources.get", null)).toEqual(
      sharedSnapshotKey("top.resources.get", undefined),
    );
    expect(sharedSnapshotKey("top.resources.get", "")).toEqual(
      sharedSnapshotKey("top.resources.get", undefined),
    );
    expect(sharedSnapshotKey("top.resources.get", "  /tmp/ws  ")).toEqual(
      sharedSnapshotKey("top.resources.get", "/tmp/ws"),
    );
  });

  it("keeps workspaces on separate keys", () => {
    expect(sharedSnapshotKey("top.resources.get", "/a")).not.toEqual(
      sharedSnapshotKey("top.resources.get", "/b"),
    );
    expect(sharedSnapshotKey("top.resources.get", "/a")).not.toEqual(
      sharedSnapshotKey("top.resources.get", undefined),
    );
  });
});

describe("client/snapshot no-op guards", () => {
  it("detects shallow-equal refetch copies", () => {
    const a = { showCpuRam: true, intervalSeconds: 3 };
    const b = { showCpuRam: true, intervalSeconds: 3 };
    expect(shallowEqualRecord(a, b)).toBe(true);
    expect(shouldEmitSnapshotUpdate(a, b)).toBe(false);
    expect(shouldEmitSnapshotUpdate(a, a)).toBe(false);
  });

  it("emits on real changes, additions, and removals", () => {
    expect(
      shouldEmitSnapshotUpdate({ intervalSeconds: 3 }, { intervalSeconds: 5 }),
    ).toBe(true);
    expect(shouldEmitSnapshotUpdate({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(shouldEmitSnapshotUpdate({ a: 1, b: 2 }, { a: 1 })).toBe(true);
    expect(shouldEmitSnapshotUpdate(null, { a: 1 })).toBe(true);
    expect(shouldEmitSnapshotUpdate(null, null)).toBe(false);
    expect(shouldEmitSnapshotUpdate(undefined, undefined)).toBe(false);
  });

  it("treats nested objects by reference", () => {
    const nested = { pill: true };
    expect(
      shallowEqualRecord({ surfaces: nested }, { surfaces: nested }),
    ).toBe(true);
    expect(
      shallowEqualRecord({ surfaces: nested }, { surfaces: { pill: true } }),
    ).toBe(false);
  });
});

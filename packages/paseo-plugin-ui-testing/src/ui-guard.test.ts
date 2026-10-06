import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  collectColors,
  colorsOutsidePalette,
  findHorizontalOverflows,
  findUncappedText,
  heightClamps,
  resolveStyle,
  scrollContainers,
  sheetScrollersInsideModal,
} from "./index.js";

/**
 * Self-test for the shared render guard.
 *
 * These trees are the shapes React Native's Yoga produces — a `View`/`Text`
 * element tree with resolved style objects — so the harness is exercised
 * without a renderer. The point is twofold: it proves the extraction still
 * measures correctly, and it proves each invariant is *red* on a defective tree
 * before it is trusted to be green on a surface.
 */

const row = (style: Record<string, unknown>, children: unknown[]) => ({
  type: "View",
  props: { style },
  children,
});

const text = (value: string, style: Record<string, unknown> = { fontSize: 14 }, props = {}) => ({
  type: "Text",
  props: { style, children: value, ...props },
  children: [value],
});

const PALETTE = ["#ffffff", "#18181b", "#2563eb"];

describe("resolveStyle", () => {
  it("flattens nested style arrays with later entries winning", () => {
    const node = { props: { style: [{ color: "#111" }, [{ color: "#222", marginLeft: 4 }]] } };
    expect(resolveStyle(node)).toEqual({ color: "#222", marginLeft: 4 });
  });
});

describe("containment invariant", () => {
  it("flags a row whose unbounded text demands more than the viewport", () => {
    const tree = row({ flexDirection: "row" }, [
      text("a-very-long-unbreakable-identifier-that-cannot-shrink"),
    ]);
    const findings = findHorizontalOverflows(tree, 120);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.excess).toBeGreaterThan(6);
  });

  it("passes the same row once the text can ellipsize", () => {
    const tree = row({ flexDirection: "row" }, [
      text("a-very-long-unbreakable-identifier-that-cannot-shrink", { fontSize: 14 }, { numberOfLines: 1 }),
    ]);
    expect(findHorizontalOverflows(tree, 120)).toEqual([]);
  });
});

describe("truncation invariant", () => {
  it("flags uncapped text that exceeds its box and ignores capped text", () => {
    const uncapped = findUncappedText(text("x".repeat(60)), 50);
    expect(uncapped).toHaveLength(1);
    expect(uncapped[0]!.text).toHaveLength(60);
    expect(findUncappedText(text("x".repeat(60), { fontSize: 14 }, { numberOfLines: 1 }), 50)).toEqual([]);
  });
});

describe("host-theme invariant", () => {
  it("reports a color literal that is not in the supplied palette", () => {
    const tree = row({ backgroundColor: "#ff00ff" }, [text("hello", { color: "#18181b" })]);
    const outside = colorsOutsidePalette(tree, PALETTE);
    expect(outside.map((use) => use.value)).toContain("#ff00ff");
    expect(outside.some((use) => use.value === "#18181b")).toBe(false);
  });

  it("collects the property and testID the color came from", () => {
    const tree = {
      type: "View",
      props: { style: { borderColor: "#123456" }, testID: "card" },
      children: [],
    };
    const [use] = collectColors(tree);
    expect(use).toMatchObject({ value: "#123456", property: "borderColor", testID: "card" });
  });

  it("accepts palette tokens with an appended alpha channel", () => {
    const tree = row({ backgroundColor: "#2563eb2e", borderColor: "#2563eb80" }, []);
    expect(colorsOutsidePalette(tree, PALETTE)).toEqual([]);
  });

  it("still rejects a literal that only looks like a palette value", () => {
    const tree = row({ backgroundColor: "#2563ec" }, []);
    expect(colorsOutsidePalette(tree, PALETTE).map((use) => use.value)).toEqual(["#2563ec"]);
  });
});

describe("scroll-owner invariant", () => {
  it("separates plugin scrollers from host-owned ones and records enclosure", () => {
    const tree = {
      type: "View",
      children: [
        {
          type: "mock-scroll",
          props: { testID: "plugin-scroll" },
          children: [{ type: "View", props: { testID: "fleet-list" }, children: [] }],
        },
        {
          type: "mock-modal-content",
          props: { scrollable: true, testID: "host-body" },
          children: [{ type: "View", props: { testID: "record" }, children: [] }],
        },
      ],
    };
    const containers = scrollContainers(tree);
    expect(containers).toHaveLength(2);
    expect(containers[0]).toMatchObject({ testID: "plugin-scroll", hostOwned: false });
    expect(containers[0]!.encloses).toContain("fleet-list");
    expect(containers[1]).toMatchObject({ testID: "host-body", hostOwned: true });
  });

  it("does not count a host body that is not scrollable", () => {
    const tree = {
      type: "mock-modal-content",
      props: { scrollable: false },
      children: [],
    };
    expect(scrollContainers(tree)).toEqual([]);
  });

  it("walks an array of sibling roots, as a renderer's toJSON may return", () => {
    const roots = [
      { type: "mock-icon", props: { name: "Plug" }, children: null },
      {
        type: "View",
        children: [{ type: "mock-scroll", props: { testID: "scroller" }, children: [] }],
      },
    ];
    const containers = scrollContainers(roots);
    expect(containers).toHaveLength(1);
    expect(containers[0]!.testID).toBe("scroller");
  });
});

describe("sheet-scroller invariant (#219 class)", () => {
  it("flags a host sheet scroller nested inside a host modal body", () => {
    const tree = {
      type: "host-modal-content",
      props: { scrollable: false, testID: "mcp-body" },
      children: [{ type: "host-scroll-view", props: { testID: "inner" }, children: [] }],
    };
    const findings = sheetScrollersInsideModal(tree);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ testID: "inner", modalTestID: "mcp-body" });
  });

  it("accepts a plain React Native scroller in the same slot", () => {
    const tree = {
      type: "host-modal-content",
      props: { scrollable: false, testID: "mcp-body" },
      children: [{ type: "ScrollView", props: { testID: "inner" }, children: [] }],
    };
    expect(sheetScrollersInsideModal(tree)).toEqual([]);
  });

  it("ignores a sheet scroller that is not inside a host modal", () => {
    const tree = {
      type: "View",
      children: [{ type: "host-scroll-view", props: {}, children: [] }],
    };
    expect(sheetScrollersInsideModal(tree)).toEqual([]);
  });
});

describe("height clamps", () => {
  it("flags a box shorter than its children need", () => {
    const tree = row({ height: 20 }, [text("line one"), text("line two")]);
    const clamps = heightClamps(tree);
    expect(clamps).toHaveLength(1);
    expect(clamps[0]!.declared).toBe(20);
    expect(clamps[0]!.needed).toBeGreaterThan(20);
  });

  it("does not flag a hairline or a box that fits its content", () => {
    expect(heightClamps(row({ height: 1 }, []))).toEqual([]);
    expect(heightClamps(row({}, [text("fits")]))).toEqual([]);
  });
});

describe("checkInvariants", () => {
  const defective = row({ backgroundColor: "#ff00ff", flexDirection: "column" }, [
    text("x".repeat(80)),
    { type: "mock-scroll", props: { testID: "s" }, children: [] },
  ]);

  it("collects every failing invariant at once", () => {
    const report = checkInvariants(defective, {
      width: 120,
      palette: PALETTE,
      expectedScrollOwners: 0,
    });
    expect(report.ok).toBe(false);
    expect(report.colors.length).toBeGreaterThan(0);
    expect(report.truncation.length).toBeGreaterThan(0);
    expect(report.scroll.filter((c) => !c.hostOwned)).toHaveLength(1);
  });

  it("is clean on a bounded, themed, single-owner tree", () => {
    const clean = row({ backgroundColor: "#18181b" }, [
      text("ok", { fontSize: 14, color: "#ffffff" }, { numberOfLines: 1 }),
      { type: "mock-scroll", props: { testID: "s" }, children: [] },
    ]);
    const report = checkInvariants(clean, {
      width: 300,
      palette: PALETTE,
      expectedScrollOwners: 1,
    });
    expect(report).toMatchObject({ ok: true, containment: [], colors: [], truncation: [] });
  });
});

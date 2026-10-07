import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";

interface RenderedNode {
  type?: string;
  props?: Record<string, any>;
  children?: RenderedNode[] | string | Array<RenderedNode | string | null>;
}

function flatten(node: RenderedNode | null, out: RenderedNode[] = []): RenderedNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of (Array.isArray(node.children) ? node.children : []) as RenderedNode[]) {
    if (child && typeof child === "object") flatten(child, out);
  }
  return out;
}

function renderedText(node: RenderedNode | null): string {
  const parts: string[] = [];
  for (const n of flatten(node)) {
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        if (typeof child === "string") parts.push(child);
      }
    }
    if (typeof n.children === "string") parts.push(n.children);
  }
  return parts.join(" ");
}

function styleList(style: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(style)) return style.filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
  return style && typeof style === "object" ? [style as Record<string, unknown>] : [];
}

describe("Issue #1074 rework: stable-height two-line repo Select", () => {
  const FULL_A = "forge.mrs.uppidi.com/xpufx-org/paseo";
  const FULL_B = "forge.mrs.uppidi.com/xpufx-org/2fado";
  const OPTIONS = [
    { label: "All Enrolled Repositories", value: "all" },
    { label: FULL_A, value: FULL_A, display: "xpufx-org/paseo" },
    { label: FULL_B, value: FULL_B, display: "xpufx-org/2fado" },
  ];

  async function openSelect() {
    const harness = await getFleetHarness();
    const { Select } = await import("./host-ui.js");
    const { root, renderer } = await harness.renderWithRoot(
      <Select value="all" options={OPTIONS} onValueChange={() => {}} />,
    );
    const trigger = root.find(
      (n: any) =>
        n.props?.accessibilityRole === "button" &&
        n.props?.accessibilityLabel === "All Enrolled Repositories",
    );
    assert.ok(trigger, "the repo Select trigger must render");
    await harness.TestRenderer.act(async () => {
      trigger.props.onPress();
    });
    return { harness, root, renderer };
  }

  it("always renders the full value as a smaller second line without hover", async () => {
    const { renderer } = await openSelect();
    const tree = renderer.toJSON() as RenderedNode | null;
    assert.ok(tree, "the Select must render a tree");

    for (const full of [FULL_A, FULL_B]) {
      const second: RenderedNode | undefined = flatten(tree).find(
        (n) => n.props?.testID === `fleet-select-option-full-${full}`,
      );
      assert.ok(
        second,
        `second line fleet-select-option-full-${full} must render unconditionally (no hover)`,
      );
      assert.match(
        renderedText(second!),
        new RegExp(full.replace(/\./g, "\\.")),
        "the second line must be the full repo value",
      );
      const secondStyle = styleList(second!.props?.style);
      const secondFontSize = secondStyle.map((s) => s.fontSize).find((v) => typeof v === "number") as number | undefined;
      assert.ok(
        typeof secondFontSize === "number",
        "the second line must declare a fontSize",
      );

      const row: RenderedNode | undefined = flatten(tree).find(
        (n) => n.props?.testID === `fleet-select-option-${full}`,
      );
      assert.ok(row, `option row for ${full} must render`);
      assert.equal(
        row!.props?.accessibilityLabel,
        full,
        "the option must keep its full accessibility label",
      );
      // Primary line: first Text child with numberOfLines=1; second line must be smaller.
      const texts = flatten(row!).filter((n) => n.type === "Text" || n.type === "RNText");
      const primaryStyle = styleList(texts[0]?.props?.style);
      const primaryFontSize = primaryStyle.map((s) => s.fontSize).find((v) => typeof v === "number") as number | undefined;
      assert.ok(typeof primaryFontSize === "number", "the primary line must declare a fontSize");
      assert.ok(
        (secondFontSize as number) < (primaryFontSize as number),
        `second line (${secondFontSize}) must be smaller than primary (${primaryFontSize})`,
      );
      assert.equal(second!.props?.numberOfLines, 1, "the second line must truncate to one line");
    }
  });

  it("keeps row height identical hovered vs not (no hover-conditional second line)", async () => {
    const { harness, root, renderer } = await openSelect();
    const before = renderer.toJSON() as RenderedNode | null;
    const beforeFullIds = flatten(before)
      .map((n) => n.props?.testID)
      .filter((id) => typeof id === "string" && id.startsWith("fleet-select-option-full-"))
      .sort();
    assert.ok(beforeFullIds.length >= 2, "both full-value second lines must render before hover");

    const rowStylesBefore = [FULL_A, FULL_B].map((full) => {
      const row = flatten(before).find((n) => n.props?.testID === `fleet-select-option-${full}`);
      assert.ok(row, `option row for ${full} must render`);
      return JSON.stringify(styleList(row!.props?.style));
    });

    // If the row still exposes hover/focus reveal handlers, invoking them must
    // not add, remove, or restyle rows — the dropdown must never resize.
    for (const full of [FULL_A, FULL_B]) {
      const option = root.find((n: any) => n.props?.testID === `fleet-select-option-${full}`);
      assert.ok(option, `the ${full} option row must render`);
      await harness.TestRenderer.act(async () => {
        if (typeof option.props.onMouseEnter === "function") option.props.onMouseEnter();
        if (typeof option.props.onFocus === "function") option.props.onFocus();
      });
    }

    const after = renderer.toJSON() as RenderedNode | null;
    const afterFullIds = flatten(after)
      .map((n) => n.props?.testID)
      .filter((id) => typeof id === "string" && id.startsWith("fleet-select-option-full-"))
      .sort();
    assert.deepEqual(
      afterFullIds,
      beforeFullIds,
      "hover/focus must not add or remove second lines (row height must be stable)",
    );

    const rowStylesAfter = [FULL_A, FULL_B].map((full) => {
      const row = flatten(after).find((n) => n.props?.testID === `fleet-select-option-${full}`);
      assert.ok(row, `option row for ${full} must render after hover`);
      return JSON.stringify(styleList(row!.props?.style));
    });
    assert.deepEqual(rowStylesAfter, rowStylesBefore, "row style must be identical hovered vs not");

    // Blur/leave must likewise be a no-op for layout.
    for (const full of [FULL_A, FULL_B]) {
      const option = root.find((n: any) => n.props?.testID === `fleet-select-option-${full}`);
      await harness.TestRenderer.act(async () => {
        if (typeof option.props.onMouseLeave === "function") option.props.onMouseLeave();
        if (typeof option.props.onBlur === "function") option.props.onBlur();
      });
    }
    const afterLeave = renderer.toJSON() as RenderedNode | null;
    const leaveFullIds = flatten(afterLeave)
      .map((n) => n.props?.testID)
      .filter((id) => typeof id === "string" && id.startsWith("fleet-select-option-full-"))
      .sort();
    assert.deepEqual(
      leaveFullIds,
      beforeFullIds,
      "mouse-leave/blur must not remove the always-visible second line",
    );
  });
});

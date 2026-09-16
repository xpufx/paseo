import { describe, expect, it, beforeEach } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { initClientHelpers, type HostLayout } from "../client/host.js";
import { PluginThemeProvider, defaultDarkTheme } from "../client/theme/provider.js";
import { resolveTypography } from "../client/theme/tokens.js";
import { KeyValue, KeyValueGroup } from "../client/components/KeyValue.js";

beforeEach(() => {
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", props),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
});

function render(el: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer!;
}

function flat(style: any): any[] {
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

function textContent(node: TestRenderer.ReactTestInstance): unknown {
  return node.props.children;
}

function withLayout(
  layout: HostLayout,
  children: React.ReactNode,
  flair?: { density?: "compact" | "comfortable" | "spacious" },
) {
  return (
    <PluginThemeProvider theme={defaultDarkTheme} layout={layout} flair={flair as any}>
      {children}
    </PluginThemeProvider>
  );
}

describe("KeyValue typography scale", () => {
  it("derives row label/value type from the resolved scale", () => {
    const layout: HostLayout = { compact: false, platform: "web" };
    const scale = resolveTypography(layout, "comfortable");

    const r = render(
      withLayout(
        layout,
        <KeyValue label="Remote" value="origin/main" mono truncate="middle" />,
      ),
    );

    const [label, value] = r.root.findAllByType(Text as any);

    const labelStyles = flat(label.props.style);
    expect(labelStyles.some((s) => s?.fontSize === scale.label.fontSize)).toBe(true);
    expect(labelStyles.some((s) => s?.lineHeight === scale.label.lineHeight)).toBe(true);
    expect(labelStyles.some((s) => s?.fontWeight === scale.label.fontWeight)).toBe(true);

    const valueStyles = flat(value.props.style);
    expect(valueStyles.some((s) => s?.fontSize === scale.bodySmall.fontSize)).toBe(true);
    expect(valueStyles.some((s) => s?.lineHeight === scale.bodySmall.lineHeight)).toBe(true);
    expect(valueStyles.some((s) => s?.fontWeight === scale.bodySmall.fontWeight)).toBe(true);
  });

  it("steps value/label type down for compact layout", () => {
    const regularLayout: HostLayout = { compact: false, platform: "web" };
    const compactLayout: HostLayout = { compact: true, platform: "web" };
    const regular = resolveTypography(regularLayout, "comfortable");
    const compact = resolveTypography(compactLayout, "comfortable");

    expect(compact.bodySmall.fontSize).toBeLessThan(regular.bodySmall.fontSize);

    const r = render(
      withLayout(
        compactLayout,
        <KeyValue label="Remote" value="origin/main" mono truncate="middle" />,
      ),
    );

    const [label, value] = r.root.findAllByType(Text as any);
    expect(flat(label.props.style).some((s) => s?.fontSize === compact.label.fontSize)).toBe(true);
    expect(flat(value.props.style).some((s) => s?.fontSize === compact.bodySmall.fontSize)).toBe(true);
  });

  it("steps value/label type down for compact density", () => {
    const layout: HostLayout = { compact: false, platform: "web" };
    const comfortable = resolveTypography(layout, "comfortable");
    const dense = resolveTypography(layout, "compact");

    expect(dense.bodySmall.fontSize).toBeLessThan(comfortable.bodySmall.fontSize);

    const r = render(
      withLayout(
        layout,
        <KeyValue label="Remote" value="origin/main" mono truncate="middle" />,
        { density: "compact" },
      ),
    );

    const [label, value] = r.root.findAllByType(Text as any);
    expect(flat(label.props.style).some((s) => s?.fontSize === dense.label.fontSize)).toBe(true);
    expect(flat(value.props.style).some((s) => s?.fontSize === dense.bodySmall.fontSize)).toBe(true);
  });

  it("keeps caller labelStyle/valueStyle overrides applied last", () => {
    const r = render(
      withLayout(
        { compact: false, platform: "web" },
        <KeyValue
          label="Remote"
          value="origin/main"
          labelStyle={{ fontSize: 9 }}
          valueStyle={{ fontSize: 8 }}
        />,
      ),
    );

    const [label, value] = r.root.findAllByType(Text as any);
    const labelStyle = flat(label.props.style).filter((s) => s?.fontSize !== undefined).pop();
    const valueStyle = flat(value.props.style).filter((s) => s?.fontSize !== undefined).pop();
    expect(labelStyle?.fontSize).toBe(9);
    expect(valueStyle?.fontSize).toBe(8);
  });

  it("never lets the value outrank its own label in size", () => {
    for (const layout of [
      { compact: false, platform: "web" } as HostLayout,
      { compact: true, platform: "web" } as HostLayout,
    ]) {
      const scale = resolveTypography(layout, "comfortable");
      expect(scale.label.fontSize).toBeGreaterThanOrEqual(scale.bodySmall.fontSize);

      const r = render(withLayout(layout, <KeyValue label="Remote" value="origin/main" mono />));
      const [label, value] = r.root.findAllByType(Text as any);
      const labelSize = flat(label.props.style)
        .filter((s) => s?.fontSize !== undefined)
        .pop()?.fontSize;
      const valueSize = flat(value.props.style)
        .filter((s) => s?.fontSize !== undefined)
        .pop()?.fontSize;
      expect(labelSize).toBeGreaterThanOrEqual(valueSize);
    }
  });

  it("derives bodySmall from label: same metrics at normal weight", () => {
    for (const density of ["compact", "comfortable", "spacious"] as const) {
      for (const compact of [false, true]) {
        const scale = resolveTypography({ compact, platform: "web" }, density);
        expect(scale.bodySmall.fontSize).toBe(scale.label.fontSize);
        expect(scale.bodySmall.lineHeight).toBe(scale.label.lineHeight);
        expect(scale.bodySmall.fontWeight).toBe("400");
        expect(scale.bodySmall.fontSize).toBeGreaterThan(scale.caption.fontSize);
        expect(scale.bodySmall.fontSize).toBeLessThan(scale.body.fontSize);
      }
    }
  });
});

describe("KeyValue row layout", () => {
  const longHash = `c97cb0a664f2${"a".repeat(28)}cbae513116a3d`;

  it("anchors the label and stacks subValue under a wrapping value", () => {
    const layout: HostLayout = { compact: false, platform: "web" };
    const scale = resolveTypography(layout, "comfortable");

    const r = render(
      withLayout(
        layout,
        <KeyValueGroup columns={2}>
          <KeyValue
            label="Version"
            value={longHash}
            subValue="working tree"
            mono
            truncate="middle"
            copyable
          />
          <KeyValue label="Remote" value={longHash} mono truncate="middle" copyable />
        </KeyValueGroup>,
      ),
    );

    const rowContainers = r.root
      .findAllByType(View as any)
      .filter((v) => flat(v.props.style).some((s) => s?.justifyContent === "space-between"));
    expect(rowContainers.length).toBeGreaterThan(0);
    for (const container of rowContainers) {
      expect(flat(container.props.style).some((s) => s?.alignItems === "flex-start")).toBe(true);
    }

    const label = r.root
      .findAllByType(Text as any)
      .find((t) => textContent(t) === "Version")!;
    expect(flat(label.props.style).some((s) => s?.minWidth === 0)).toBe(true);

    const value = r.root
      .findAllByType(Text as any)
      .find((t) => flat(t.props.style).some((s) => s?.textAlign === "right"))!;
    expect(flat(value.props.style).some((s) => s?.minWidth === 0)).toBe(true);
    expect(flat(value.props.style).some((s) => s?.lineHeight === scale.bodySmall.lineHeight)).toBe(
      true,
    );

    const subValue = r.root
      .findAllByType(Text as any)
      .find((t) => textContent(t) === "working tree")!;
    const valueParent = value.parent as TestRenderer.ReactTestInstance;
    const subValueParent = subValue.parent as TestRenderer.ReactTestInstance;

    expect(valueParent).not.toBe(subValueParent);
    expect(flat(valueParent.props.style).some((s) => s?.flexDirection === "row")).toBe(true);
    expect(flat(subValueParent.props.style).some((s) => s?.flexDirection === "column")).toBe(true);
    expect(
      subValueParent
        .findAllByType(Text as any)
        .map((t) => textContent(t))
        .includes("working tree"),
    ).toBe(true);
    expect(
      valueParent
        .findAllByType(Text as any)
        .map((t) => textContent(t))
        .includes("working tree"),
    ).toBe(false);
  });
});

describe("KeyValue inline layout", () => {
  it("keeps label and value on one row with a single-line truncating value", () => {
    const layout: HostLayout = { compact: true, platform: "web" };
    const scale = resolveTypography(layout, "comfortable");

    const r = render(
      withLayout(
        layout,
        <KeyValue
          layout="inline"
          label="Version"
          value="c97cb0a664f2"
          subValue="working tree"
          mono
          copyable
        />,
      ),
    );

    const value = r.root
      .findAllByType(Text as any)
      .find((t) => textContent(t) === "c97cb0a664f2")!;
    const label = r.root.findAllByType(Text as any).find((t) => textContent(t) === "Version")!;
    const subValue = r.root
      .findAllByType(Text as any)
      .find((t) => textContent(t) === "working tree")!;

    // label, value and subValue share one flexDirection:row container
    expect(label.parent).toBe(value.parent);
    expect(label.parent).toBe(subValue.parent);
    expect(flat(label.parent!.props.style).some((s) => s?.flexDirection === "row")).toBe(true);

    // the value collapses to a single text line, ellipsized in the middle
    expect(value.props.numberOfLines).toBe(1);
    expect(value.props.ellipsizeMode).toBe("middle");

    expect(flat(label.props.style).some((s) => s?.fontSize === scale.label.fontSize)).toBe(true);
    expect(flat(value.props.style).some((s) => s?.fontSize === scale.bodySmall.fontSize)).toBe(true);
    expect(flat(value.props.style).some((s) => s?.fontFamily === "monospace")).toBe(true);
  });

  it("does not change stacked: the default still stacks label above value", () => {
    const layout: HostLayout = { compact: true, platform: "web" };
    const r = render(withLayout(layout, <KeyValue label="Ref" value="branch · main" />));

    const container = r.root
      .findAllByType(View as any)
      .find((v) => flat(v.props.style).some((s) => s?.flexDirection === "column"))!;
    expect(container).toBeTruthy();

    const headerRow = r.root
      .findAllByType(View as any)
      .find((v) => flat(v.props.style).some((s) => s?.flexDirection === "row"))!;
    expect(
      headerRow
        .findAllByType(Text as any)
        .map((t) => textContent(t))
        .includes("Ref"),
    ).toBe(true);

    const value = r.root
      .findAllByType(Text as any)
      .find((t) => textContent(t) === "branch · main")!;
    expect(value.props.numberOfLines).toBeUndefined();
  });

  it("keeps the wide (non-compact) default horizontal layout untouched", () => {
    const layout: HostLayout = { compact: false, platform: "web" };
    const r = render(withLayout(layout, <KeyValue label="Remote" value="abcd1234" />));

    const container = r.root
      .findAllByType(View as any)
      .find((v) => flat(v.props.style).some((s) => s?.justifyContent === "space-between"))!;
    expect(container).toBeTruthy();
    expect(flat(container.props.style).some((s) => s?.flexDirection === "row")).toBe(true);

    // the horizontal branch wraps the value in its own right-aligned wrapper
    const wrapper = r.root
      .findAllByType(View as any)
      .find((v) => flat(v.props.style).some((s) => s?.alignItems === "flex-end"));
    expect(wrapper).toBeTruthy();
  });
});

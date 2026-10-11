import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  HostActionBar,
  HostAttentionBeacon,
  HostButton,
  HostCodeBlock,
  HostCommandBox,
  HostFormRow,
  HostKeyValue,
  HostKeyValueGroup,
  HostModalBody,
  HostModalSection,
  HostScroll,
  HostSelect,
  HostTextInput,
  HostThemeProvider,
  HostVital,
  ListActionPageTemplate,
  type ThemeColors,
} from "../index.js";

// The package imports these directly from the host SDK entry, so stub them
// instead of initializing the helper host (the package must not depend on it).
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_COLORS: ThemeColors = {
  surface0: "#010101",
  surface1: "#020202",
  surface2: "#030303",
  border: "#040404",
  foreground: "#f1f1f1",
  foregroundMuted: "#a1a1a1",
  accent: "#0a0aff",
  accentForeground: "#ffffff",
  statusSuccess: "#00ff00",
  statusWarning: "#ffaa00",
  statusDanger: "#ff0000",
};

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  }
  return (style as Record<string, unknown>) ?? {};
}

function resolvedStyle(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  const style = node.props.style as unknown;
  const value = typeof style === "function" ? style({ pressed: false }) : style;
  return flattenStyle(value);
}

describe("@xpufx/paseo-plugin-ui invariants", () => {
  it("HostModalSection fills the host frame so a single HostScroll owns the scroll (xpufx-org/paseo#975, #1049)", () => {
    const renderer = render(
      <HostModalSection>
        <HostScroll>
          <span>body</span>
        </HostScroll>
      </HostModalSection>,
    );

    const section = renderer.root.findAllByType("View")[0];
    const sectionStyle = resolvedStyle(section);
    expect(sectionStyle.flex).toBe(1);
    expect(sectionStyle.minHeight).toBe(0);

    expect(renderer.root.findAllByType("ScrollView")).toHaveLength(1);
  });

  it("draws button colors from the host theme supplied by HostThemeProvider", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostButton label="Save" variant="primary" />
      </HostThemeProvider>,
    );

    const pressable = renderer.root.findByType("Pressable");
    expect(resolvedStyle(pressable).backgroundColor).toBe(HOST_COLORS.accent);
  });

  it("falls back to a static palette when no host theme is provided", () => {
    expect(() => render(<HostButton label="Save" />)).not.toThrow();
  });

  it("caps HostVital chips so wrapping rows stay multi-per-line (xpufx-org/paseo#1010)", () => {
    const renderer = render(<HostVital color="#fff">12%</HostVital>);
    const vital = renderer.root.findAllByType("View")[0];
    const style = resolvedStyle(vital);
    expect(style.maxWidth).toBe(110);
    expect(style.flexGrow).toBe(1);
    expect(style.width).toBeUndefined();
  });

  it("renders HostFormRow with label, description and HostTextInput", () => {
    const onChange = vi.fn();
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostFormRow label="Agent Name" description="Unique agent identifier">
          <HostTextInput value="Test Agent" onChangeText={onChange} placeholder="Enter name" />
        </HostFormRow>
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("Agent Name");
    expect(texts).toContain("Unique agent identifier");

    const input = renderer.root.findByType("TextInput");
    expect(input.props.value).toBe("Test Agent");
    expect(input.props.placeholder).toBe("Enter name");
  });

  it("renders HostSelect and toggles option menu", () => {
    const onSelect = vi.fn();
    const options = [
      { label: "Option 1", value: "opt1" },
      { label: "Option 2", value: "opt2" },
    ];
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostSelect value="opt1" options={options} onValueChange={onSelect} />
      </HostThemeProvider>,
    );

    const trigger = renderer.root.findByType("Pressable");
    expect(trigger.props.accessibilityState.expanded).toBe(false);

    act(() => {
      trigger.props.onPress();
    });

    const pressables = renderer.root.findAllByType("Pressable");
    expect(pressables.length).toBeGreaterThan(1);

    // Click second option
    act(() => {
      pressables[2].props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith("opt2");
  });

  it("renders HostActionBar with specified alignment and gap", () => {
    const renderer = render(
      <HostActionBar align="between" gap={16}>
        <HostButton label="Cancel" variant="ghost" />
        <HostButton label="Save" variant="primary" />
      </HostActionBar>,
    );

    const view = renderer.root.findAllByType("View")[0];
    const style = resolvedStyle(view);
    expect(style.justifyContent).toBe("space-between");
    expect(style.gap).toBe(16);
  });

  it("renders HostModalBody with pinned header and single scroll owner", () => {
    const renderer = render(
      <HostModalBody header={<HostButton label="Modal Header" />}>
        <span>Modal Content</span>
      </HostModalBody>,
    );

    expect(renderer.root.findAllByType("ScrollView")).toHaveLength(1);
    const views = renderer.root.findAllByType("View");
    expect(views.length).toBeGreaterThan(0);
  });

  it("renders ListActionPageTemplate with empty state when data is empty", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <ListActionPageTemplate
          title="Installed Plugins"
          subtitle="0 updates available"
          data={[]}
          keyExtractor={(item: { id: string }) => item.id}
          renderItem={(item) => <span>{item.id}</span>}
          emptyState={{
            title: "No plugins installed",
            description: "No managed plugins found.",
          }}
        />
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("Installed Plugins");
    expect(texts).toContain("0 updates available");
    expect(texts).toContain("No plugins installed");
    expect(texts).toContain("No managed plugins found.");
  });

  it("renders ListActionPageTemplate with card items and header actions", () => {
    const onRefresh = vi.fn();
    const items = [
      { id: "plugin-a", name: "Plugin A" },
      { id: "plugin-b", name: "Plugin B" },
    ];

    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <ListActionPageTemplate
          title="Plugin Updates"
          headerActions={[
            { id: "refresh", label: "Refresh", icon: "RefreshCw", onPress: onRefresh },
          ]}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={(item) => (
            <HostButton key={item.id} label={item.name} />
          )}
        />
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("Plugin Updates");
    expect(texts).toContain("Refresh");
    expect(texts).toContain("Plugin A");
    expect(texts).toContain("Plugin B");

    // Single outer HostScroll must own the scroll viewport
    expect(renderer.root.findAllByType("ScrollView")).toHaveLength(1);
  });

  it("renders HostKeyValueGroup with multi-column items", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostKeyValueGroup columns={2}>
          <HostKeyValue label="Version" value="1.2.3" />
          <HostKeyValue label="Channel" value="stable" />
        </HostKeyValueGroup>
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("Version");
    expect(texts).toContain("1.2.3");
    expect(texts).toContain("Channel");
    expect(texts).toContain("stable");
  });

  it("renders HostAttentionBeacon with active status indicator dot", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostAttentionBeacon tone="warning" active>
          <HostButton label="Action" />
        </HostAttentionBeacon>
      </HostThemeProvider>,
    );

    const views = renderer.root.findAllByType("View");
    const dot = views.find((v) => resolvedStyle(v).position === "absolute");
    expect(dot).toBeDefined();
    expect(resolvedStyle(dot!).backgroundColor).toBe(HOST_COLORS.statusWarning);
  });

  it("renders HostCodeBlock with title, copy button, and bounded content", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostCodeBlock code="const x = 42;" title="Example" language="typescript" />
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("Example");
    expect(texts).toContain("const x = 42;");
  });

  it("renders HostCommandBox with prompt and arguments", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostCommandBox argv={["npm", "run", "test"]} />
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("$ npm");
  });
});


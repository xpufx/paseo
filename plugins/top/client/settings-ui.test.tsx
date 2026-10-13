import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ChoiceChips, MultiChoiceChips, type ChipOption } from "./settings-ui";
import { HostButton, HostThemeProvider } from "./host-ui";

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THEME = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#d4d4d8",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#ca8a04",
    statusDanger: "#dc2626",
  },
} as const;

describe("MultiChoiceChips and ChoiceChips settings UI (#1318)", () => {
  const options: ChipOption<string>[] = [
    { id: "cpu_ram", label: "CPU & RAM", icon: "Cpu" },
    { id: "branch", label: "Git Branch", icon: "GitBranch" },
    { id: "mcp", label: "MCP Health", icon: "Server", disabled: true },
  ];

  it("renders multi-select chips with active highlighting and disabled states", () => {
    const onToggle = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HostThemeProvider theme={THEME as never}>
          <MultiChoiceChips
            options={options}
            selected={["cpu_ram"]}
            onToggle={onToggle}
          />
        </HostThemeProvider>,
      );
    });

    const buttons = renderer.root.findAllByType(HostButton);
    expect(buttons).toHaveLength(3);

    // Active item has primary variant
    expect(buttons[0].props.label).toBe("CPU & RAM");
    expect(buttons[0].props.variant).toBe("primary");
    expect(buttons[0].props.disabled).toBeFalsy();

    // Inactive item has secondary variant by default
    expect(buttons[1].props.label).toBe("Git Branch");
    expect(buttons[1].props.variant).toBe("secondary");
    expect(buttons[1].props.disabled).toBeFalsy();

    // Disabled item preserves disabled prop
    expect(buttons[2].props.label).toBe("MCP Health");
    expect(buttons[2].props.disabled).toBe(true);

    // Pressing button triggers onToggle
    act(() => {
      buttons[1].props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith("branch");
  });

  it("supports onSelectAll and onClearAll helper action buttons", () => {
    const onToggle = vi.fn();
    const onSelectAll = vi.fn();
    const onClearAll = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HostThemeProvider theme={THEME as never}>
          <MultiChoiceChips
            options={options}
            selected={["cpu_ram"]}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
            onClearAll={onClearAll}
          />
        </HostThemeProvider>,
      );
    });

    const buttons = renderer.root.findAllByType(HostButton);
    // 2 action buttons ("All", "None") + 3 chip buttons
    expect(buttons).toHaveLength(5);

    const allBtn = buttons.find((b) => b.props.label === "All");
    const noneBtn = buttons.find((b) => b.props.label === "None");
    expect(allBtn).toBeDefined();
    expect(noneBtn).toBeDefined();

    act(() => {
      allBtn!.props.onPress();
    });
    expect(onSelectAll).toHaveBeenCalledTimes(1);

    act(() => {
      noneBtn!.props.onPress();
    });
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("supports custom inactiveVariant like ghost", () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HostThemeProvider theme={THEME as never}>
          <MultiChoiceChips
            options={options}
            selected={[]}
            onToggle={() => {}}
            inactiveVariant="ghost"
          />
        </HostThemeProvider>,
      );
    });

    const buttons = renderer.root.findAllByType(HostButton);
    expect(buttons[0].props.variant).toBe("ghost");
  });

  it("ChoiceChips single select continues to function properly", () => {
    const onChange = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HostThemeProvider theme={THEME as never}>
          <ChoiceChips
            options={[
              { id: "cycle", label: "Cycle", description: "Rotate items" },
              { id: "all", label: "All in One", description: "Combined pill" },
            ]}
            value="cycle"
            onChange={onChange}
            showActiveDescription
          />
        </HostThemeProvider>,
      );
    });

    const buttons = renderer.root.findAllByType(HostButton);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].props.variant).toBe("primary");
    expect(buttons[1].props.variant).toBe("ghost");

    act(() => {
      buttons[1].props.onPress();
    });
    expect(onChange).toHaveBeenCalledWith("all");
  });
});

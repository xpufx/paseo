import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  HostActionBar,
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostEmptyState,
  HostKeyValue,
  HostKeyValueGroup,
  HostProgressBar,
  HostRow,
  HostScroll,
  HostSectionHeader,
  HostStack,
  HostStatusDot,
  HostThemeProvider,
  ListActionPageTemplate,
  type ThemeColors,
} from "../index.js";

// Mock host SDK primitives
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_THEME_COLORS: Partial<ThemeColors> = {
  background: "#18181b",
  card: "#27272a",
  foreground: "#f4f4f5",
  muted: "#71717a",
  border: "#3f3f46",
  primary: "#3b82f6",
  primaryForeground: "#ffffff",
  destructive: "#ef4444",
  success: "#22c55e",
  warning: "#f59e0b",
};

function render(element: React.ReactElement) {
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(element);
  });
  return root;
}

describe("Consumer Regression Harness (xpufx-org/paseo#1221)", () => {
  it("renders plugin-updates page fixture adhering to single scroll owner contract", () => {
    interface PluginUpdateFixture {
      id: string;
      name: string;
      version: string;
      status: "up-to-date" | "update-available" | "updating";
    }

    const samplePlugins: PluginUpdateFixture[] = [
      { id: "p1", name: "MCP Tools", version: "0.9.1", status: "up-to-date" },
      { id: "p2", name: "Twofado", version: "0.8.4", status: "update-available" },
    ];

    const onUpdate = vi.fn();
    const onCheck = vi.fn();

    const renderer = render(
      <HostThemeProvider theme={{ colors: TEST_THEME_COLORS }}>
        <ListActionPageTemplate
          title="Plugin Updates"
          subtitle="Manage installed plugins"
          badge={<HostBadge label="2 plugins" tone="accent" />}
          headerActions={[
            { id: "check", label: "Check All", onPress: onCheck },
          ]}
          data={samplePlugins}
          keyExtractor={(p) => p.id}
          renderItem={(p) => (
            <HostCard key={p.id}>
              <HostCardHeader
                title={p.name}
                badge={
                  <HostBadge
                    label={p.status}
                    tone={p.status === "update-available" ? "warning" : "success"}
                  />
                }
              />
              <HostKeyValueGroup columns={2}>
                <HostKeyValue label="ID" value={p.id} />
                <HostKeyValue label="Version" value={p.version} />
              </HostKeyValueGroup>
              <HostActionBar align="end">
                <HostButton
                  label="Update"
                  tone="primary"
                  disabled={p.status !== "update-available"}
                  onPress={() => onUpdate(p.id)}
                />
              </HostActionBar>
            </HostCard>
          )}
        />
      </HostThemeProvider>,
    );

    // 1. Invariant: Only one single outer ScrollView owns scrolling
    const scrollViews = renderer.root.findAllByType("ScrollView");
    expect(scrollViews).toHaveLength(1);

    // 2. Invariant: Text content renders properly across card children
    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("Plugin Updates");
    expect(texts).toContain("Manage installed plugins");
    expect(texts).toContain("2 plugins");
    expect(texts).toContain("MCP Tools");
    expect(texts).toContain("Twofado");
    expect(texts).toContain("0.9.1");
    expect(texts).toContain("0.8.4");

    // 3. Invariant: Interactive button triggers action
    const updateButtons = renderer.root.findAllByType(HostButton);
    const enabledButton = updateButtons.find((b) => b.props.label === "Update" && !b.props.disabled);
    expect(enabledButton).toBeDefined();

    act(() => {
      enabledButton?.props.onPress();
    });
    expect(onUpdate).toHaveBeenCalledWith("p2");
  });

  it("renders plugin-updates empty state fixture cleanly", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: TEST_THEME_COLORS }}>
        <ListActionPageTemplate
          title="Plugin Updates"
          data={[]}
          renderItem={() => null}
          emptyState={{
            title: "No plugins installed",
            description: "No managed plugins found in ~/.paseo/plugins.",
          }}
        />
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(texts).toContain("No plugins installed");
    expect(texts).toContain("No managed plugins found in ~/.paseo/plugins.");
  });

  it("renders composite card with HostRow, HostStatusDot, and HostProgressBar", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: TEST_THEME_COLORS }}>
        <HostCard>
          <HostRow justify="between">
            <HostRow gap={8}>
              <HostStatusDot status="warning" />
              <HostStack gap={2}>
                <span key="t1">Update in progress</span>
                <span key="t2">Downloading 4 files...</span>
              </HostStack>
            </HostRow>
            <HostBadge label="45%" tone="warning" />
          </HostRow>
          <HostProgressBar progress={0.45} tone="warning" />
        </HostCard>
      </HostThemeProvider>,
    );

    const texts = renderer.root.findAllByType(HostBadge).map((b) => b.props.label);
    expect(texts).toContain("45%");
  });
});

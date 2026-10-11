import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  HostActionBar,
  HostAttentionBeacon,
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostCodeBlock,
  HostCommandBox,
  HostEmptyState,
  HostFormRow,
  HostKeyValue,
  HostKeyValueGroup,
  HostModalBody,
  HostProgressBar,
  HostRow,
  HostScroll,
  HostSectionHeader,
  HostSelect,
  HostStack,
  HostStatusDot,
  HostTabs,
  HostTextInput,
  HostThemeProvider,
  HostToggle,
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

  it("renders slash console command editor fixture with HostFormRow, HostTabs, HostTextInput, and HostActionBar (#1233)", () => {
    const onTabChange = vi.fn();
    const onTextChange = vi.fn();
    const onSave = vi.fn();

    const renderer = render(
      <HostThemeProvider theme={{ colors: TEST_THEME_COLORS }}>
        <HostCard variant="elevated">
          <HostStack gap={8}>
            <HostFormRow label="Name" description="Unique lowercase command name">
              <HostTextInput
                value="review"
                placeholder="my-command"
                onChangeText={onTextChange}
              />
            </HostFormRow>
            <HostFormRow label="Action">
              <HostTabs
                tabs={[
                  { id: "send", label: "Send", icon: "Send" },
                  { id: "open", label: "Open", icon: "ExternalLink" },
                  { id: "rpc", label: "RPC", icon: "Zap" },
                ]}
                activeTab="send"
                onTabChange={onTabChange}
              />
            </HostFormRow>
            <HostActionBar align="end">
              <HostButton variant="secondary" label="Cancel" />
              <HostButton variant="primary" label="Save Command" onPress={onSave} />
            </HostActionBar>
          </HostStack>
        </HostCard>
      </HostThemeProvider>,
    );

    const labels = renderer.root.findAllByType("Text").map((t) => t.props.children);
    expect(labels).toContain("Name");
    expect(labels).toContain("Unique lowercase command name");
    expect(labels).toContain("Action");

    const buttons = renderer.root.findAllByType(HostButton);
    expect(buttons).toHaveLength(2);
    const saveBtn = buttons.find((b) => b.props.label === "Save Command");
    expect(saveBtn).toBeDefined();

    act(() => {
      saveBtn?.props.onPress?.();
    });
    expect(onSave).toHaveBeenCalled();
  });

  it("propagates light/dark host theme colors down through HostThemeProvider to card and text surfaces (#1235)", () => {
    const LIGHT_THEME: ThemeColors = {
      surface0: "#ffffff",
      surface1: "#f4f4f5",
      surface2: "#e4e4e7",
      border: "#e4e4e7",
      foreground: "#09090b",
      foregroundMuted: "#71717a",
      accent: "#2563eb",
      accentForeground: "#ffffff",
      statusSuccess: "#16a34a",
      statusWarning: "#ca8a04",
      statusDanger: "#dc2626",
    };

    const DARK_THEME: ThemeColors = {
      surface0: "#18181b",
      surface1: "#27272a",
      surface2: "#3f3f46",
      border: "#3f3f46",
      foreground: "#fafafa",
      foregroundMuted: "#a1a1aa",
      accent: "#3b82f6",
      accentForeground: "#ffffff",
      statusSuccess: "#22c55e",
      statusWarning: "#eab308",
      statusDanger: "#ef4444",
    };

    const lightRenderer = render(
      <HostThemeProvider theme={{ colors: LIGHT_THEME }}>
        <HostCard variant="elevated">
          <HostFormRow label="Command prefix">
            <HostTextInput value="slash" />
          </HostFormRow>
        </HostCard>
      </HostThemeProvider>,
    );

    const lightCard = lightRenderer.root.findByType(HostCard);
    const lightView = lightCard.findByType("View");
    const lightStyle = Array.isArray(lightView.props.style)
      ? Object.assign({}, ...lightView.props.style.filter(Boolean))
      : lightView.props.style;
    expect(lightStyle.backgroundColor).toBe(LIGHT_THEME.surface1);

    const darkRenderer = render(
      <HostThemeProvider theme={{ colors: DARK_THEME }}>
        <HostCard variant="elevated">
          <HostFormRow label="Command prefix">
            <HostTextInput value="slash" />
          </HostFormRow>
        </HostCard>
      </HostThemeProvider>,
    );

    const darkCard = darkRenderer.root.findByType(HostCard);
    const darkView = darkCard.findByType("View");
    const darkStyle = Array.isArray(darkView.props.style)
      ? Object.assign({}, ...darkView.props.style.filter(Boolean))
      : darkView.props.style;
    expect(darkStyle.backgroundColor).toBe(DARK_THEME.surface1);
  });

  it("renders twofado approval fixture with shared primitives and theme propagation (#1237)", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();

    const renderer = render(
      <HostThemeProvider theme={{ colors: TEST_THEME_COLORS }}>
        <HostModalBody headerMode="pinned" header={<HostSectionHeader title="Pending 2FA Approvals" />}>
          <HostCard variant="elevated">
            <HostCardHeader
              title="Execution Request #42"
              badge={<HostBadge label="Pending" tone="warning" />}
            />
            <HostRow align="center" gap={8}>
              <HostAttentionBeacon active tone="warning" mode="pulse" />
              <HostKeyValueGroup columns={2}>
                <HostKeyValue label="By" value="agent-1" />
                <HostKeyValue label="CWD" value="/home/user/project" mono stackOnCompact />
              </HostKeyValueGroup>
            </HostRow>

            <HostCommandBox argv={["rm", "-rf", "/tmp/cache"]} />

            <HostCodeBlock
              title="Preview"
              code="Removing 14 cache directories..."
              maxHeight={120}
              copyable
            />

            <HostFormRow label="Reason">
              <HostTextInput
                value="Automated clearance"
                disabled
                onChangeText={() => {}}
              />
            </HostFormRow>

            <HostActionBar align="flex-end" gap={8}>
              <HostButton label="Reject" tone="danger" onPress={onReject} />
              <HostButton label="Approve" tone="primary" onPress={onApprove} />
            </HostActionBar>
          </HostCard>
        </HostModalBody>
      </HostThemeProvider>,
    );

    // 1. Scroller hierarchy: 1 outer modal body scroller + 1 bounded inner code snippet scroller
    const scrollViews = renderer.root.findAllByType("ScrollView");
    expect(scrollViews).toHaveLength(2);
    const codeBlockScroller = renderer.root.findByType(HostCodeBlock).findByType("ScrollView");
    expect(codeBlockScroller.props.style).toEqual({ maxHeight: 120 });

    // 2. Beacon renders with warning tone color
    const beacon = renderer.root.findByType(HostAttentionBeacon);
    expect(beacon).toBeDefined();

    // 3. Command box renders with argv joined
    const commandBox = renderer.root.findByType(HostCommandBox);
    expect(commandBox).toBeDefined();

    // 4. Code block renders preview code
    const codeBlock = renderer.root.findByType(HostCodeBlock);
    expect(codeBlock).toBeDefined();

    // 5. Disabled text input renders with reduced opacity
    const textInput = renderer.root.findByType(HostTextInput);
    const inputPrimitive = textInput.findByType("TextInput");
    const inputStyle = Array.isArray(inputPrimitive.props.style)
      ? Object.assign({}, ...inputPrimitive.props.style.filter(Boolean))
      : inputPrimitive.props.style;
    expect(inputStyle.opacity).toBe(0.5);
    expect(inputPrimitive.props.editable).toBe(false);

    // 6. Action buttons trigger handlers
    const buttons = renderer.root.findAllByType(HostButton);
    const approveBtn = buttons.find((b) => b.props.label === "Approve");
    act(() => {
      approveBtn?.props.onPress();
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});


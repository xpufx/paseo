import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { HostCollapsible, HostRow, HostThemeProvider } from "./host-ui";

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIGHT = {
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

type JsonNode = { type: unknown; props: Record<string, unknown>; children: unknown };

function flattenStyle(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object") Object.assign(out, value);
  };
  visit(style);
  return out;
}

function parentMap(root: unknown): Map<JsonNode, JsonNode> {
  const parents = new Map<JsonNode, JsonNode>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const el = node as JsonNode;
    if (Array.isArray(el.children)) {
      for (const child of el.children) {
        if (child && typeof child === "object") {
          parents.set(child as JsonNode, el);
          visit(child);
        }
      }
    }
  };
  visit(root);
  return parents;
}

function findText(root: unknown, text: string): JsonNode {
  let found: JsonNode | undefined;
  const visit = (node: unknown): void => {
    if (found || !node || typeof node !== "object") return;
    const el = node as JsonNode;
    if (el.props?.children === text) {
      found = el;
      return;
    }
    if (Array.isArray(el.children) && el.children.includes(text)) {
      found = el;
      return;
    }
    if (Array.isArray(el.children)) el.children.forEach(visit);
  };
  visit(root);
  if (!found) throw new Error(`text "${text}" not found`);
  return found;
}

function renderCollapsible() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <HostThemeProvider theme={LIGHT}>
        <HostCollapsible
          title={
            <HostRow gap={6} align="center">
              <Text>Turn Failed</Text>
            </HostRow>
          }
          headerRight={
            <HostRow gap={6} align="center">
              <Text>06:11:22 PM</Text>
            </HostRow>
          }
        >
          <Text>body</Text>
        </HostCollapsible>
      </HostThemeProvider>,
    );
  });
  return renderer;
}

/**
 * Regression for xpufx-org/paseo#1010: callers pass `HostRow` (which is
 * `width: 100%`) as `title`/`headerRight`. Rendered as direct children of the
 * collapsible header row, the right row claimed the whole header width and the
 * title column collapsed, wrapping "Turn Failed" and overlapping the timestamp
 * in the timeline card.
 */
describe("HostCollapsible header layout (#1010)", () => {
  it("keeps a ReactNode title column growing and a ReactNode headerRight at content width", () => {
    const renderer = renderCollapsible();
    const tree = renderer.toJSON();
    const parents = parentMap(tree);

    const titleRow = parents.get(findText(tree, "Turn Failed"));
    const titleColumn = titleRow && parents.get(titleRow);
    expect(titleColumn).toBeDefined();
    expect(flattenStyle(titleColumn!.props.style)).toMatchObject({ flex: 1, minWidth: 0 });

    const rightRow = parents.get(findText(tree, "06:11:22 PM"));
    const rightSlot = rightRow && parents.get(rightRow);
    expect(rightSlot).toBeDefined();
    const rightStyle = flattenStyle(rightSlot!.props.style);
    expect(rightStyle.flexShrink).toBe(0);
    expect(rightStyle.width).toBeUndefined();
  });
});

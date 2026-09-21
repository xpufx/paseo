import { beforeEach, describe, expect, it } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { StyleSheet, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import { registerWorkspacePanel } from "../client/panel.js";
import { Card } from "../client/components/Card.js";
import { SearchInput } from "../client/components/SearchInput.js";
import {
  defaultDarkTheme,
  defaultLightTheme,
  usePluginTheme,
} from "../client/theme/provider.js";

beforeEach(() => {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
});

function flatten(style: unknown) {
  const resolved = StyleSheet.flatten((style ?? {}) as any);
  return (Array.isArray(resolved) ? Object.assign({}, ...resolved) : resolved) as Record<string, unknown>;
}

describe("workspace panel theme ownership", () => {
  it.each([
    ["light", defaultLightTheme],
    ["dark", defaultDarkTheme],
  ] as const)("passes the host %s tokens to queue-compatible cards and inputs", (_name, theme) => {
    let registered: any;
    const remove = registerWorkspacePanel(
      {
        addWorkspacePanel(contribution: any) {
          registered = contribution;
          return () => {};
        },
      },
      {
        id: "queues",
        title: "Queues",
        icon: "Layers",
        locations: ["workspace", "explorer"],
        Component: () => {
          const { colors } = usePluginTheme();
          return (
            <>
              <Card variant="elevated" style={{ borderTopWidth: 7 }}>
                <View />
              </Card>
              <SearchInput
                testID="queue-search"
                value=""
                onChangeText={() => {}}
                style={{ marginTop: 13 }}
              />
              <View testID="message-row" style={{ backgroundColor: colors.surface2 }} />
            </>
          );
        },
      },
    );

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <registered.Component theme={theme} layout={{ compact: false, platform: "web" }} />,
      );
    });

    const card = renderer.root.findAllByType(View).find((node) => flatten(node.props.style).borderTopWidth === 7);
    const search = renderer.root
      .findAllByType(View)
      .find((node) => flatten(node.props.style).marginTop === 13);
    const message = renderer.root.findByProps({ testID: "message-row" });

    expect(flatten(card?.props.style).backgroundColor).toBe(theme.colors.surface1);
    expect(flatten(search?.props.style).backgroundColor).toBe(theme.colors.surface1);
    expect(flatten(message.props.style).backgroundColor).toBe(theme.colors.surface2);
    expect(registered.locations).toEqual(["workspace", "explorer"]);
    expect(() => remove()).not.toThrow();
  });
});

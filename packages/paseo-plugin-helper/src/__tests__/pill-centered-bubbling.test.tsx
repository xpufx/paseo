import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import { Text, TextInput, View } from "react-native";
import { initClientHelpers, type ComposerPillRegistrar } from "../client/host.js";
import { registerComposerPill } from "../client/pill.js";

const theme: any = {
  colors: {
    surface0: "#18181b",
    surface1: "#27272a",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    accent: "#3b82f6",
  },
};
const layout: any = { compact: false, platform: "web" };

describe("registerComposerPill centered modal event bubbling boundary (#347)", () => {
  it("wraps centered modal contents with event propagation stoppers", async () => {
    let iconElement: any;
    let buttonOnPress: (() => void) | undefined;
    let registeredContribution: any;

    initClientHelpers({
      Icon: () => null,
      Modal: Object.assign(
        (props: any) => (
          <div data-testid="modal-root">
            {props.open ? props.children : null}
          </div>
        ),
        {
          Content: (props: any) => <div data-testid="modal-content">{props.children}</div>,
        },
      ),
      useRpc: () => async () => ({}),
      useToast: () => ({}),
    } as any);

    const client = {
      addComposerPill: (contribution: Record<string, unknown>) => {
        registeredContribution = contribution;
        if (typeof (contribution as any).onPress === "function") {
          buttonOnPress = (contribution as any).onPress;
        }
        if ((contribution as any).button?.icon) {
          iconElement = (contribution as any).button.icon;
        }
        return () => {};
      },
      paseo: {
        agents: {
          subscribe: () => () => {},
          list: async () => ({ entries: [{ agent: { id: "a1", workspaceId: "w1" } }] }),
        },
      },
    } as unknown as ComposerPillRegistrar;

    registerComposerPill(client, {
      id: "test-centered",
      title: "Test Centered",
      presentation: "centered",
      renderModal: () => (
        <View>
          <TextInput testID="modal-input" placeholder="Type here" />
        </View>
      ),
    } as any);

    await act(async () => {
      await Promise.resolve();
    });

    expect(iconElement).toBeDefined();

    // Open modal
    act(() => {
      buttonOnPress?.();
    });

    const IconComp = iconElement;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <IconComp
          agentId="a1"
          workspaceId="w1"
          theme={theme}
          layout={layout}
          host={{ id: "h", label: "H" }}
        />,
      );
    });

    // Find all Views in the tree
    const views = renderer.root.findAllByType(View);
    // At least one view should have event boundary handlers like onClick / onPointerDown
    const eventBoundaries = views.filter(
      (v) => typeof v.props.onClick === "function" && typeof v.props.onPointerDown === "function",
    );
    expect(eventBoundaries.length).toBeGreaterThanOrEqual(1);

    // Verify stopPropagation is called on events
    const stopPropagation = vi.fn();
    const mockEvent = { stopPropagation };

    eventBoundaries[0].props.onClick(mockEvent);
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    eventBoundaries[0].props.onPointerDown(mockEvent);
    expect(stopPropagation).toHaveBeenCalledTimes(2);

    eventBoundaries[0].props.onMouseDown(mockEvent);
    expect(stopPropagation).toHaveBeenCalledTimes(3);

    eventBoundaries[0].props.onTouchStart(mockEvent);
    expect(stopPropagation).toHaveBeenCalledTimes(4);
  });
});

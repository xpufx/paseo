import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ScrollView, Text, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import { HostModalContent, HostScroll } from "../ui/modal.js";

let hostContentProps: Record<string, unknown> | null = null;

function installStubs() {
  hostContentProps = null;
  const HostContent = (props: Record<string, unknown>) => {
    hostContentProps = props;
    return <View testID="host-modal-content">{props.children as React.ReactNode}</View>;
  };
  const HostScrollView = (props: Record<string, unknown>) => (
    <ScrollView testID="host-scrollview" {...(props as object)} />
  );
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: HostContent }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
    ScrollView: HostScrollView,
  } as any);
}

beforeEach(() => {
  installStubs();
});

function render(el: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer!;
}

describe("ui/HostModalContent host delegation", () => {
  it("leaves scroll ownership with the host (no scrollable={false})", () => {
    render(
      <HostModalContent>
        <Text>body</Text>
      </HostModalContent>,
    );
    expect(hostContentProps?.scrollable).toBeUndefined();
  });

  it("adds no helper-owned scroller inside the host content", () => {
    const r = render(
      <HostModalContent>
        <Text>body</Text>
      </HostModalContent>,
    );
    expect(r.root.findByProps({ testID: "host-modal-content" })).toBeTruthy();
    expect(r.root.findAllByType(ScrollView)).toHaveLength(0);
  });
});

describe("ui/HostScroll explicit scroll owner", () => {
  it("renders exactly one scroller via the injected host ScrollView", () => {
    const r = render(
      <HostScroll>
        <Text>body</Text>
      </HostScroll>,
    );
    expect(r.root.findAllByType(ScrollView)).toHaveLength(1);
    expect(r.root.findByProps({ testID: "host-scrollview" }).type).toBe(ScrollView);
  });
});

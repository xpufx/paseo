import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import {
  initClientHelpers,
  type ComposerPillRegistrar,
} from "../client/host.js";
import {
  registerComposerPill,
  resolvePillModalScrollable,
} from "../client/pill.js";
import { HostModalSection } from "../ui/modal.js";

describe("resolvePillModalScrollable", () => {
  it("defaults to the legacy bounded dialog", () => {
    expect(resolvePillModalScrollable()).toBe(false);
    expect(resolvePillModalScrollable(false)).toBe(false);
  });

  it("delegates scroll to the host when opted in", () => {
    expect(resolvePillModalScrollable(true)).toBe(true);
  });
});

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

describe("registerComposerPill legacy modal wrapper", () => {
  let contentProps: Array<Record<string, unknown>>;
  let HostComponent: any;
  let pressOpener: (() => void) | undefined;
  let HostContent: (props: Record<string, unknown>) => React.ReactElement;

  beforeEach(() => {
    contentProps = [];
    HostComponent = undefined;
    pressOpener = undefined;
    HostContent = (props: Record<string, unknown>) => {
      contentProps.push(props);
      return <View>{props.children as React.ReactNode}</View>;
    };
    initClientHelpers({
      Icon: () => null,
      Modal: Object.assign((props: Record<string, unknown>) => <>{props.children as React.ReactNode}</>, {
        Content: HostContent,
      }),
      useRpc: () => async () => ({}),
      useToast: () => ({}),
    } as any);
  });

  function registerOnLegacyHost(options: Record<string, unknown>) {
    const client = {
      addComposerPill: (contribution: Record<string, unknown>) => {
        // Button-shaped probe must throw so the registrar takes the legacy path.
        if ((contribution as any).button) throw new Error("legacy host");
        if ((contribution as any).Component) HostComponent = (contribution as any).Component;
        if (typeof (contribution as any).onPress === "function") {
          pressOpener = (contribution as any).onPress;
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
    let dispose!: () => void;
    act(() => {
      dispose = registerComposerPill(client, {
        id: "test",
        title: "Test",
        renderModal: () => <Text>modal body</Text>,
        ...options,
      } as any);
    });
    return dispose;
  }

  async function openPill() {
    await act(async () => {
      await Promise.resolve();
    });
    expect(HostComponent).toBeDefined();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <HostComponent
          agentId="a1"
          workspaceId="w1"
          theme={theme}
          layout={layout}
          host={{ id: "h", label: "H" }}
        />,
      );
    });
    act(() => {
      pressOpener?.();
    });
    return renderer;
  }

  it("renders exactly one Modal.Content, non-scrollable by default", async () => {
    const dispose = registerOnLegacyHost({});
    const renderer = await openPill();
    expect(renderer.root.findAllByType(HostContent)).toHaveLength(1);
    expect(contentProps.at(-1)?.scrollable).toBe(false);
    dispose();
  });

  it("renders exactly one Modal.Content, host-scrollable when opted in", async () => {
    const dispose = registerOnLegacyHost({ hostScroll: true });
    const renderer = await openPill();
    expect(renderer.root.findAllByType(HostContent)).toHaveLength(1);
    expect(contentProps.at(-1)?.scrollable).toBe(true);
    dispose();
  });

  it("hosts fluid section content with exactly one Modal.Content", async () => {
    const client = {
      addComposerPill: (contribution: Record<string, unknown>) => {
        if ((contribution as any).button) throw new Error("legacy host");
        if ((contribution as any).Component) HostComponent = (contribution as any).Component;
        if (typeof (contribution as any).onPress === "function") {
          pressOpener = (contribution as any).onPress;
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
    let dispose!: () => void;
    act(() => {
      dispose = registerComposerPill(client, {
        id: "test",
        title: "Test",
        hostScroll: true,
        renderModal: () => (
          <HostModalSection>
            <Text>section body</Text>
          </HostModalSection>
        ),
      } as any);
    });
    await act(async () => {
      await Promise.resolve();
    });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <HostComponent
          agentId="a1"
          workspaceId="w1"
          theme={theme}
          layout={layout}
          host={{ id: "h", label: "H" }}
        />,
      );
    });
    act(() => {
      pressOpener?.();
    });
    expect(renderer.root.findAllByType(HostContent)).toHaveLength(1);
    expect(contentProps.at(-1)?.scrollable).toBe(true);
    expect(renderer.root.findAllByType(HostModalSection)).toHaveLength(1);
    dispose();
  });
});

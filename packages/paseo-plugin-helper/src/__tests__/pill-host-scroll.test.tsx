import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useContext } from "react";
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
import { ModalBodyScrollOwnerContext } from "../client/layout/ModalBody.js";
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

  it("provides ModalBodyScrollOwnerContext 'required' when hostScroll is omitted/false", async () => {
    let capturedScrollOwner: string | undefined;
    function ScrollConsumer() {
      capturedScrollOwner = useContext(ModalBodyScrollOwnerContext);
      return <Text>scroll consumer</Text>;
    }
    const dispose = registerOnLegacyHost({
      renderModal: () => <ScrollConsumer />,
    });
    await openPill();
    expect(capturedScrollOwner).toBe("required");
    dispose();
  });

  it("provides ModalBodyScrollOwnerContext 'host' when hostScroll is true", async () => {
    let capturedScrollOwner: string | undefined;
    function ScrollConsumer() {
      capturedScrollOwner = useContext(ModalBodyScrollOwnerContext);
      return <Text>scroll consumer</Text>;
    }
    const dispose = registerOnLegacyHost({
      hostScroll: true,
      renderModal: () => <ScrollConsumer />,
    });
    await openPill();
    expect(capturedScrollOwner).toBe("host");
    dispose();
  });
});

describe("registerComposerPill centered modal event boundary layout", () => {
  it("gives the event boundary View flex: 1 / minHeight: 0 so the inner scroller is bounded", async () => {
    let iconElement: any;
    let openModal: (() => void) | undefined;

    initClientHelpers({
      Icon: () => null,
      Modal: Object.assign(
        (props: Record<string, unknown>) => (
          <View>{props.open ? (props.children as React.ReactNode) : null}</View>
        ),
        {
          Content: (props: Record<string, unknown>) => (
            <View>{props.children as React.ReactNode}</View>
          ),
        },
      ),
      useRpc: () => async () => ({}),
      useToast: () => ({}),
    } as any);

    const client = {
      addComposerPill: (contribution: Record<string, unknown>) => {
        if ((contribution as any).button?.icon) {
          iconElement = (contribution as any).button.icon;
        }
        const behavior = (contribution as any).button?.behavior;
        if (behavior?.kind === "action" && typeof behavior.onPress === "function") {
          openModal = behavior.onPress;
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

    act(() => {
      registerComposerPill(client, {
        id: "test-centered-layout",
        title: "Test",
        presentation: "centered",
        renderModal: () => <Text>modal body</Text>,
      } as any);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(iconElement).toBeDefined();

    act(() => {
      openModal?.();
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

    // The centered open path renders two event-boundary Views: the outer one
    // around <Modal> and the inner one around the modal body. Only the inner
    // wrapper must be flex-bounded so the nested scroller gets a viewport.
    const boundaries = renderer.root.findAll(
      (node) =>
        node.type === View &&
        typeof node.props.onStartShouldSetResponder === "function" &&
        typeof node.props.onClick === "function",
    );
    const flexBounded = boundaries.filter((node) => {
      const style = node.props.style;
      return Boolean(style) && style.flex === 1 && style.minHeight === 0;
    });
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
    expect(flexBounded).toHaveLength(1);
    expect(boundaries).toContain(flexBounded[0]);
  });
});

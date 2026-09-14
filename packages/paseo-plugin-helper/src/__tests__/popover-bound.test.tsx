import { describe, it, expect } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { View } from "react-native";
import { initClientHelpers, type ComposerPillRegistrar } from "../client/host.js";
import { registerComposerPill } from "../client/pill.js";
import { defaultDarkTheme } from "../client/theme/provider.js";

function installHostStubs() {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
}

function buttonRegistrar() {
  const pills: Array<{ contribution: any }> = [];
  const subscribers = new Set<(update: any) => void>();
  const client = {
    addComposerPill(contribution: any) {
      if (!contribution.button) throw new TypeError("expected button shape");
      const stored = { contribution };
      pills.push(stored);
      return {
        update: () => {},
        remove: () => {
          const i = pills.indexOf(stored);
          if (i >= 0) pills.splice(i, 1);
        },
      };
    },
    paseo: {
      agents: {
        subscribe: (cb: (update: any) => void) => {
          subscribers.add(cb);
          return () => subscribers.delete(cb);
        },
        list: async () => ({ entries: [] }),
      },
    },
    emit(update: any) {
      for (const cb of subscribers) cb(update);
    },
  } as unknown as ComposerPillRegistrar & { emit(update: any): void };
  return { client, pills };
}

describe("popover content height bound (#78)", () => {
  it("caps the 0.8 popover container so the inner ModalBody column resolves a finite height", () => {
    installHostStubs();
    const { client, pills } = buttonRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "bound-pill",
      title: "Bound",
      renderModal: () => null,
    });
    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    const Content = pills[0].contribution.button.behavior.Content;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <Content
          agentId="a1"
          workspaceId="w1"
          theme={defaultDarkTheme}
          layout={{ compact: true, platform: "web" }}
          close={() => {}}
        />,
      );
    });
    const views = renderer.root.findAllByType(View);
    const bounded = views.filter((v: any) => {
      const s = v.props.style;
      return s && typeof s === "object" && typeof s.maxHeight === "number";
    });
    expect(bounded.length).toBeGreaterThan(0);
    for (const v of bounded) {
      expect((v.props.style as any).maxHeight).toBeGreaterThan(0);
    }
    cleanup();
  });
});

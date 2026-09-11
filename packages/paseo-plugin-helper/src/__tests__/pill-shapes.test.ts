import { describe, it, expect, beforeEach } from "vitest";
import { initClientHelpers, type ComposerPillRegistrar } from "../client/host.js";
import { registerComposerPill } from "../client/pill.js";

function installHostStubs() {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  });
}

interface StoredPill {
  contribution: any;
  removed: boolean;
}

function legacyRegistrar(): { client: ComposerPillRegistrar; pills: StoredPill[] } {
  const pills: StoredPill[] = [];
  const subscribers = new Set<(update: any) => void>();
  const client = {
    addComposerPill(contribution: any) {
      if (typeof contribution.Component !== "function") {
        throw new Error(`Composer pill ${contribution.id} is not a component`);
      }
      if (typeof contribution.onPress !== "function") {
        throw new Error(`Composer pill ${contribution.id} has no callback`);
      }
      const stored: StoredPill = { contribution, removed: false };
      pills.push(stored);
      return () => {
        stored.removed = true;
      };
    },
    paseo: {
      agents: {
        subscribe: (cb: (update: any) => void) => {
          subscribers.add(cb);
          return () => {
            subscribers.delete(cb);
          };
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

function modernRegistrar(): {
  client: ComposerPillRegistrar;
  pills: StoredPill[];
  updates: Array<{ contribution: any; patch: any }>;
} {
  const pills: StoredPill[] = [];
  const updates: Array<{ contribution: any; patch: any }> = [];
  const subscribers = new Set<(update: any) => void>();
  const client = {
    addComposerPill(contribution: any) {
      if (!contribution.button || typeof contribution.button !== "object") {
        throw new TypeError("Cannot read properties of undefined (reading 'icon')");
      }
      const stored: StoredPill = { contribution, removed: false };
      pills.push(stored);
      return {
        update: (patch: any) => {
          updates.push({ contribution, patch });
        },
        remove: () => {
          stored.removed = true;
          const index = pills.indexOf(stored);
          if (index >= 0) pills.splice(index, 1);
        },
      };
    },
    paseo: {
      agents: {
        subscribe: (cb: (update: any) => void) => {
          subscribers.add(cb);
          return () => {
            subscribers.delete(cb);
          };
        },
        list: async () => ({ entries: [] }),
      },
    },
    emit(update: any) {
      for (const cb of subscribers) cb(update);
    },
  } as unknown as ComposerPillRegistrar & { emit(update: any): void };
  return { client, pills, updates };
}

describe("registerComposerPill host shapes", () => {
  beforeEach(() => {
    installHostStubs();
  });

  it("uses the legacy Component shape on old hosts", () => {
    const { client, pills } = legacyRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "legacy-pill",
      title: "Legacy",
      renderModal: () => null,
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    expect(pills).toHaveLength(1);
    expect(typeof pills[0].contribution.Component).toBe("function");
    expect(typeof pills[0].contribution.onPress).toBe("function");
    expect(pills[0].contribution).not.toHaveProperty("button");

    cleanup();
    expect(pills[0].removed).toBe(true);
  });

  it("uses the button/popover shape on 0.8 hosts", () => {
    const { client, pills } = modernRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "modern-pill",
      title: "Modern",
      icon: "Activity",
      renderModal: () => null,
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    expect(pills).toHaveLength(1);
    const stored = pills[0];
    const contribution = stored.contribution;
    expect(contribution).not.toHaveProperty("Component");
    expect(contribution.button.title).toBe("Modern");
    expect(contribution.button.icon).toBe("Activity");
    expect(contribution.button.behavior.kind).toBe("popover");
    expect(typeof contribution.button.behavior.Content).toBe("function");

    cleanup();
    expect(stored.removed).toBe(true);
    expect(pills).toHaveLength(0);
  });

  it("reports registration failures through onError instead of throwing", () => {
    const seen: Array<{ agentId: string; workspaceId: string; error: Error }> = [];
    const subscribers = new Set<(update: any) => void>();
    const boom: ComposerPillRegistrar = {
      addComposerPill: (contribution: any) => {
        if (contribution.id.startsWith("php-probe-")) {
          return { update: () => {}, remove: () => {} };
        }
        throw new Error("boom");
      },
      paseo: {
        agents: {
          subscribe: (cb: (update: any) => void) => {
            subscribers.add(cb);
            return () => {
              subscribers.delete(cb);
            };
          },
          list: async () => ({ entries: [] }),
        },
      },
    };
    const cleanup = registerComposerPill(boom, {
      id: "broken-pill",
      title: "Broken",
      renderModal: () => null,
      onError: (info) => {
        seen.push(info);
      },
    });

    for (const cb of subscribers) cb({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    expect(seen).toHaveLength(1);
    expect(seen[0].agentId).toBe("a1");
    expect(seen[0].workspaceId).toBe("w1");
    expect(seen[0].error.message).toBe("boom");

    expect(() => cleanup()).not.toThrow();
  });

  it("surfaces duplicate-id failures without killing the plugin client", () => {    const { client } = modernRegistrar();
    const seen: Error[] = [];
    registerComposerPill(client, {
      id: "dup-pill",
      title: "Dup",
      renderModal: () => null,
      onError: ({ error }) => {
        seen.push(error);
      },
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    // Second registration with the same pill id for the same agent is a no-op (already tracked).
    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    expect(seen).toHaveLength(0);
  });

  it("pushes the resolved label through update() on button hosts", async () => {
    const { client, updates } = modernRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "live-pill",
      title: "Live",
      renderModal: () => null,
      resolveLabel: ({ agentId }) => `CPU ${agentId}`,
      refreshIntervalMs: 0,
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ label: "CPU a1" });

    cleanup();
  });

  it("polls resolveLabel on an interval and stops on removal", async () => {
    const { client, pills, updates } = modernRegistrar();
    const seen: string[] = [];
    const cleanup = registerComposerPill(client, {
      id: "poll-pill",
      title: "Poll",
      renderModal: () => null,
      resolveLabel: () => {
        seen.push("tick");
        return `v${seen.length}`;
      },
      refreshIntervalMs: 10,
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[updates.length - 1].patch.label).toBe(`v${seen.length}`);

    (client as any).emit({ kind: "remove", agentId: "a1" });
    const frozen = updates.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates).toHaveLength(frozen);
    expect(pills).toHaveLength(0);

    cleanup();
  });

  it("supports async resolvers and skips undefined labels", async () => {
    const { client, updates } = modernRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "async-pill",
      title: "Async",
      renderModal: () => null,
      resolveLabel: async () => undefined,
      refreshIntervalMs: 0,
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updates).toHaveLength(0);

    cleanup();
  });

  it("reports resolver failures through onError instead of throwing", async () => {
    const { client } = modernRegistrar();
    const seen: Error[] = [];
    const cleanup = registerComposerPill(client, {
      id: "fail-pill",
      title: "Fail",
      renderModal: () => null,
      resolveLabel: () => {
        throw new Error("resolver boom");
      },
      refreshIntervalMs: 0,
      onError: ({ error }) => {
        seen.push(error);
      },
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe("resolver boom");

    cleanup();
  });

  it("never calls update() when no resolveLabel is set", async () => {
    const { client, updates } = modernRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "static-pill",
      title: "Static",
      renderModal: () => null,
    });

    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updates).toHaveLength(0);

    cleanup();
  });
});

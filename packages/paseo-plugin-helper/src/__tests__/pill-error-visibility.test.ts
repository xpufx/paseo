import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

interface SimulatedAgent {
  id: string;
  workspaceId?: string | null;
}

function createRegistrar(options: {
  addComposerPill?: (contribution: any) => any;
  list?: () => Promise<{ entries: Array<{ agent: SimulatedAgent }> }>;
  onSubscribe?: (subscribers: Set<(update: any) => void>) => void;
} = {}) {
  const subscribers = new Set<(update: any) => void>();
  const client = {
    addComposerPill:
      options.addComposerPill ?? (() => ({ update: () => {}, remove: () => {} })),
    paseo: {
      agents: {
        subscribe: (cb: (update: any) => void) => {
          subscribers.add(cb);
          return () => {
            subscribers.delete(cb);
          };
        },
        list: options.list ?? (async () => ({ entries: [] })),
      },
    },
  } as unknown as ComposerPillRegistrar;
  options.onSubscribe?.(subscribers);
  return { client, subscribers };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerComposerPill suppressed-error visibility", () => {
  beforeEach(() => {
    installHostStubs();
  });

  it("warns when the initial agents.list() RPC fails instead of swallowing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = createRegistrar({
      list: async () => {
        throw new Error("list boom");
      },
    });

    registerComposerPill(client, { id: "list-pill", title: "List", renderModal: () => null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("agents.list() failed"),
      expect.any(Error),
    );
  });

  it("logs and still reports registration failures through onError", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: Error[] = [];
    const { client, subscribers } = createRegistrar({
      addComposerPill: (contribution: any) => {
        if (contribution.id.startsWith("php-probe-")) {
          return { update: () => {}, remove: () => {} };
        }
        throw new Error("reg boom");
      },
    });

    registerComposerPill(client, {
      id: "reg-pill",
      title: "Reg",
      renderModal: () => null,
      onError: ({ error }) => {
        seen.push(error);
      },
    });

    for (const cb of subscribers) cb({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });

    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe("reg boom");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("registration failed"),
      expect.any(Error),
    );
  });

  it("logs resolver RPC failures at debug even when no onError hook is wired", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { client, subscribers } = createRegistrar();

    registerComposerPill(client, {
      id: "resolve-pill",
      title: "Resolve",
      renderModal: () => null,
      resolveLabel: async () => {
        throw new Error("resolver boom");
      },
      refreshIntervalMs: 0,
    });

    for (const cb of subscribers) cb({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("resolveLabel/resolveIcon failed"),
      expect.any(Error),
    );
  });
});

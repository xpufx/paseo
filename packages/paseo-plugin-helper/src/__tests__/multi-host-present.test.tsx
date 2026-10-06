import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

/**
 * The companion to `multi-host-missing.test.tsx`: when the host does supply
 * the primitives, the seam must pass the host list through and return the
 * borrowed client rather than always claiming "unavailable".
 */
vi.mock("@getpaseo/plugin/client", () => {
  const hosts = [{ serverId: "srv_one", label: "One", status: "online" }];
  const clients = new Map<string, { serverId: string }>();
  return {
    useHosts: () => hosts,
    getPaseoClient: (serverId: string) => {
      const existing = clients.get(serverId);
      if (existing) return existing;
      const client = { serverId };
      clients.set(serverId, client);
      return client;
    },
  };
});

import {
  getOptionalPaseoClient,
  isMultiHostSupported,
  useOptionalHosts,
} from "../lifecycle/multi-host.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function HostsProbe() {
  const hosts = useOptionalHosts();
  return React.createElement("probe", {
    count: hosts.length,
    serverId: hosts[0]?.serverId ?? null,
  });
}

describe("optional multi-host seam on a multi-host-capable host", () => {
  it("reports multi-host supported", () => {
    expect(isMultiHostSupported()).toBe(true);
  });

  it("useOptionalHosts returns the host list", () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(HostsProbe));
    });
    expect(renderer!.toJSON()).toMatchObject({
      props: { count: 1, serverId: "srv_one" },
    });
  });

  it("getOptionalPaseoClient returns the borrowed client", () => {
    expect(getOptionalPaseoClient("srv_one")).toMatchObject({ serverId: "srv_one" });
  });
});

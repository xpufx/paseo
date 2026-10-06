import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

/**
 * The mobile host bundle does not supply `useHosts` / `getPaseoClient`: the
 * SDK declares them but only the app's desktop client bundle loader fills them
 * in, so the named exports bind `undefined` on mobile. The optional multi-host
 * seam must degrade to "no hosts, no client" instead of throwing the #1043
 * crash class into every surface that enumerates hosts.
 */
vi.mock("@getpaseo/plugin/client", () => ({
  useHosts: undefined,
  getPaseoClient: undefined,
}));

import {
  getOptionalPaseoClient,
  isMultiHostSupported,
  useOptionalHosts,
} from "../lifecycle/multi-host.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function HostsProbe() {
  const hosts = useOptionalHosts();
  return React.createElement("probe", { count: hosts.length });
}

describe("optional multi-host seam on a host without the primitives", () => {
  it("reports multi-host unsupported", () => {
    expect(isMultiHostSupported()).toBe(false);
  });

  it("useOptionalHosts returns an empty list instead of calling the absent hook", () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    expect(() => {
      act(() => {
        renderer = TestRenderer.create(React.createElement(HostsProbe));
      });
    }).not.toThrow();
    expect(renderer!.toJSON()).toMatchObject({ props: { count: 0 } });
  });

  it("getOptionalPaseoClient returns undefined instead of throwing", () => {
    expect(getOptionalPaseoClient("srv_one")).toBeUndefined();
  });
});

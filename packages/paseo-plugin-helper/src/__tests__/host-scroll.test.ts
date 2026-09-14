import { describe, it, expect } from "vitest";
import {
  initClientHelpers,
  getClientHost,
  selectHostScrollView,
  type HostScrollView,
} from "../client/host.js";

const HostStub = (() => null) as unknown as HostScrollView;
const FallbackStub = (() => null) as unknown as HostScrollView;

describe("client/host scroll resolution", () => {
  it("prefers the injected host ScrollView", () => {
    expect(selectHostScrollView({ ScrollView: HostStub }, FallbackStub)).toBe(HostStub);
  });

  it("falls back to RN ScrollView when the host omits it", () => {
    expect(selectHostScrollView({}, FallbackStub)).toBe(FallbackStub);
  });

  it("falls back to RN ScrollView when no host is initialized", () => {
    expect(selectHostScrollView(undefined, FallbackStub)).toBe(FallbackStub);
  });

  it("round-trips ScrollView and FlatList through initClientHelpers", () => {
    const FlatListStub = (() => null) as any;
    initClientHelpers({
      Icon: () => null,
      Modal: Object.assign(() => null, { Content: () => null }),
      useRpc: () => async () => ({}),
      useToast: () => ({}),
      ScrollView: HostStub,
      FlatList: FlatListStub,
    });
    const host = getClientHost();
    expect(host.ScrollView).toBe(HostStub);
    expect(host.FlatList).toBe(FlatListStub);
    expect(selectHostScrollView(host, FallbackStub)).toBe(HostStub);
  });
});

import { describe, it, expect } from "vitest";
import { REFRESH_INTERVALS } from "../client/query-refresh.js";

describe("client/query-refresh", () => {
  it("maps refresh rates correctly", () => {
    expect(REFRESH_INTERVALS["1s"]).toBe(1000);
    expect(REFRESH_INTERVALS["2s"]).toBe(2000);
    expect(REFRESH_INTERVALS["5s"]).toBe(5000);
    expect(REFRESH_INTERVALS["10s"]).toBe(10000);
    expect(REFRESH_INTERVALS["paused"]).toBe(false);
  });
});

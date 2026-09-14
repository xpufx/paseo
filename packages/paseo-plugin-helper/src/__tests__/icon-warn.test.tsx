import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "../client/host.js";
import {
  Icon,
  clearKnownIconNames,
  reportUnknownIcon,
  setKnownIconNames,
} from "../client/icon.js";

afterEach(() => {
  clearKnownIconNames();
  vi.restoreAllMocks();
});

function initStubIcon() {
  initClientHelpers({
    Icon: (() => null) as never,
    Modal: (() => null) as never,
    useRpc: (() => () => Promise.resolve(null)) as never,
    useToast: (() => ({})) as never,
  });
}

function renderIcon(name: string) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Icon, { name }));
  });
  return renderer!;
}

describe("Icon warn path", () => {
  it("warns on blank icon names instead of rendering nothing silently", () => {
    initStubIcon();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderIcon("   ");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown icon name"));
  });

  it("warns once per unknown registered name", () => {
    initStubIcon();
    setKnownIconNames(["check", "x"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderIcon("bogus-icon");
    renderIcon("bogus-icon");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent for known names", () => {
    initStubIcon();
    setKnownIconNames(["check"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderIcon("check");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reportUnknownIcon dedupes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportUnknownIcon("nope");
    reportUnknownIcon("nope");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { APPROVAL_TABS } from "./approvals";
import { parseApprovers } from "../shared/approval";

// The real `react-native` entrypoint carries Flow syntax Vite cannot parse.
vi.mock("react-native", () => {
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      React.createElement(name, props, (props?.children as React.ReactNode) ?? null);
    Object.defineProperty(Component, "name", { value: name });
    return Component;
  };
  return {
    View: stub("View"),
    Text: stub("Text"),
    Pressable: stub("Pressable"),
    ScrollView: stub("ScrollView"),
    TextInput: stub("TextInput"),
    Image: stub("Image"),
    StyleSheet: {
      create: <T,>(styles: T): T => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
      compose: (a: unknown, b: unknown) => [a, b],
    },
    Platform: {
      OS: "web",
      select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined =>
        options.web ?? options.default,
    },
    Appearance: { getColorScheme: () => "dark" as const, addChangeListener: () => ({ remove: () => {} }) },
    useColorScheme: () => "dark" as const,
    Dimensions: { get: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }) },
    useWindowDimensions: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }),
    Linking: { openURL: async () => {}, canOpenURL: async () => true },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Animated: {
      Value: class {
        constructor(public value: number) {}
        setValue() {}
        interpolate() {
          return {};
        }
      },
      View: stub("AnimatedView"),
      Text: stub("AnimatedText"),
      loop: (a: unknown) => a,
      sequence: () => ({ start: () => {}, stop: () => {} }),
      timing: () => ({ start: () => {}, stop: () => {} }),
      spring: () => ({ start: () => {}, stop: () => {} }),
    },
    Easing: { linear: (v: number) => v, ease: (v: number) => v, inOut: (v: unknown) => v },
    ActivityIndicator: stub("ActivityIndicator"),
  };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const approvalsSource = fs.readFileSync(path.join(here, "approvals.tsx"), "utf8");
const entrySource = fs.readFileSync(path.resolve(here, "../index.client.tsx"), "utf8");

describe("2fado surface tabs", () => {
  it("exposes pending, history and settings as the three tabs", () => {
    expect(APPROVAL_TABS.map((tab) => tab.id)).toEqual(["pending", "history", "settings"]);
    expect(APPROVAL_TABS.map((tab) => tab.label)).toEqual(["Pending", "History", "Settings"]);
    expect(APPROVAL_TABS[2]).toMatchObject({ id: "settings", icon: "Settings" });
  });

  it("renders the settings tab body for the settings tab", () => {
    // pending -> history -> settings (final else branch)
    expect(approvalsSource).toMatch(/activeTab === "history"\s*\?/);
    expect(approvalsSource).toMatch(/<SettingsTab\s*\/>/);
  });

  it("binds the settings screen to the twofado settings contract and daemon health", () => {
    expect(approvalsSource).toMatch(/usePluginSettings\(\s*approvalSettings\s*\)/);
    expect(approvalsSource).toMatch(/useDaemonHealth\(\)/);
  });

  it("offers save and reset controls for settings changes", () => {
    expect(approvalsSource).toMatch(/label="Reset"/);
    expect(approvalsSource).toMatch(/label=\{dirty \? "Save changes" : "Saved"\}/);
  });
});

describe("2fado settings screen registration", () => {
  it("registers the settings screen from the client entrypoint", () => {
    expect(entrySource).toMatch(
      /registerHelperSettingsScreen\(\s*client,\s*approvalSettings/,
    );
    expect(entrySource).toMatch(/import\s*\{[^}]*approvalSettings[^}]*\}\s*from\s*["']\.\/shared\/approval["']/);
  });
});

describe("parseApprovers", () => {
  it("splits on commas and whitespace and drops blanks", () => {
    expect(parseApprovers(" 123, 456  789 ")).toEqual(["123", "456", "789"]);
    expect(parseApprovers("")).toEqual([]);
    expect(parseApprovers(" , , ")).toEqual([]);
  });
});

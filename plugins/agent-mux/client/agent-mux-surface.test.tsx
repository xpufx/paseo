import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import ReactTestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { HostThemeProvider } from "./host-ui.js";
import { DashboardTab } from "./tabs/dashboard-tab.js";
import { ProfilesTab } from "./tabs/profiles-tab.js";
import { CooldownsTab } from "./tabs/cooldowns-tab.js";
import { LogsTab } from "./tabs/logs-tab.js";
import { ConfigTab } from "./tabs/config-tab.js";
import { SettingsTab } from "./tabs/settings-tab.js";
import type {
  ConfigPayload,
  CooldownsPayload,
  LogsPayload,
  ProfilesPayload,
  SystemStatus,
} from "../shared/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({}),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  Modal: Object.assign(
    (props: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, props.children),
    { Content: (props: { children?: React.ReactNode }) => props.children }
  ),
  ScrollView: (props: Record<string, unknown>) =>
    React.createElement("host-scroll-view", props, props.children as React.ReactNode),
  TextInput: () => null,
  useToast: () => ({ show: () => {}, error: () => {}, copied: () => {} }),
  copyText: async () => {},
}));

beforeAll(() => {
  initClientHelpers({
    Icon: (props: { name: string }) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(
      (props: { open?: boolean; children?: React.ReactNode }) =>
        props.open ? React.createElement(React.Fragment, null, props.children) : null,
      { Content: (props: { children?: React.ReactNode }) => props.children }
    ) as any,
    useRpc: () => async () => ({}),
    useToast: () => ({ show: () => {}, error: () => {}, copied: () => {} }),
  });
});

function renderWithTheme(children: React.ReactNode) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<HostThemeProvider>{children}</HostThemeProvider>);
  });
  return renderer;
}

describe("DashboardTab", () => {
  it("renders quota health and provider details", () => {
    const mockStatus: SystemStatus = {
      isolationMode: "scoped",
      bwrapVersion: "0.9.0",
      profileOverride: null,
      activeCooldownsCount: 1,
      quotaHealth: "yellow",
      providers: [
        {
          id: "antigravity",
          name: "Google Antigravity",
          profiles: [
            {
              profile: "okt",
              authenticated: true,
              accountIdentity: "okt@test.com",
              pools: [
                { pool: "gemini", state: "HEALTHY" },
                { pool: "claude", state: "COOLDOWN", details: "Resets in 46h" },
              ],
            },
          ],
        },
      ],
    };

    const tree = renderWithTheme(
      <DashboardTab
        status={mockStatus}
        isLoading={false}
        onRefresh={() => {}}
        onProbeProvider={() => {}}
        onNavigateTab={() => {}}
      />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Quota Health");
    expect(text).toContain("Partial Cooldown");
    expect(text).toContain("active cooldown lock(s)");
    expect(text).toContain("Locks");
    expect(text).toContain("SCOPED");
    expect(text).toContain("Bubblewrap 0.9.0");
    expect(text).toContain("Google Antigravity");
    expect(text).toContain("okt");
    expect(text).toContain("okt@test.com");
    expect(text).toContain("gemini: HEALTHY");
    expect(text).toContain("claude: COOLDOWN");
  });
});

describe("ProfilesTab", () => {
  it("renders profile items and handles enable toggle", () => {
    const mockProfiles: ProfilesPayload = {
      isolationMode: "scoped",
      sandboxedWarning: true,
      providers: [
        {
          id: "antigravity",
          name: "Google Antigravity",
          profiles: [
            {
              name: "okt",
              status: "Authenticated",
              accountIdentity: "okt@test.com",
              registered: true,
              directory: "/home/user/.agent-mux/profiles/antigravity/okt",
              enabled: true,
            },
          ],
        },
      ],
    };

    const onToggle = vi.fn();

    const tree = renderWithTheme(
      <ProfilesTab
        profilesData={mockProfiles}
        isLoading={false}
        onRefresh={() => {}}
        onToggleProfile={onToggle}
      />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Active Sandboxed Session Detected");
    expect(text).toContain("Google Antigravity");
    expect(text).toContain("okt");
    expect(text).toContain("Authenticated");
    expect(text).toContain("/home/user/.agent-mux/profiles/antigravity/okt");
  });
});

describe("CooldownsTab", () => {
  it("renders active cooldown locks and empty state", () => {
    const mockCooldowns: CooldownsPayload = {
      totalCount: 1,
      cooldowns: [
        {
          provider: "antigravity",
          profile: "okt",
          pool: "claude",
          remainingSeconds: 3600,
          remainingDisplay: "1h 0m 0s",
          reason: "Rate limit reached",
          resetAt: "2026-10-18T00:00:00.000Z",
        },
      ],
    };

    const onClear = vi.fn();

    const tree = renderWithTheme(
      <CooldownsTab
        cooldownsData={mockCooldowns}
        isLoading={false}
        onRefresh={() => {}}
        onClearCooldown={onClear}
        showLiveCountdown={false}
      />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("antigravity:okt");
    expect(text).toContain("Pool: claude");
    expect(text).toContain("1h 0m 0s");
    expect(text).toContain("Rate limit reached");
  });

  it("renders empty state when no active cooldowns", () => {
    const emptyCooldowns: CooldownsPayload = {
      totalCount: 0,
      cooldowns: [],
    };

    const tree = renderWithTheme(
      <CooldownsTab
        cooldownsData={emptyCooldowns}
        isLoading={false}
        onRefresh={() => {}}
        onClearCooldown={() => {}}
      />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("All Accounts Healthy");
    expect(text).toContain("No active cooldown locks");
  });
});

describe("LogsTab", () => {
  it("renders logs and level badges", () => {
    const mockLogs: LogsPayload = {
      logFile: "/var/log/agent-mux.log",
      entries: [
        {
          raw: "[SUPERVISOR] Failover event",
          timestamp: "2026-10-16T08:00:00Z",
          level: "SUPERVISOR",
          message: "Failing over from puf to okt",
        },
      ],
    };

    const tree = renderWithTheme(
      <LogsTab
        logsData={mockLogs}
        isLoading={false}
        onRefresh={() => {}}
        tailDepth={50}
        onChangeTailDepth={() => {}}
        filterType="ALL"
        onChangeFilterType={() => {}}
      />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Routing & Failover Logs");
    expect(text).toContain("SUPERVISOR");
    expect(text).toContain("Failing over from puf to okt");
  });
});

describe("ConfigTab", () => {
  it("renders global settings and wrapper statuses", () => {
    const mockConfig: ConfigPayload = {
      configFile: "/home/user/.agent-mux/config.json",
      activeSurfaceAccount: "none",
      activeRoutingPolicy: "pool-strict",
      surfaceAccountOverridden: false,
      routingPolicyOverridden: true,
      settings: { sampleKey: "sampleValue" },
      wrappers: [
        {
          binaryName: "agy",
          status: "WRAPPED",
          sourcePath: "/bin/agy",
          targetPath: "/bin/agy.bin",
        },
      ],
    };

    const tree = renderWithTheme(
      <ConfigTab configData={mockConfig} isLoading={false} onRefresh={() => {}} />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("pool-strict (env override)");
    expect(text).toContain("none");
    expect(text).toContain("agy");
    expect(text).toContain("WRAPPED");
    expect(text).toContain("/bin/agy");
    expect(text).toContain("-> /bin/agy.bin");
  });
});

describe("SettingsTab", () => {
  it("renders settings fields and attribution", () => {
    const mockSettings = {
      autoRefreshInterval: 10,
      logTailDepth: 50,
      autoProbeOnLoad: false,
      showLiveCountdown: true,
    };

    const tree = renderWithTheme(
      <SettingsTab settings={mockSettings} onUpdateSettings={() => {}} />
    );

    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Auto-Refresh Interval");
    expect(text).toContain("Log Tail Depth");
    expect(text).toContain("Live Countdown Timer");
    expect(text).toContain("Agent Mux Plugin");
  });
});

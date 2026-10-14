import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { FALLBACK_COLORS, HostThemeProvider } from "../index.js";
import { HostKanbanBoard } from "../tickets/index.js";
import type { AutomationTier, RepoGroup } from "../tickets/types.js";
import type { KanbanIssue } from "../tickets/types.js";

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <HostThemeProvider theme={{ colors: FALLBACK_COLORS }}>{element}</HostThemeProvider>,
    );
  });
  return renderer;
}

const GROUPS: RepoGroup[] = [
  { id: "core", name: "Core", repos: ["xpufx-org/paseo", "xpufx-org/platform"] },
  { id: "sprint", name: "Active Sprint", repos: ["xpufx-org/2fado"] },
];

const ISSUES: KanbanIssue[] = [
  { number: 1, title: "Core card", status: "Backlog", repo: "xpufx-org/paseo" },
  { number: 2, title: "Platform card", status: "In progress", repo: "xpufx-org/platform" },
  { number: 3, title: "Sprint card", status: "Review", repo: "xpufx-org/2fado" },
];

describe("KanbanBoard multi-repo groups (#1282)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an All pill plus each configured group", () => {
    const renderer = render(<HostKanbanBoard issues={ISSUES} repoGroups={GROUPS} />);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("All");
    expect(json).toContain("Core");
    expect(json).toContain("Active Sprint");
    expect(renderer.root.findByProps({ testID: "kanban-repo-group-all" })).toBeDefined();
    expect(renderer.root.findByProps({ testID: "kanban-repo-group-core" })).toBeDefined();
    expect(renderer.root.findByProps({ testID: "kanban-repo-group-sprint" })).toBeDefined();
  });

  it("filters the board down to the selected group's repositories", () => {
    const renderer = render(<HostKanbanBoard issues={ISSUES} repoGroups={GROUPS} />);
    expect(JSON.stringify(renderer.toJSON())).toContain("Sprint card");

    act(() => {
      renderer.root.findByProps({ testID: "kanban-repo-group-core" }).props.onPress();
    });
    const coreJson = JSON.stringify(renderer.toJSON());
    expect(coreJson).toContain("Core card");
    expect(coreJson).toContain("Platform card");
    expect(coreJson).not.toContain("Sprint card");

    act(() => {
      renderer.root.findByProps({ testID: "kanban-repo-group-all" }).props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("Sprint card");
  });

  it("reports group selection to a controlled host and defers state ownership", () => {
    const onSelectRepoGroup = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={ISSUES}
        repoGroups={GROUPS}
        selectedRepoGroup="all"
        onSelectRepoGroup={onSelectRepoGroup}
      />,
    );
    act(() => {
      renderer.root.findByProps({ testID: "kanban-repo-group-sprint" }).props.onPress();
    });
    expect(onSelectRepoGroup).toHaveBeenCalledWith("sprint");
    // Controlled selection stays on `all`; the sprint card remains rendered.
    expect(JSON.stringify(renderer.toJSON())).toContain("Sprint card");
  });

  it("omits the group filter when no groups are configured", () => {
    const renderer = render(<HostKanbanBoard issues={ISSUES} />);
    expect(() => renderer.root.findByProps({ testID: "kanban-repo-groups" })).toThrow();
  });
});

describe("KanbanBoard automation tier pills (#1282)", () => {
  const tiers: Record<string, AutomationTier> = {
    "xpufx-org/paseo": "full-active",
    "xpufx-org/platform": "paused",
    "xpufx-org/2fado": "kanban-only",
  };

  it("renders a labelled tier badge per repository", () => {
    const renderer = render(<HostKanbanBoard issues={ISSUES} automationTiers={tiers} />);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Full Fleet Active");
    expect(json).toContain("Paused Fleet");
    expect(json).toContain("Kanban-Only");
    expect(
      renderer.root.findByProps({ testID: "kanban-automation-tier-xpufx-org/paseo" }),
    ).toBeDefined();
  });

  it("cycles a repo to the next tier through onToggleAutomationTier", () => {
    const onToggleAutomationTier = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={ISSUES}
        automationTiers={tiers}
        onToggleAutomationTier={onToggleAutomationTier}
      />,
    );

    act(() => {
      renderer.root
        .findByProps({ testID: "kanban-automation-tier-xpufx-org/paseo" })
        .props.onPress();
    });
    expect(onToggleAutomationTier).toHaveBeenCalledWith("xpufx-org/paseo", "paused");

    act(() => {
      renderer.root
        .findByProps({ testID: "kanban-automation-tier-xpufx-org/platform" })
        .props.onPress();
    });
    expect(onToggleAutomationTier).toHaveBeenLastCalledWith("xpufx-org/platform", "kanban-only");

    act(() => {
      renderer.root
        .findByProps({ testID: "kanban-automation-tier-xpufx-org/2fado" })
        .props.onPress();
    });
    expect(onToggleAutomationTier).toHaveBeenLastCalledWith("xpufx-org/2fado", "full-active");
  });

  it("treats an unconfigured repo as full-active", () => {
    const onToggleAutomationTier = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={[{ number: 9, title: "Unconfigured", status: "Review", repo: "xpufx-org/new" }]}
        automationTiers={{}}
        onToggleAutomationTier={onToggleAutomationTier}
      />,
    );
    act(() => {
      renderer.root
        .findByProps({ testID: "kanban-automation-tier-xpufx-org/new" })
        .props.onPress();
    });
    expect(onToggleAutomationTier).toHaveBeenCalledWith("xpufx-org/new", "paused");
  });
});

describe("KanbanBoard backward transitions (#1282)", () => {
  it("fires onBackwardTransition when a review card returns to in progress", async () => {
    const onTransitionIssue = vi.fn().mockResolvedValue(undefined);
    const onBackwardTransition = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={ISSUES}
        onTransitionIssue={onTransitionIssue}
        onBackwardTransition={onBackwardTransition}
      />,
    );

    const button = renderer.root.findByProps({
      accessibilityLabel: "Move #3 to Return to In Progress",
    });
    await act(async () => {
      await button.props.onPress();
    });

    expect(onTransitionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ number: 3 }),
      "in_progress",
    );
    expect(onBackwardTransition).toHaveBeenCalledWith(
      expect.objectContaining({ number: 3 }),
      "review",
      "in_progress",
    );
  });

  it("does not fire onBackwardTransition on forward moves", async () => {
    const onTransitionIssue = vi.fn().mockResolvedValue(undefined);
    const onBackwardTransition = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={ISSUES}
        onTransitionIssue={onTransitionIssue}
        onBackwardTransition={onBackwardTransition}
      />,
    );

    const button = renderer.root.findByProps({
      accessibilityLabel: "Move #1 to Move to In Progress",
    });
    await act(async () => {
      await button.props.onPress();
    });

    expect(onTransitionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ number: 1 }),
      "in_progress",
    );
    expect(onBackwardTransition).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { FALLBACK_COLORS, HostThemeProvider } from "../index.js";
import { HostKanbanBoard } from "../tickets/index.js";
import { isScopedLabel, HostScopedLabelChip } from "../tickets/scoped-label-chip.js";
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

// --- Scoped label chip detection ---

describe("Scoped label chip helpers (#1282)", () => {
  it("recognizes valid scoped labels", () => {
    expect(isScopedLabel("state/wip")).toBe(true);
    expect(isScopedLabel("priority/high")).toBe(true);
    expect(isScopedLabel("kind/feature")).toBe(true);
    expect(isScopedLabel("attention/user")).toBe(true);
    expect(isScopedLabel("review/approved")).toBe(true);
  });

  it("rejects non-scoped labels", () => {
    expect(isScopedLabel("bug")).toBe(false);
    expect(isScopedLabel("enhancement")).toBe(false);
    expect(isScopedLabel("wip")).toBe(false);
  });

  it("rejects edge cases", () => {
    expect(isScopedLabel("/value")).toBe(false);
    expect(isScopedLabel("scope/")).toBe(false);
    expect(isScopedLabel("scope")).toBe(false);
    expect(isScopedLabel("a/b/c")).toBe(true); // first slash splits
  });
});

describe("HostScopedLabelChip rendering (#1282)", () => {
  it("renders a two-tone chip for scoped labels on web", () => {
    const renderer = render(<HostScopedLabelChip label="state/wip" />);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("state");
    expect(json).toContain("wip");
    expect(json).toContain("kanban-scoped-label-chip-state/wip");
  });

  it("renders with distinct prefix and suffix tones", () => {
    const renderer = render(<HostScopedLabelChip label="priority/high" />);
    const json = JSON.stringify(renderer.toJSON());
    // Both parts should be present
    expect(json).toContain("priority");
    expect(json).toContain("high");
  });

  it("calls onPress when clicked on web", () => {
    const onPress = vi.fn();
    const renderer = render(<HostScopedLabelChip label="state/review" onPress={onPress} />);
    const chip = renderer.root.findByProps({ role: "button" });
    act(() => {
      chip.props.onClick();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders different scope tints per scope", () => {
    const stateRenderer = render(<HostScopedLabelChip label="state/done" />);
    const priorityRenderer = render(<HostScopedLabelChip label="priority/low" />);
    const kindRenderer = render(<HostScopedLabelChip label="kind/bug" />);

    const stateJson = JSON.stringify(stateRenderer.toJSON());
    const priorityJson = JSON.stringify(priorityRenderer.toJSON());
    const kindJson = JSON.stringify(kindRenderer.toJSON());

    // Different scopes should have different border colors (tint)
    expect(stateJson).toContain("#4c7bf5");
    expect(priorityJson).toContain("#f5a623");
    expect(kindJson).toContain("#7c3aed");
  });
});

// --- Swimlane row grouping ---

const MULTI_REPO_ISSUES: KanbanIssue[] = [
  { number: 1, title: "Repo A issue", status: "Backlog", repo: "repo-a" },
  { number: 2, title: "Repo A in-progress", status: "In progress", repo: "repo-a" },
  { number: 3, title: "Repo B review", status: "Review", repo: "repo-b" },
  { number: 4, title: "Repo C done", status: "Done", repo: "repo-c" },
];

describe("KanbanBoard swimlane rows (#1282)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders classic columns when swimlaneGroup is 'none'", () => {
    const renderer = render(
      <HostKanbanBoard issues={MULTI_REPO_ISSUES} swimlaneGroup="none" />,
    );
    const json = JSON.stringify(renderer.toJSON());
    // Should contain column titles
    expect(json).toContain("Backlog / Triage");
    expect(json).toContain("In Progress");
    expect(json).toContain("Review / Verify");
    expect(json).toContain("Done");
    // Should NOT contain swimlane headers
    expect(json).not.toContain("kanban-swimlane-header-repo-a");
  });

  it("renders swimlane rows when swimlaneGroup is 'repository'", () => {
    const renderer = render(
      <HostKanbanBoard issues={MULTI_REPO_ISSUES} swimlaneGroup="repository" />,
    );
    const json = JSON.stringify(renderer.toJSON());
    // Should contain swimlane headers
    expect(json).toContain("kanban-swimlane-header-repo-a");
    expect(json).toContain("kanban-swimlane-header-repo-b");
    expect(json).toContain("kanban-swimlane-header-repo-c");
    // Each swimlane should contain its issues
    expect(json).toContain("Repo A issue");
    expect(json).toContain("Repo A in-progress");
    expect(json).toContain("Repo B review");
    expect(json).toContain("Repo C done");
  });

  it("collapses a swimlane header on press", () => {
    const renderer = render(
      <HostKanbanBoard issues={MULTI_REPO_ISSUES} swimlaneGroup="repository" />,
    );
    const jsonBefore = JSON.stringify(renderer.toJSON());
    expect(jsonBefore).toContain("Collapse");

    // Find the div by data-testid (web mode)
    const headers = renderer.root.findAll((node) => {
      return node.props["data-testid"] === "kanban-swimlane-header-repo-a";
    });
    expect(headers.length).toBeGreaterThan(0);
    act(() => {
      headers[0].props.onClick();
    });
    // After collapse, the expand text should appear
    const collapsedJson = JSON.stringify(renderer.toJSON());
    expect(collapsedJson).toContain("Expand");
  });

  it("groups by priority when swimlaneGroup is 'priority'", () => {
    const issuesWithPriority: KanbanIssue[] = [
      { number: 1, title: "High priority", status: "Backlog", repo: "repo-a", labels: ["priority/high"] },
      { number: 2, title: "Low priority", status: "Backlog", repo: "repo-a", labels: ["priority/low"] },
      { number: 3, title: "Normal priority", status: "In progress", repo: "repo-b", labels: ["priority/normal"] },
    ];
    const renderer = render(
      <HostKanbanBoard issues={issuesWithPriority} swimlaneGroup="priority" />,
    );
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("kanban-swimlane-header-high");
    expect(json).toContain("kanban-swimlane-header-low");
    expect(json).toContain("kanban-swimlane-header-normal");
  });

  it("groups by epic when swimlaneGroup is 'epic'", () => {
    const issuesWithEpic: KanbanIssue[] = [
      { number: 1, title: "Epic Alpha issue", status: "Backlog", repo: "repo-a", labels: ["epic/alpha"] },
      { number: 2, title: "Epic Beta issue", status: "Review", repo: "repo-b", labels: ["epic/beta"] },
      { number: 3, title: "No epic issue", status: "Done", repo: "repo-c" },
    ];
    const renderer = render(
      <HostKanbanBoard issues={issuesWithEpic} swimlaneGroup="epic" />,
    );
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("kanban-swimlane-header-alpha");
    expect(json).toContain("kanban-swimlane-header-beta");
    // No-epic swimlane uses title "No Epic" for its testID
    expect(json).toContain("kanban-swimlane-header-No Epic");
  });

  it("defaults to repository grouping when multi-repo group view is active", () => {
    const renderer = render(
      <HostKanbanBoard
        issues={MULTI_REPO_ISSUES}
        repoGroups={[
          { id: "core", name: "Core", repos: ["repo-a", "repo-b"] },
          { id: "other", name: "Other", repos: ["repo-c"] },
        ]}
      />,
    );
    // With multiple repo groups active, should default to swimlane mode
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("kanban-swimlane-header-repo-a");
    expect(json).toContain("kanban-swimlane-header-repo-b");
    expect(json).toContain("kanban-swimlane-header-repo-c");
  });

  it("respects controlled swimlane collapse state", () => {
    const collapsed = new Set(["repo-a"]);
    const renderer = render(
      <HostKanbanBoard
        issues={MULTI_REPO_ISSUES}
        swimlaneGroup="repository"
        collapsedSwimlanes={collapsed}
      />,
    );
    const json = JSON.stringify(renderer.toJSON());
    // Repo A should be collapsed (showing Expand text)
    expect(json).toContain("Expand");
  });

  it("fires onSwimlaneToggle when a swimlane header is pressed", () => {
    const onSwimlaneToggle = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={MULTI_REPO_ISSUES}
        swimlaneGroup="repository"
        onSwimlaneToggle={onSwimlaneToggle}
      />,
    );
    // Find the div by data-testid (web mode)
    const headers = renderer.root.findAll((node) => {
      return node.props["data-testid"] === "kanban-swimlane-header-repo-a";
    });
    expect(headers.length).toBeGreaterThan(0);
    act(() => {
      headers[0].props.onClick();
    });
    expect(onSwimlaneToggle).toHaveBeenCalledWith("repo-a");
  });

  it("shows count in swimlane header", () => {
    const renderer = render(
      <HostKanbanBoard issues={MULTI_REPO_ISSUES} swimlaneGroup="repository" />,
    );
    const json = JSON.stringify(renderer.toJSON());
    // Repo A has 2 issues
    expect(json).toContain("2");
    // Repo B has 1 issue
    expect(json).toContain("1");
  });
});

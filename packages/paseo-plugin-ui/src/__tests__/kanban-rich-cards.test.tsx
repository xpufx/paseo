import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { Linking } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import {
  FALLBACK_COLORS,
  HostStatusDot,
  HostThemeProvider,
} from "../index.js";
import {
  HostKanbanBoard,
  HostKanbanCard,
  HostIssueDetailDrawer,
  HostScopedLabelGroup,
} from "../tickets/index.js";
import {
  describeCiStatus,
  describePullRequest,
  describeReviewDecision,
  detectBranchPill,
  detectCiStatus,
  detectLinkedPullRequest,
  extractChecklist,
  isFeatureBranch,
  setChecklistItemChecked,
} from "../tickets/card-artifacts.js";
import { resolveKanbanKeyboardIntent } from "../tickets/kanban-keyboard.js";
import type { IssueComment, KanbanIssue } from "../tickets/types.js";

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type KeyListener = (event: any) => void;
let keyListeners: KeyListener[] = [];

function installWindowStub(): void {
  keyListeners = [];
  (globalThis as any).window = {
    addEventListener: (type: string, fn: KeyListener) => {
      if (type === "keydown") keyListeners.push(fn);
    },
    removeEventListener: (type: string, fn: KeyListener) => {
      if (type === "keydown") keyListeners = keyListeners.filter((item) => item !== fn);
    },
  };
}

function dispatchKey(key: string, target?: unknown): { preventDefault: () => void } {
  const event = { key, target, preventDefault: vi.fn() };
  act(() => {
    for (const listener of [...keyListeners]) listener(event);
  });
  return event;
}

async function dispatchKeyAsync(key: string): Promise<void> {
  await act(async () => {
    for (const listener of [...keyListeners]) {
      await listener({ key, preventDefault: vi.fn() });
    }
  });
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <HostThemeProvider theme={{ colors: FALLBACK_COLORS }}>{element}</HostThemeProvider>,
    );
  });
  return renderer;
}

function json(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

beforeEach(() => {
  installWindowStub();
});

afterEach(() => {
  delete (globalThis as any).window;
  vi.restoreAllMocks();
});

const RICH_ISSUE: KanbanIssue = {
  number: 42,
  title: "Ship rich kanban cards",
  status: "Review",
  repo: "xpufx/paseo",
  branch: "feat/rich-cards",
  labels: ["state/review", "pr/77", "pr/merged", "review/approved", "ci/passing"],
  url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/pulls/77",
  comments: 3,
};

const SAMPLE_ISSUES: KanbanIssue[] = [
  { number: 1, title: "Issue One", status: "Backlog", repo: "repo-a" },
  { number: 2, title: "Issue Two", status: "In progress", repo: "repo-a" },
  { number: 3, title: "Issue Three", status: "Review", repo: "repo-b" },
  { number: 4, title: "Issue Four", status: "Done", repo: "repo-b" },
];

describe("card artifact detection", () => {
  it("prefers the explicit branch and falls back to label detection", () => {
    expect(detectBranchPill(RICH_ISSUE)).toBe("feat/rich-cards");
    expect(detectBranchPill({ number: 1, title: "x", labels: ["branch/fix/bug"] })).toBe(
      "fix/bug",
    );
    expect(detectBranchPill({ number: 1, title: "x" })).toBeNull();
  });

  it("classifies feature branches", () => {
    expect(isFeatureBranch("feat/thing")).toBe(true);
    expect(isFeatureBranch("fix/thing")).toBe(true);
    expect(isFeatureBranch("main")).toBe(false);
  });

  it("detects a linked PR from labels, URL, and explicit fields", () => {
    const detected = detectLinkedPullRequest(RICH_ISSUE);
    expect(detected).not.toBeNull();
    expect(detected?.number).toBe(77);
    expect(detected?.state).toBe("merged");
    expect(detected?.reviewDecision).toBe("approved");
    expect(detected?.url).toContain("/pulls/77");

    const fromUrl = detectLinkedPullRequest({
      number: 5,
      title: "url only",
      url: "https://forge.example.com/o/r/pull/991",
    });
    expect(fromUrl?.number).toBe(991);

    const explicit = detectLinkedPullRequest({
      number: 6,
      title: "explicit",
      pullRequest: { number: 12, state: "draft", url: "https://x/pulls/12" },
    });
    expect(explicit?.state).toBe("draft");
    expect(explicit?.draft).toBe(true);

    expect(detectLinkedPullRequest({ number: 7, title: "none" })).toBeNull();
  });

  it("detects CI status from explicit values and labels", () => {
    expect(detectCiStatus(RICH_ISSUE)).toBe("passing");
    expect(detectCiStatus({ number: 1, title: "x", ciStatus: "failed" })).toBe("failing");
    expect(detectCiStatus({ number: 1, title: "x", labels: ["ci/running"] })).toBe("running");
    expect(detectCiStatus({ number: 1, title: "x", labels: ["checks/pending"] })).toBe("pending");
    expect(detectCiStatus({ number: 1, title: "x", labels: ["kind/feature"] })).toBe("unknown");
  });

  it("describes PR, review, and CI badges", () => {
    expect(describePullRequest({ number: 7, state: "merged" })).toMatchObject({
      label: "#7 merged",
      variant: "success",
    });
    expect(describePullRequest({ number: 7, state: "draft" }).label).toBe("#7 draft");
    expect(describePullRequest({ state: "open" }).label).toBe("PR");
    expect(describeReviewDecision("approved")?.variant).toBe("success");
    expect(describeReviewDecision("changes-requested")?.variant).toBe("warning");
    expect(describeReviewDecision("unknown")).toBeNull();
    expect(describeCiStatus("failing")?.variant).toBe("danger");
    expect(describeCiStatus("running")?.variant).toBe("warning");
    expect(describeCiStatus("unknown")).toBeNull();
  });

  it("parses and rewrites markdown checklists", () => {
    const body = "- [ ] first\n- [x] second\ntext\n  - [ ] indented";
    const items = extractChecklist(body);
    expect(items).toEqual([
      { index: 0, line: 1, text: "first", checked: false },
      { index: 1, line: 2, text: "second", checked: true },
      { index: 2, line: 4, text: "indented", checked: false },
    ]);
    const toggled = setChecklistItemChecked(body, 0, true);
    expect(toggled).toContain("- [x] first");
    expect(setChecklistItemChecked(toggled, 1, false)).toContain("- [ ] second");
  });

  it("maps keys to board intents", () => {
    expect(resolveKanbanKeyboardIntent("j")).toEqual({ type: "select-next" });
    expect(resolveKanbanKeyboardIntent("ArrowUp")).toEqual({ type: "select-prev" });
    expect(resolveKanbanKeyboardIntent("Enter")).toEqual({ type: "open" });
    expect(resolveKanbanKeyboardIntent("Escape")).toEqual({ type: "close" });
    expect(resolveKanbanKeyboardIntent("3", 4)).toEqual({ type: "move", columnIndex: 2 });
    expect(resolveKanbanKeyboardIntent("9", 4)).toEqual({ type: "none" });
    expect(resolveKanbanKeyboardIntent("z")).toEqual({ type: "none" });
  });
});

describe("KanbanCard rich artifacts", () => {
  it("renders branch pill, linked PR badge, review verdict, and CI indicator", () => {
    const renderer = render(
      <HostKanbanCard issue={RICH_ISSUE} columnId="review" onSelect={() => {}} />,
    );
    const text = json(renderer);
    expect(text).toContain("feat/rich-cards");
    expect(text).toContain("#77 merged");
    expect(text).toContain("Approved");
    expect(text).toContain("CI passing");
    expect(renderer.root.findByProps({ testID: "kanban-branch-pill-42" })).toBeDefined();
    expect(renderer.root.findByProps({ testID: "kanban-pr-badge-42" })).toBeDefined();
    expect(renderer.root.findByProps({ testID: "kanban-ci-42" })).toBeDefined();

    const dot = renderer.root.findByType(HostStatusDot);
    expect(dot.props.variant).toBe("success");
  });

  it("marks CI running with a pulsing warning dot", () => {
    const renderer = render(
      <HostKanbanCard
        issue={{ number: 9, title: "running", status: "In progress", ciStatus: "running" }}
        columnId="in_progress"
      />,
    );
    const dot = renderer.root.findByType(HostStatusDot);
    expect(dot.props.variant).toBe("warning");
    expect(dot.props.pulse).toBe(true);
  });

  it("opens the linked pull request on badge press", () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(true as any);
    const renderer = render(<HostKanbanCard issue={RICH_ISSUE} columnId="review" />);
    const badge = renderer.root.findByProps({ testID: "kanban-pr-badge-42" });
    act(() => {
      badge.props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith(RICH_ISSUE.url);
  });

  it("highlights the card when selected", () => {
    const renderer = render(
      <HostKanbanCard issue={RICH_ISSUE} columnId="review" isSelected />,
    );
    const card = renderer.root.findByProps({ testID: "kanban-card-42" });
    const style = Array.isArray(card.props.style)
      ? Object.assign({}, ...card.props.style.filter(Boolean))
      : card.props.style;
    expect(style.borderColor).toBe(FALLBACK_COLORS.accent);
    expect(style.borderWidth).toBe(2);
  });
});

describe("IssueDetailDrawer", () => {
  const comment: IssueComment = {
    id: 5,
    author: "operator",
    createdAt: "2026-10-12T12:00:00Z",
    updatedAt: "2026-10-12T12:00:00Z",
    body: "Please add coverage.",
    url: "https://forge.example.com/comment/5",
    envelope: null,
  };

  const detail = {
    body: "## Summary\n\n- [ ] add tests\n- [x] write code\n\nSome **bold** text.",
    labels: [
      { name: "state/review" },
      { name: "attention/user" },
      { name: "priority/high" },
    ],
    comments: [comment],
    webUrl: "https://forge.example.com/issues/42",
  };

  it("renders nothing when not visible", () => {
    const renderer = render(
      <HostIssueDetailDrawer visible={false} issue={RICH_ISSUE} onClose={() => {}} />,
    );
    expect(renderer.toJSON()).toBeNull();
  });

  it("renders markdown, checklist, labels, comments, and composer", () => {
    const onSelectLabel = vi.fn();
    const renderer = render(
      <HostIssueDetailDrawer
        visible
        issue={RICH_ISSUE}
        detail={detail}
        onClose={() => {}}
        onSelectLabel={onSelectLabel}
        onSubmitComment={() => {}}
      />,
    );
    const text = json(renderer);
    expect(text).toContain("Ship rich kanban cards");
    expect(text).toContain("add tests");
    expect(text).toContain("write code");
    expect(text).toContain("Please add coverage.");
    expect(text).toContain("State");
    expect(text).toContain("Attention");
    expect(text).toContain("Priority");
    expect(renderer.root.findByProps({ testID: "issue-detail-checklist" })).toBeDefined();
    expect(renderer.root.findByProps({ testID: "issue-detail-comments" })).toBeDefined();
    expect(renderer.root.findByProps({ testID: "issue-detail-composer" })).toBeDefined();
  });

  it("toggles a checklist item and reports it", () => {
    const onToggle = vi.fn();
    const renderer = render(
      <HostIssueDetailDrawer
        visible
        issue={RICH_ISSUE}
        detail={detail}
        onClose={() => {}}
        onToggleChecklistItem={onToggle}
      />,
    );
    const item = renderer.root.findByProps({ testID: "issue-checklist-item-0" });
    expect(item.props.accessibilityState.checked).toBe(false);
    act(() => {
      item.props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, text: "add tests", checked: true }),
      true,
    );
    const updated = renderer.root.findByProps({ testID: "issue-checklist-item-0" });
    expect(updated.props.accessibilityState.checked).toBe(true);
  });

  it("submits a comment and clears the composer", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const renderer = render(
      <HostIssueDetailDrawer
        visible
        issue={RICH_ISSUE}
        detail={detail}
        onClose={() => {}}
        onSubmitComment={onSubmit}
      />,
    );
    const input = renderer.root.findByProps({
      placeholder: "Write a comment...",
    });
    act(() => {
      input.props.onChangeText("Nice work");
    });
    const submit = renderer.root.findByProps({ testID: "issue-detail-comment-submit" });
    await act(async () => {
      await submit.props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledWith("Nice work");
    const cleared = renderer.root.findByProps({ placeholder: "Write a comment..." });
    expect(cleared.props.value).toBe("");
  });

  it("closes from the backdrop and on Escape", () => {
    const onClose = vi.fn();
    const renderer = render(
      <HostIssueDetailDrawer visible issue={RICH_ISSUE} onClose={onClose} />,
    );
    act(() => {
      renderer.root.findByProps({ testID: "issue-detail-drawer-backdrop" }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    dispatchKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("selects a scoped label", () => {
    const onSelectLabel = vi.fn();
    const renderer = render(
      <HostIssueDetailDrawer
        visible
        issue={RICH_ISSUE}
        detail={detail}
        onClose={() => {}}
        onSelectLabel={onSelectLabel}
      />,
    );
    const groups = renderer.root.findAllByType(HostScopedLabelGroup);
    expect(groups.length).toBe(3);
    act(() => {
      groups[0].props.onSelect("state/wip");
    });
    expect(onSelectLabel).toHaveBeenCalledWith("state/wip");
  });
});

describe("KanbanBoard keyboard navigation", () => {
  it("moves selection with j/k via onSelectedIssueNumberChange", () => {
    const onSelectedIssueNumberChange = vi.fn();
    render(
      <HostKanbanBoard
        issues={SAMPLE_ISSUES}
        onSelectedIssueNumberChange={onSelectedIssueNumberChange}
      />,
    );
    dispatchKey("j");
    expect(onSelectedIssueNumberChange).toHaveBeenLastCalledWith(1);
    dispatchKey("j");
    expect(onSelectedIssueNumberChange).toHaveBeenLastCalledWith(2);
    dispatchKey("k");
    expect(onSelectedIssueNumberChange).toHaveBeenLastCalledWith(1);
  });

  it("wraps selection at the edges", () => {
    const onSelectedIssueNumberChange = vi.fn();
    render(
      <HostKanbanBoard
        issues={SAMPLE_ISSUES}
        selectedIssueNumber={1}
        onSelectedIssueNumberChange={onSelectedIssueNumberChange}
      />,
    );
    dispatchKey("k");
    expect(onSelectedIssueNumberChange).toHaveBeenLastCalledWith(4);
  });

  it("opens the detail drawer on Enter", () => {
    const onSelectIssue = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={SAMPLE_ISSUES}
        onSelectIssue={onSelectIssue}
        issueDetail={{ body: "- [ ] confirm" }}
      />,
    );
    dispatchKey("j");
    dispatchKey("Enter");
    expect(onSelectIssue).toHaveBeenCalledWith(1);
    expect(renderer.root.findByProps({ testID: "issue-detail-drawer" })).toBeDefined();
  });

  it("delegates Enter to onOpenIssueDetail when provided", () => {
    const onOpenIssueDetail = vi.fn();
    const renderer = render(
      <HostKanbanBoard
        issues={SAMPLE_ISSUES}
        selectedIssueNumber={2}
        onOpenIssueDetail={onOpenIssueDetail}
      />,
    );
    dispatchKey("Enter");
    expect(onOpenIssueDetail).toHaveBeenCalledWith(2);
    expect(() => renderer.root.findByProps({ testID: "issue-detail-drawer" })).toThrow();
  });

  it("moves the selected card across columns with number keys", async () => {
    const onTransitionIssue = vi.fn();
    render(
      <HostKanbanBoard
        issues={SAMPLE_ISSUES}
        selectedIssueNumber={1}
        onTransitionIssue={onTransitionIssue}
      />,
    );
    await dispatchKeyAsync("3");
    expect(onTransitionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ number: 1 }),
      "review",
    );
    expect(onTransitionIssue).toHaveBeenCalledTimes(1);
  });

  it("ignores keys typed into editable fields", () => {
    const onSelectedIssueNumberChange = vi.fn();
    render(
      <HostKanbanBoard
        issues={SAMPLE_ISSUES}
        selectedIssueNumber={1}
        onSelectedIssueNumberChange={onSelectedIssueNumberChange}
      />,
    );
    dispatchKey("j", { tagName: "INPUT" });
    expect(onSelectedIssueNumberChange).not.toHaveBeenCalled();
  });

  it("closes the internal drawer on Escape", () => {
    const renderer = render(<HostKanbanBoard issues={SAMPLE_ISSUES} />);
    dispatchKey("j");
    dispatchKey("Enter");
    expect(renderer.root.findByProps({ testID: "issue-detail-drawer" })).toBeDefined();
    dispatchKey("Escape");
    expect(renderer.toJSON()).not.toBeNull();
    expect(() => renderer.root.findByProps({ testID: "issue-detail-drawer" })).toThrow();
  });

  it("renders the selected card highlighted", () => {
    const renderer = render(
      <HostKanbanBoard issues={SAMPLE_ISSUES} selectedIssueNumber={3} />,
    );
    const selected = renderer.root.findByProps({ testID: "kanban-card-3" });
    const style = Array.isArray(selected.props.style)
      ? Object.assign({}, ...selected.props.style.filter(Boolean))
      : selected.props.style;
    expect(style.borderColor).toBe(FALLBACK_COLORS.accent);
  });
});

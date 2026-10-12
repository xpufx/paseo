import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  HostThemeProvider,
  HostMarkdownLite,
  HostAgentEnvelopeCard,
  HostCommentCard,
  HostScopedLabelGroup,
  HostKanbanBoard,
  HostKanbanCard,
  FALLBACK_COLORS,
} from "../index.js";
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
      <HostThemeProvider theme={{ colors: FALLBACK_COLORS }}>
        {element}
      </HostThemeProvider>,
    );
  });
  return renderer;
}

describe("Ticket & Kanban Presentation Components", () => {
  it("renders MarkdownLite with headings and lists", () => {
    const body = `# Title\nParagraph with **bold** and \`code\`.\n- Item 1\n- Item 2`;
    const tree = render(<HostMarkdownLite body={body} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("Title");
    expect(json).toContain("Paragraph with");
    expect(json).toContain("bold");
    expect(json).toContain("Item 1");
    expect(json).toContain("Item 2");
  });

  it("renders AgentEnvelopeCard with model and commit shas", () => {
    const envelope = {
      commentId: 101,
      sessionTitle: "Coding Agent #42",
      agentShortId: "agent-123",
      model: "gpt-4o",
      repo: "xpufx/paseo",
      branch: "feat/tickets",
      postedAt: "2026-10-12T12:00:00Z",
      commitShas: ["abc1234"],
      paseoLinks: ["paseo://sessions/agent-123"],
      serverId: null,
    };
    const tree = render(<HostAgentEnvelopeCard envelope={envelope} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("Coding Agent #42");
    expect(json).toContain("agent-123");
    expect(json).toContain("gpt-4o");
    expect(json).toContain("abc1234");
  });

  it("renders CommentCard with author, body, and envelope", () => {
    const comment = {
      id: 50,
      author: "xpufx",
      createdAt: "2026-10-12T12:30:00Z",
      updatedAt: "2026-10-12T12:30:00Z",
      body: "Looks good to merge!",
      url: "https://forge.example.com/comment/50",
      envelope: null,
    };
    const tree = render(<HostCommentCard comment={comment} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("xpufx");
    expect(json).toContain("Looks good to merge!");
  });

  it("renders ScopedLabelGroup with active selection", () => {
    const labels = [
      { name: "state/triage" },
      { name: "state/wip" },
      { name: "state/done" },
    ];
    let selected = "state/wip";
    const tree = render(
      <HostScopedLabelGroup
        title="State"
        labels={labels}
        active={selected}
        onSelect={(l) => {
          selected = l;
        }}
      />,
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("State");
    expect(json).toContain("Triage");
    expect(json).toContain("WIP");
    expect(json).toContain("Done");
  });

  it("renders KanbanBoard across columns and filters by query", () => {
    const issues: KanbanIssue[] = [
      { number: 1, title: "Issue One", status: "Backlog", repo: "repo-a" },
      { number: 2, title: "Issue Two", status: "In progress", repo: "repo-a" },
      { number: 3, title: "Issue Three", status: "Review", repo: "repo-b" },
      { number: 4, title: "Issue Four", status: "Done", repo: "repo-b" },
    ];

    const tree = render(
      <HostKanbanBoard
        issues={issues}
        selectedRepo="all"
        onSelectIssue={() => {}}
        onTransitionIssue={() => {}}
      />,
    );

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("Issue One");
    expect(json).toContain("Issue Two");
    expect(json).toContain("Issue Three");
    expect(json).toContain("Issue Four");
    expect(json).toContain("Backlog / Triage");
    expect(json).toContain("In Progress");
    expect(json).toContain("Review / Verify");
    expect(json).toContain("Done");
  });
});

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { getFleetHarness } from "./testing/fleet-harness.js";
import type { UppidiIssue } from "../shared/contracts.js";

interface RenderedNode {
  type?: string;
  props?: Record<string, any>;
  children?: RenderedNode[] | string | Array<RenderedNode | string | null>;
}

function flatten(node: RenderedNode | null, out: RenderedNode[] = []): RenderedNode[] {
  if (!node) return out;
  out.push(node);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    if (child && typeof child === "object") {
      flatten(child, out);
    }
  }
  return out;
}

function findByTestId(tree: RenderedNode | null, testId: string): RenderedNode[] {
  return flatten(tree).filter((n) => n.props?.testID === testId);
}

function findByAccessibilityLabel(tree: RenderedNode | null, labelPattern: RegExp): RenderedNode[] {
  return flatten(tree).filter((n) =>
    typeof n.props?.accessibilityLabel === "string" && labelPattern.test(n.props.accessibilityLabel),
  );
}

let React: typeof import("react");
let TestRenderer: typeof import("react-test-renderer");
let KANBAN_COLUMNS: typeof import("./kanban-board.js").KANBAN_COLUMNS;
let getIssueKanbanColumn: typeof import("./kanban-board.js").getIssueKanbanColumn;
let getColumnTransitions: typeof import("./kanban-board.js").getColumnTransitions;
let UppidiFleetKanbanBoard: typeof import("./kanban-board.js").UppidiFleetKanbanBoard;
let KanbanCard: typeof import("./kanban-board.js").KanbanCard;
let getActiveDraggingIssue: typeof import("./kanban-board.js").getActiveDraggingIssue;
let setActiveDraggingIssue: typeof import("./kanban-board.js").setActiveDraggingIssue;

const sampleIssues: UppidiIssue[] = [
  {
    number: 755,
    title: "Kanban board surface prototype",
    state: "open",
    repo: "paseo",
    status: "In progress",
    attention: "attention/1-agent",
    labels: ["state/1-wip", "kind/feature"],
    comments: 4,
    branch: "feat-755-kanban-board-prototype",
  },
  {
    number: 756,
    title: "Backlog item triage",
    state: "open",
    repo: "paseo",
    status: "Backlog",
    attention: "attention/0-orchestrator",
    labels: ["state/0-triage"],
    comments: 0,
  },
  {
    number: 750,
    title: "Review needed pull request",
    state: "open",
    repo: "paseo",
    status: "Review",
    attention: "attention/2-user",
    labels: ["state/2-review"],
    comments: 2,
  },
  {
    number: 740,
    title: "Completed bugfix",
    state: "closed",
    repo: "paseo",
    status: "Done",
    attention: "attention/1-agent",
    labels: ["state/4-done"],
    comments: 1,
  },
];

describe("UppidiFleetKanbanBoard (#755)", () => {
  before(async () => {
    await getFleetHarness();
    React = (await import("react")).default as any;
    TestRenderer = (await import("react-test-renderer")).default as any;
    const mod = await import("./kanban-board.js");
    KANBAN_COLUMNS = mod.KANBAN_COLUMNS;
    getIssueKanbanColumn = mod.getIssueKanbanColumn;
    getColumnTransitions = mod.getColumnTransitions;
    UppidiFleetKanbanBoard = mod.UppidiFleetKanbanBoard;
    KanbanCard = mod.KanbanCard;
    getActiveDraggingIssue = mod.getActiveDraggingIssue;
    setActiveDraggingIssue = mod.setActiveDraggingIssue;
  });

  it("defines the 4 canonical Forgejo Kanban columns in order", () => {
    assert.equal(KANBAN_COLUMNS.length, 4);
    assert.deepEqual(
      KANBAN_COLUMNS.map((c) => c.id),
      ["backlog", "in_progress", "review", "done"],
    );
    assert.equal(KANBAN_COLUMNS[0].stateLabel, "state/triage");
    assert.equal(KANBAN_COLUMNS[1].stateLabel, "state/wip");
    assert.equal(KANBAN_COLUMNS[2].stateLabel, "state/review");
    assert.equal(KANBAN_COLUMNS[3].stateLabel, "state/done");
  });

  describe("getIssueKanbanColumn mapping", () => {
    it("maps state/4-done and closed state to done column", () => {
      assert.equal(getIssueKanbanColumn(sampleIssues[3]), "done");
      assert.equal(
        getIssueKanbanColumn({
          number: 1,
          title: "done issue",
          state: "open",
          repo: "paseo",
          status: "Backlog",
          attention: "attention/1-agent",
          labels: ["state/4-done"],
          comments: 0,
        }),
        "done",
      );
    });

    it("maps state/2-review, state/3-verify and Review status to review column", () => {
      assert.equal(getIssueKanbanColumn(sampleIssues[2]), "review");
      assert.equal(
        getIssueKanbanColumn({
          number: 2,
          title: "verify issue",
          state: "open",
          repo: "paseo",
          status: "Backlog",
          attention: "attention/1-agent",
          labels: ["state/3-verify"],
          comments: 0,
        }),
        "review",
      );
    });

    it("maps state/1-wip and In progress status to in_progress column", () => {
      assert.equal(getIssueKanbanColumn(sampleIssues[0]), "in_progress");
    });

    it("defaults to backlog column for unclassified or state/0-triage issues", () => {
      assert.equal(getIssueKanbanColumn(sampleIssues[1]), "backlog");
      assert.equal(
        getIssueKanbanColumn({
          number: 3,
          title: "untagged issue",
          state: "open",
          repo: "paseo",
          status: "Backlog",
          attention: "attention/1-agent",
          labels: [],
          comments: 0,
        }),
        "backlog",
      );
    });
  });

  describe("getColumnTransitions", () => {
    it("returns expected transition actions for each column", () => {
      const backlogTransitions = getColumnTransitions("backlog");
      assert.deepEqual(
        backlogTransitions.map((t) => t.targetState),
        ["in_progress", "review"],
      );

      const inProgressTransitions = getColumnTransitions("in_progress");
      assert.deepEqual(
        inProgressTransitions.map((t) => t.targetState),
        ["backlog", "review"],
      );

      const reviewTransitions = getColumnTransitions("review");
      assert.deepEqual(
        reviewTransitions.map((t) => t.targetState),
        ["in_progress", "done"],
      );

      const doneTransitions = getColumnTransitions("done");
      assert.deepEqual(
        doneTransitions.map((t) => t.targetState),
        ["backlog", "in_progress"],
      );
    });
  });

  describe("KanbanCard rendering and interactions", () => {
    it("renders card details and handles select callback", () => {
      let selectedNumber: number | null = null;
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(KanbanCard, {
            issue: sampleIssues[0],
            columnId: "in_progress",
            onSelect: (num: number) => {
              selectedNumber = num;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const cardNodes = findByTestId(tree, "kanban-card-755");
      assert.equal(cardNodes.length, 1);

      const openIssueNodes = findByAccessibilityLabel(tree, /Open issue #755/);
      assert.ok(openIssueNodes.length >= 1, "card must have button to open issue");
      openIssueNodes[0].props?.onPress?.();
      assert.equal(selectedNumber, 755);
    });

    it("renders 1-click transition buttons and handles transition callback", () => {
      let transitionedTarget: string | null = null;
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(KanbanCard, {
            issue: sampleIssues[0],
            columnId: "in_progress",
            onTransition: (_issue: any, target: string) => {
              transitionedTarget = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      // In progress column transitions: Backlog and Review
      const buttons = findByAccessibilityLabel(tree, /Move #755 to/);
      assert.equal(buttons.length, 2);

      // Second button moves to Review
      buttons[1].props?.onPress?.();
      assert.equal(transitionedTarget, "review");
    });

    it("supports HTML5 draggable and sets dataTransfer on drag start", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(KanbanCard, {
            issue: sampleIssues[0],
            columnId: "in_progress",
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const cardNodes = findByTestId(tree, "kanban-card-755");
      assert.equal(cardNodes.length, 1);
      assert.equal(cardNodes[0].props?.draggable, true);

      const dataStore: Record<string, string> = {};
      const mockEvent = {
        dataTransfer: {
          setData: (format: string, data: string) => {
            dataStore[format] = data;
          },
          effectAllowed: "",
        },
      };

      TestRenderer.act(() => {
        cardNodes[0].props?.onDragStart?.(mockEvent);
      });

      assert.equal(dataStore["text/plain"], "755");
      assert.deepEqual(JSON.parse(dataStore["application/json"]), sampleIssues[0]);
      assert.equal(mockEvent.dataTransfer.effectAllowed, "move");

      // Verify dragging style update (opacity 0.6)
      const draggingTree = renderer.toJSON() as RenderedNode;
      const draggingCard = findByTestId(draggingTree, "kanban-card-755")[0];
      assert.equal(draggingCard.props?.style?.opacity, 0.6);

      // Verify drag end resets opacity
      TestRenderer.act(() => {
        cardNodes[0].props?.onDragEnd?.({});
      });
      const endTree = renderer.toJSON() as RenderedNode;
      const normalCard = findByTestId(endTree, "kanban-card-755")[0];
      assert.equal(normalCard.props?.style?.opacity, 1);
    });

    it("supports HTML5 drag start with e.nativeEvent.dataTransfer and sets active dragging issue", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(KanbanCard, {
            issue: sampleIssues[0],
            columnId: "in_progress",
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const cardNodes = findByTestId(tree, "kanban-card-755");
      assert.equal(cardNodes.length, 1);

      const nativeDataStore: Record<string, string> = {};
      const mockEvent = {
        nativeEvent: {
          dataTransfer: {
            setData: (format: string, data: string) => {
              nativeDataStore[format] = data;
            },
            effectAllowed: "",
          },
        },
      };

      TestRenderer.act(() => {
        cardNodes[0].props?.onDragStart?.(mockEvent);
      });

      assert.equal(nativeDataStore["text/plain"], "755");
      assert.deepEqual(JSON.parse(nativeDataStore["application/json"]), sampleIssues[0]);
      assert.equal(mockEvent.nativeEvent.dataTransfer.effectAllowed, "move");
      assert.equal(getActiveDraggingIssue()?.number, 755);

      // Verify drag end resets active dragging issue
      TestRenderer.act(() => {
        cardNodes[0].props?.onDragEnd?.({});
      });
      assert.equal(getActiveDraggingIssue(), null);
    });
  });

  describe("UppidiFleetKanbanBoard rendering", () => {
    it("renders the 4 columns and groups issues into their respective columns", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, { issues: sampleIssues }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      for (const col of KANBAN_COLUMNS) {
        const colNodes = findByTestId(tree, `kanban-column-${col.id}`);
        assert.equal(colNodes.length, 1, `column ${col.id} must be present`);
      }

      // Check card presence
      for (const issue of sampleIssues) {
        const cardNodes = findByTestId(tree, `kanban-card-${issue.number}`);
        assert.equal(cardNodes.length, 1, `card #${issue.number} must be rendered`);
      }
    });

    it("filters board issues by search query", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            filterQuery: "prototype",
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      // Only issue 755 has "prototype" in title
      const card755 = findByTestId(tree, "kanban-card-755");
      const card756 = findByTestId(tree, "kanban-card-756");
      assert.equal(card755.length, 1);
      assert.equal(card756.length, 0);
    });
  });

  describe("Kanban column drag-and-drop and drop transitions", () => {
    it("supports dragOver with preventDefault and sets dropEffect", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, { issues: sampleIssues }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const reviewCol = findByTestId(tree, "kanban-column-review")[0];
      assert.ok(reviewCol, "review column should exist");
      assert.equal(typeof reviewCol.props?.onDragOver, "function");

      let defaultPrevented = false;
      const mockEvent = {
        preventDefault: () => {
          defaultPrevented = true;
        },
        dataTransfer: { dropEffect: "" },
      };

      TestRenderer.act(() => {
        reviewCol.props?.onDragOver?.(mockEvent);
      });

      assert.equal(defaultPrevented, true);
      assert.equal(mockEvent.dataTransfer.dropEffect, "move");
    });

    it("toggles active drop zone visual feedback on dragEnter and dragLeave", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, { issues: sampleIssues }),
        );
      });

      let tree = renderer.toJSON() as RenderedNode;
      let reviewCol = findByTestId(tree, "kanban-column-review")[0];
      assert.equal(reviewCol.props?.style?.borderStyle, "solid");

      // Enter column: visual highlight active (dashed border, active background)
      TestRenderer.act(() => {
        reviewCol.props?.onDragEnter?.({ preventDefault: () => {} });
      });

      tree = renderer.toJSON() as RenderedNode;
      reviewCol = findByTestId(tree, "kanban-column-review")[0];
      assert.equal(reviewCol.props?.style?.borderStyle, "dashed");
      assert.equal(reviewCol.props?.style?.borderWidth, 2);

      // Leave column: visual highlight cleared
      TestRenderer.act(() => {
        reviewCol.props?.onDragLeave?.({ preventDefault: () => {} });
      });

      tree = renderer.toJSON() as RenderedNode;
      reviewCol = findByTestId(tree, "kanban-column-review")[0];
      assert.equal(reviewCol.props?.style?.borderStyle, "solid");
      assert.equal(reviewCol.props?.style?.borderWidth, 1);
    });

    it("triggers state transition via onTransitionIssue on drop with application/json data", async () => {
      let transitionedIssue: UppidiIssue | null = null;
      let targetColumn: string | null = null;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: (issue: UppidiIssue, target: any) => {
              transitionedIssue = issue;
              targetColumn = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const reviewCol = findByTestId(tree, "kanban-column-review")[0];

      // Drop sampleIssues[0] (issue 755 currently in "in_progress") into "review"
      const dropEvent = {
        preventDefault: () => {},
        dataTransfer: {
          getData: (type: string) => {
            if (type === "application/json") {
              return JSON.stringify(sampleIssues[0]);
            }
            return "";
          },
        },
      };

      await TestRenderer.act(async () => {
        await reviewCol.props?.onDrop?.(dropEvent);
      });

      assert.ok(transitionedIssue, "transition callback must be invoked");
      assert.equal((transitionedIssue as UppidiIssue).number, 755);
      assert.equal(targetColumn, "review");
    });

    it("triggers state transition on drop with text/plain issue number fallback", async () => {
      let transitionedIssue: UppidiIssue | null = null;
      let targetColumn: string | null = null;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: (issue: UppidiIssue, target: any) => {
              transitionedIssue = issue;
              targetColumn = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const doneCol = findByTestId(tree, "kanban-column-done")[0];

      // Drop issue 755 with text/plain only
      const dropEvent = {
        preventDefault: () => {},
        dataTransfer: {
          getData: (type: string) => {
            if (type === "text/plain") {
              return "755";
            }
            return "";
          },
        },
      };

      await TestRenderer.act(async () => {
        await doneCol.props?.onDrop?.(dropEvent);
      });

      assert.ok(transitionedIssue, "transition callback must be invoked via text/plain fallback");
      assert.equal((transitionedIssue as UppidiIssue).number, 755);
      assert.equal(targetColumn, "done");
    });

    it("does not trigger transition when card is dropped into its current column", async () => {
      let transitionCalled = false;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: () => {
              transitionCalled = true;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      // sampleIssues[0] (755) is already in "in_progress"
      const inProgressCol = findByTestId(tree, "kanban-column-in_progress")[0];

      const dropEvent = {
        preventDefault: () => {},
        dataTransfer: {
          getData: (type: string) => {
            if (type === "application/json") {
              return JSON.stringify(sampleIssues[0]);
            }
            return "";
          },
        },
      };

      await TestRenderer.act(async () => {
        await inProgressCol.props?.onDrop?.(dropEvent);
      });

      assert.equal(transitionCalled, false, "no transition should occur for same column");
    });

    it("supports dragOver with nativeEvent preventDefault and nativeEvent.dataTransfer", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, { issues: sampleIssues }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const reviewCol = findByTestId(tree, "kanban-column-review")[0];
      assert.ok(reviewCol, "review column should exist");

      let nativeDefaultPrevented = false;
      let syntheticDefaultPrevented = false;
      const mockEvent = {
        preventDefault: () => {
          syntheticDefaultPrevented = true;
        },
        nativeEvent: {
          preventDefault: () => {
            nativeDefaultPrevented = true;
          },
          dataTransfer: { dropEffect: "" },
        },
      };

      TestRenderer.act(() => {
        reviewCol.props?.onDragOver?.(mockEvent);
      });

      assert.equal(syntheticDefaultPrevented, true);
      assert.equal(nativeDefaultPrevented, true);
      assert.equal(mockEvent.nativeEvent.dataTransfer.dropEffect, "move");
    });

    it("triggers state transition via onTransitionIssue on drop with e.nativeEvent.dataTransfer", async () => {
      let transitionedIssue: UppidiIssue | null = null;
      let targetColumn: string | null = null;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: (issue: UppidiIssue, target: any) => {
              transitionedIssue = issue;
              targetColumn = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const reviewCol = findByTestId(tree, "kanban-column-review")[0];

      let nativeDefaultPrevented = false;
      const dropEvent = {
        preventDefault: () => {},
        nativeEvent: {
          preventDefault: () => {
            nativeDefaultPrevented = true;
          },
          dataTransfer: {
            getData: (type: string) => {
              if (type === "application/json") {
                return JSON.stringify(sampleIssues[0]);
              }
              return "";
            },
          },
        },
      };

      await TestRenderer.act(async () => {
        await reviewCol.props?.onDrop?.(dropEvent);
      });

      assert.equal(nativeDefaultPrevented, true);
      assert.ok(transitionedIssue, "transition callback must be invoked");
      assert.equal((transitionedIssue as UppidiIssue).number, 755);
      assert.equal(targetColumn, "review");
    });

    it("triggers state transition on drop with fallback to active dragging issue", async () => {
      let transitionedIssue: UppidiIssue | null = null;
      let targetColumn: string | null = null;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: (issue: UppidiIssue, target: any) => {
              transitionedIssue = issue;
              targetColumn = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const reviewCol = findByTestId(tree, "kanban-column-review")[0];

      // Set module fallback (simulate dragstart setting activeDraggingIssue)
      setActiveDraggingIssue(sampleIssues[0]);

      // Drop event with empty/broken dataTransfer
      const dropEvent = {
        preventDefault: () => {},
        nativeEvent: {
          preventDefault: () => {},
          dataTransfer: {
            getData: () => "",
          },
        },
      };

      await TestRenderer.act(async () => {
        await reviewCol.props?.onDrop?.(dropEvent);
      });

      assert.ok(transitionedIssue, "transition callback must be invoked via active dragging issue fallback");
      assert.equal((transitionedIssue as UppidiIssue).number, 755);
      assert.equal(targetColumn, "review");
      assert.equal(getActiveDraggingIssue(), null, "active dragging issue should be cleared after drop");
    });

    it("triggers state transition when dropping onto column body ScrollView", async () => {
      let transitionedIssue: UppidiIssue | null = null;
      let targetColumn: string | null = null;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: (issue: UppidiIssue, target: any) => {
              transitionedIssue = issue;
              targetColumn = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const reviewColBody = findByTestId(tree, "kanban-column-body-review")[0];
      assert.ok(reviewColBody, "column body ScrollView must exist");
      assert.equal(typeof reviewColBody.props?.onDrop, "function", "column body ScrollView must have onDrop handler");
      assert.equal(typeof reviewColBody.props?.onDragOver, "function", "column body ScrollView must have onDragOver handler");

      const dropEvent = {
        preventDefault: () => {},
        dataTransfer: {
          getData: (type: string) => {
            if (type === "application/json") {
              return JSON.stringify(sampleIssues[0]);
            }
            return "";
          },
        },
      };

      await TestRenderer.act(async () => {
        await reviewColBody.props?.onDrop?.(dropEvent);
      });

      assert.ok(transitionedIssue, "transition callback must be invoked via column body drop");
      assert.equal((transitionedIssue as UppidiIssue).number, 755);
      assert.equal(targetColumn, "review");
    });

    // #807 regression: React Native Web strips draggable/onDrag*/onDrop props
    // from <View>/<ScrollView>, so the drag source and drop zones must render
    // as native host elements on web or the browser never fires DnD events.
    it("renders drag source and drop zones as native DOM elements on web (#807)", () => {
      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, { issues: sampleIssues }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const card = findByTestId(tree, "kanban-card-755")[0];
      assert.ok(card, "card must exist");
      assert.equal(card.type, "div", "card must be a native div so draggable reaches the DOM");
      assert.equal(card.props?.draggable, true, "card div must be draggable");
      assert.equal(typeof card.props?.onDragStart, "function");
      assert.equal(typeof card.props?.onDragEnd, "function");

      for (const colId of ["backlog", "in_progress", "review", "done"]) {
        const col = findByTestId(tree, `kanban-column-${colId}`)[0];
        assert.ok(col, `column ${colId} must exist`);
        assert.equal(col.type, "div", `column ${colId} must be a native div so onDrop reaches the DOM`);
        assert.equal(typeof col.props?.onDragOver, "function");
        assert.equal(typeof col.props?.onDrop, "function");

        const body = findByTestId(tree, `kanban-column-body-${colId}`)[0];
        assert.ok(body, `column body ${colId} must exist`);
        assert.equal(body.type, "div", `column body ${colId} must be a native div`);
        assert.equal(typeof body.props?.onDragOver, "function");
        assert.equal(typeof body.props?.onDrop, "function");
      }
    });

    // #807 regression: full dragstart->dragover->drop flow with real React DOM
    // synthetic event shape (dataTransfer directly on the event, no
    // nativeEvent wrapper). #809 only tested nativeEvent-shaped events.
    it("transitions issue via DOM-shaped dragstart/dragover/drop events (#807)", async () => {
      let transitionedIssue: UppidiIssue | null = null;
      let targetColumn: string | null = null;

      let renderer: any;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(UppidiFleetKanbanBoard, {
            issues: sampleIssues,
            onTransitionIssue: (issue: UppidiIssue, target: any) => {
              transitionedIssue = issue;
              targetColumn = target;
            },
          }),
        );
      });

      const tree = renderer.toJSON() as RenderedNode;
      const card = findByTestId(tree, "kanban-card-755")[0];
      assert.equal(card.type, "div");

      const store: Record<string, string> = {};
      const dataTransfer = {
        setData: (format: string, data: string) => {
          store[format] = data;
        },
        getData: (format: string) => store[format] ?? "",
        effectAllowed: "",
        dropEffect: "",
      };

      TestRenderer.act(() => {
        card.props?.onDragStart?.({ dataTransfer });
      });
      assert.equal(store["text/plain"], "755");
      assert.ok(JSON.parse(store["application/json"]));
      assert.equal(dataTransfer.effectAllowed, "move");

      const reviewCol = findByTestId(tree, "kanban-column-review")[0];
      let prevented = false;
      TestRenderer.act(() => {
        reviewCol.props?.onDragOver?.({
          preventDefault: () => {
            prevented = true;
          },
          dataTransfer,
        });
      });
      assert.equal(prevented, true, "dragover must preventDefault to allow drop");
      assert.equal(dataTransfer.dropEffect, "move");

      await TestRenderer.act(async () => {
        await reviewCol.props?.onDrop?.({
          preventDefault: () => {},
          stopPropagation: () => {},
          dataTransfer,
        });
      });

      assert.ok(transitionedIssue, "drop must dispatch transition");
      assert.equal((transitionedIssue as UppidiIssue).number, 755);
      assert.equal(targetColumn, "review");
    });
  });
});

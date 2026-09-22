import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UppidiIssueSchema,
  HookQueueItemSchema,
  HookStatusOutputSchema,
  uppidiIssuesContract,
  uppidiHookStatusContract,
  DeterministicAgentStateSchema,
  UppidiAgentSchema,
  UppidiAgentTreeNodeSchema,
  UppidiAgentsOutputSchema,
} from "./contracts.js";

describe("uppidi-forge shared contracts", () => {
  it("validates UppidiIssueSchema with defaults", () => {
    const issue = UppidiIssueSchema.parse({
      number: 123,
      title: "Fix crash on launch",
      state: "open",
      repo: "paseo",
      status: "In progress",
      attention: "attention/0-orchestrator",
      comments: 5,
    });
    assert.equal(issue.number, 123);
    assert.equal(issue.status, "In progress");
    assert.equal(issue.attention, "attention/0-orchestrator");
    assert.equal(issue.comments, 5);
    assert.deepEqual(issue.labels, []);
  });

  it("validates HookQueueItemSchema", () => {
    const item = HookQueueItemSchema.parse({
      key: "forge.mrs.uppidi.com/xpufx-org/paseo",
      depth: 3,
      paused: false,
      isBusy: true,
      messages: [{ id: "msg-1", ts: 123456, preview: "push event" }],
    });
    assert.equal(item.key, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(item.depth, 3);
    assert.equal(item.isBusy, true);
    assert.equal(item.messages.length, 1);
  });

  it("has valid contract definitions", () => {
    assert.equal(uppidiIssuesContract.name, "uppidi-forge.issues");
    assert.equal(uppidiHookStatusContract.name, "uppidi-forge.hook-status");
  });

  it("validates deterministic agent state taxonomy strictly", () => {
    const validStates = [
      "working",
      "running",
      "sleeping",
      "idle:waiting",
      "idle:quota-exhausted",
      "failed:quota-exhausted",
      "failed:spawn",
      "failed:timeout",
      "failed:error",
      "unknown",
    ];

    for (const s of validStates) {
      assert.equal(DeterministicAgentStateSchema.parse(s), s);
    }

    assert.throws(() => DeterministicAgentStateSchema.parse("invalid-state"));
  });

  it("validates UppidiAgentSchema with lineage, work attribution, and deterministic state", () => {
    const agent = UppidiAgentSchema.parse({
      id: "agent-123",
      shortId: "ag123",
      name: "Worker feat-385",
      category: "worker",
      status: "running",
      parentId: "orch-456",
      model: "gemini-3.8-flash-low",
      deterministicState: "working",
      stateDetail: "#385 (feat/385-tree-fleet-view)",
      attributedWork: {
        repo: "xpufx-org/paseo",
        issue: 385,
        slug: "feat/385-tree-fleet-view",
      },
    });

    assert.equal(agent.id, "agent-123");
    assert.equal(agent.parentId, "orch-456");
    assert.equal(agent.deterministicState, "working");
    assert.equal(agent.attributedWork?.issue, 385);
  });

  it("validates UppidiAgentTreeNodeSchema recursively", () => {
    const tree = UppidiAgentTreeNodeSchema.parse({
      agent: {
        id: "root-1",
        shortId: "root1",
        name: "Front Desk",
        category: "front-desk",
        status: "running",
        parentId: null,
        deterministicState: "running",
      },
      depth: 0,
      children: [
        {
          agent: {
            id: "child-1",
            shortId: "chld1",
            name: "Orchestrator",
            category: "orchestrator",
            status: "running",
            parentId: "root-1",
            deterministicState: "working",
          },
          depth: 1,
          children: [],
        },
      ],
    });

    assert.equal(tree.agent.id, "root-1");
    assert.equal(tree.depth, 0);
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].agent.id, "child-1");
    assert.equal(tree.children[0].depth, 1);
  });
});

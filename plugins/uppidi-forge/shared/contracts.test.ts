import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UppidiIssueSchema,
  HookQueueItemSchema,
  HookStatusOutputSchema,
  uppidiIssuesContract,
  uppidiHookStatusContract,
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
});

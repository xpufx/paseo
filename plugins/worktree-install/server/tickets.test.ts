import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveAttention, deriveBranch, deriveStatus, normalizeIssue } from "./tickets.js";

describe("attention ownership", () => {
  it("promotes the operator above the orchestrator", () => {
    assert.equal(deriveAttention(["attention/2-user", "attention/0-orchestrator"]), "attention/2-user");
    assert.equal(deriveAttention(["attention/0-orchestrator"]), "attention/0-orchestrator");
    assert.equal(deriveAttention(["size/0-cheap"]), "attention/1-agent");
    assert.equal(deriveAttention([]), "attention/1-agent");
  });

  it("accepts the two legacy spellings of the operator signal", () => {
    assert.equal(deriveAttention(["attention/user"]), "attention/2-user");
    assert.equal(deriveAttention(["attention:user"]), "attention/2-user");
    assert.equal(deriveAttention(["Attention/User"]), "attention/2-user");
  });
});

describe("ticket status", () => {
  it("maps the state machine the board uses", () => {
    assert.equal(deriveStatus("open", []), "Backlog");
    assert.equal(deriveStatus("closed", []), "Done");
    assert.equal(deriveStatus("open", ["state/1-wip"]), "In progress");
    assert.equal(deriveStatus("open", ["state/2-review"]), "Review");
    assert.equal(deriveStatus("open", ["state/3-verify"]), "Review");
    assert.equal(deriveStatus("open", ["review/0-needed"]), "Review");
  });

  it("lets a closed ticket stay done regardless of labels", () => {
    assert.equal(deriveStatus("closed", ["state/1-wip"]), "Done");
  });
});

describe("branch detection", () => {
  it("reads a worktree branch out of the ticket body", () => {
    assert.equal(deriveBranch("see feat/629-fleet-alternative"), "feat/629-fleet-alternative");
    assert.equal(deriveBranch("fix/629-x and docs/1-y"), "fix/629-x");
    assert.equal(deriveBranch("no branch here"), undefined);
    assert.equal(deriveBranch(undefined), undefined);
  });
});

describe("normalizeIssue", () => {
  it("keeps every field the inventory requires", () => {
    const ticket = normalizeIssue(
      {
        number: 629,
        title: "uppidi-fleet alternative design",
        state: "open",
        body: "branch feat/629-alt",
        comments: 4,
        html_url: "https://forge.example.com/org/repo/issues/629",
        updated_at: "2026-01-01T00:00:00.000Z",
        labels: [{ name: "state/1-wip" }, { name: "attention/2-user" }],
      },
      "org/repo",
    );
    assert.equal(ticket.number, 629);
    assert.equal(ticket.title, "uppidi-fleet alternative design");
    assert.equal(ticket.state, "open");
    // The bare repository name is what the row and scope chips show.
    assert.equal(ticket.repo, "repo");
    assert.equal(ticket.status, "In progress");
    assert.equal(ticket.attention, "attention/2-user");
    assert.equal(ticket.branch, "feat/629-alt");
    assert.equal(ticket.comments, 4);
    assert.deepEqual(ticket.labels, ["state/1-wip", "attention/2-user"]);
    assert.equal(ticket.url, "https://forge.example.com/org/repo/issues/629");
    assert.equal(ticket.updatedAt, "2026-01-01T00:00:00.000Z");
  });

  it("tolerates a payload with no labels, comments, or body", () => {
    const ticket = normalizeIssue({ number: 1, title: "bare", state: "open" }, "org/repo");
    assert.deepEqual(ticket.labels, []);
    assert.equal(ticket.comments, 0);
    assert.equal(ticket.branch, undefined);
    assert.equal(ticket.attention, "attention/1-agent");
  });
});

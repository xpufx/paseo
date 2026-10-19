/**
 * Tests for project identity migration utility (#1371).
 *
 * Run: node --test scripts/migrate-project-identity.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planProjectIdentityMigration } from "./migrate-project-identity.mjs";

describe("migrate-project-identity (#1371)", () => {
  it("translates prj_* keys to canonical project keys", () => {
    const cwd = process.cwd();
    const projects = [
      {
        projectId: "prj_paseo_test",
        displayName: "paseo",
        projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
        rootPath: cwd,
      },
    ];

    const workspaces = [
      {
        workspaceId: "wks_main",
        projectId: "prj_paseo_test",
        cwd,
        displayName: "main",
      },
      {
        workspaceId: "wks_worktree",
        projectId: "prj_paseo_test",
        cwd: `${cwd}/.paseo/worktrees/abc/feat`,
        displayName: "feat",
      },
    ];

    const settings = {
      enrolledRepos: ["remote:forge.mrs.uppidi.com:222/xpufx-org/paseo", "prj_paseo_test"],
    };

    const plan = planProjectIdentityMigration(projects, workspaces, settings);

    assert.ok(plan.translationMap.has("prj_paseo_test"));
    const newId = plan.translationMap.get("prj_paseo_test");
    assert.match(newId, /^git-root:[a-f0-9]{40}$/);

    assert.equal(plan.plannedProjects[0].projectId, newId);
    assert.equal(plan.plannedWorkspaces[0].projectId, newId);
    assert.equal(plan.plannedWorkspaces[1].projectId, newId);

    assert.ok(plan.plannedSettings.enrolledProjects.includes(newId));
    assert.equal(plan.plannedSettings.enrolledRepos, undefined);

    // Verify zero prj_* keys remain
    const jsonProjects = JSON.stringify(plan.plannedProjects);
    const jsonWorkspaces = JSON.stringify(plan.plannedWorkspaces);
    const jsonSettings = JSON.stringify(plan.plannedSettings);

    assert.doesNotMatch(jsonProjects, /"projectId":"prj_/);
    assert.doesNotMatch(jsonWorkspaces, /"projectId":"prj_/);
    assert.doesNotMatch(jsonSettings, /"prj_/);
  });
});

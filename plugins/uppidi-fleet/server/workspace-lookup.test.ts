import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceForRepo, type WorkspaceRecord, type ProjectRecord } from "./workspace-lookup.js";
import { resolveHostHome } from "./role-models.js";

describe("workspace-lookup deterministic resolution (#793)", () => {
  const sampleProjects: ProjectRecord[] = [
    {
      projectId: "prj_paseo",
      displayName: "paseo",
      projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
      rootPath: "/home/user/code/paseo",
    },
    {
      projectId: "prj_uppidi",
      displayName: "uppidi",
      projectKey: "remote:forge.example.com:222/xpufx/uppidi",
      rootPath: "/home/user/code/uppidi",
    },
  ];

  const sampleWorkspaces: WorkspaceRecord[] = [
    {
      workspaceId: "wks_paseo_main",
      projectId: "prj_paseo",
      cwd: "/home/user/code/paseo",
      displayName: "main",
      mainRepoRoot: null,
      archivedAt: null,
      updatedAt: "2026-09-20T10:00:00Z",
    },
    {
      workspaceId: "wks_paseo_worktree",
      projectId: "prj_paseo",
      cwd: "/home/user/.paseo/worktrees/123/feat-793",
      displayName: "feat-793",
      mainRepoRoot: "/home/user/code/paseo",
      isPaseoOwnedWorktree: true,
      archivedAt: null,
      updatedAt: "2026-09-25T10:00:00Z",
    },
    {
      workspaceId: "wks_paseo_archived",
      projectId: "prj_paseo",
      cwd: "/home/user/code/old-paseo",
      displayName: "old",
      archivedAt: "2026-01-01T00:00:00Z",
    },
    {
      workspaceId: "wks_uppidi_main",
      projectId: "prj_uppidi",
      cwd: "/home/user/code/uppidi",
      displayName: "main",
      mainRepoRoot: null,
      archivedAt: null,
      updatedAt: "2026-09-20T10:00:00Z",
    },
  ];

  it("matches owner/repo slug deterministically to main repository workspace", () => {
    const res = resolveWorkspaceForRepo("xpufx-org/paseo", {
      workspacesData: sampleWorkspaces,
      projectsData: sampleProjects,
    });
    assert.ok(res);
    assert.equal(res.workspaceId, "wks_paseo_main");
    assert.equal(res.cwd, "/home/user/code/paseo");
  });

  it("matches full remote URL and git suffix to main workspace", () => {
    const res = resolveWorkspaceForRepo("https://forge.mrs.uppidi.com/xpufx-org/paseo.git", {
      workspacesData: sampleWorkspaces,
      projectsData: sampleProjects,
    });
    assert.ok(res);
    assert.equal(res.workspaceId, "wks_paseo_main");
    assert.equal(res.cwd, "/home/user/code/paseo");
  });

  it("prioritizes active root workspace over ephemeral worktree even if worktree was updated later", () => {
    // wks_paseo_worktree has updatedAt 2026-09-25 vs wks_paseo_main 2026-09-20
    const res = resolveWorkspaceForRepo("xpufx-org/paseo", {
      workspacesData: sampleWorkspaces,
      projectsData: sampleProjects,
    });
    assert.ok(res);
    assert.equal(res.workspaceId, "wks_paseo_main");
  });

  it("penalizes archived workspaces heavily", () => {
    const onlyArchived: WorkspaceRecord[] = [
      {
        workspaceId: "wks_archived",
        projectId: "prj_paseo",
        cwd: "/home/user/code/old-paseo",
        archivedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const res = resolveWorkspaceForRepo("xpufx-org/paseo", {
      workspacesData: onlyArchived,
      projectsData: sampleProjects,
    });
    // Still resolves if it's the only match, but score is penalized
    assert.ok(res);
    assert.equal(res.workspaceId, "wks_archived");
    assert.ok((res.score ?? 0) < 600);
  });

  it("matches repo basename to project displayName", () => {
    const res = resolveWorkspaceForRepo("uppidi", {
      workspacesData: sampleWorkspaces,
      projectsData: sampleProjects,
    });
    assert.ok(res);
    assert.equal(res.workspaceId, "wks_uppidi_main");
  });

  it("returns null for non-matching unknown repository", () => {
    const res = resolveWorkspaceForRepo("nonexistent-org/unknown-project-xyz", {
      workspacesData: sampleWorkspaces,
      projectsData: sampleProjects,
    });
    assert.equal(res, null);
  });

  it("returns null for empty or invalid repo slug", () => {
    assert.equal(resolveWorkspaceForRepo("", { workspacesData: sampleWorkspaces }), null);
    assert.equal(resolveWorkspaceForRepo("   ", { workspacesData: sampleWorkspaces }), null);
    assert.equal(resolveWorkspaceForRepo(null as any, { workspacesData: sampleWorkspaces }), null);
  });
});

describe("host home resolution under agent-mux profiles (#973)", () => {
  const originalEnv = {
    HOME: process.env.HOME,
    REAL_HOME: process.env.REAL_HOME,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns HOME unchanged when it is not an agent-mux profile", () => {
    process.env.HOME = "/home/user";
    delete process.env.REAL_HOME;
    assert.equal(resolveHostHome(), "/home/user");
  });

  it("prefers REAL_HOME when HOME points into an agent-mux profile", () => {
    process.env.HOME = "/home/user/.agent-mux/profiles/opencode/test-profile";
    process.env.REAL_HOME = "/home/user";
    assert.equal(resolveHostHome(), "/home/user");
  });

  it("derives the host home from the profile prefix when REAL_HOME is absent", () => {
    process.env.HOME = "/home/user/.agent-mux/profiles/opencode/test-profile";
    delete process.env.REAL_HOME;
    assert.equal(resolveHostHome(), "/home/user");
  });

  it("reads the host ~/.paseo registry when HOME is a profile directory (#973)", () => {
    const realHome = mkdtempSync(join(tmpdir(), "paseo-host-home-"));
    const repoDir = join(realHome, "code", "paseo");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(realHome, ".paseo", "projects"), { recursive: true });
    writeFileSync(
      join(realHome, ".paseo", "projects", "workspaces.json"),
      JSON.stringify([{ workspaceId: "ws-host", cwd: repoDir, displayName: "main" }]),
    );

    process.env.HOME = "/home/user/.agent-mux/profiles/opencode/test-profile";
    process.env.REAL_HOME = realHome;
    delete process.env.PASEO_DIR;
    delete process.env.PASEO_WORKSPACES_PATH;
    process.env.NODE_ENV = "production";
    try {
      const res = resolveWorkspaceForRepo("xpufx-org/paseo");
      assert.ok(res);
      assert.equal(res.workspaceId, "ws-host");
      assert.equal(res.cwd, repoDir);
    } finally {
      rmSync(realHome, { recursive: true, force: true });
    }
  });

  it("falls back to the host ~/code/<basename> checkout in a profile session (#987)", () => {
    const realHome = mkdtempSync(join(tmpdir(), "paseo-host-fallback-"));
    const repoDir = join(realHome, "code", "paseo");
    mkdirSync(repoDir, { recursive: true });

    process.env.HOME = "/home/user/.agent-mux/profiles/opencode/test-profile";
    process.env.REAL_HOME = realHome;
    delete process.env.PASEO_DIR;
    delete process.env.PASEO_WORKSPACES_PATH;
    process.env.NODE_ENV = "production";
    try {
      const res = resolveWorkspaceForRepo("xpufx-org/paseo");
      assert.ok(res, "the host checkout must resolve when no registry exists");
      assert.equal(res.cwd, repoDir);
      assert.equal(res.workspaceId, undefined);
    } finally {
      rmSync(realHome, { recursive: true, force: true });
    }
  });

  it("honors PASEO_DIR as the workspace registry root in CLI contexts (#987)", () => {
    const paseoDir = mkdtempSync(join(tmpdir(), "paseo-dir-override-"));
    const repoDir = join(paseoDir, "code", "paseo");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(
      join(paseoDir, "workspaces.json"),
      JSON.stringify([{ workspaceId: "ws-paseo-dir", cwd: repoDir, displayName: "paseo" }]),
    );

    const previousPaseoDir = process.env.PASEO_DIR;
    process.env.PASEO_DIR = paseoDir;
    delete process.env.PASEO_WORKSPACES_PATH;
    try {
      const res = resolveWorkspaceForRepo("xpufx-org/paseo");
      assert.ok(res);
      assert.equal(res.workspaceId, "ws-paseo-dir");
      assert.equal(res.cwd, repoDir);
    } finally {
      if (previousPaseoDir === undefined) delete process.env.PASEO_DIR;
      else process.env.PASEO_DIR = previousPaseoDir;
      rmSync(paseoDir, { recursive: true, force: true });
    }
  });
});

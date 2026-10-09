import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceForRepo, resolveWorkspaceForRepoViaDaemon, WorkspaceResolutionError, type WorkspaceRecord, type ProjectRecord } from "./workspace-lookup.js";
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

  it("still resolves an archived-only match but prefers a live match when present", () => {
    const archived: WorkspaceRecord[] = [
      {
        workspaceId: "wks_archived",
        projectId: "prj_paseo",
        cwd: "/home/user/code/paseo-old",
        displayName: "paseo",
        archivedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const only = resolveWorkspaceForRepo("xpufx-org/paseo", {
      workspacesData: archived,
      projectsData: sampleProjects,
    });
    assert.ok(only);
    assert.equal(only.workspaceId, "wks_archived");

    const withLive = resolveWorkspaceForRepo("xpufx-org/paseo", {
      workspacesData: [...sampleWorkspaces, ...archived],
      projectsData: sampleProjects,
    });
    assert.ok(withLive);
    assert.equal(withLive.workspaceId, "wks_paseo_main");
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
});

describe("canonical daemon workspace resolution (#1159)", () => {
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

  const paseoWith = (
    entries: any[],
    openImpl?: (input: { cwd: string }) => Promise<any>,
  ): any => ({
    workspaces: {
      list: async () => ({ entries }),
      open:
        openImpl ??
        (async ({ cwd }: { cwd: string }) => ({ id: "wks_opened", directory: cwd, projectId: "prj_opened" })),
    },
  });

  const paseoKey = "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo";

  it("matches the root checkout from the daemon RPC deterministically", async () => {
    const res = await resolveWorkspaceForRepoViaDaemon(
      "forge.mrs.uppidi.com/xpufx-org/paseo",
      paseoWith([
        {
          id: "wks_worktree",
          projectId: "prj_paseo",
          projectRootPath: "/home/user/code/paseo",
          workspaceDirectory: "/home/user/.paseo/worktrees/abc/feat-1",
          workspaceKind: "worktree",
          name: "feat-1",
          gitRuntime: { isPaseoOwnedWorktree: true },
          project: { projectKey: paseoKey },
        },
        {
          id: "wks_main",
          projectId: "prj_paseo",
          projectRootPath: "/home/user/code/paseo",
          workspaceDirectory: "/home/user/code/paseo",
          workspaceKind: "checkout",
          name: "main",
          gitRuntime: { isPaseoOwnedWorktree: false },
          project: { projectKey: paseoKey },
        },
      ]),
      { candidateDir: () => undefined },
    );
    assert.ok(res);
    assert.equal(res?.workspaceId, "wks_main");
    assert.equal(res?.cwd, "/home/user/code/paseo");
  });

  it("provisions the ambient workspace through workspaces.open when nothing matches", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "paseo-ambient-"));
    try {
      let openedCwd: string | undefined;
      const res = await resolveWorkspaceForRepoViaDaemon(
        "xpufx-org/paseo",
        paseoWith([], async ({ cwd }: { cwd: string }) => {
          openedCwd = cwd;
          return { id: "wks_ambient", directory: cwd, projectId: "prj_ambient" };
        }),
        { candidateDir: () => repoDir },
      );
      assert.equal(openedCwd, repoDir);
      assert.equal(res?.workspaceId, "wks_ambient");
      assert.equal(res?.cwd, repoDir);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("returns null (fail fast) when neither the daemon nor a host checkout has the workspace", async () => {
    const res = await resolveWorkspaceForRepoViaDaemon(
      "xpufx-org/does-not-exist",
      paseoWith([]),
      { candidateDir: () => undefined },
    );
    assert.equal(res, null);
  });

  it("never parses ~/.paseo/projects/workspaces.json", async () => {
    const realHome = mkdtempSync(join(tmpdir(), "paseo-no-registry-"));
    const repoDir = join(realHome, "code", "paseo");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(realHome, ".paseo", "projects"), { recursive: true });
    writeFileSync(
      join(realHome, ".paseo", "projects", "workspaces.json"),
      JSON.stringify([{ workspaceId: "ws-on-disk", cwd: repoDir, displayName: "main" }]),
    );
    process.env.REAL_HOME = realHome;
    process.env.HOME = realHome;
    process.env.NODE_ENV = "production";
    try {
      const res = await resolveWorkspaceForRepoViaDaemon("xpufx-org/paseo", paseoWith([]), {
        candidateDir: () => undefined,
      });
      assert.equal(res, null, "an on-disk workspaces.json must not be consulted");
    } finally {
      rmSync(realHome, { recursive: true, force: true });
    }
  });

  it("surfaces a daemon list failure as an actionable WorkspaceResolutionError", async () => {
    const paseo: any = {
      workspaces: {
        list: async () => {
          throw new Error("daemon offline");
        },
        open: async () => ({ id: "x" }),
      },
    };
    await assert.rejects(
      () => resolveWorkspaceForRepoViaDaemon("xpufx-org/paseo", paseo, { candidateDir: () => undefined }),
      (err: any) => err instanceof WorkspaceResolutionError && /daemon offline/.test(err.message),
    );
  });
});

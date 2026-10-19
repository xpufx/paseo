#!/usr/bin/env node
/**
 * migrate-project-identity — one-time migration utility for canonical universal
 * project identity anchored on git root commit SHA (#1371).
 *
 * Translates surrogate prj_* identifiers to git-root:<sha> across:
 * - ~/.paseo/projects/projects.json
 * - ~/.paseo/projects/workspaces.json
 * - ~/.paseo/plugin-data/xpufx/uppidi-fleet/settings.json
 *
 * Usage:
 *   node scripts/migrate-project-identity.mjs [--dry-run] [--apply] [--paseo-dir <dir>]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { canonicalProjectKey } from "../packages/backend/fleet/dist/index.js";

export function parseArgs(argv) {
  const opts = { apply: false, dryRun: true, paseoDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      opts.apply = true;
      opts.dryRun = false;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
      opts.apply = false;
    } else if (a === "--paseo-dir" && i + 1 < argv.length) {
      opts.paseoDir = argv[++i];
    }
  }
  return opts;
}

export function planProjectIdentityMigration(projects, workspaces, settings) {
  const translationMap = new Map();
  const repoToProjectKey = new Map();

  // 1. Resolve each project
  for (const project of projects || []) {
    if (!project) continue;
    const oldId = project.projectId;
    const rootPath = project.rootPath;
    let newKey = null;
    if (rootPath) {
      newKey = canonicalProjectKey(rootPath);
    }
    if (!newKey && oldId) {
      newKey = oldId;
    }
    if (oldId && newKey) {
      translationMap.set(oldId, newKey);
    }
    if (project.projectKey && newKey) {
      repoToProjectKey.set(project.projectKey, newKey);
    }
    if (project.displayName && newKey) {
      repoToProjectKey.set(project.displayName, newKey);
    }
  }

  // 2. Plan projects update
  const plannedProjects = (projects || []).map((project) => {
    if (!project) return project;
    const newId = translationMap.get(project.projectId) ?? project.projectId;
    return {
      ...project,
      projectId: newId,
    };
  });

  // 3. Plan workspaces update
  const plannedWorkspaces = (workspaces || []).map((workspace) => {
    if (!workspace) return workspace;
    let newProjectId = workspace.projectId;
    if (workspace.projectId && translationMap.has(workspace.projectId)) {
      newProjectId = translationMap.get(workspace.projectId);
    } else if (workspace.cwd) {
      newProjectId = canonicalProjectKey(workspace.cwd);
    }
    return {
      ...workspace,
      projectId: newProjectId,
    };
  });

  // 4. Plan settings update
  let plannedSettings = null;
  if (settings) {
    const enrolledProjects = new Set();
    const existingEnrolled = settings.enrolledProjects || settings.enrolledRepos || [];
    for (const item of existingEnrolled) {
      if (typeof item === "string") {
        if (item.startsWith("git-root:") || item.startsWith("non-git:")) {
          enrolledProjects.add(item);
        } else if (translationMap.has(item)) {
          enrolledProjects.add(translationMap.get(item));
        } else if (repoToProjectKey.has(item)) {
          enrolledProjects.add(repoToProjectKey.get(item));
        } else if (existsSync(item)) {
          enrolledProjects.add(canonicalProjectKey(item));
        } else {
          // Keep as is if unresolvable
          enrolledProjects.add(item);
        }
      }
    }
    plannedSettings = {
      ...settings,
      enrolledProjects: Array.from(enrolledProjects),
    };
    if ("enrolledRepos" in plannedSettings) {
      delete plannedSettings.enrolledRepos;
    }
  }

  return {
    translationMap,
    plannedProjects,
    plannedWorkspaces,
    plannedSettings,
  };
}

export function migrateProjectIdentity(options = {}) {
  const home = process.env.HOME || "";
  const paseoDir = options.paseoDir || join(home, ".paseo");
  const dryRun = options.dryRun ?? true;

  const projectsFile = join(paseoDir, "projects", "projects.json");
  const workspacesFile = join(paseoDir, "projects", "workspaces.json");
  const settingsFile = join(paseoDir, "plugin-data", "xpufx", "uppidi-fleet", "settings.json");

  let projects = [];
  let workspaces = [];
  let settings = null;

  if (existsSync(projectsFile)) {
    projects = JSON.parse(readFileSync(projectsFile, "utf8"));
  }
  if (existsSync(workspacesFile)) {
    workspaces = JSON.parse(readFileSync(workspacesFile, "utf8"));
  }
  if (existsSync(settingsFile)) {
    settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  }

  const plan = planProjectIdentityMigration(projects, workspaces, settings);

  if (!dryRun) {
    const timestamp = Date.now();
    if (existsSync(projectsFile)) {
      copyFileSync(projectsFile, `${projectsFile}.${timestamp}.bak`);
      writeFileSync(projectsFile, JSON.stringify(plan.plannedProjects, null, 2) + "\n");
    }
    if (existsSync(workspacesFile)) {
      copyFileSync(workspacesFile, `${workspacesFile}.${timestamp}.bak`);
      writeFileSync(workspacesFile, JSON.stringify(plan.plannedWorkspaces, null, 2) + "\n");
    }
    if (settings && existsSync(settingsFile)) {
      copyFileSync(settingsFile, `${settingsFile}.${timestamp}.bak`);
      writeFileSync(settingsFile, JSON.stringify(plan.plannedSettings, null, 2) + "\n");
    }
  }

  return {
    dryRun,
    ...plan,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[migrate-project-identity] Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  const res = migrateProjectIdentity(args);
  console.log(`[migrate-project-identity] Mapped ${res.translationMap.size} projects:`);
  for (const [oldId, newId] of res.translationMap) {
    console.log(`  ${oldId} -> ${newId}`);
  }
  console.log("[migrate-project-identity] Done.");
}

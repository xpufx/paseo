import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
if (!process.env.HOOK_STATE_DIR) {
  process.env.HOOK_STATE_DIR = path.join(os.tmpdir(), `paseo-fleet-skills-test-${process.pid}`);
}

import {
  FLEET_SKILL_DEFINITIONS,
  canonicalSkillsRootCandidates,
  getBundledSkillPath,
  getCanonicalSkillPath,
  getEffectiveSkillContent,
  getEffectiveSkillPath,
  handleUppidiSetSkill,
  handleUppidiSkills,
  pluginRootCandidates,
  readBundledSkillContent,
  readCanonicalSkillContent,
  renderSkillDirective,
  resolveCanonicalSkillsRoot,
  resolveEffectiveSkill,
  resolvePluginRoot,
  setSkillContent,
  setSkillsBaseDirForTest,
} from "./skills.js";
import { handleUppidiAddOrchestrator, setExecFileAsyncForTest } from "./agents.js";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

const NO_CONTEXT = {} as PluginHandlerContext;

/** The checkout under test; keep bundled reads off the daemon's installed copy. */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledOptions = { rootDir: PLUGIN_ROOT };

function makeBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "paseo-fleet-skills-"));
}

describe("fleet skills effective resolution & overrides (#883)", () => {
  let baseDir: string;

  before(() => {
    baseDir = makeBaseDir();
    setSkillsBaseDirForTest(baseDir);
  });

  after(() => {
    setSkillsBaseDirForTest(null);
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("lists every bundled skill with bundled origin when no canonical root resolves", () => {
    const options = {
      canonicalSkillsRoot: path.join(baseDir, "no-canonical"),
      rootDir: PLUGIN_ROOT,
    };
    for (const def of FLEET_SKILL_DEFINITIONS) {
      const resolved = resolveEffectiveSkill(def.id, options);
      assert.equal(resolved.origin, "bundled");
      assert.equal(resolved.content, readBundledSkillContent(def.id, options));
      assert.equal(resolved.effectivePath, getBundledSkillPath(def.id, options));
      assert.ok(resolved.content.length > 0);
    }
  });

  it("RPC list returns all fleet skills with title, content, and origin", async () => {
    const res = await handleUppidiSkills({}, NO_CONTEXT);
    assert.equal(res.ok, true);
    assert.deepEqual(
      res.skills.map((s) => s.id),
      FLEET_SKILL_DEFINITIONS.map((d) => d.id),
    );
    assert.ok(
      res.skills.every((s) =>
        ["override", "canonical", "bundled"].includes(s.origin),
      ),
    );
    assert.ok(res.skills.every((s) => s.content.length > 0));
    assert.ok(res.skills.every((s) => s.title.length > 0));
  });

  it("save persists an override under plugin-data without touching the checkout", async () => {
    const bundledBefore = readBundledSkillContent("orchestrator");
    const sentinel = "# Orchestrator override\n\nsentinel-883\n";

    const saveRes = await handleUppidiSetSkill(
      { id: "orchestrator", content: sentinel },
      NO_CONTEXT,
    );
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.skill?.origin, "override");
    assert.equal(saveRes.skill?.content, sentinel);

    const overridePath = path.join(baseDir, "uppidi-fleet", "skills", "orchestrator.md");
    assert.ok(fs.existsSync(overridePath), "override markdown should exist under plugin-data");
    assert.equal(fs.readFileSync(overridePath, "utf8"), sentinel);

    // The effective resolution now reads the override, and the spawn prompt
    // points at the override file rather than the bundled copy.
    const resolved = resolveEffectiveSkill("orchestrator");
    assert.equal(resolved.origin, "override");
    assert.equal(resolved.content, sentinel);
    assert.equal(resolved.effectivePath, overridePath);
    assert.equal(getEffectiveSkillPath("orchestrator"), overridePath);

    // The bundled checkout copy and ~/.agents are never written.
    assert.equal(readBundledSkillContent("orchestrator"), bundledBefore);
    assert.ok(overridePath.startsWith(baseDir), "override should live under the plugin-data base dir");
    assert.ok(!overridePath.startsWith(path.join(os.homedir(), ".agents")));
  });

  it("reset removes the override and restores the bundled text", async () => {
    const sentinel = "# temporary override\n";
    await handleUppidiSetSkill({ id: "front-desk", content: sentinel }, NO_CONTEXT);
    const overridePath = path.join(baseDir, "uppidi-fleet", "skills", "front-desk.md");
    assert.ok(fs.existsSync(overridePath));

    const resetRes = await handleUppidiSetSkill({ id: "front-desk", content: null }, NO_CONTEXT);
    assert.equal(resetRes.ok, true);
    assert.notEqual(resetRes.skill?.origin, "override");
    assert.equal(resetRes.skill?.content, resolveEffectiveSkill("front-desk").content);
    assert.equal(fs.existsSync(overridePath), false, "override file should be removed");
  });

  it("rejects an unknown skill id", async () => {
    const res = await handleUppidiSetSkill({ id: "not-a-skill", content: "x" }, NO_CONTEXT);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /Unknown skill id/);
  });

  it("setSkillContent reports unknown ids", () => {
    assert.throws(() => setSkillContent("nope", "x"), /Unknown skill id/);
  });
});

describe("spawned agents use the effective skill (#883)", () => {
  let baseDir: string;

  before(() => {
    baseDir = makeBaseDir();
    setSkillsBaseDirForTest(baseDir);
  });

  after(() => {
    setSkillsBaseDirForTest(null);
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("handleUppidiAddOrchestrator prompt points at the saved override", async () => {
    const sentinel = "# Orchestrator override for spawn test\n\nonly-override-body-883\n";
    await handleUppidiSetSkill({ id: "orchestrator", content: sentinel }, NO_CONTEXT);

    let capturedPayload: any = null;
    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            capturedPayload = opts;
            return {
              agent: {
                id: "agent-orch-883",
                name: opts.title,
                role: opts.role,
                status: "running",
              },
            };
          },
        },
      },
    };

    setExecFileAsyncForTest(async (cmd: string, args: readonly string[]) => {
      if (cmd === "paseo" && args[0] === "workspace" && args[1] === "ls") {
        return {
          stdout: JSON.stringify([
            {
              workspaceId: "wks_883",
              project: "sample-883",
              name: "Main",
              isolation: "local",
              cwd: "/home/user/code/sample-883",
            },
          ]),
        };
      }
      return { stdout: "[]" };
    });

    try {
      const res = await handleUppidiAddOrchestrator(
        { repo: "xpufx-org/sample-883" },
        mockContext,
      );
      assert.equal(res.ok, true);
      assert.ok(capturedPayload, "spawn payload should be captured");

      const overridePath = path.join(baseDir, "uppidi-fleet", "skills", "orchestrator.md");
      assert.ok(
        capturedPayload.prompt.includes("only-override-body-883"),
        "orchestrator prompt must inline the override content",
      );
      assert.ok(
        !capturedPayload.prompt.includes("examples/skills/orchestrator/SKILL.md"),
        "orchestrator prompt must not fall back to the bundled path when an override exists",
      );
      assert.equal(fs.readFileSync(overridePath, "utf8"), sentinel);
      // Workers are handed the coding-agent skill inline; the scratch rule must
      // survive whatever source (override, canonical, or bundled) wins.
      assert.ok(
        capturedPayload.prompt.includes("<workspace>/.tmp/"),
        "orchestrator prompt must inline the coding-agent .tmp scratch rule",
      );
    } finally {
      setExecFileAsyncForTest(null);
    }
  });
});

describe("bundle-safe plugin root resolution (#926)", () => {
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  function scratchDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "paseo-fleet-skillroot-"));
  }

  function writeConfig(home: string, pluginPath: string): void {
    fs.mkdirSync(path.join(home, ".paseo"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".paseo", "config.json"),
      JSON.stringify({
        plugins: {
          "uppidi-fleet": { source: "directory", path: pluginPath, enabled: true },
        },
      }),
    );
  }

  it("resolves the bundled default through the config path with import.meta.url absent", () => {
    const home = scratchDir();
    const cwd = scratchDir();
    try {
      writeConfig(home, pluginRoot);
      const options = { env: {}, home, cwd, moduleUrl: null };
      const expected = path.join(pluginRoot, "examples", "skills", "orchestrator", "SKILL.md");
      assert.equal(getBundledSkillPath("orchestrator", options), expected);
      assert.ok(readBundledSkillContent("orchestrator", options).length > 0);
      assert.equal(resolvePluginRoot(options), pluginRoot);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("honours PASEO_UPPIDI_FLEET_ROOT over the config path", () => {
    const envRoot = scratchDir();
    const home = scratchDir();
    const cwd = scratchDir();
    try {
      const skillDir = path.join(envRoot, "examples", "skills", "orchestrator");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# env-root\n");
      writeConfig(home, "/nonexistent/config-root");
      const options = { env: { PASEO_UPPIDI_FLEET_ROOT: envRoot }, home, cwd, moduleUrl: null };
      assert.equal(pluginRootCandidates(options)[0], envRoot);
      assert.equal(getBundledSkillPath("orchestrator", options), path.join(skillDir, "SKILL.md"));
      assert.equal(readBundledSkillContent("orchestrator", options), "# env-root\n");
    } finally {
      fs.rmSync(envRoot, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("degrades to an empty bundled default instead of throwing when nothing resolves", () => {
    const home = scratchDir();
    const cwd = scratchDir();
    const baseDir = scratchDir();
    try {
      const options = { env: {}, home, cwd, moduleUrl: null };
      assert.equal(resolvePluginRoot(options), null);
      assert.equal(getBundledSkillPath("orchestrator", options), null);
      assert.equal(readBundledSkillContent("orchestrator", options), "");

      const skill = resolveEffectiveSkill("orchestrator", { ...options, baseDir });
      assert.equal(skill.origin, "bundled");
      assert.equal(skill.content, "");
      assert.equal(skill.effectivePath, "");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("loads the daemon-style bundle (no import.meta.url) and resolves via config", async () => {
    const scratch = scratchDir();
    const home = scratchDir();
    try {
      const outfile = path.join(scratch, "skills.bundle.cjs");
      await build({
        entryPoints: [path.join(pluginRoot, "server", "skills.ts")],
        bundle: true,
        format: "cjs",
        jsx: "automatic",
        platform: "node",
        target: "node20",
        external: ["@getpaseo/plugin", "@getpaseo/plugin/server"],
        treeShaking: true,
        logLevel: "silent",
        absWorkingDir: pluginRoot,
        outfile,
      });
      writeConfig(home, pluginRoot);
      const require = createRequire(outfile);
      // Pre-#926 this threw ERR_INVALID_ARG_TYPE at load: the bundle inlines the
      // module with import.meta.url absent, and PLUGIN_ROOT read it unguarded.
      const mod = require(outfile) as typeof import("./skills.js");
      const options = { env: {}, home, cwd: scratch, moduleUrl: null };
      assert.equal(
        mod.getBundledSkillPath("coding-agent", options),
        path.join(pluginRoot, "examples", "skills", "coding-agent", "SKILL.md"),
      );
      assert.ok(mod.readBundledSkillContent("coding-agent", options).length > 0);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

/**
 * Extract the "Workspace Scratch Isolation (`.tmp/`)" blockquote so the drift
 * check can compare the canonical and bundled copies without tripping over the
 * host/identity sanitization the bundled fallback deliberately carries (#717).
 */
function extractScratchRule(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes("Workspace Scratch Isolation"));
  if (start === -1) return null;
  const block: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith(">")) break;
    block.push(line.trim());
  }
  return block.join("\n");
}

describe("canonical platform skill resolution (#1080)", () => {
  function writeSkill(root: string, id: string, body: string): string {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    fs.writeFileSync(file, body, "utf8");
    return file;
  }

  it("prefers the canonical copy and inlines its content into spawn prompts", () => {
    const canonicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-canonical-"));
    const baseDir = makeBaseDir();
    try {
      const body =
        "# Orchestrator canonical\n\n" +
        "Workspace Scratch Isolation (`.tmp/`): always use `<workspace>/.tmp/`.\n";
      const canonicalFile = writeSkill(canonicalRoot, "orchestrator", body);
      const options = { canonicalSkillsRoot: canonicalRoot, baseDir };

      assert.deepEqual(canonicalSkillsRootCandidates(options), [canonicalRoot]);
      assert.equal(resolveCanonicalSkillsRoot(options), canonicalRoot);
      assert.equal(getCanonicalSkillPath("orchestrator", options), canonicalFile);
      assert.equal(readCanonicalSkillContent("orchestrator", options), body);

      const resolved = resolveEffectiveSkill("orchestrator", options);
      assert.equal(resolved.origin, "canonical");
      assert.equal(resolved.content, body);
      assert.equal(resolved.effectivePath, canonicalFile);
      assert.equal(getEffectiveSkillContent("orchestrator", options), body);

      const directive = renderSkillDirective("orchestrator", options);
      assert.ok(directive.includes("<workspace>/.tmp/"), "inlined text carries the scratch rule");
      assert.ok(
        !directive.includes("examples/skills/orchestrator/SKILL.md"),
        "inlining must not point the agent back at a permission-gated path",
      );
    } finally {
      fs.rmSync(canonicalRoot, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("falls back to the bundled copy when the canonical root is absent", () => {
    const baseDir = makeBaseDir();
    const options = {
      canonicalSkillsRoot: path.join(baseDir, "missing"),
      baseDir,
      rootDir: PLUGIN_ROOT,
    };
    try {
      assert.equal(resolveCanonicalSkillsRoot(options), null);
      assert.equal(getCanonicalSkillPath("orchestrator", options), null);
      assert.equal(readCanonicalSkillContent("orchestrator", options), "");

      const resolved = resolveEffectiveSkill("orchestrator", options);
      assert.equal(resolved.origin, "bundled");
      assert.equal(resolved.content, readBundledSkillContent("orchestrator", options));
      assert.ok(resolved.content.length > 0);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps the operator override ahead of the canonical copy", async () => {
    const canonicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-canonical-"));
    const baseDir = makeBaseDir();
    setSkillsBaseDirForTest(baseDir);
    try {
      writeSkill(canonicalRoot, "orchestrator", "# canonical copy\n");
      const sentinel = "# operator override wins\n";
      await handleUppidiSetSkill({ id: "orchestrator", content: sentinel }, NO_CONTEXT);

      const resolved = resolveEffectiveSkill("orchestrator", {
        canonicalSkillsRoot: canonicalRoot,
        baseDir,
      });
      assert.equal(resolved.origin, "override");
      assert.equal(resolved.content, sentinel);
    } finally {
      setSkillsBaseDirForTest(null);
      fs.rmSync(canonicalRoot, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("carries the .tmp rule through the effective text from either source", () => {
    const canonicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-canonical-"));
    const baseDir = makeBaseDir();
    try {
      for (const id of ["orchestrator", "coding-agent"] as const) {
        writeSkill(
          canonicalRoot,
          id,
          `# ${id}\n\nWorkspace Scratch Isolation (\`.tmp/\`): use \`<workspace>/.tmp/\`.\n`,
        );

        const canonical = resolveEffectiveSkill(id, { canonicalSkillsRoot: canonicalRoot, baseDir });
        assert.equal(canonical.origin, "canonical");
        assert.ok(canonical.content.includes("<workspace>/.tmp/"));
        assert.ok(renderSkillDirective(id, { canonicalSkillsRoot: canonicalRoot, baseDir }).includes("<workspace>/.tmp/"));

        const bundled = resolveEffectiveSkill(id, {
          canonicalSkillsRoot: path.join(baseDir, "missing"),
          baseDir,
          rootDir: PLUGIN_ROOT,
        });
        assert.equal(bundled.origin, "bundled");
        assert.ok(
          bundled.content.includes("<workspace>/.tmp/"),
          `${id} bundled fallback must carry the .tmp rule`,
        );
        assert.ok(
          renderSkillDirective(id, {
            canonicalSkillsRoot: path.join(baseDir, "missing"),
            baseDir,
            rootDir: PLUGIN_ROOT,
          }).includes("<workspace>/.tmp/"),
        );
      }
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.rmSync(canonicalRoot, { recursive: true, force: true });
    }
  });
});

describe("platform canonical vs bundled skill drift (#1080)", () => {
  it("keeps the .tmp scratch rule byte-identical across both copies", (t) => {
    const canonicalRoot = resolveCanonicalSkillsRoot();
    if (!canonicalRoot) {
      t.skip("platform checkout unavailable; drift check skipped (bundled fallback is in use)");
      return;
    }

    for (const id of ["orchestrator", "coding-agent"] as const) {
      assert.ok(
        getCanonicalSkillPath(id),
        `canonical ${id} SKILL.md must resolve under ${canonicalRoot}`,
      );
      const bundledPath = getBundledSkillPath(id, bundledOptions);
      assert.ok(bundledPath, `bundled ${id} SKILL.md fallback must resolve`);

      const canonicalRule = extractScratchRule(readCanonicalSkillContent(id));
      const bundledRule = extractScratchRule(readBundledSkillContent(id, bundledOptions));
      assert.ok(canonicalRule, `canonical ${id} must carry the .tmp scratch rule`);
      assert.equal(
        bundledRule,
        canonicalRule,
        `bundled ${id} drifted from the canonical .tmp scratch rule`,
      );
    }
  });
});

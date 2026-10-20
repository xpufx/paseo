import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPromptManagerContent,
  getPromptManagerConfigPath,
  getPromptManagerSettings,
  isPromptManagerRunning,
  loadPromptManagerSlashCommands,
  parsePromptFile,
  promptIdToCommandName,
  PROMPT_MANAGER_PLUGIN_ID,
} from "./prompt-manager";
import {
  handleGetSettings,
  handleListCommands,
  handleResetSettings,
  handleRunCommand,
  handleUpdateSettings,
} from "./resources";
import { getSlashSettingsStorage, resetSlashSettingsStorageInstance } from "./settings";

// Mock isPluginRunning from helper
vi.mock("paseo-plugin-helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("paseo-plugin-helper/server")>();
  return {
    ...actual,
    isPluginRunning: vi.fn().mockResolvedValue(false),
  };
});

describe("promptIdToCommandName", () => {
  it("normalizes filenames, folders, and special characters into lowercase dashes", () => {
    expect(promptIdToCommandName("review")).toBe("review");
    expect(promptIdToCommandName("code-review.md")).toBe("code-review");
    expect(promptIdToCommandName("frontend/button-check")).toBe("frontend-button-check");
    expect(promptIdToCommandName("Architecture/API/Spec-v2.md")).toBe("architecture-api-spec-v2");
    expect(promptIdToCommandName("--leading-trailing--")).toBe("leading-trailing");
  });
});

describe("isPromptManagerRunning (presence detection)", () => {
  it("detects running plugin via context.paseo.plugins.list() canonical source", async () => {
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: "top", status: "running", enabled: true },
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
      },
    };

    const isRunning = await isPromptManagerRunning(mockContext);
    expect(isRunning).toBe(true);
    expect(mockContext.paseo.plugins.list).toHaveBeenCalledTimes(1);
  });

  it("returns false when plugin in list is disabled or failed", async () => {
    const disabledContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: false },
          ]),
        },
      },
    };
    expect(await isPromptManagerRunning(disabledContext)).toBe(false);

    const failedContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "failed", enabled: true },
          ]),
        },
      },
    };
    expect(await isPromptManagerRunning(failedContext)).toBe(false);
  });

  it("returns false when plugin is absent from list", async () => {
    const absentContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: "mcp-tools", status: "running", enabled: true },
          ]),
        },
      },
    };
    expect(await isPromptManagerRunning(absentContext)).toBe(false);
  });

  it("delegates to isPluginRunning when context.paseo.plugins.list is not available", async () => {
    const { isPluginRunning: mockIsPluginRunning } = await import("paseo-plugin-helper/server");
    vi.mocked(mockIsPluginRunning).mockResolvedValueOnce(true);

    const result = await isPromptManagerRunning();
    expect(result).toBe(true);
    expect(mockIsPluginRunning).toHaveBeenCalledWith(PROMPT_MANAGER_PLUGIN_ID);
  });
});

describe("handleGetSettings & capability flag", () => {
  beforeEach(async () => {
    resetSlashSettingsStorageInstance();
    await handleResetSettings();
  });

  it("returns hasPromptManager: true when plugin is running", async () => {
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
      },
    };

    const settings = await handleGetSettings(mockContext);
    expect(settings.hasPromptManager).toBe(true);
    expect(settings.includePromptManagerPrompts).toBe(false);
  });

  it("returns hasPromptManager: false when plugin is absent", async () => {
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([]),
        },
      },
    };

    const settings = await handleGetSettings(mockContext);
    expect(settings.hasPromptManager).toBe(false);
  });

  it("does not persist hasPromptManager into settingsStorage during update", async () => {
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
      },
    };

    const updated = await handleUpdateSettings(
      { includePromptManagerPrompts: true, hasPromptManager: true },
      mockContext,
    );
    expect(updated.includePromptManagerPrompts).toBe(true);
    expect(updated.hasPromptManager).toBe(true);

    // Verify stored raw data does not persist hasPromptManager
    const storage = getSlashSettingsStorage();
    const stored = await storage.readAsync();
    expect(stored.includePromptManagerPrompts).toBe(true);
    expect(stored.hasPromptManager).toBeUndefined();
  });
});

describe("prompt manager storage resolution", () => {
  const TEST_ROOT = path.resolve(__dirname, "../../../.tmp/test-pm-" + process.pid);
  const TEST_CONFIG_HOME = path.join(TEST_ROOT, "config");
  const origXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_CONFIG_HOME, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_CONFIG_HOME;
    resetSlashSettingsStorageInstance();
    await handleResetSettings();
  });

  afterEach(async () => {
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("reads custom directory from prompt-manager.json", async () => {
    const customDir = path.join(TEST_ROOT, "custom-prompts");
    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(
      configFile,
      JSON.stringify({ directory: customDir, gitEnabled: true, syncMode: "manual" }),
    );

    const settings = await getPromptManagerSettings();
    expect(settings.directory).toBe(customDir);
    expect(settings.gitEnabled).toBe(true);
  });

  it("resolves tilde in custom directory to os.homedir()", async () => {
    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(
      configFile,
      JSON.stringify({ directory: "~/test-prompts-dir", gitEnabled: false }),
    );

    const settings = await getPromptManagerSettings();
    expect(settings.directory).toBe(path.join(os.homedir(), "test-prompts-dir"));
  });

  it("falls back to default prompt-lib directory when prompt-manager.json is missing", async () => {
    const settings = await getPromptManagerSettings();
    const expectedDefault = path.join(TEST_CONFIG_HOME, "paseo", "prompt-lib");
    expect(settings.directory).toBe(expectedDefault);
  });

  it("falls back to default directory when prompt-manager.json has invalid JSON or missing directory", async () => {
    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, "NOT_VALID_JSON{");

    const settings1 = await getPromptManagerSettings();
    expect(settings1.directory).toBe(path.join(TEST_CONFIG_HOME, "paseo", "prompt-lib"));

    await fs.writeFile(configFile, JSON.stringify({ directory: "" }));
    const settings2 = await getPromptManagerSettings();
    expect(settings2.directory).toBe(path.join(TEST_CONFIG_HOME, "paseo", "prompt-lib"));
  });

  it("parses frontmatter metadata and content correctly", () => {
    const rawWithFrontmatter = `---
paseo: {"description":"Review pull requests","tags":["review","git"]}
---
# PR Review
Review the following PR changes: {args}`;

    const parsed1 = parsePromptFile(rawWithFrontmatter);
    expect(parsed1.metadata?.description).toBe("Review pull requests");
    expect(parsed1.metadata?.tags).toEqual(["review", "git"]);
    expect(parsed1.body).toBe(`# PR Review\nReview the following PR changes: {args}`);

    const rawWithoutFrontmatter = `# Simple Prompt\nJust the prompt body`;
    const parsed2 = parsePromptFile(rawWithoutFrontmatter);
    expect(parsed2.metadata).toBeUndefined();
    expect(parsed2.body).toBe(rawWithoutFrontmatter);

    const rawWithInvalidJson = `---
paseo: {corrupted json}
---
# Invalid Frontmatter
Body content`;
    const parsed3 = parsePromptFile(rawWithInvalidJson);
    expect(parsed3.metadata).toBeUndefined();
    expect(parsed3.body).toBe(`# Invalid Frontmatter\nBody content`);
  });

  it("loads commands from custom directory, parsing headings and frontmatter", async () => {
    const customDir = path.join(TEST_ROOT, "my-prompts");
    await fs.mkdir(path.join(customDir, "docs"), { recursive: true });
    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({ directory: customDir }));

    // File 1: With frontmatter and heading
    await fs.writeFile(
      path.join(customDir, "code-review.md"),
      `---
paseo: {"description":"Thorough review of staged changes","tags":["review"]}
---
# Code Review
Please review the following code changes: {args}`,
    );

    // File 2: Nested folder with heading but no frontmatter
    await fs.writeFile(
      path.join(customDir, "docs", "generate.md"),
      `# Generate Docs
Generate markdown API documentation for: {args}`,
    );

    // File 3: Without heading (falls back to prompt name)
    await fs.writeFile(
      path.join(customDir, "no-heading.md"),
      `---
paseo: {"description":"Prompt without markdown heading"}
---
Content with no title`,
    );

    const commands = await loadPromptManagerSlashCommands();
    expect(commands).toHaveLength(3);

    const codeReview = commands.find((c) => c.name === "code-review");
    expect(codeReview).toEqual({
      name: "code-review",
      title: "Code Review",
      description: "Thorough review of staged changes",
      enabled: true,
      source: PROMPT_MANAGER_PLUGIN_ID,
      promptId: "code-review",
      action: {
        verb: "send",
        template: "{args}",
      },
    });

    const docsGenerate = commands.find((c) => c.name === "docs-generate");
    expect(docsGenerate).toEqual({
      name: "docs-generate",
      title: "Generate Docs",
      description: "Prompt Manager prompt",
      enabled: true,
      source: PROMPT_MANAGER_PLUGIN_ID,
      promptId: "docs/generate",
      action: {
        verb: "send",
        template: "{args}",
      },
    });

    const noHeading = commands.find((c) => c.name === "no-heading");
    expect(noHeading?.title).toBe("no-heading");
    expect(noHeading?.description).toBe("Prompt without markdown heading");
  });

  it("skips versions directory, dotfiles, dotdirs, and non-md files", async () => {
    const customDir = path.join(TEST_ROOT, "filtered-prompts");
    await fs.mkdir(path.join(customDir, "versions", "code-review"), { recursive: true });
    await fs.mkdir(path.join(customDir, ".hidden"), { recursive: true });
    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({ directory: customDir }));

    // Valid prompt
    await fs.writeFile(path.join(customDir, "valid.md"), "# Valid\nValid body");

    // Skipped items
    await fs.writeFile(path.join(customDir, "versions", "code-review", "v1.md"), "# V1");
    await fs.writeFile(path.join(customDir, ".hidden", "secret.md"), "# Secret");
    await fs.writeFile(path.join(customDir, ".dotfile.md"), "# Dotfile");
    await fs.writeFile(path.join(customDir, "readme.txt"), "Not markdown");

    const commands = await loadPromptManagerSlashCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("valid");
  });

  it("handles missing directories and files gracefully", async () => {
    // Missing directory returns empty array without throwing
    const commands = await loadPromptManagerSlashCommands();
    expect(commands).toEqual([]);

    // fetchPromptManagerContent throws descriptive error on missing file
    await expect(fetchPromptManagerContent("non-existent-prompt")).rejects.toThrow(
      /Failed to read prompt "non-existent-prompt" from paseo-prompt-manager/,
    );
  });

  it("fetches prompt content and strips frontmatter header", async () => {
    const customDir = path.join(TEST_ROOT, "fetch-prompts");
    await fs.mkdir(customDir, { recursive: true });
    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({ directory: customDir }));

    await fs.writeFile(
      path.join(customDir, "my-prompt.md"),
      `---
paseo: {"description":"Custom header"}
---
# Title
Actual prompt body for {args}`,
    );

    const content = await fetchPromptManagerContent("my-prompt");
    expect(content).toBe("# Title\nActual prompt body for {args}");
  });
});

describe("handleListCommands & catalog composition", () => {
  const TEST_ROOT = path.resolve(__dirname, "../../../.tmp/test-pm-catalog-" + process.pid);
  const TEST_CONFIG_HOME = path.join(TEST_ROOT, "config");
  const customDir = path.join(TEST_ROOT, "catalog-prompts");
  const origXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_CONFIG_HOME, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_CONFIG_HOME;

    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({ directory: customDir }));

    await fs.writeFile(
      path.join(customDir, "unit-test-generator.md"),
      `---
paseo: {"description":"Generates comprehensive unit tests"}
---
# Unit Test Generator
Write unit tests for: {args}`,
    );

    resetSlashSettingsStorageInstance();
    await handleResetSettings();
  });

  afterEach(async () => {
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("handleListCommands returns only base commands when toggle is false", async () => {
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
      },
    };

    const { commands } = await handleListCommands(mockContext);
    expect(commands.some((c) => c.source === PROMPT_MANAGER_PLUGIN_ID)).toBe(false);
  });

  it("handleListCommands returns only base commands when toggle is true but plugin is absent", async () => {
    await handleUpdateSettings({ includePromptManagerPrompts: true });

    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([]), // absent
        },
      },
    };

    const { commands } = await handleListCommands(mockContext);
    expect(commands.some((c) => c.source === PROMPT_MANAGER_PLUGIN_ID)).toBe(false);
  });

  it("handleListCommands merges external prompts dynamically when toggle is true and plugin is running", async () => {
    await handleUpdateSettings({ includePromptManagerPrompts: true });

    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
      },
    };

    const { commands } = await handleListCommands(mockContext);
    const pmCommand = commands.find((c) => c.name === "unit-test-generator");
    expect(pmCommand).toBeDefined();
    expect(pmCommand?.title).toBe("Unit Test Generator");
    expect(pmCommand?.description).toBe("Generates comprehensive unit tests");
    expect(pmCommand?.action.verb).toBe("send");
    expect(pmCommand?.source).toBe(PROMPT_MANAGER_PLUGIN_ID);

    // Verify zero duplication into slash storage
    const storage = getSlashSettingsStorage();
    const stored = await storage.readAsync();
    expect(stored.commands.some((c) => c.name === "unit-test-generator")).toBe(false);
  });
});

describe("handleRunCommand & live prompt execution", () => {
  const TEST_ROOT = path.resolve(__dirname, "../../../.tmp/test-pm-run-" + process.pid);
  const TEST_CONFIG_HOME = path.join(TEST_ROOT, "config");
  const customDir = path.join(TEST_ROOT, "run-prompts");
  const origXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_CONFIG_HOME, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_CONFIG_HOME;

    const configFile = getPromptManagerConfigPath();
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({ directory: customDir }));

    resetSlashSettingsStorageInstance();
    await handleResetSettings();
    await handleUpdateSettings({ includePromptManagerPrompts: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("executes external prompt by dynamically reading fresh Markdown from disk", async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const promptPath = path.join(customDir, "unit-tests.md");

    await fs.writeFile(
      promptPath,
      `---
paseo: {"description":"Generate unit tests"}
---
# Unit Tests
Write unit tests for the following file: {args}`,
    );

    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
        agents: {
          ref: vi.fn().mockReturnValue({
            send: sendFn,
          }),
        },
      },
    };

    // First run
    const result1 = await handleRunCommand(
      { name: "unit-tests", args: "server/resources.ts", agentId: "agent-run-1" },
      mockContext,
    );

    expect(result1.verb).toBe("send");
    expect(result1.prompt).toBe(
      "# Unit Tests\nWrite unit tests for the following file: server/resources.ts",
    );
    expect(sendFn).toHaveBeenCalledWith(
      "# Unit Tests\nWrite unit tests for the following file: server/resources.ts",
    );

    // Simulate edit in Prompt Manager directly on disk
    await fs.writeFile(
      promptPath,
      `---
paseo: {"description":"Updated"}
---
# Unit Tests
UPDATED: Review security vulnerabilities in: {args}`,
    );

    // Second run immediately observes live disk edit without restarting or importing
    const result2 = await handleRunCommand(
      { name: "unit-tests", args: "auth.ts", agentId: "agent-run-1" },
      mockContext,
    );

    expect(result2.verb).toBe("send");
    expect(result2.prompt).toBe(
      "# Unit Tests\nUPDATED: Review security vulnerabilities in: auth.ts",
    );
    expect(sendFn).toHaveBeenCalledWith(
      "# Unit Tests\nUPDATED: Review security vulnerabilities in: auth.ts",
    );
  });

  it("handles missing prompt file gracefully and appends error to timeline", async () => {
    const timelineAppend = vi.fn().mockResolvedValue(undefined);

    // Create prompt file initially so it registers in commands
    const promptPath = path.join(customDir, "broken-prompt.md");
    await fs.writeFile(promptPath, "# Broken Prompt\nSome text");

    let readCount = 0;
    const realReadFile = fs.readFile;
    vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      if (String(filePath).includes("broken-prompt.md")) {
        readCount++;
        // First read occurs during handleListCommands; second read occurs during fetchPromptManagerContent
        if (readCount > 1) {
          throw new Error("Prompt file corrupted or deleted");
        }
      }
      return realReadFile(filePath, options);
    });

    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
        agents: {
          ref: vi.fn().mockReturnValue({
            timeline: { append: timelineAppend },
            send: vi.fn(),
          }),
        },
      },
    };

    await expect(
      handleRunCommand(
        { name: "broken-prompt", args: "", agentId: "agent-err-1" },
        mockContext,
      ),
    ).rejects.toThrow(/Prompt file corrupted or deleted/);

    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "slash-command-result",
        version: 1,
        data: expect.objectContaining({
          command: "broken-prompt",
          status: "error",
          body: expect.stringContaining("Prompt file corrupted or deleted"),
        }),
      }),
    );
  });
});

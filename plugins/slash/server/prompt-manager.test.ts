import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPromptManagerContent,
  getPromptManagerSettings,
  isPromptManagerRunning,
  loadPromptManagerSlashCommands,
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

// Mock isPluginRunning from vendor helper
vi.mock("./vendor/paseo-plugin-helper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vendor/paseo-plugin-helper")>();
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
    const { isPluginRunning: mockIsPluginRunning } = await import("./vendor/paseo-plugin-helper");
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

describe("loadPromptManagerSlashCommands & catalog composition", () => {
  beforeEach(async () => {
    resetSlashSettingsStorageInstance();
    await handleResetSettings();
  });

  it("calls library.settings and prompts.list RPCs over plugin RPC", async () => {
    const invokePluginRpc = vi.fn().mockImplementation((pluginId, method, _input) => {
      expect(pluginId).toBe(PROMPT_MANAGER_PLUGIN_ID);
      if (method === "library.settings") {
        return Promise.resolve({
          directory: "/home/user/.prompts",
          gitEnabled: false,
          syncMode: "manual",
          syncInterval: 15,
        });
      }
      if (method === "prompts.list") {
        return Promise.resolve([
          {
            id: "code-review",
            title: "Code Review",
            description: "Thorough review of staged changes",
          },
          {
            id: "docs/generate",
            title: "Generate Docs",
            description: "Generate API documentation",
          },
        ]);
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const mockContext: any = {
      paseo: {
        invokePluginRpc,
      },
    };

    const settings = await getPromptManagerSettings(mockContext);
    expect(settings.directory).toBe("/home/user/.prompts");

    const commands = await loadPromptManagerSlashCommands(mockContext);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({
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
    expect(commands[1]).toEqual({
      name: "docs-generate",
      title: "Generate Docs",
      description: "Generate API documentation",
      enabled: true,
      source: PROMPT_MANAGER_PLUGIN_ID,
      promptId: "docs/generate",
      action: {
        verb: "send",
        template: "{args}",
      },
    });
  });

  it("handleListCommands returns only base commands when toggle is false", async () => {
    const invokePluginRpc = vi.fn();
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
        invokePluginRpc,
      },
    };

    const { commands } = await handleListCommands(mockContext);
    expect(commands.some((c) => c.source === PROMPT_MANAGER_PLUGIN_ID)).toBe(false);
    expect(invokePluginRpc).not.toHaveBeenCalled();
  });

  it("handleListCommands returns only base commands when toggle is true but plugin is absent", async () => {
    await handleUpdateSettings({ includePromptManagerPrompts: true });

    const invokePluginRpc = vi.fn();
    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([]), // absent
        },
        invokePluginRpc,
      },
    };

    const { commands } = await handleListCommands(mockContext);
    expect(commands.some((c) => c.source === PROMPT_MANAGER_PLUGIN_ID)).toBe(false);
    expect(invokePluginRpc).not.toHaveBeenCalled();
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
        invokePluginRpc: vi.fn().mockImplementation((_plugin, method) => {
          if (method === "library.settings") {
            return Promise.resolve({ directory: "/home/user/.prompts", gitEnabled: false });
          }
          if (method === "prompts.list") {
            return Promise.resolve([
              {
                id: "unit-test-generator",
                title: "Unit Test Generator",
                description: "Generates comprehensive unit tests",
              },
            ]);
          }
          throw new Error(`Unexpected method: ${method}`);
        }),
      },
    };

    const { commands } = await handleListCommands(mockContext);
    const pmCommand = commands.find((c) => c.name === "unit-test-generator");
    expect(pmCommand).toBeDefined();
    expect(pmCommand?.title).toBe("Unit Test Generator");
    expect(pmCommand?.action.verb).toBe("send");
    expect(pmCommand?.source).toBe(PROMPT_MANAGER_PLUGIN_ID);

    // Verify zero duplication into slash storage
    const storage = getSlashSettingsStorage();
    const stored = await storage.readAsync();
    expect(stored.commands.some((c) => c.name === "unit-test-generator")).toBe(false);
  });
});

describe("handleRunCommand & live prompt execution", () => {
  beforeEach(async () => {
    resetSlashSettingsStorageInstance();
    await handleResetSettings();
    await handleUpdateSettings({ includePromptManagerPrompts: true });
  });

  it("executes external prompt by dynamically fetching fresh Markdown via prompts.read RPC", async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    let promptContent = "Write unit tests for the following file: {args}";

    const invokePluginRpc = vi.fn().mockImplementation((pluginId, method, input) => {
      expect(pluginId).toBe(PROMPT_MANAGER_PLUGIN_ID);
      if (method === "library.settings") {
        return Promise.resolve({ directory: "/home/user/.prompts", gitEnabled: false });
      }
      if (method === "prompts.list") {
        return Promise.resolve([
          {
            id: "unit-tests",
            title: "Unit Tests",
            description: "Generate unit tests",
          },
        ]);
      }
      if (method === "prompts.read") {
        expect(input).toEqual({ id: "unit-tests" });
        return Promise.resolve({
          id: "unit-tests",
          title: "Unit Tests",
          content: promptContent,
        });
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
        invokePluginRpc,
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
    expect(result1.prompt).toBe("Write unit tests for the following file: server/resources.ts");
    expect(sendFn).toHaveBeenCalledWith("Write unit tests for the following file: server/resources.ts");
    expect(invokePluginRpc).toHaveBeenCalledWith(PROMPT_MANAGER_PLUGIN_ID, "prompts.read", {
      id: "unit-tests",
    });

    // Simulate edit in Prompt Manager live
    promptContent = "UPDATED: Review security vulnerabilities in: {args}";

    // Second run immediately observes live edit without importing into slash storage
    const result2 = await handleRunCommand(
      { name: "unit-tests", args: "auth.ts", agentId: "agent-run-1" },
      mockContext,
    );

    expect(result2.verb).toBe("send");
    expect(result2.prompt).toBe("UPDATED: Review security vulnerabilities in: auth.ts");
    expect(sendFn).toHaveBeenCalledWith("UPDATED: Review security vulnerabilities in: auth.ts");
  });

  it("handles prompts.read failure gracefully and appends error to timeline", async () => {
    const timelineAppend = vi.fn().mockResolvedValue(undefined);

    const mockContext: any = {
      paseo: {
        plugins: {
          list: vi.fn().mockResolvedValue([
            { id: PROMPT_MANAGER_PLUGIN_ID, status: "running", enabled: true },
          ]),
        },
        invokePluginRpc: vi.fn().mockImplementation((_plugin, method) => {
          if (method === "library.settings") {
            return Promise.resolve({ directory: "/home/user/.prompts", gitEnabled: false });
          }
          if (method === "prompts.list") {
            return Promise.resolve([
              { id: "broken-prompt", title: "Broken Prompt" },
            ]);
          }
          if (method === "prompts.read") {
            return Promise.reject(new Error("Prompt file corrupted or deleted"));
          }
          throw new Error(`Unexpected RPC method: ${method}`);
        }),
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
    ).rejects.toThrow("Prompt file corrupted or deleted");

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

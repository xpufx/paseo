import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  upsertMcpServer,
  removeMcpServer,
  getMcpServer,
  expandPath,
  McpConfigPaths,
} from "../server/mcp-config.js";

describe("McpConfigWriter (server/mcp-config)", () => {
  const testDir = path.join(os.tmpdir(), `paseo-mcp-config-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("creates a brand new config file when it does not exist", () => {
    const configPath = path.join(testDir, "sub", "config.json");
    const result = upsertMcpServer({
      target: configPath,
      serverName: "paseo-gateway",
      config: {
        command: "node",
        args: ["gateway.js"],
        env: { PORT: "4280" },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("created");
    expect(fs.existsSync(configPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.mcpServers["paseo-gateway"]).toEqual({
      command: "node",
      args: ["gateway.js"],
      env: { PORT: "4280" },
    });
  });

  it("updates an existing server while preserving other servers and keys", () => {
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        customSetting: true,
        mcpServers: {
          existingServer: { command: "python", args: ["server.py"] },
          "paseo-gateway": { command: "node", args: ["old.js"] },
        },
      }),
      "utf8"
    );

    const result = upsertMcpServer({
      target: configPath,
      serverName: "paseo-gateway",
      config: {
        command: "node",
        args: ["new.js"],
      },
    });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("updated");

    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.customSetting).toBe(true);
    expect(content.mcpServers.existingServer).toEqual({ command: "python", args: ["server.py"] });
    expect(content.mcpServers["paseo-gateway"]).toEqual({ command: "node", args: ["new.js"] });
  });

  it("is idempotent and returns unchanged when config is identical", () => {
    const configPath = path.join(testDir, "config.json");
    const serverConfig = {
      command: "node",
      args: ["gateway.js"],
      env: { PORT: "4280" },
    };

    upsertMcpServer({
      target: configPath,
      serverName: "paseo-gateway",
      config: serverConfig,
    });

    const statBefore = fs.statSync(configPath);

    // Call again with exact same config
    const secondResult = upsertMcpServer({
      target: configPath,
      serverName: "paseo-gateway",
      config: serverConfig,
    });

    expect(secondResult.changed).toBe(false);
    expect(secondResult.action).toBe("unchanged");

    const statAfter = fs.statSync(configPath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("safely parses JSONC files with comments and trailing commas", () => {
    const configPath = path.join(testDir, "claude.jsonc");
    const jsoncContent = `
    {
      // User comment explaining servers
      "mcpServers": {
        /* Another comment */
        "legacy": {
          "command": "sh",
        },
      },
    }
    `;
    fs.writeFileSync(configPath, jsoncContent, "utf8");

    const result = upsertMcpServer({
      target: configPath,
      serverName: "new-server",
      config: { command: "node", args: ["app.js"] },
    });

    expect(result.changed).toBe(true);
    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.mcpServers.legacy.command).toBe("sh");
    expect(content.mcpServers["new-server"].command).toBe("node");
  });

  it("supports custom keys (e.g. mcp-servers)", () => {
    const configPath = path.join(testDir, "custom.json");
    const result = upsertMcpServer({
      target: { path: configPath, key: "mcp-servers" },
      serverName: "x-comms",
      config: { command: "bun", args: ["run", "x-comms"] },
    });

    expect(result.changed).toBe(true);
    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content["mcp-servers"]["x-comms"].command).toBe("bun");
  });

  it("creates a backup file when backup is enabled", () => {
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), "utf8");

    const result = upsertMcpServer({
      target: configPath,
      serverName: "paseo-gateway",
      config: { command: "node" },
      backup: true,
    });

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath!)).toBe(true);
  });

  it("removes an existing MCP server cleanly", () => {
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          stay: { command: "keep-me" },
          removeMe: { command: "delete-me" },
        },
      }),
      "utf8"
    );

    const result = removeMcpServer({
      target: configPath,
      serverName: "removeMe",
    });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("removed");

    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.mcpServers.stay).toBeDefined();
    expect(content.mcpServers.removeMe).toBeUndefined();
  });

  it("returns not_found when removing non-existent server or file", () => {
    const nonExistent = path.join(testDir, "missing.json");
    const result = removeMcpServer({
      target: nonExistent,
      serverName: "ghost",
    });
    expect(result.changed).toBe(false);
    expect(result.action).toBe("not_found");
  });

  it("retrieves an MCP server configuration with getMcpServer", () => {
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "paseo-gateway": { command: "node", args: ["index.js"] },
        },
      }),
      "utf8"
    );

    const found = getMcpServer(configPath, "paseo-gateway");
    expect(found).toEqual({ command: "node", args: ["index.js"] });

    const missing = getMcpServer(configPath, "non-existent");
    expect(missing).toBeNull();
  });

  it("expands home directory tilde paths properly", () => {
    expect(expandPath("~")).toBe(os.homedir());
    expect(expandPath("~/foo/bar")).toBe(path.join(os.homedir(), "foo", "bar"));
    expect(expandPath("/absolute/path")).toBe(path.resolve("/absolute/path"));
  });

  it("provides valid string paths in McpConfigPaths", () => {
    expect(typeof McpConfigPaths.claudeDesktop()).toBe("string");
    expect(typeof McpConfigPaths.claudeCode()).toBe("string");
    expect(typeof McpConfigPaths.openCode()).toBe("string");
    expect(typeof McpConfigPaths.cursor()).toBe("string");
    expect(typeof McpConfigPaths.gemini()).toBe("string");
    expect(typeof McpConfigPaths.pi()).toBe("string");
  });
});

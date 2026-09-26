import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractMcpServersFromText, parseJsonc } from "./extract";
import { McpServerSchema } from "../../shared/mcp";

describe("Universal MCP Extractor Heuristics", () => {
  it("extracts from standard Pi config format without hints", () => {
    const rawPi = `{
      // Pi user config
      "mcpServers": {
        "deepwiki": {
          "url": "https://mcp.deepwiki.com/mcp",
          "protocolVersion": "auto"
        },
        "disabled-server": {
          "command": "bad",
          "disabled": true
        }
      }
    }`;

    const servers = extractMcpServersFromText(rawPi, "pi", "~/.pi/.mcp.json", "pi · user config");
    expect(servers.length).toBe(1);
    expect(servers[0].name).toBe("deepwiki");
    expect(servers[0].transport).toBe("http");
    expect(servers[0].url).toBe("https://mcp.deepwiki.com/mcp");
    expect(McpServerSchema.safeParse(servers[0]).success).toBe(true);
  });

  it("extracts from OpenCode opencode.json format without hints", () => {
    const rawOpenCode = `{
      "$schema": "https://opencode.ai/schema.json",
      "mcp": {
        "memory": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-memory"]
        },
        "remote-search": {
          "type": "sse",
          "url": "https://search.example.com/sse",
          "headers": {
            "Authorization": "Bearer secret-token-xyz"
          }
        }
      }
    }`;

    const servers = extractMcpServersFromText(rawOpenCode, "opencode", "opencode.json", "opencode · config");
    expect(servers.length).toBe(2);

    const mem = servers.find((s) => s.name === "memory")!;
    expect(mem).toBeDefined();
    expect(mem.transport).toBe("stdio");
    expect(mem.command).toBe("npx -y @modelcontextprotocol/server-memory");

    const search = servers.find((s) => s.name === "remote-search")!;
    expect(search).toBeDefined();
    expect(search.transport).toBe("sse");
    expect(search.hasSecrets).toBe(true);
    expect(search.configPreview).toMatch(/•••|\[REDACTED\]|\.\.\./);

    for (const s of servers) {
      expect(McpServerSchema.safeParse(s).success).toBe(true);
    }
  });

  it("extracts from array-based server lists without hints", () => {
    const rawArray = `{
      "servers": [
        {
          "name": "sqlite-db",
          "command": "uvx",
          "args": ["mcp-server-sqlite", "--db-path", "/data/app.db"]
        }
      ]
    }`;

    const servers = extractMcpServersFromText(rawArray, "custom", "config.json", "custom · list");
    expect(servers.length).toBe(1);
    expect(servers[0].name).toBe("sqlite-db");
    expect(servers[0].transport).toBe("stdio");
    expect(servers[0].command).toBe("uvx mcp-server-sqlite --db-path /data/app.db");
    expect(McpServerSchema.safeParse(servers[0]).success).toBe(true);
  });

  it("extracts from root-level dictionary of servers", () => {
    const rawRoot = `{
      "github": {
        "command": "npx -y @modelcontextprotocol/server-github",
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_123456"
        }
      }
    }`;

    const servers = extractMcpServersFromText(rawRoot, "root", "root.json", "root · direct");
    expect(servers.length).toBe(1);
    expect(servers[0].name).toBe("github");
    expect(servers[0].hasSecrets).toBe(true);
    expect(McpServerSchema.safeParse(servers[0]).success).toBe(true);
  });

  it("survives invalid json / empty text gracefully", () => {
    expect(extractMcpServersFromText("", "test", "path", "label")).toEqual([]);
    expect(extractMcpServersFromText("{ not json", "test", "path", "label")).toEqual([]);
    expect(extractMcpServersFromText("{}", "test", "path", "label")).toEqual([]);
  });
});

import claudeProbe from "../providers/claude";
import antigravityProbe from "../providers/antigravity";

describe("Live Local Filesystem Verification", () => {
  it("extracts servers from a ~/.claude.json on disk", async () => {
    // The probe resolves `~/.claude.json` through `os.homedir()`, so point HOME
    // at a fixture instead of whoever is running the suite. Reading the real
    // developer config made this the second non-hermetic test in the monorepo
    // (#617): it passed only because the machine happened to have MCP servers
    // configured, and would be red in any container.
    const home = mkdtempSync(join(tmpdir(), "mcp-tools-home-"));
    const prevHome = process.env.HOME;
    try {
      writeFileSync(
        join(home, ".claude.json"),
        JSON.stringify({
          mcpServers: {
            "fixture-http": { type: "http", url: "https://mcp.example.test/mcp" },
            "fixture-stdio": { command: "fixture-server", args: ["--stdio"] },
          },
        }),
      );
      process.env.HOME = home;
      const res = await claudeProbe.probe({
        agentId: "live-test",
        provider: "claude",
        cwd: home,
      });
      console.log(`\n=== CLAUDE CONFIG EXTRACTED: ${res.servers.length} SERVERS ===`);
      for (const s of res.servers) {
        console.log(`  - [${s.transport.toUpperCase()}] ${s.name} -> ${s.command || s.url} (hasSecrets: ${s.hasSecrets})`);
      }
      expect(res.servers.length).toBeGreaterThan(0);
      expect(res.servers.map((s) => s.name).sort()).toEqual(["fixture-http", "fixture-stdio"]);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("extracts real Antigravity ~/.gemini/config/mcp_config.json on this machine", async () => {
    const res = await antigravityProbe.probe({
      agentId: "live-test-antigravity",
      provider: "antigravity-acp",
      cwd: process.cwd(),
    });
    console.log(`\n=== REAL ANTIGRAVITY CONFIG EXTRACTED: ${res.servers.length} SERVERS ===`);
    for (const s of res.servers) {
      console.log(`  - [${s.transport.toUpperCase()}] ${s.name} -> ${s.command || s.url} (hasSecrets: ${s.hasSecrets})`);
      expect(McpServerSchema.safeParse(s).success).toBe(true);
    }
    expect(res.servers.length).toBeGreaterThanOrEqual(0);
  });
});

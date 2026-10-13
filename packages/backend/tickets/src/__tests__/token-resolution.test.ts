import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveForgeToken, resolveDefaultForgeHost } from "../server/client.js";

describe("resolveForgeToken — scoped to caller plugin, no ambient fallback (#1332)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalPaseoHome: string | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalPaseoHome = process.env.PASEO_HOME;
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
      else process.env[k] = originalEnv[k];
    });
    process.env.PASEO_HOME = originalPaseoHome;
  });

  it("resolves token via explicit readSettings callback", async () => {
    const readSettings = vi.fn().mockResolvedValue({
      tokensByHost: { "forge.mrs.uppidi.com": "callback-token" },
    });
    const result = await resolveForgeToken("forge.mrs.uppidi.com", {
      storagePluginId: "my-plugin",
      readSettings,
    });
    expect(result).toBe("callback-token");
    expect(readSettings).toHaveBeenCalledWith("my-plugin", "settings.json");
  });

  it("resolves token from caller's plugin settings file when storagePluginId is provided", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    // Write settings directly to a temp dir with mkdir -p.
    const fs = await import("node:fs/promises");
    const base = join(tmpdir(), `tickets-test-${Date.now()}`);
    const settingsDir = join(base, "plugin-data", "xpufx", "my-scoped-plugin");
    const settingsPath = join(settingsDir, "settings.json");
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({ tokensByHost: { "forge.mrs.uppidi.com": "scoped-token-abc" } }), "utf8");
    process.env.PASEO_HOME = base;
    const result = await resolveForgeToken("forge.mrs.uppidi.com", {
      storagePluginId: "my-scoped-plugin",
    });
    expect(result).toBe("scoped-token-abc");
    await fs.rm(base, { recursive: true, force: true });
  });

  it("returns undefined when storagePluginId is NOT provided (no 'forges' fallback)", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    // No storagePluginId means we skip settings entirely.
    const result = await resolveForgeToken("forge.mrs.uppidi.com");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no token configured anywhere", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    // Use a non-existent path so no settings file can be found.
    process.env.PASEO_HOME = "/nonexistent/paseo/home/path-xyz";
    const result = await resolveForgeToken("forge.mrs.uppidi.com", {
      storagePluginId: "my-plugin",
    });
    expect(result).toBeUndefined();
  });

  it("prefers env FORGEJO_TOKEN over plugin settings", async () => {
    process.env.FORGEJO_TOKEN = "env-wins";
    delete process.env.GITEA_TOKEN;
    // Even with settings that have a token, env takes priority.
    const result = await resolveForgeToken("forge.mrs.uppidi.com", {
      storagePluginId: "my-plugin",
    });
    expect(result).toBe("env-wins");
  });

  it("does NOT read ~/.config/tea/config.yml", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    // Use a completely non-existent path so no settings file can be found.
    process.env.PASEO_HOME = "/nonexistent/paseo/home/path-xyz";
    // Even though ~/.config/tea/config.yml exists on this machine,
    // resolveForgeToken must not read it.
    const result = await resolveForgeToken("forge.mrs.uppidi.com", {
      storagePluginId: "my-plugin",
    });
    expect(result).toBeUndefined();
  });
});

describe("resolveDefaultForgeHost — no tea/config.yml fallback (#1332)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
      else process.env[k] = originalEnv[k];
    });
  });

  it("returns FORGEJO_HOST when set", async () => {
    process.env.FORGEJO_HOST = "custom.forge.example.com";
    delete process.env.GITEA_HOST;
    const result = await resolveDefaultForgeHost();
    expect(result).toBe("custom.forge.example.com");
  });

  it("returns GITEA_HOST as fallback", async () => {
    delete process.env.FORGEJO_HOST;
    process.env.GITEA_HOST = "gitea.example.com";
    const result = await resolveDefaultForgeHost();
    expect(result).toBe("gitea.example.com");
  });

  it("strips protocol and trailing slashes from host values", async () => {
    process.env.FORGEJO_HOST = "https://custom.forge.example.com/";
    delete process.env.GITEA_HOST;
    const result = await resolveDefaultForgeHost();
    expect(result).toBe("custom.forge.example.com");
  });

  it("defaults to forge.mrs.uppidi.com without env vars or tea config", async () => {
    delete process.env.FORGEJO_HOST;
    delete process.env.GITEA_HOST;
    const result = await resolveDefaultForgeHost();
    expect(result).toBe("forge.mrs.uppidi.com");
  });
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveForgejoToken, setTokenResolverForTest } from "./forgejo-api.js";

describe("resolveForgejoToken — no ambient credential harvesting (#1332)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalPaseoHome: string | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalPaseoHome = process.env.PASEO_HOME;
    setTokenResolverForTest(null);
  });

  afterEach(async () => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
      else process.env[k] = originalEnv[k];
    });
    process.env.PASEO_HOME = originalPaseoHome;
    setTokenResolverForTest(null);
  });

  it("returns null when no env var and no plugin settings exist", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    // Point at a non-existent temp home so no settings exist.
    process.env.PASEO_HOME = "/nonexistent/paseo/home/path-xyz";
    const result = await resolveForgejoToken("forge.mrs.uppidi.com");
    assert.equal(result, null);
  });

  it("resolves token from FORGEJO_TOKEN env var", async () => {
    process.env.FORGEJO_TOKEN = "env-token-123";
    delete process.env.GITEA_TOKEN;
    const result = await resolveForgejoToken("any-host");
    assert.equal(result, "env-token-123");
  });

  it("resolves token from GITEA_TOKEN env var as fallback", async () => {
    delete process.env.FORGEJO_TOKEN;
    process.env.GITEA_TOKEN = "gitea-token-456";
    const result = await resolveForgejoToken("any-host");
    assert.equal(result, "gitea-token-456");
  });

  it("prefers FORGEJO_TOKEN over GITEA_TOKEN", async () => {
    process.env.FORGEJO_TOKEN = "forge-preferred";
    process.env.GITEA_TOKEN = "gitea-secondary";
    const result = await resolveForgejoToken("any-host");
    assert.equal(result, "forge-preferred");
  });

  it("resolves per-host token from uppidi-fleet settings", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    const base = join(tmpdir(), `uppidi-token-test-${Date.now()}`);
    const settingsDir = join(base, "plugin-data", "xpufx", "uppidi-fleet");
    const settingsPath = join(settingsDir, "settings.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({ tokensByHost: { "forge.mrs.uppidi.com": "host-specific-token" } }),
      "utf8",
    );
    process.env.PASEO_HOME = base;
    const result = await resolveForgejoToken("forge.mrs.uppidi.com");
    assert.equal(result, "host-specific-token");
    await rm(base, { recursive: true, force: true });
  });

  it("does NOT read ~/.config/tea/config.yml", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    // Point to a temp home with NO settings at all.
    const base = join(tmpdir(), `no-tea-test-${Date.now()}`);
    const settingsDir = join(base, "plugin-data", "xpufx", "my-plugin");
    const settingsPath = join(settingsDir, "settings.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({}), "utf8");
    process.env.PASEO_HOME = base;
    // Even though ~/.config/tea/config.yml exists on this machine with a real token,
    // resolveForgejoToken must not read it.
    const result = await resolveForgejoToken("forge.mrs.uppidi.com");
    assert.equal(result, null, "should not harvest credentials from tea/config.yml");
    await rm(base, { recursive: true, force: true });
  });

  it("fails closed when uppidi-fleet settings exist but have no token for host", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;
    const base = join(tmpdir(), `no-token-for-host-${Date.now()}`);
    const settingsDir = join(base, "plugin-data", "xpufx", "uppidi-fleet");
    const settingsPath = join(settingsDir, "settings.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({ tokensByHost: { "other.example.com": "other-token" } }),
      "utf8",
    );
    process.env.PASEO_HOME = base;
    const result = await resolveForgejoToken("forge.mrs.uppidi.com");
    assert.equal(result, null);
    await rm(base, { recursive: true, force: true });
  });
});

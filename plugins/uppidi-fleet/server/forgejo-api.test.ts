import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveForgejoIdentity,
  resolveForgejoToken,
  resolveForgejoTokenSync,
  resolveTokenValue,
  forgejoToken,
  setTokenResolverForTest,
} from "./forgejo-api.js";

describe("role-based multi-PAT identity routing & single-user fallback (#1428)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    setTokenResolverForTest(null);
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
      else process.env[k] = originalEnv[k];
    });
    setTokenResolverForTest(null);
  });

  it("resolves multi-role identities with dedicated credentials and service accounts", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;

    const fullAuthSettings = {
      auth: {
        mode: "auto",
        defaultUser: "xpufx",
        defaultToken: "tok-default-fallback",
        roles: {
          system: {
            username: "fleet-bot",
            token: "tok-system-123",
          },
          "front-desk": {
            username: "fleet-frontdesk",
            token: "tok-frontdesk-456",
          },
          orchestrator: {
            username: "fleet-orchestrator",
            token: "tok-orch-789",
          },
          worker: {
            username: "fleet-worker",
            token: "tok-worker-999",
          },
        },
      },
    };

    // System role
    const sysIdent = resolveForgejoIdentity("forge.test", "system", { settings: fullAuthSettings });
    assert.equal(sysIdent.username, "fleet-bot");
    assert.equal(sysIdent.token, "tok-system-123");
    assert.equal(sysIdent.role, "system");
    assert.equal(sysIdent.isFallback, false);

    // Front-desk role
    const fdIdent = resolveForgejoIdentity("forge.test", "front-desk", { settings: fullAuthSettings });
    assert.equal(fdIdent.username, "fleet-frontdesk");
    assert.equal(fdIdent.token, "tok-frontdesk-456");
    assert.equal(fdIdent.role, "front-desk");
    assert.equal(fdIdent.isFallback, false);

    // Orchestrator role
    const orchIdent = resolveForgejoIdentity("forge.test", "orchestrator", { settings: fullAuthSettings });
    assert.equal(orchIdent.username, "fleet-orchestrator");
    assert.equal(orchIdent.token, "tok-orch-789");
    assert.equal(orchIdent.role, "orchestrator");
    assert.equal(orchIdent.isFallback, false);

    // Worker role
    const workerIdent = resolveForgejoIdentity("forge.test", "worker", { settings: fullAuthSettings });
    assert.equal(workerIdent.username, "fleet-worker");
    assert.equal(workerIdent.token, "tok-worker-999");
    assert.equal(workerIdent.role, "worker");
    assert.equal(workerIdent.isFallback, false);

    // Verify resolveForgejoToken returns exact token
    const sysToken = await resolveForgejoToken("forge.test", "system", { settings: fullAuthSettings });
    assert.equal(sysToken, "tok-system-123");

    const orchToken = await resolveForgejoToken("forge.test", "orchestrator", { settings: fullAuthSettings });
    assert.equal(orchToken, "tok-orch-789");

    // Sync resolution
    assert.equal(resolveForgejoTokenSync("forge.test", "worker", { settings: fullAuthSettings }), "tok-worker-999");
  });

  it("supports partial role configuration with independent single-user degradation", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;

    const partialSettings = {
      auth: {
        defaultUser: "xpufx",
        defaultToken: "tok-default-fallback",
        roles: {
          worker: {
            username: "fleet-worker",
            token: "tok-worker-999",
          },
        },
      },
    };

    // Configured role resolves dedicated identity
    const workerIdent = resolveForgejoIdentity("forge.test", "worker", { settings: partialSettings });
    assert.equal(workerIdent.username, "fleet-worker");
    assert.equal(workerIdent.token, "tok-worker-999");
    assert.equal(workerIdent.role, "worker");
    assert.equal(workerIdent.isFallback, false);

    // Missing orchestrator collapses cleanly to defaultUser/defaultToken (never to worker)
    const orchIdent = resolveForgejoIdentity("forge.test", "orchestrator", { settings: partialSettings });
    assert.equal(orchIdent.username, "xpufx");
    assert.equal(orchIdent.token, "tok-default-fallback");
    assert.equal(orchIdent.role, null);
    assert.equal(orchIdent.isFallback, true);

    // Missing system collapses cleanly to defaultUser/defaultToken
    const sysIdent = resolveForgejoIdentity("forge.test", "system", { settings: partialSettings });
    assert.equal(sysIdent.username, "xpufx");
    assert.equal(sysIdent.token, "tok-default-fallback");
    assert.equal(sysIdent.role, null);
    assert.equal(sysIdent.isFallback, true);

    // Missing front-desk collapses cleanly
    const fdIdent = resolveForgejoIdentity("forge.test", "front-desk", { settings: partialSettings });
    assert.equal(fdIdent.username, "xpufx");
    assert.equal(fdIdent.token, "tok-default-fallback");
    assert.equal(fdIdent.role, null);
    assert.equal(fdIdent.isFallback, true);
  });

  it("collapses all roles cleanly to single-user mode when auth.roles is empty or omitted", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;

    const singleUserSettings = {
      auth: {
        defaultUser: "xpufx",
        defaultToken: "tok-single-user-pat",
      },
    };

    for (const role of ["system", "front-desk", "orchestrator", "worker"] as const) {
      const ident = resolveForgejoIdentity("forge.test", role, { settings: singleUserSettings });
      assert.equal(ident.username, "xpufx");
      assert.equal(ident.token, "tok-single-user-pat");
      assert.equal(ident.role, null);
      assert.equal(ident.isFallback, true);

      const token = await resolveForgejoToken("forge.test", role, { settings: singleUserSettings });
      assert.equal(token, "tok-single-user-pat");
    }
  });

  it("resolves token values with env: variable indirection", async () => {
    process.env.TEST_SYS_PAT = "pat-from-sys-env";
    process.env.TEST_DEF_PAT = "pat-from-def-env";

    const envIndirectionSettings = {
      auth: {
        defaultUser: "xpufx",
        defaultToken: "env:TEST_DEF_PAT",
        roles: {
          system: {
            username: "fleet-bot",
            token: "env:TEST_SYS_PAT",
          },
        },
      },
    };

    const sysToken = await resolveForgejoToken("forge.test", "system", { settings: envIndirectionSettings });
    assert.equal(sysToken, "pat-from-sys-env");

    const orchToken = await resolveForgejoToken("forge.test", "orchestrator", { settings: envIndirectionSettings });
    assert.equal(orchToken, "pat-from-def-env");

    assert.equal(resolveTokenValue("env:TEST_SYS_PAT"), "pat-from-sys-env");
    assert.equal(resolveTokenValue("literal-token"), "literal-token");
    assert.equal(resolveTokenValue(""), "");
    assert.equal(resolveTokenValue(null), "");
  });

  it("honors FORGEJO_TOKEN_<ROLE> environment variable overrides", async () => {
    process.env.FORGEJO_TOKEN_WORKER = "env-worker-override-tok";
    process.env.FORGEJO_TOKEN_SYSTEM = "env-system-override-tok";

    const fullAuthSettings = {
      auth: {
        roles: {
          worker: { username: "fleet-worker", token: "settings-tok" },
          system: { username: "fleet-bot", token: "settings-sys-tok" },
        },
      },
    };

    const workerIdent = resolveForgejoIdentity("forge.test", "worker", { settings: fullAuthSettings });
    assert.equal(workerIdent.token, "env-worker-override-tok");
    assert.equal(workerIdent.username, "fleet-worker");
    assert.equal(workerIdent.isFallback, false);

    const sysIdent = resolveForgejoIdentity("forge.test", "system", { settings: fullAuthSettings });
    assert.equal(sysIdent.token, "env-system-override-tok");
    assert.equal(sysIdent.username, "fleet-bot");
  });

  it("supports shorthand string role configuration", async () => {
    delete process.env.FORGEJO_TOKEN;

    const shorthandSettings = {
      auth: {
        roles: {
          worker: "tok-worker-shorthand",
          orchestrator: "tok-orch-shorthand",
        },
      },
    };

    const workerIdent = resolveForgejoIdentity("forge.test", "worker", { settings: shorthandSettings });
    assert.equal(workerIdent.token, "tok-worker-shorthand");
    assert.equal(workerIdent.username, "fleet-worker");
    assert.equal(workerIdent.isFallback, false);

    const orchIdent = resolveForgejoIdentity("forge.test", "orchestrator", { settings: shorthandSettings });
    assert.equal(orchIdent.token, "tok-orch-shorthand");
    assert.equal(orchIdent.username, "fleet-orchestrator");
  });

  it("normalizes coding-agent role alias to worker", async () => {
    delete process.env.FORGEJO_TOKEN;

    const settings = {
      auth: {
        roles: {
          worker: { username: "fleet-worker", token: "tok-worker-42" },
        },
      },
    };

    const ident = resolveForgejoIdentity("forge.test", "coding-agent", { settings });
    assert.equal(ident.role, "worker");
    assert.equal(ident.username, "fleet-worker");
    assert.equal(ident.token, "tok-worker-42");
    assert.equal(ident.isFallback, false);
  });

  it("falls back to legacy tokensByHost and fails closed when unconfigured", async () => {
    delete process.env.FORGEJO_TOKEN;
    delete process.env.GITEA_TOKEN;

    const legacySettings = {
      tokensByHost: {
        "forge.mrs.uppidi.com": "tok-host-specific",
      },
    };

    // Resolves token for matching host
    const matchedToken = await resolveForgejoToken("forge.mrs.uppidi.com", undefined, { settings: legacySettings });
    assert.equal(matchedToken, "tok-host-specific");

    // Fails closed for different host
    const unconfiguredToken = await resolveForgejoToken("other.host.com", undefined, { settings: legacySettings });
    assert.equal(unconfiguredToken, null);

    // Blank settings fails closed to null
    const emptyToken = await resolveForgejoToken("any.host", "system", { settings: {} });
    assert.equal(emptyToken, null);
  });

  it("threads role through forgejoToken wrapper", async () => {
    const customSettings = {
      auth: {
        roles: {
          system: { username: "fleet-bot", token: "tok-sys-wrapper" },
        },
      },
    };

    let calledWithRole: string | null | undefined;
    setTokenResolverForTest(async (host, role) => {
      calledWithRole = role;
      return resolveForgejoTokenSync(host, role, { settings: customSettings });
    });

    const token = await forgejoToken("forge.test", "system");
    assert.equal(calledWithRole, "system");
    assert.equal(token, "tok-sys-wrapper");
  });
});

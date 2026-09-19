import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForgeClient } from "./forge-client.ts";

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("ForgeClient.isForgeHost (issue #114)", () => {
  it("accepts a Gitea-family version payload and probes /api/v1/version", async () => {
    let seen = "";
    stubFetch((url) => {
      seen = url;
      return jsonResponse({ version: "10.0.0+forgejo" });
    });
    assert.equal(await new ForgeClient({ host: "forge.example.com" }).isForgeHost(), true);
    assert.equal(seen, "https://forge.example.com/api/v1/version");
  });

  it("rejects a non-forge host such as github.com (410)", async () => {
    stubFetch(() => jsonResponse("<html>410 Gone</html>", 410));
    assert.equal(await new ForgeClient({ host: "github.com" }).isForgeHost(), false);
  });

  it("rejects an unrelated 200 JSON body without a version", async () => {
    stubFetch(() => jsonResponse({ message: "ok" }));
    assert.equal(await new ForgeClient({ host: "example.com" }).isForgeHost(), false);
  });

  it("rejects a 200 non-JSON body", async () => {
    stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          text: async () => "<html>not json</html>",
        }) as unknown as Response,
    );
    assert.equal(await new ForgeClient({ host: "example.com" }).isForgeHost(), false);
  });

  it("fails closed on a transport error", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    assert.equal(await new ForgeClient({ host: "forge.example.com" }).isForgeHost(), false);
  });

  it("sends the configured token", async () => {
    let authorization: string | undefined;
    stubFetch((_url, init) => {
      authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return jsonResponse({ version: "9.0.0" });
    });
    await new ForgeClient({ host: "forge.example.com", token: "secret" }).isForgeHost();
    assert.equal(authorization, "token secret");
  });
});

describe("ForgeClient label metadata (issue #182)", () => {
  it("keeps label colors/descriptions alongside the names view", async () => {
    stubFetch((url) => {
      assert.match(url, /\/repos\/owner\/repo\/issues\?/);
      return jsonResponse([
        {
          number: 7,
          title: "chips",
          state: "open",
          labels: [
            { id: 1, name: "state/1-wip", color: "e11d48", description: "In progress" },
            { id: 2, name: "priority/1-high", color: "d93f0b" },
          ],
        },
      ]);
    });
    const result = await new ForgeClient({ host: "forge.example.com" }).listIssues("owner/repo");
    assert.ok(result);
    assert.deepEqual(result.issues[0].labels, ["state/1-wip", "priority/1-high"]);
    assert.deepEqual(result.issues[0].labelDetails, [
      { name: "state/1-wip", color: "e11d48", description: "In progress" },
      { name: "priority/1-high", color: "d93f0b" },
    ]);
  });

  it("degrades labels without a color and bare-string entries to name-only", async () => {
    stubFetch(() =>
      jsonResponse([
        {
          number: 8,
          title: "plain",
          state: "open",
          labels: [{ id: 1, name: "no-color" }, "legacy-string"],
        },
      ]),
    );
    const result = await new ForgeClient({ host: "forge.example.com" }).listIssues("owner/repo");
    assert.ok(result);
    assert.deepEqual(result.issues[0].labels, ["no-color", "legacy-string"]);
    assert.deepEqual(result.issues[0].labelDetails, [
      { name: "no-color" },
      { name: "legacy-string" },
    ]);
  });
});

describe("ForgeClient.repoWritePermission (issue #193)", () => {
  it("reports write capability from the repo permissions object", async () => {
    let seen = "";
    stubFetch((url) => {
      seen = url;
      return jsonResponse({ permissions: { push: true, admin: false, pull: true } });
    });
    const granted = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .repoWritePermission("owner/repo");
    assert.equal(granted, true);
    assert.equal(seen, "https://forge.example.com/api/v1/repos/owner/repo");
  });

  it("reports false for a read-only token that can pull but not push", async () => {
    stubFetch(() => jsonResponse({ permissions: { push: false, admin: false, pull: true } }));
    const granted = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .repoWritePermission("owner/repo");
    assert.equal(granted, false);
  });

  it("returns null when the host omits a permission object (fallback path)", async () => {
    stubFetch(() => jsonResponse({ full_name: "owner/repo", id: 1 }));
    const granted = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .repoWritePermission("owner/repo");
    assert.equal(granted, null);
  });

  it("returns null without a token, and on an API failure", async () => {
    stubFetch(() => jsonResponse({ permissions: { push: true } }));
    const anonymous = await new ForgeClient({ host: "forge.example.com" })
      .repoWritePermission("owner/repo");
    assert.equal(anonymous, null);
    stubFetch(() => jsonResponse({ message: "forbidden" }, 403));
    const forbidden = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .repoWritePermission("owner/repo");
    assert.equal(forbidden, null);
  });
});

describe("ForgeClient token scope handling (issue #212)", () => {
  it("treats a 403 from /user as a valid token with a narrower scope", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/user")) {
        // Forgejo demands read:user; an issue-scoped PAT gets 403.
        assert.equal((init?.headers as Record<string, string>)?.Authorization, "token secret");
        return jsonResponse({ message: "token does not have required scope(s): [read:user]" }, 403);
      }
      return jsonResponse({}, 404);
    });
    const validity = await new ForgeClient({ host: "forge.example.com", token: "secret" }).tokenIsValid();
    assert.equal(validity, true);
  });

  it("still reports an invalid token on 401", async () => {
    stubFetch(() => jsonResponse({ message: "Unauthorized" }, 401));
    const validity = await new ForgeClient({ host: "forge.example.com", token: "secret" }).tokenIsValid();
    assert.equal(validity, false);
  });

  it("returns null (unknown, not invalid) when the probe cannot reach the host", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const validity = await new ForgeClient({ host: "forge.example.com", token: "secret" }).tokenIsValid();
    assert.equal(validity, null);
  });

  it("falls back to an anonymous read for openIssueCount when the token lacks read:repository", async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    stubFetch((url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      seen.push({ url, auth });
      if (auth) return jsonResponse({ message: "required scope(s): [read:repository]" }, 403);
      return jsonResponse({ open_issues_count: 7 });
    });
    const count = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .openIssueCount("owner/repo");
    assert.equal(count, 7);
    // Authenticated attempt first, then the anonymous retry.
    assert.equal(seen.length, 2);
    assert.equal(seen[0].auth, "token secret");
    assert.equal(seen[1].auth, undefined);
  });

  it("does not fabricate a count when the repo is private and the token is scope-limited", async () => {
    stubFetch((url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      return auth ? jsonResponse({ message: "forbidden" }, 403) : jsonResponse({ message: "not found" }, 404);
    });
    const count = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .openIssueCount("owner/private");
    assert.equal(count, null);
  });

  it("retries repoWritePermission anonymously on a scope 403 instead of reporting read-only", async () => {
    stubFetch((url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (auth) return jsonResponse({ message: "required scope(s): [read:repository]" }, 403);
      return jsonResponse({ permissions: { push: true, admin: false, pull: true } });
    });
    const granted = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .repoWritePermission("owner/repo");
    assert.equal(granted, true);
  });
});

describe("ForgeClient.createIssue (issue #200)", () => {
  it("POSTs /repos/{repo}/issues and returns the created number", async () => {
    let seen = "";
    let init: RequestInit | undefined;
    stubFetch((url, requestInit) => {
      seen = url;
      init = requestInit;
      return jsonResponse({ number: 42, title: "New ticket", state: "open" });
    });
    const number = await new ForgeClient({ host: "forge.example.com", token: "secret" })
      .createIssue("owner/repo", { title: "New ticket", body: "Body text" });
    assert.equal(number, 42);
    assert.equal(seen, "https://forge.example.com/api/v1/repos/owner/repo/issues");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      title: "New ticket",
      body: "Body text",
    });
    assert.equal(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
      "token secret",
    );
  });

  it("attaches labels when provided", async () => {
    let init: RequestInit | undefined;
    stubFetch((_url, requestInit) => {
      init = requestInit;
      return jsonResponse({ number: 7 });
    });
    const number = await new ForgeClient({ host: "forge.example.com" })
      .createIssue("owner/repo", {
        title: "Labeled",
        body: "",
        labels: ["kind/feature", "target/forges"],
      });
    assert.equal(number, 7);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      title: "Labeled",
      labels: ["kind/feature", "target/forges"],
    });
  });

  it("returns null when the API rejects the create or omits a number", async () => {
    stubFetch(() => jsonResponse({ message: "forbidden" }, 403));
    assert.equal(
      await new ForgeClient({ host: "forge.example.com", token: "secret" })
        .createIssue("owner/repo", { title: "Nope" }),
      null,
    );
    stubFetch(() => jsonResponse({ title: "no number" }));
    assert.equal(
      await new ForgeClient({ host: "forge.example.com" }).createIssue("owner/repo", { title: "x" }),
      null,
    );
  });
});

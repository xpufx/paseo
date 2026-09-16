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

import { describe, it, expect } from "vitest";
import { redactSecrets } from "../server/redact.js";

describe("redactSecrets", () => {
  it("masks sensitive keys in flat and nested objects", () => {
    const raw = {
      user: "alice",
      token: "secret-token-12345678",
      apiKey: "sk-proj-abcdefghijklmnop",
      nested: {
        password: "super-secret-password",
        publicName: "server-1",
      },
    };

    const redacted = redactSecrets(raw);
    expect(redacted.user).toBe("alice");
    expect(redacted.token).toBe("sec...678");
    expect(redacted.apiKey).toBe("sk-...nop");
    expect(redacted.nested.password).toBe("sup...ord");
    expect(redacted.nested.publicName).toBe("server-1");
  });

  it("redacts bearer tokens and URL credentials in strings", () => {
    const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const redactedAuth = redactSecrets(authHeader);
    expect(redactedAuth).toBe("Bearer [REDACTED]");

    const url = "https://admin:superSecret123@my-host.internal/api";
    const redactedUrl = redactSecrets(url);
    expect(redactedUrl).toBe("https://admin:[REDACTED]@my-host.internal/api");
  });

  it("applies custom mask to long sensitive keys", () => {
    const raw = {
      token: "secret-token-12345678",
      shortSecret: "1234",
    };
    const redacted = redactSecrets(raw, { mask: "•••" });
    expect(redacted.token).toBe("sec•••678");
    expect(redacted.shortSecret).toBe("•••");
  });

  it("masks pairing-offer URLs but leaves normal URLs alone", () => {
    const msg =
      "pair me: https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9fbE9WSEIyMjNoelQiLCJkYWVtb25QdWJsaWNLZXlCNjQiOiJLM2syZkhlVGlBMldSeGpYU1lNRjlTOG1rZldrT0tPV0hTYmRYNWRzMkdNPSIsInJlbGF5Ijp7ImVuZHBvaW50IjoicmVsYXkucGFzZW8uc2g6NDQzIiwidXNlVGxzIjp0cnVlfX0 and https://example.com/docs";
    const redacted = redactSecrets(msg);
    expect(redacted).toContain("https://app.paseo.sh/#offer=[REDACTED]");
    expect(redacted).toContain("https://example.com/docs");
    expect(redacted).not.toContain("eyJ2Ijoy");
  });

  it("masks pairing offers nested in objects", () => {
    const raw = {
      note: "see https://app.paseo.sh/#offer=abcDEF123_-",
      nested: { link: "https://app.paseo.sh/#offer=xyz" },
    };
    const redacted = redactSecrets(raw);
    expect(redacted.note).toBe("see https://app.paseo.sh/#offer=[REDACTED]");
    expect(redacted.nested.link).toBe("https://app.paseo.sh/#offer=[REDACTED]");
  });

  it("masks standard-base64 offer tails without leaking suffix", () => {
    const msg = "see https://app.paseo.sh/#offer=abc+def/ghi==";
    expect(redactSecrets(msg)).toBe("see https://app.paseo.sh/#offer=[REDACTED]");
  });
});

import { describe, it, expect } from "vitest";
import {
  validateForgejoSignature,
  validateGitHubSignature,
  validateGitLabSignature,
} from "../shared/signatures.js";
import { createHmac } from "node:crypto";

describe("HMAC signature validation", () => {
  const secret = "supersecretkey123";
  const payload = '{"action":"opened","repository":{"full_name":"test/repo"}}';

  function forgejoHex(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  function gitHubHex(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  function gitLabHex(payload: string, token: string): string {
    return createHmac("sha256", token).update(payload).digest("hex");
  }

  describe("Forgejo", () => {
    it("validates a correct signature", () => {
      const sig = forgejoHex(payload, secret);
      expect(validateForgejoSignature(payload, secret, sig)).toBe(true);
    });

    it("validates a signature with sha256= prefix", () => {
      const sig = `sha256=${forgejoHex(payload, secret)}`;
      expect(validateForgejoSignature(payload, secret, sig)).toBe(true);
    });

    it("rejects a tampered payload", () => {
      const sig = forgejoHex(payload, secret);
      expect(validateForgejoSignature("tampered", secret, sig)).toBe(false);
    });

    it("rejects an invalid secret", () => {
      const sig = forgejoHex(payload, secret);
      expect(validateForgejoSignature(payload, "wrong", sig)).toBe(false);
    });

    it("rejects a wrong-length or non-hex signature without throwing RangeError", () => {
      expect(validateForgejoSignature(payload, secret, "notahex")).toBe(false);
      expect(validateForgejoSignature(payload, secret, "z".repeat(64))).toBe(false);
    });
  });

  describe("GitHub", () => {
    it("validates a correct signature", () => {
      const sig = gitHubHex(payload, secret);
      expect(validateGitHubSignature(payload, secret, sig)).toBe(true);
    });

    it("validates a signature with sha256= prefix", () => {
      const sig = `sha256=${gitHubHex(payload, secret)}`;
      expect(validateGitHubSignature(payload, secret, sig)).toBe(true);
    });

    it("rejects a tampered payload", () => {
      const sig = gitHubHex(payload, secret);
      expect(validateGitHubSignature("different", secret, sig)).toBe(false);
    });

    it("rejects an incorrect secret", () => {
      const sig = gitHubHex(payload, secret);
      expect(validateGitHubSignature(payload, "othersecret", sig)).toBe(false);
    });
  });

  describe("GitLab", () => {
    it("validates HMAC signature with token-as-key", () => {
      const sig = gitLabHex(payload, secret);
      expect(
        validateGitLabSignature(payload, secret, {
          signatureHex: sig,
        }),
      ).toBe(true);
    });

    it("rejects HMAC signature with wrong key", () => {
      const sig = gitLabHex(payload, secret);
      expect(
        validateGitLabSignature(payload, "wrongtoken", {
          signatureHex: sig,
        }),
      ).toBe(false);
    });

    it("validates token exact-match with matching receivedToken", () => {
      expect(
        validateGitLabSignature(payload, "mytoken", {
          receivedToken: "mytoken",
        }),
      ).toBe(true);
    });

    it("rejects token exact-match with mismatching receivedToken", () => {
      expect(
        validateGitLabSignature(payload, "mytoken", {
          receivedToken: "attacker-token",
        }),
      ).toBe(false);
    });

    it("rejects when no signature and no token provided", () => {
      expect(validateGitLabSignature(payload, "mytoken")).toBe(false);
      expect(validateGitLabSignature(payload, "")).toBe(false);
    });
  });
});

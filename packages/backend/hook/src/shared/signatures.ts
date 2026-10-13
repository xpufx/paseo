import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Strips common `sha256=` prefixes and trims whitespace from hex signatures.
 */
function cleanSignature(signature: string): string {
  return signature.replace(/^sha256=/i, "").trim();
}

/**
 * Constant-time hex string comparison to prevent timing attacks.
 * Validates hex format and equal byte length before invoking timingSafeEqual.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();
  if (cleanA.length !== cleanB.length) return false;
  if (!/^[0-9a-f]+$/i.test(cleanA) || !/^[0-9a-f]+$/i.test(cleanB)) return false;

  const bufA = Buffer.from(cleanA, "hex");
  const bufB = Buffer.from(cleanB, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;

  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate a Forgejo / Gitea webhook signature.
 *
 * Forgejo uses `X-Hub-Signature-256` header with value `sha256=<hex>` or `<hex>`.
 * The secret is shared via repo settings → Integrations → Webhook Secret.
 */
export function validateForgejoSignature(
  payload: string,
  secret: string,
  signatureHex: string,
): boolean {
  if (!secret || !signatureHex) return false;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return safeCompare(expected, cleanSignature(signatureHex));
}

/**
 * Validate a GitHub webhook signature.
 *
 * GitHub uses `X-Hub-Signature-256` header with value `sha256=<hex>` or `<hex>`.
 * The secret is configured in the webhook settings.
 */
export function validateGitHubSignature(
  payload: string,
  secret: string,
  signatureHex: string,
): boolean {
  if (!secret || !signatureHex) return false;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return safeCompare(expected, cleanSignature(signatureHex));
}

/**
 * Validate a GitLab webhook signature.
 *
 * GitLab supports two mechanisms:
 * - **Secret token** (preferred): `X-Gitlab-Token` header — exact match.
 * - **Signature**: `X-Gitlab-Signature-256` header — HMAC-SHA256 of the raw body using the token as key.
 *
 * If a signature header is provided it will be validated via HMAC; otherwise falls back
 * to the `X-Gitlab-Token` exact-match check against `options.receivedToken`.
 */
export function validateGitLabSignature(
  payload: string,
  tokenOrSecret: string,
  options?: {
    /** `X-Gitlab-Signature-256=<hex>` value. */
    signatureHex?: string;
    /** Received `X-Gitlab-Token` header value for token exact match. */
    receivedToken?: string;
    /** Whether to treat `tokenOrSecret` as the GitLab secret token (for HMAC). */
    useTokenAsHmacKey?: boolean;
  },
): boolean {
  if (!tokenOrSecret) return false;

  // If a signature is provided, validate via HMAC-SHA256
  if (options?.signatureHex) {
    const expected = createHmac("sha256", tokenOrSecret)
      .update(payload)
      .digest("hex");
    return safeCompare(expected, cleanSignature(options.signatureHex));
  }

  // Fall back to X-Gitlab-Token exact match using timingSafeEqual
  if (options?.receivedToken !== undefined) {
    const bufA = Buffer.from(tokenOrSecret, "utf8");
    const bufB = Buffer.from(options.receivedToken, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  return false;
}

export interface RedactOptions {
  mask?: string;
  customSensitiveKeys?: string[];
  preserveLength?: boolean;
}

const DEFAULT_SENSITIVE_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "privatekey",
  "private_key",
  "authorization",
  "auth",
  "credential",
  "credentials",
  "cert",
  "certificate",
];

function isSensitiveKey(key: string, customKeys: string[] = []): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return [...DEFAULT_SENSITIVE_KEYS, ...customKeys].some((k) =>
    normalized.includes(k.replace(/[-_]/g, "")),
  );
}

function maskString(val: string, mask = "[REDACTED]"): string {
  if (val.length <= 8) return mask;
  // Keep first 3 and last 3 characters if long enough, using custom mask if provided
  const placeholder = mask === "[REDACTED]" ? "..." : mask;
  return `${val.slice(0, 3)}${placeholder}${val.slice(-3)}`;
}

/**
 * Deeply redacts sensitive keys and values in an object or primitive before logging or sending over RPC.
 */
export function redactSecrets<T>(target: T, options: RedactOptions = {}): T {
  const mask = options.mask ?? "[REDACTED]";
  const customKeys = options.customSensitiveKeys ?? [];

  if (target === null || target === undefined) return target;

  if (typeof target === "string") {
    // Redact Bearer tokens in headers
    let result = target.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, `$1${mask}`);
    // Redact basic auth in URLs
    result = result.replace(/(https?:\/\/[^:]+:)[^@]+(@)/gi, `$1${mask}$2`);
    // Redact Paseo pairing offers (password-equivalent): app.paseo.sh/#offer=
    // plus the base64 tail, optionally JSON-sniffed by serverId key below.
    // Tail covers standard (+/=) and URL-safe (-_) base64 so partial
    // offers never leak through a truncated match.
    result = result.replace(
      /(https?:\/\/app\.paseo\.sh\/#offer=)[A-Za-z0-9\-_.~+/]+=*/gi,
      `$1${mask}`,
    );
    return result as unknown as T;
  }

  if (Array.isArray(target)) {
    return target.map((item) => redactSecrets(item, options)) as unknown as T;
  }

  if (typeof target === "object") {
    const clone: Record<string, any> = {};
    for (const [key, value] of Object.entries(target)) {
      if (isSensitiveKey(key, customKeys)) {
        clone[key] = typeof value === "string" ? maskString(value, mask) : mask;
      } else if (typeof value === "object" && value !== null) {
        clone[key] = redactSecrets(value, options);
      } else if (typeof value === "string") {
        clone[key] = redactSecrets(value, options);
      } else {
        clone[key] = value;
      }
    }
    return clone as T;
  }

  return target;
}

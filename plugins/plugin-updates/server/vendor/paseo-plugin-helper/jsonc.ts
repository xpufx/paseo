/**
 * Strips single-line and multi-line comments and trailing commas from a JSONC string
 * without altering strings or URLs.
 */
export function stripJsonComments(text: string): string {
  let insideString = false;
  let stringDelimiter = "";
  let isEscaped = false;
  let result = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideString) {
      result += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === stringDelimiter) {
        insideString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      insideString = true;
      stringDelimiter = char;
      result += char;
      continue;
    }

    // Line comment
    if (char === "/" && nextChar === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      if (i < text.length) result += text[i];
      continue;
    }

    // Block comment
    if (char === "/" && nextChar === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i++; // Skip closing '/'
      continue;
    }

    result += char;
  }

  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Safely parses a JSONC (JSON with comments and trailing commas) string.
 */
export function parseJsonc<T = unknown>(text: string): T {
  const sanitized = stripJsonComments(text.trim());
  return JSON.parse(sanitized) as T;
}

/**
 * Safely parses a JSONC string without throwing errors.
 * Returns the provided fallback value if parsing fails.
 */
export function tryParseJsonc<T>(text: string, fallback: T): T {
  try {
    return parseJsonc<T>(text);
  } catch {
    return fallback;
  }
}

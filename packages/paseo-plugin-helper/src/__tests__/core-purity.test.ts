import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  /from\s+["']react-native["']/,
  /require\(\s*["']react-native["']\s*\)/,
  // Client/server boundary: node built-ins must never enter the client bundle.
  /from\s+["']node:/,
  /require\(\s*["']node:/,
  /from\s+["'](fs|path|os|child_process|util|events|stream|crypto|readline|net|http|https|tty|v8|vm|zlib)["']/,
  /client\/theme\/host-variables/,
  /theme\/host-variables/,
  /getComputedStyle/,
  /documentElement/,
  /PASEO_HOST_CSS_VARIABLES/,
  /maxContentWidth/,
  /ModalBody/,
  /scrollable=\{false\}/,
] as const;

const LAYOUT_COMPONENT_RE = /client\/(layout|components)\//;

function stripTypeImports(source: string): string {
  return source.replace(/import\s+type\b[\s\S]*?;/g, "");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  if (base.endsWith(".js")) {
    const stem = base.slice(0, -".js".length);
    candidates.push(stem, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`);
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function collectTransitive(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  let source: string;
  try {
    source = readFileSync(entry, "utf8");
  } catch {
    return [];
  }
  const out = [entry];
  for (const match of source.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)) {
    const next = resolveImport(entry, match[1]);
    if (next) out.push(...collectTransitive(next, seen));
  }
  return out;
}

describe("core entry purity (headless runtime)", () => {
  it("core + its transitive closure carry no UI/scraper/layout opinions", () => {
    const files = collectTransitive(resolve(SRC, "core/index.ts"));
    expect(files.length).toBeGreaterThan(10);
    const violations: string[] = [];
    for (const file of files) {
      const body = stripComments(stripTypeImports(readFileSync(file, "utf8")));
      for (const pattern of FORBIDDEN) {
        if (pattern.test(body)) violations.push(`${file}: ${pattern}`);
      }
      const rel = file.slice(SRC.length + 1);
      if (LAYOUT_COMPONENT_RE.test(rel)) violations.push(`${file}: bespoke UI module`);
    }
    expect(violations).toEqual([]);
  });

  it("ui adapters never hijack scroll or cap width", () => {
    const files = collectTransitive(resolve(SRC, "ui/index.ts"));
    expect(files.length).toBeGreaterThan(1);
    const violations: string[] = [];
    for (const file of files) {
      if (!file.includes("/ui/")) continue;
      const body = stripComments(readFileSync(file, "utf8"));
      if (/scrollable=\{false\}/.test(body)) violations.push(`${file}: forces scrollable={false}`);
      if (/maxContentWidth/.test(body)) violations.push(`${file}: width cap`);
      if (/host-variables|getComputedStyle|documentElement/.test(body)) {
        violations.push(`${file}: CSS scraper`);
      }
    }
    expect(violations).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Static guard for the mobile render crash class in xpufx-org/paseo#555:
 * "Element type is invalid ... but got: undefined".
 *
 * A capitalized JSX tag whose identifier is not bound at module scope evaluates
 * to `undefined` at element-creation time. That error is thrown by React before
 * any component renders, so it escapes a plugin's own ErrorBoundary and surfaces
 * as a host-level "Plugin failed" boundary. The plugin bundle is compiled from
 * source (the vendored helper is inlined), so a name absent from the vendored
 * barrel would fail the daemon's own `compilePlugin` — this test pins that
 * invariant locally and names any future offender.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const vendorRoot = path.join(here, "vendor", "paseo-plugin-helper");
const helperSrcBarrel = path.resolve(
  pluginRoot,
  "../../packages/paseo-plugin-helper/src/client/index.ts",
);

// Client surfaces registered by the plugin entry: the sidebar surface and every
// module it renders through (the settings-screen contract, the ask cards, and
// the local boundary).
const SURFACE_FILES = [
  "index.client.tsx",
  "client/approvals.tsx",
  "client/ask.tsx",
  "client/error-boundary.tsx",
];

// Identifiers supplied by the JSX runtime rather than a module binding.
const JSX_GLOBALS = new Set(["React", "Fragment"]);

function parseSource(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
}

function collectBinding(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBinding(element.name, out);
  }
}

/** Every value (non-type-only) binding available at module scope. */
function moduleValueBindings(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      if (clause.name) names.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
        else {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly) names.add(element.name.text);
          }
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBinding(declaration.name, names);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) names.add(statement.name.text);
    if (ts.isClassDeclaration(statement) && statement.name) names.add(statement.name.text);
  }
  return names;
}

/** Capitalized JSX roots (`<Card.Header>` contributes root `Card`), keyed by tag. */
function jsxElementRoots(source: ts.SourceFile): Map<string, number> {
  const roots = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    let tag: ts.JsxTagNameExpression | undefined;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      tag = node.tagName;
    }
    if (tag) {
      let root: string | undefined;
      let full: string;
      if (ts.isIdentifier(tag)) {
        root = tag.text;
        full = tag.text;
      } else if (ts.isPropertyAccessExpression(tag)) {
        let expr: ts.Expression = tag;
        while (ts.isPropertyAccessExpression(expr)) expr = expr.expression;
        full = tag.getText(source);
        if (ts.isIdentifier(expr)) root = expr.text;
      } else {
        full = tag.getText(source);
      }
      if (root && /^[A-Z]/.test(root) && !roots.has(full)) {
        roots.set(full, source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return roots;
}

function helperImports(source: ts.SourceFile): Array<{ name: string; typeOnly: boolean }> {
  const imports: Array<{ name: string; typeOnly: boolean }> = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || specifier.text !== "paseo-plugin-helper/client") {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.push({
          name: (element.propertyName ?? element.name).text,
          typeOnly: element.isTypeOnly,
        });
      }
    }
  }
  return imports;
}

function resolveRelativeModule(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  const candidates = [
    base,
    stripped,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(stripped, "index.ts"),
    path.join(stripped, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Recursively collect the value exports reachable from a barrel. */
function collectBarrelExports(entry: string): Set<string> {
  const exports = new Set<string>();
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = parseSource(file);
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        const specifier =
          statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : undefined;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (!element.isTypeOnly) exports.add(element.name.text);
          }
          continue;
        }
        if (specifier) {
          const target = resolveRelativeModule(file, specifier);
          if (target) walk(target);
        }
        continue;
      }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        continue;
      }
      if (ts.isFunctionDeclaration(statement) && statement.name) exports.add(statement.name.text);
      if (ts.isClassDeclaration(statement) && statement.name) exports.add(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          collectBinding(declaration.name, exports);
        }
      }
    }
  };
  walk(entry);
  return exports;
}

const parsedSurfaces = SURFACE_FILES.map((rel) => ({
  rel,
  source: parseSource(path.join(pluginRoot, rel)),
}));

describe("2fado client JSX element types resolve statically (#555)", () => {
  it("binds every capitalized JSX tag at module scope", () => {
    for (const { rel, source } of parsedSurfaces) {
      const bound = moduleValueBindings(source);
      for (const [full, line] of jsxElementRoots(source)) {
        const root = full.split(".")[0];
        expect(
          bound.has(root) || JSX_GLOBALS.has(root),
          `${rel}:${line} renders <${full}> but '${root}' is not a module-scope value import or declaration`,
        ).toBe(true);
      }
    }
  });

  it("imports only names the vendored helper barrel exports", () => {
    const vendored = collectBarrelExports(path.join(vendorRoot, "index.ts"));
    expect(vendored.size).toBeGreaterThan(0);
    for (const { rel, source } of parsedSurfaces) {
      for (const { name, typeOnly } of helperImports(source)) {
        if (typeOnly) continue;
        expect(
          vendored.has(name),
          `${rel} imports '${name}' from paseo-plugin-helper/client but the vendored barrel does not export it`,
        ).toBe(true);
      }
    }
  });

  it("keeps the vendored helper barrel in sync with the helper source barrel", () => {
    // Equivalent to `node scripts/vendor-sync.mjs --check`, scoped to the
    // exports this plugin actually resolves at build time.
    const vendored = [...collectBarrelExports(path.join(vendorRoot, "index.ts"))].sort();
    const source = [...collectBarrelExports(helperSrcBarrel)].sort();
    expect(vendored).toEqual(source);
  });
});

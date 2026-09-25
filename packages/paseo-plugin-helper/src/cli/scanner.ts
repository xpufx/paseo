import fs from "node:fs";
import path from "node:path";
import { AUDIT_RULES } from "./rules.js";
import type { AuditExemption, AuditIssue, AuditOptions, AuditReport } from "./types.js";
import { readPluginConformanceExemptions } from "./conformance-exemptions.js";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  "vendor",
  ".git",
  "dist",
  "build",
  ".paseo",
  ".agents",
  ".gemini",
  "coverage",
]);

const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const BARE_NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http",
  "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "timers", "tls", "trace_events", "tty", "url", "util",
  "v8", "vm", "wasi", "worker_threads", "zlib",
]);

function isBareNodeBuiltin(specifier: string): boolean {
  const root = specifier.split("/")[0];
  return BARE_NODE_BUILTINS.has(root);
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes("__tests__") ||
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.endsWith(".d.ts")
  );
}

function isBuildOrToolFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base.startsWith("tsup.config.") ||
    base.startsWith("vite.config.") ||
    base.startsWith("vitest.config.") ||
    base === "cli.ts" ||
    base === "scanner.ts" ||
    filePath.includes("/scripts/") ||
    filePath.includes("/testing/")
  );
}

function isGeneratedOrBundledFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base.includes(".bundled.") ||
    base.includes(".bundle.") ||
    base.includes(".min.") ||
    base.endsWith(".bundle.js") ||
    base.endsWith(".bundle.mjs")
  );
}

function findFiles(dir: string, ignoredCustom: Set<string>): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name) && !ignoredCustom.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (
          SCANNABLE_EXTENSIONS.has(ext) &&
          !entry.name.endsWith(".d.ts") &&
          !isGeneratedOrBundledFile(entry.name)
        ) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

export function auditProject(targetDir: string, options: AuditOptions = {}): AuditReport {
  const resolvedTarget = path.resolve(targetDir);
  const ignoredCustom = new Set(options.ignore ?? []);
  const files = findFiles(resolvedTarget, ignoredCustom);
  const issues: AuditIssue[] = [];

  // Per-rule opt-outs declared by the plugin itself, resolved before the file
  // loop so every rule check can consult them.
  const { exemptions, unknownExemptions } = readPluginConformanceExemptions(resolvedTarget);
  const isExempt = (ruleId: string): boolean => exemptions.has(ruleId);
  const exemptReason = (ruleId: string): string | undefined => exemptions.get(ruleId);

  const pushIssue = (
    ruleId: keyof typeof AUDIT_RULES,
    file: string,
    line: number,
    snippet: string,
    severityOverride?: AuditIssue["severity"],
  ) => {
    if (isExempt(ruleId)) return;
    const rule = AUDIT_RULES[ruleId];
    issues.push({
      ruleId: rule.id,
      severity: severityOverride ?? rule.severity,
      file,
      line,
      column: snippet.indexOf(snippet.trim()),
      message: rule.description,
      codeSnippet: snippet.trim(),
      replacement: rule.replacement,
      docUrl: rule.docUrl,
    });
  };

  // Project-level: v8-missing-requirements from paseo-plugin.json.
  // Error for v0.8-layout plugins (the daemon rejects them); warn for
  // older layouts as a migration heads-up. Manifest parsing happens after
  // hasV8Entries is known, so this check runs after the file loop below
  // (see the project-level checks at the end of this function).

  const hasV8Entries = files.some((f) => {
    const rel = path.relative(resolvedTarget, f);
    return (
      rel === "index.client.ts" ||
      rel === "index.client.tsx" ||
      rel === "index.server.ts" ||
      rel === "index.server.tsx"
    );
  });

  let helperClientUsed = false;
  let initCalled = false;

  for (const filePath of files) {
    const relPath = path.relative(resolvedTarget, filePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    const inTest = isTestFile(relPath);
    const inBuildOrTool = isBuildOrToolFile(relPath);

    // v8 init tracking (any file; the call itself belongs in client code)
    if (content.includes("paseo-plugin-helper/client")) {
      helperClientUsed = true;
    }
    if (content.includes("initClientHelpers(")) {
      initCalled = true;
    }

    // v8-root-module: stray code modules at the plugin root in v8 layouts.
    // Entry points, the generated version stamp, and type shims are legal.
    if (hasV8Entries && !relPath.includes(path.sep)) {
      const base = path.basename(relPath);
      const isCode = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base);
      const isLegalRoot = /^(index\.client|index\.server)\.(ts|tsx|js)$/.test(base) ||
        base === "version.ts" ||
        base.endsWith(".d.ts");
      if (isCode && !isLegalRoot && !inTest) {
        pushIssue("v8-root-module", relPath, 1, lines[0]?.trim() || base);
      }
    }

    // v8-crossed-import: runtime boundary violations by directory.
    if (!inTest && !inBuildOrTool) {
      const inClientDir = relPath.split(path.sep).includes("client");
      const inServerDir = relPath.split(path.sep).includes("server");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed.startsWith("import") && !trimmed.startsWith("} from") && !trimmed.startsWith("export")) {
          continue;
        }
        const reachesServer = /from\s+["'](\.\.\/)+server\//.test(line);
        const reachesClient = /from\s+["'](\.\.\/)+client\//.test(line);
        const specifier = /from\s+["']([^"']+)["']/.exec(line)?.[1] ?? "";
        const importsNode = specifier.startsWith("node:") || isBareNodeBuiltin(specifier);
        if ((inClientDir && (reachesServer || importsNode)) || (inServerDir && reachesClient)) {
          pushIssue("v8-crossed-import", relPath, i + 1, trimmed);
          break;
        }
      }
    }

    // Rule 1: no-manual-agent-subscription
    if (!inTest && !inBuildOrTool) {
      const hasAgentSubscribe = content.includes(".agents.subscribe(");
      const hasAddComposerPill = content.includes(".addComposerPill(");
      const hasRegisterPill = content.includes("registerComposerPill");

      if (hasAddComposerPill && !hasRegisterPill) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(".addComposerPill(") || line.includes(".agents.subscribe(")) {
            const rule = AUDIT_RULES["no-manual-agent-subscription"];
            issues.push({
              ruleId: rule.id,
              severity: rule.severity,
              file: relPath,
              line: i + 1,
              column: line.indexOf(line.trim()),
              message: rule.description,
              codeSnippet: line.trim(),
              replacement: rule.replacement,
              docUrl: rule.docUrl,
            });
            break; // 1 report per file is sufficient
          }
        }
      }
    }

    // Rule 2: no-raw-file-persistence
    if (!inTest && !inBuildOrTool && !isExempt("no-raw-file-persistence")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isFsWrite =
          line.includes("fs.writeFileSync(") ||
          line.includes("fs.writeFile(") ||
          line.includes("fs.promises.writeFile(");

        if (isFsWrite) {
          const isPersistingState =
            line.includes(".json") ||
            line.includes("status") ||
            line.includes("settings") ||
            line.includes("state") ||
            line.includes(".paseo");

          if (isPersistingState && !content.includes("PluginStorage")) {
            const rule = AUDIT_RULES["no-raw-file-persistence"];
            issues.push({
              ruleId: rule.id,
              severity: rule.severity,
              file: relPath,
              line: i + 1,
              column: line.indexOf(line.trim()),
              message: rule.description,
              codeSnippet: line.trim(),
              replacement: rule.replacement,
              docUrl: rule.docUrl,
            });
          }
        }
      }
    }

    // Rule 3: no-raw-console-in-server
    const isServerFile =
      relPath.includes(".server.") ||
      relPath.includes("/server/") ||
      (relPath.includes("index.") && !relPath.includes(".client."));

    if (isServerFile && !inTest && !inBuildOrTool) {
      if (!content.includes("createPluginLogger")) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (
            (line.includes("console.log(") ||
              line.includes("console.error(") ||
              line.includes("console.warn(")) &&
            !line.trim().startsWith("//")
          ) {
            const rule = AUDIT_RULES["no-raw-console-in-server"];
            issues.push({
              ruleId: rule.id,
              severity: rule.severity,
              file: relPath,
              line: i + 1,
              column: line.indexOf(line.trim()),
              message: rule.description,
              codeSnippet: line.trim(),
              replacement: rule.replacement,
              docUrl: rule.docUrl,
            });
            break; // 1 report per file
          }
        }
      }
    }

    // Rule 4: no-filesystem-plugin-probing
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isProbe =
          (line.includes("plugins") || line.includes("config.json")) &&
          (line.includes("fs.existsSync") ||
            line.includes("fs.stat") ||
            line.includes("fs.readdir") ||
            line.includes("fs.readFileSync"));

        if (
          isProbe &&
          !content.includes("isPluginRunning") &&
          !content.includes("isPluginInstalled") &&
          !content.includes("listPlugins")
        ) {
          const rule = AUDIT_RULES["no-filesystem-plugin-probing"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            column: line.indexOf(line.trim()),
            message: rule.description,
            codeSnippet: line.trim(),
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
        }
      }
    }

    // Rule 5: no-manual-mcp-config-mutation
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMcpConfig =
          line.includes(".claude.json") ||
          line.includes("mcp_config.json") ||
          line.includes("opencode.json");

        if (
          isMcpConfig &&
          (line.includes("writeFile") || line.includes("writeFileSync")) &&
          !content.includes("upsertMcpServer")
        ) {
          const rule = AUDIT_RULES["no-manual-mcp-config-mutation"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            column: line.indexOf(line.trim()),
            message: rule.description,
            codeSnippet: line.trim(),
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
        }
      }
    }

    // Rule 6: no-raw-mcp-subprocess
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMcpSpawn =
          (line.includes("spawn(") ||
            line.includes("child_process.exec(") ||
            line.includes("execSync(") ||
            line.includes("execFile(")) &&
          (line.includes("mcp") || content.includes("jsonrpc") || line.includes("stdio"));

        if (isMcpSpawn && !content.includes("McpClient")) {
          const rule = AUDIT_RULES["no-raw-mcp-subprocess"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            column: line.indexOf(line.trim()),
            message: rule.description,
            codeSnippet: line.trim(),
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
        }
      }
    }

    // Rule 7: no-raw-system-metrics
    if (!inTest && !inBuildOrTool && !relPath.includes("system.ts")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isRawMetric =
          line.includes("os.loadavg()") ||
          line.includes("os.cpus()") ||
          line.includes("/proc/loadavg") ||
          line.includes("/proc/stat");

        if (isRawMetric && !content.includes("getSystemMetrics")) {
          const rule = AUDIT_RULES["no-raw-system-metrics"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            column: line.indexOf(line.trim()),
            message: rule.description,
            codeSnippet: line.trim(),
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
          break;
        }
      }
    }

    // Rule 8: no-manual-version-resolution
    if (!inTest && !inBuildOrTool && !relPath.includes("version.ts")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isVersionProbe =
          line.includes("package.json") &&
          (line.includes(".version") || content.includes("JSON.parse(fs.readFileSync"));

        if (
          isVersionProbe &&
          !content.includes("resolvePluginVersion") &&
          !content.includes("stampVersion")
        ) {
          const rule = AUDIT_RULES["no-manual-version-resolution"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            column: line.indexOf(line.trim()),
            message: rule.description,
            codeSnippet: line.trim(),
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
          break;
        }
      }
    }

    // UI conformance rules apply to client files only.
    const isClientFile =
      relPath.split(path.sep).includes("client") ||
      /\.client\.(tsx?|jsx?|mjs|cjs)$/.test(relPath);

    // Rules: no-bare-react-native-ui, and the two bespoke-UI companions it
    // shares a scan with. Each is checked against its own exemption, so
    // exempting one never silently exempts the others.
    if (isClientFile && !inTest && !inBuildOrTool) {
      const importRe = /import\s+(?!type\b)([^;]*?)\s+from\s+["']react-native["']/g;
      let match: RegExpExecArray | null;
      while ((match = importRe.exec(content)) !== null) {
        const clause = match[1];
        const valueClause = clause.replace(/type\s+(ScrollView|Switch|TextInput|Button)\b/g, "");
        if (/\b(ScrollView|Switch|TextInput|Button)\b/.test(valueClause) && !isExempt("no-bare-react-native-ui")) {
          const before = content.slice(0, match.index);
          const lineNum = before.split("\n").length;
          const snippetLine = lines[lineNum - 1]?.trim() || match[0].split("\n")[0].trim();
          const rule = AUDIT_RULES["no-bare-react-native-ui"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: lineNum,
            column: Math.max(0, (lines[lineNum - 1] ?? "").indexOf((lines[lineNum - 1] ?? "").trim())),
            message: rule.description,
            codeSnippet: snippetLine,
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
        }
        const before = content.slice(0, match.index);
        const lineNum = before.split("\n").length;
        const snippetLine = lines[lineNum - 1]?.trim() || match[0].split("\n")[0].trim();
        const rawUiRules: Array<[string, RegExp]> = [
          [
            "no-bespoke-react-native-interactions",
            /\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/,
          ],
          ["no-bespoke-style-system", /\bStyleSheet\b/],
        ];
        for (const [ruleId, pattern] of rawUiRules) {
          if (!pattern.test(valueClause)) continue;
          if (isExempt(ruleId)) continue;
          const rule = AUDIT_RULES[ruleId];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: lineNum,
            column: Math.max(0, (lines[lineNum - 1] ?? "").indexOf((lines[lineNum - 1] ?? "").trim())),
            message: rule.description,
            codeSnippet: snippetLine,
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
        }
      }
    }

    // Rule: no-hardcoded-modal-dimensions
    if (isClientFile && !inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /minWidth\s*:\s*([4-9]\d{2}|\d{4,})/.test(line) ||
          /minHeight\s*:\s*([5-9]\d{2}|\d{4,})/.test(line)
        ) {
          const rule = AUDIT_RULES["no-hardcoded-modal-dimensions"];
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            column: line.indexOf(line.trim()),
            message: rule.description,
            codeSnippet: line.trim(),
            replacement: rule.replacement,
            docUrl: rule.docUrl,
          });
        }
      }
    }

    // Rule: no-helper-width-cap + no-host-scroll-hijack (#219).
    // Plugin code must not cap host-owned dialog frames or replace the host
    // scroller; the ui adapters (HostModalContent / HostScroll) delegate both.
    if (isClientFile && !inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
          continue;
        }
        const widthCap = /maxContentWidth/.test(line);
        const scrollHijack = /<Modal\.Content[^>]*scrollable=\{false\}/.test(line);
        if (!widthCap && !scrollHijack) continue;
        const rule = AUDIT_RULES[widthCap ? "no-helper-width-cap" : "no-host-scroll-hijack"];
        issues.push({
          ruleId: rule.id,
          severity: rule.severity,
          file: relPath,
          line: i + 1,
          column: line.indexOf(line.trim()),
          message: rule.description,
          codeSnippet: line.trim(),
          replacement: rule.replacement,
          docUrl: rule.docUrl,
        });
      }
    }
  }

  // Project-level checks needing whole-tree knowledge.
  try {
    const manifestPath = path.join(resolvedTarget, "paseo-plugin.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const hasRequirements =
        manifest &&
        typeof manifest === "object" &&
        manifest.requirements &&
        typeof manifest.requirements.paseo === "string";
      if (!hasRequirements) {
        pushIssue(
          "v8-missing-requirements",
          "paseo-plugin.json",
          1,
          '"id" without "requirements.paseo"',
          hasV8Entries ? undefined : "warn",
        );
      }
    }
  } catch {
    // Unparseable manifest is the daemon's complaint, not the audit's
  }

  if (helperClientUsed && !initCalled) {
    const entry =
      files
        .map((f) => path.relative(resolvedTarget, f))
        .find((rel) => rel === "index.client.tsx" || rel === "index.client.ts") ??
      "index.client.tsx";
    pushIssue(
      "missing-client-init",
      entry,
      1,
      "paseo-plugin-helper/client used without initClientHelpers()",
    );
  }

  // An exemption naming a rule that does not exist is a manifest bug, not a
  // finding the plugin can be exempted from: surface it so a typo cannot make
  // an audit look clean.
  for (const unknown of unknownExemptions) {
    const rule = AUDIT_RULES["unknown-conformance-exemption"];
    issues.push({
      ruleId: rule.id,
      severity: rule.severity,
      file: "paseo-plugin.json",
      line: 1,
      column: 0,
      message: `${rule.description} (declared: "${unknown}")`,
      codeSnippet: `"${unknown}"`,
      replacement: rule.replacement,
    });
  }

  const summary = {
    errorCount: issues.filter((i) => i.severity === "error").length,
    warnCount: issues.filter((i) => i.severity === "warn").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
    suggestionCount: issues.filter((i) => i.severity === "suggestion").length,
  };

  const passed = options.strict
    ? summary.errorCount === 0 && summary.warnCount === 0
    : summary.errorCount === 0;

  return {
    targetDir: resolvedTarget,
    scannedFiles: files.length,
    issues,
    exemptions: [...exemptions].map(([ruleId, reason]) => ({ ruleId, reason })),
    unknownExemptions,
    summary,
    passed,
  };
}

/**
 * Alias for auditProject.
 */
export const doctorProject = auditProject;

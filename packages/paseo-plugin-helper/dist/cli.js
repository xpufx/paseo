#!/usr/bin/env node
import process from 'process';
import fs2 from 'fs';
import path from 'path';
import { createRequire } from 'module';

// src/cli/rules.ts
var AUDIT_RULES = {
  "no-manual-agent-subscription": {
    id: "no-manual-agent-subscription",
    severity: "warn",
    description: "Manual Paseo agent subscription and composer pill registration detected.",
    replacement: "registerComposerPill from 'paseo-plugin-helper/client'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/client.md#3-lifecycle-registration-helpers"
  },
  "no-raw-file-persistence": {
    id: "no-raw-file-persistence",
    severity: "warn",
    description: "Direct file write (fs.writeFileSync / fs.writeFile) used for state, status, or configuration persistence.",
    replacement: "PluginStorage from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#3-atomic-state-storage-pluginstorage"
  },
  "no-raw-console-in-server": {
    id: "no-raw-console-in-server",
    severity: "suggestion",
    description: "Raw console logging (console.log / console.error) used in server runtime.",
    replacement: "createPluginLogger from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#1-structured-logging-createpluginlogger"
  },
  "no-filesystem-plugin-probing": {
    id: "no-filesystem-plugin-probing",
    severity: "warn",
    description: "Direct filesystem inspection of ~/.paseo/plugins or config.json to check plugin presence.",
    replacement: "isPluginRunning, isPluginInstalled, or listPlugins from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#12-plugin-query--lifecycle-helpers-listplugins-ispluginrunning-getplugininfo"
  },
  "no-manual-mcp-config-mutation": {
    id: "no-manual-mcp-config-mutation",
    severity: "warn",
    description: "Manual modification or parsing of agent MCP configuration files (Claude, Cursor, Gemini, OpenCode).",
    replacement: "upsertMcpServer / removeMcpServer from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#11-agent-mcp-configuration-writer-upsertmcpserver--removemcpserver"
  },
  "no-raw-mcp-subprocess": {
    id: "no-raw-mcp-subprocess",
    severity: "warn",
    description: "Raw child_process spawn used to launch or communicate with MCP stdio servers.",
    replacement: "McpClient from 'paseo-plugin-helper/mcp'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/mcp.md"
  },
  "no-raw-system-metrics": {
    id: "no-raw-system-metrics",
    severity: "suggestion",
    description: "Direct os module calls (os.loadavg, os.cpus) or /proc reads for host metrics.",
    replacement: "getSystemMetrics / CpuSampler from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#2-system-host-metrics-getsystemmetrics--cpusampler"
  },
  "no-unredacted-secrets": {
    id: "no-unredacted-secrets",
    severity: "warn",
    description: "Sensitive tokens, API keys, or credentials handled or logged without redaction.",
    replacement: "redactSecrets from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#5-secret-redaction-redactsecrets"
  },
  "no-manual-version-resolution": {
    id: "no-manual-version-resolution",
    severity: "suggestion",
    description: "Manual reading and parsing of package.json for plugin version resolution.",
    replacement: "resolvePluginVersion / stampVersion from 'paseo-plugin-helper/server'",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/server.md#6-plugin-version-resolution-resolvepluginversion"
  },
  "v8-missing-requirements": {
    id: "v8-missing-requirements",
    severity: "error",
    description: "paseo-plugin.json has no requirements.paseo, which a v0.8 daemon reads as pre-0.8 and rejects.",
    replacement: 'Add "requirements": { "paseo": ">=0.8.0" } to paseo-plugin.json (migration guide step 7)',
    docUrl: "https://paseo.sh/docs/plugins/v0.8/migration"
  },
  "v8-root-module": {
    id: "v8-root-module",
    severity: "error",
    description: "Code module at the plugin root in a v0.8-layout plugin. The v0.8 compiler only accepts client/, server/, and shared/ directories.",
    replacement: "Move the file into client/, server/, or shared/ and fix its imports",
    docUrl: "https://paseo.sh/docs/plugins/v0.8/migration"
  },
  "v8-crossed-import": {
    id: "v8-crossed-import",
    severity: "error",
    description: "Cross-runtime import: client code reaching into server/ (or vice versa), or a Node API imported into the client bundle. The v0.8 compiler rejects these.",
    replacement: "Move the operation behind an RPC defined in shared/ and call it from the client",
    docUrl: "https://paseo.sh/docs/plugins/v0.8/migration"
  },
  "missing-client-init": {
    id: "missing-client-init",
    severity: "warn",
    description: "Client code uses paseo-plugin-helper/client components or hooks but never calls initClientHelpers(). Every helper component throws without it.",
    replacement: "Call initClientHelpers({ Icon, Modal, useRpc, useToast }) once in the client entry with version-correct SDK imports",
    docUrl: "https://github.com/xpufx/paseo-plugin-helper/blob/main/docs/client.md"
  }
};

// src/cli/scanner.ts
var DEFAULT_IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".paseo",
  ".agents",
  ".gemini",
  "coverage"
]);
var SCANNABLE_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
var BARE_NODE_BUILTINS = /* @__PURE__ */ new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib"
]);
function isBareNodeBuiltin(specifier) {
  const root = specifier.split("/")[0];
  return BARE_NODE_BUILTINS.has(root);
}
function isTestFile(filePath) {
  return filePath.includes("__tests__") || filePath.includes(".test.") || filePath.includes(".spec.") || filePath.endsWith(".d.ts");
}
function isBuildOrToolFile(filePath) {
  const base = path.basename(filePath);
  return base.startsWith("tsup.config.") || base.startsWith("vite.config.") || base.startsWith("vitest.config.") || base === "cli.ts" || base === "scanner.ts" || filePath.includes("/scripts/") || filePath.includes("/testing/");
}
function isGeneratedOrBundledFile(filePath) {
  const base = path.basename(filePath);
  return base.includes(".bundled.") || base.includes(".bundle.") || base.includes(".min.") || base.endsWith(".bundle.js") || base.endsWith(".bundle.mjs");
}
function findFiles(dir, ignoredCustom) {
  const results = [];
  function walk(current) {
    let entries = [];
    try {
      entries = fs2.readdirSync(current, { withFileTypes: true });
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
        if (SCANNABLE_EXTENSIONS.has(ext) && !entry.name.endsWith(".d.ts") && !isGeneratedOrBundledFile(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  }
  walk(dir);
  return results;
}
function auditProject(targetDir, options = {}) {
  const resolvedTarget = path.resolve(targetDir);
  const ignoredCustom = new Set(options.ignore ?? []);
  const files = findFiles(resolvedTarget, ignoredCustom);
  const issues = [];
  const pushIssue = (ruleId, file, line, snippet, severityOverride) => {
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
      docUrl: rule.docUrl
    });
  };
  const hasV8Entries = files.some((f) => {
    const rel = path.relative(resolvedTarget, f);
    return rel === "index.client.ts" || rel === "index.client.tsx" || rel === "index.server.ts" || rel === "index.server.tsx";
  });
  let helperClientUsed = false;
  let initCalled = false;
  for (const filePath of files) {
    const relPath = path.relative(resolvedTarget, filePath);
    const content = fs2.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const inTest = isTestFile(relPath);
    const inBuildOrTool = isBuildOrToolFile(relPath);
    if (content.includes("paseo-plugin-helper/client")) {
      helperClientUsed = true;
    }
    if (content.includes("initClientHelpers(")) {
      initCalled = true;
    }
    if (hasV8Entries && !relPath.includes(path.sep)) {
      const base = path.basename(relPath);
      const isCode = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base);
      const isLegalRoot = /^(index\.client|index\.server)\.(ts|tsx|js)$/.test(base) || base === "version.ts" || base.endsWith(".d.ts");
      if (isCode && !isLegalRoot && !inTest) {
        pushIssue("v8-root-module", relPath, 1, lines[0]?.trim() || base);
      }
    }
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
        if (inClientDir && (reachesServer || importsNode) || inServerDir && reachesClient) {
          pushIssue("v8-crossed-import", relPath, i + 1, trimmed);
          break;
        }
      }
    }
    if (!inTest && !inBuildOrTool) {
      content.includes(".agents.subscribe(");
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
              docUrl: rule.docUrl
            });
            break;
          }
        }
      }
    }
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isFsWrite = line.includes("fs.writeFileSync(") || line.includes("fs.writeFile(") || line.includes("fs.promises.writeFile(");
        if (isFsWrite) {
          const isPersistingState = line.includes(".json") || line.includes("status") || line.includes("settings") || line.includes("state") || line.includes(".paseo");
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
              docUrl: rule.docUrl
            });
          }
        }
      }
    }
    const isServerFile = relPath.includes(".server.") || relPath.includes("/server/") || relPath.includes("index.") && !relPath.includes(".client.");
    if (isServerFile && !inTest && !inBuildOrTool) {
      if (!content.includes("createPluginLogger")) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if ((line.includes("console.log(") || line.includes("console.error(") || line.includes("console.warn(")) && !line.trim().startsWith("//")) {
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
              docUrl: rule.docUrl
            });
            break;
          }
        }
      }
    }
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isProbe = (line.includes("plugins") || line.includes("config.json")) && (line.includes("fs.existsSync") || line.includes("fs.stat") || line.includes("fs.readdir") || line.includes("fs.readFileSync"));
        if (isProbe && !content.includes("isPluginRunning") && !content.includes("isPluginInstalled") && !content.includes("listPlugins")) {
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
            docUrl: rule.docUrl
          });
        }
      }
    }
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMcpConfig = line.includes(".claude.json") || line.includes("mcp_config.json") || line.includes("opencode.json");
        if (isMcpConfig && (line.includes("writeFile") || line.includes("writeFileSync")) && !content.includes("upsertMcpServer")) {
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
            docUrl: rule.docUrl
          });
        }
      }
    }
    if (!inTest && !inBuildOrTool) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMcpSpawn = (line.includes("spawn(") || line.includes("child_process.exec(") || line.includes("execSync(") || line.includes("execFile(")) && (line.includes("mcp") || content.includes("jsonrpc") || line.includes("stdio"));
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
            docUrl: rule.docUrl
          });
        }
      }
    }
    if (!inTest && !inBuildOrTool && !relPath.includes("system.ts")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isRawMetric = line.includes("os.loadavg()") || line.includes("os.cpus()") || line.includes("/proc/loadavg") || line.includes("/proc/stat");
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
            docUrl: rule.docUrl
          });
          break;
        }
      }
    }
    if (!inTest && !inBuildOrTool && !relPath.includes("version.ts")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isVersionProbe = line.includes("package.json") && (line.includes(".version") || content.includes("JSON.parse(fs.readFileSync"));
        if (isVersionProbe && !content.includes("resolvePluginVersion") && !content.includes("stampVersion")) {
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
            docUrl: rule.docUrl
          });
          break;
        }
      }
    }
  }
  try {
    const manifestPath = path.join(resolvedTarget, "paseo-plugin.json");
    if (fs2.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf-8"));
      const hasRequirements = manifest && typeof manifest === "object" && manifest.requirements && typeof manifest.requirements.paseo === "string";
      if (!hasRequirements) {
        pushIssue(
          "v8-missing-requirements",
          "paseo-plugin.json",
          1,
          '"id" without "requirements.paseo"',
          hasV8Entries ? void 0 : "warn"
        );
      }
    }
  } catch {
  }
  if (helperClientUsed && !initCalled) {
    const entry = files.map((f) => path.relative(resolvedTarget, f)).find((rel) => rel === "index.client.tsx" || rel === "index.client.ts") ?? "index.client.tsx";
    pushIssue(
      "missing-client-init",
      entry,
      1,
      "paseo-plugin-helper/client used without initClientHelpers()"
    );
  }
  const summary = {
    errorCount: issues.filter((i) => i.severity === "error").length,
    warnCount: issues.filter((i) => i.severity === "warn").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
    suggestionCount: issues.filter((i) => i.severity === "suggestion").length
  };
  const passed = options.strict ? summary.errorCount === 0 && summary.warnCount === 0 : summary.errorCount === 0;
  return {
    targetDir: resolvedTarget,
    scannedFiles: files.length,
    issues,
    summary,
    passed
  };
}
var doctorProject = auditProject;
function readJson(filePath) {
  return JSON.parse(fs2.readFileSync(filePath, "utf8"));
}
function resolveHelperVersion(explicit) {
  if (explicit) return explicit;
  try {
    const require2 = createRequire(import.meta.url);
    const pkg = require2("../../package.json");
    if (typeof pkg?.version === "string") {
      const [major, minor] = pkg.version.split(".");
      return `^${major}.${minor}.0`;
    }
  } catch {
  }
  return "^0.4.0";
}
function detectSdkMajor(pkg) {
  const version = pkg?.devDependencies?.["@getpaseo/plugin"] ?? pkg?.dependencies?.["@getpaseo/plugin"];
  if (typeof version !== "string") return void 0;
  const match = version.match(/(\d+)\.(\d+)/);
  if (!match) return void 0;
  const major = Number(match[1]);
  if (major !== 0) return 8;
  return Number(match[2]) >= 8 ? 8 : 7;
}
function initBlock(sdkMajor) {
  if (sdkMajor === 8) {
    return [
      `import { useRpc } from "@getpaseo/plugin/client";`,
      `import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";`,
      `import { initClientHelpers } from "paseo-plugin-helper/client";`,
      ``,
      `initClientHelpers({ Icon, Modal, useRpc, useToast });`
    ].join("\n");
  }
  return [
    `import { useRpc } from "@getpaseo/plugin";`,
    `import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";`,
    `import { initClientHelpers } from "paseo-plugin-helper/client";`,
    ``,
    `initClientHelpers({ Icon, Modal, useRpc, useToast });`
  ].join("\n");
}
function adoptProject(targetDir, options = {}) {
  const directory = path.resolve(targetDir);
  const packagePath = path.join(directory, "package.json");
  const clientEntry = path.join(directory, "index.client.tsx");
  if (!fs2.existsSync(packagePath)) {
    throw new Error(
      `No package.json in ${directory}. Run \`paseo plugin init\` there first.`
    );
  }
  if (!fs2.existsSync(clientEntry)) {
    throw new Error(
      `No index.client.tsx in ${directory}. Adopt needs a client entry to wire init into.`
    );
  }
  const pkg = readJson(packagePath);
  const sdkMajor = detectSdkMajor(pkg);
  if (sdkMajor === void 0) {
    throw new Error(
      `Cannot determine @getpaseo/plugin SDK generation in ${packagePath}.`
    );
  }
  const helperVersion = resolveHelperVersion(options.helperVersion);
  let addedDependency = false;
  pkg.dependencies = pkg.dependencies ?? {};
  if (!pkg.dependencies["paseo-plugin-helper"]) {
    pkg.dependencies["paseo-plugin-helper"] = helperVersion;
    addedDependency = true;
  }
  let content = fs2.readFileSync(clientEntry, "utf8");
  let addedInit = false;
  if (!content.includes("initClientHelpers")) {
    const block = initBlock(sdkMajor);
    const lines = content.split("\n");
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import[\s(]/.test(lines[i])) {
        insertAt = i + 1;
      } else if (lines[i].trim() !== "") {
        break;
      }
    }
    lines.splice(insertAt, 0, "", block);
    content = lines.join("\n");
    fs2.writeFileSync(clientEntry, content);
    addedInit = true;
  }
  if (addedDependency) {
    fs2.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}
`);
  }
  return {
    directory,
    sdkMajor,
    addedDependency,
    addedInit,
    alreadyAdopted: !addedDependency && !addedInit
  };
}
function formatAdoptResult(result) {
  const lines = [
    `Adopted ${result.directory} (SDK v${result.sdkMajor}).`,
    result.addedDependency ? `- Added paseo-plugin-helper dependency. Run \`npm install\`.` : `- Dependency already present.`,
    result.addedInit ? `- Wired initClientHelpers() into index.client.tsx.` : `- initClientHelpers() already wired.`,
    `Next: npm install && npm run typecheck`
  ];
  return lines.join("\n");
}

// src/cli/formatter.ts
function formatReportPretty(report) {
  const lines = [];
  lines.push(`Auditing Paseo plugin at ${report.targetDir}...`);
  lines.push("");
  if (report.issues.length === 0) {
    lines.push(`[PASS] Clean audit. All ${report.scannedFiles} files follow paseo-plugin-helper patterns.`);
    return lines.join("\n");
  }
  for (const issue of report.issues) {
    const prefix = issue.severity.toUpperCase().padEnd(10);
    lines.push(`[${prefix}] ${issue.file}:${issue.line}:${issue.column} (${issue.ruleId})`);
    lines.push(`           ${issue.message}`);
    if (issue.codeSnippet) {
      lines.push(`           Code: ${issue.codeSnippet}`);
    }
    lines.push(`           Replacement: ${issue.replacement}`);
    if (issue.docUrl) {
      lines.push(`           Docs: ${issue.docUrl}`);
    }
    lines.push("");
  }
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `Audit Summary: ${report.issues.length} opportunities found across ${report.scannedFiles} scanned files (${report.summary.errorCount} errors, ${report.summary.warnCount} warnings, ${report.summary.suggestionCount} suggestions).`
  );
  if (!report.passed) {
    lines.push("Result: FAILED (strict mode enabled or errors found)");
  } else {
    lines.push("Result: PASSED with suggestions/warnings");
  }
  return lines.join("\n");
}
function formatReportJson(report) {
  return JSON.stringify(report, null, 2);
}

// src/cli/index.ts
function runCli(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`
Paseo Plugin Helper CLI (audit & lint)

Usage:
  npx paseo-plugin-helper audit [path] [options]
  npx paseo-plugin-helper doctor [path] [options]
  npx paseo-plugin-helper adopt [path]
  npx paseo-plugin-helper [path] [options]

Commands:
  audit / doctor    Scan for bespoke patterns replaceable by helper primitives
  adopt             Layer paseo-plugin-helper onto a \`paseo plugin init\` scaffold

Options:
  --strict             Exit with code 1 if any warnings or errors are found
  --format <type>      Output format: pretty (default) or json
  --ignore <dirs>      Comma-separated list of directories to ignore
  -h, --help           Show this help message

Examples:
  npx paseo-plugin-helper audit .
  npx paseo-plugin-helper doctor .
  npx paseo-plugin-helper adopt ~/code/my-plugin
  npx paseo-plugin-helper audit ~/code/my-plugin --strict
  npx paseo-plugin-helper audit . --format json
`);
    return 0;
  }
  if (argv[0] === "adopt") {
    const targetDir2 = argv[1] && !argv[1].startsWith("-") ? argv[1] : ".";
    try {
      const result = adoptProject(targetDir2);
      console.log(formatAdoptResult(result));
      return 0;
    } catch (err) {
      console.error(`adopt failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }
  let targetDir = ".";
  const options = {
    strict: false,
    format: "pretty",
    ignore: []
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "audit" || arg === "doctor") {
      continue;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--format" && argv[i + 1]) {
      options.format = argv[i + 1] === "json" ? "json" : "pretty";
      i++;
    } else if (arg === "--ignore" && argv[i + 1]) {
      options.ignore = argv[i + 1].split(",").map((s) => s.trim());
      i++;
    } else if (!arg.startsWith("-")) {
      targetDir = arg;
    }
  }
  const report = auditProject(targetDir, options);
  if (options.format === "json") {
    console.log(formatReportJson(report));
  } else {
    console.log(formatReportPretty(report));
  }
  return report.passed ? 0 : 1;
}
var isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("/cli.cjs") || process.argv[1].endsWith("/paseo-plugin-helper.js") || process.argv[1].includes("paseo-plugin-helper"));
if (isMain) {
  const exitCode = runCli();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export { AUDIT_RULES, adoptProject, auditProject, doctorProject, formatAdoptResult, formatReportJson, formatReportPretty, runCli };
//# sourceMappingURL=cli.js.map
//# sourceMappingURL=cli.js.map
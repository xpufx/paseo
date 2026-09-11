import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export interface AdoptResult {
  directory: string;
  sdkMajor: 7 | 8;
  addedDependency: boolean;
  addedInit: boolean;
  alreadyAdopted: boolean;
}

export interface AdoptOptions {
  helperVersion?: string;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveHelperVersion(explicit?: string): string {
  if (explicit) return explicit;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json");
    if (typeof pkg?.version === "string") {
      const [major, minor] = pkg.version.split(".");
      return `^${major}.${minor}.0`;
    }
  } catch {
    // Fall through to default below
  }
  return "^0.4.0";
}

function detectSdkMajor(pkg: any): 7 | 8 | undefined {
  const version: unknown =
    pkg?.devDependencies?.["@getpaseo/plugin"] ?? pkg?.dependencies?.["@getpaseo/plugin"];
  if (typeof version !== "string") return undefined;
  // Paseo is 0.x versioned, so the generation lives in the minor number
  // (0.7.x is v7, 0.8.x is v8). A future 1.x+ counts as v8-or-newer.
  const match = version.match(/(\d+)\.(\d+)/);
  if (!match) return undefined;
  const major = Number(match[1]);
  if (major !== 0) return 8;
  return Number(match[2]) >= 8 ? 8 : 7;
}

function initBlock(sdkMajor: 7 | 8): string {
  if (sdkMajor === 8) {
    return [
      `import { useRpc } from "@getpaseo/plugin/client";`,
      `import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";`,
      `import { initClientHelpers } from "paseo-plugin-helper/client";`,
      ``,
      `initClientHelpers({ Icon, Modal, useRpc, useToast });`,
    ].join("\n");
  }
  return [
    `import { useRpc } from "@getpaseo/plugin";`,
    `import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";`,
    `import { initClientHelpers } from "paseo-plugin-helper/client";`,
    ``,
    `initClientHelpers({ Icon, Modal, useRpc, useToast });`,
  ].join("\n");
}

/**
 * Layers paseo-plugin-helper onto a plugin directory created by
 * `paseo plugin init`: adds the dependency and injects the required
 * `initClientHelpers()` call into the client entry using import specifiers
 * that match the installed SDK generation. Safe to run twice.
 */
export function adoptProject(
  targetDir: string,
  options: AdoptOptions = {},
): AdoptResult {
  const directory = path.resolve(targetDir);
  const packagePath = path.join(directory, "package.json");
  const clientEntry = path.join(directory, "index.client.tsx");

  if (!fs.existsSync(packagePath)) {
    throw new Error(
      `No package.json in ${directory}. Run \`paseo plugin init\` there first.`,
    );
  }
  if (!fs.existsSync(clientEntry)) {
    throw new Error(
      `No index.client.tsx in ${directory}. Adopt needs a client entry to wire init into.`,
    );
  }

  const pkg = readJson(packagePath);
  const sdkMajor = detectSdkMajor(pkg);
  if (sdkMajor === undefined) {
    throw new Error(
      `Cannot determine @getpaseo/plugin SDK generation in ${packagePath}.`,
    );
  }

  const helperVersion = resolveHelperVersion(options.helperVersion);
  let addedDependency = false;
  pkg.dependencies = pkg.dependencies ?? {};
  if (!pkg.dependencies["paseo-plugin-helper"]) {
    pkg.dependencies["paseo-plugin-helper"] = helperVersion;
    addedDependency = true;
  }

  let content = fs.readFileSync(clientEntry, "utf8");
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
    fs.writeFileSync(clientEntry, content);
    addedInit = true;
  }

  if (addedDependency) {
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return {
    directory,
    sdkMajor,
    addedDependency,
    addedInit,
    alreadyAdopted: !addedDependency && !addedInit,
  };
}

export function formatAdoptResult(result: AdoptResult): string {
  const lines = [
    `Adopted ${result.directory} (SDK v${result.sdkMajor}).`,
    result.addedDependency
      ? `- Added paseo-plugin-helper dependency. Run \`npm install\`.`
      : `- Dependency already present.`,
    result.addedInit
      ? `- Wired initClientHelpers() into index.client.tsx.`
      : `- initClientHelpers() already wired.`,
    `Next: npm install && npm run typecheck`,
  ];
  return lines.join("\n");
}

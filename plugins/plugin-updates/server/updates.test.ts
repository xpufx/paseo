import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoPluginInfo, SafeSpawnResult } from "paseo-plugin-helper/server";
import { testing } from "./updates";

function result(stdout = "", code = 0, stderr = ""): SafeSpawnResult {
  return { stdout, stderr, code, signal: null, durationMs: 1 };
}

function hex(char: string): string {
  return char.repeat(40);
}

const LOCAL = hex("a");
const REMOTE = hex("b");
const BASE = hex("c");
const UPSTREAM = hex("d");
const TREE_LOCAL = hex("1");
const TREE_REMOTE = hex("2");
const TREE_WORK = hex("3");
const TREE_TAG = hex("4");

function plugin(id = "demo", pluginPath = "/repo/plugins/demo", extra: Partial<PaseoPluginInfo> = {}): PaseoPluginInfo {
  return { id, path: pluginPath, enabled: true, status: "running", ...extra };
}

type Runner = Parameters<typeof testing.probePlugin>[1];

interface Call {
  command: string;
  args: string[];
  timeoutMs: number;
  cwd?: string;
}

interface MockOptions {
  toplevel?: string | null | ((cwd: string | undefined) => string | null);
  head?: string | ((cwd: string | undefined) => string);
  currentBranch?: string;
  upstream?: string | null;
  remoteUrl?: string;
  trees?: Record<string, string>;
  refs?: Record<string, string>;
  revParseStderr?: (expr: string) => string;
  lsRemote?: (ref: string) => string;
  lsRemoteCode?: number;
  lsRemoteStderr?: string;
  lsRemoteThrows?: Error;
  statusPorcelain?: string;
  stashCreate?: string;
  isAncestor?: (a: string, b: string) => 0 | 1 | 128;
  mergeBase?: (a: string, b: string) => string | null;
  log?: string;
  fetchCode?: number;
  fetchStderr?: string;
  pullCode?: number;
  pullOutput?: string;
  pullStderr?: string;
  reloadCode?: number;
  paseoUpdateCode?: number;
  calls?: Call[];
}

function makeRunner(opts: MockOptions): Runner {
  return async (command, args, options) => {
    opts.calls?.push({ command, args, timeoutMs: options.timeoutMs, cwd: options.cwd });

    if (command === "paseo" && args[0] === "plugin" && args[1] === "reload") {
      return result("reloaded", opts.reloadCode ?? 0, opts.reloadCode ? "reload failed" : "");
    }
    if (command === "paseo" && args[0] === "plugin" && args[1] === "update") {
      return result("updated", opts.paseoUpdateCode ?? 0, opts.paseoUpdateCode ? "update failed" : "");
    }
    if (command !== "git") return result("", 1, "unexpected command");

    const inCache = args[0] === "-C";
    const gitArgs = inCache ? args.slice(2) : args;
    const cmd = gitArgs[0];

    if (cmd === "rev-parse") {
      if (!inCache) {
        if (gitArgs[1] === "--show-toplevel") {
          const top = typeof opts.toplevel === "function" ? opts.toplevel(options.cwd) : opts.toplevel;
          if (top === null) return result("", 128, "fatal: not a git repository");
          return result(`${top ?? "/repo"}\n`);
        }
        if (gitArgs[1] === "--abbrev-ref" && gitArgs[2] === "--symbolic-full-name") {
          if (opts.upstream === null) return result("", 128, "fatal: no upstream configured for branch 'main'");
          return result(`${opts.upstream ?? "origin/main"}\n`);
        }
        if (gitArgs[1] === "--abbrev-ref") return result(`${opts.currentBranch ?? "main"}\n`);
        if (gitArgs[1] === "HEAD") {
          const head = typeof opts.head === "function" ? opts.head(options.cwd) : (opts.head ?? LOCAL);
          return result(`${head}\n`);
        }
      }
      const expr = gitArgs[1]!;
      const value = opts.trees?.[expr] ?? opts.refs?.[expr];
      if (value) return result(`${value}\n`);
      return result("", 128, opts.revParseStderr?.(expr) ?? `fatal: path '${expr}' does not exist in the repository`);
    }

    if (cmd === "ls-remote") {
      if (opts.lsRemoteThrows) throw opts.lsRemoteThrows;
      if ((opts.lsRemoteCode ?? 0) !== 0) {
        return result("", opts.lsRemoteCode ?? 128, opts.lsRemoteStderr ?? "fatal: unable to access remote");
      }
      return result(opts.lsRemote?.(gitArgs[2]!) ?? "");
    }

    if (cmd === "init") return result("");
    if (cmd === "fetch") {
      if ((opts.fetchCode ?? 0) !== 0) return result("", opts.fetchCode ?? 128, opts.fetchStderr ?? "fatal: fetch failed");
      return result("");
    }
    if (cmd === "log") return result(opts.log ?? "");
    if (cmd === "status") return result(opts.statusPorcelain ?? "");
    if (cmd === "stash") return result(opts.stashCreate ?? "");
    if (cmd === "remote") return result(`${opts.remoteUrl ?? "https://example.test/repo.git"}\n`);
    if (cmd === "merge-base") {
      if (gitArgs[1] === "--is-ancestor") {
        const code = opts.isAncestor?.(gitArgs[2]!, gitArgs[3]!) ?? 1;
        return result("", code);
      }
      const base = opts.mergeBase?.(gitArgs[1]!, gitArgs[2]!);
      return base ? result(`${base}\n`) : result("", 1);
    }
    if (cmd === "pull") {
      if ((opts.pullCode ?? 0) !== 0) {
        return result("", opts.pullCode ?? 1, opts.pullStderr ?? "fatal: not possible to fast-forward");
      }
      return result(opts.pullOutput ?? "Already up to date", 0);
    }
    return result("", 1, `unexpected git command: ${gitArgs.join(" ")}`);
  };
}

const NO_FILES = async (): Promise<string> => {
  throw new Error("missing file");
};

function branchRemote(commit = REMOTE): string {
  return `${commit}\trefs/heads/main\n`;
}

// ---------------------------------------------------------------------------
// Identity / ref semantics
// ---------------------------------------------------------------------------

test("reports not-a-repo when the toplevel cannot be resolved", async () => {
  const probe = await testing.probePlugin(plugin(), makeRunner({ toplevel: null }), { readFile: NO_FILES });

  assert.equal(probe.status, "not-a-repo");
  assert.equal(probe.error, null);
  assert.match(probe.detail ?? "", /not a git repository/i);
});

test("reports unpinned on detached HEAD and never probes a remote", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ toplevel: "/repo", currentBranch: "HEAD", upstream: null, calls }),
    { readFile: NO_FILES },
  );

  assert.equal(probe.status, "unpinned");
  assert.equal(calls.some((call) => call.args.includes("ls-remote")), false);
});

test("reports no-upstream and stays report-only", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ toplevel: "/repo", upstream: null, calls }),
    { readFile: NO_FILES },
  );

  assert.equal(probe.status, "no-upstream");
  assert.equal(probe.ref, "main");
  assert.equal(calls.some((call) => call.args.includes("ls-remote")), false);
});

test("derives (repo, ref, subdir) and reports the committed subdir tree", async () => {
  const probe = await testing.probePlugin(
    plugin("demo", "/repo/plugins/demo"),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      upstream: "origin/main",
      lsRemote: () => branchRemote(REMOTE),
      trees: { [`${LOCAL}:plugins/demo`]: TREE_LOCAL, [`${REMOTE}:plugins/demo`]: TREE_REMOTE },
      isAncestor: () => 0,
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.repoRoot, "/repo");
  assert.equal(probe.subdir, "plugins/demo");
  assert.equal(probe.ref, "main");
  assert.equal(probe.refKind, "branch");
  assert.equal(probe.localTree, TREE_LOCAL);
  assert.equal(probe.remoteTree, TREE_REMOTE);
});

// ---------------------------------------------------------------------------
// Source URL: install source first, package.json only as fallback
// ---------------------------------------------------------------------------

function packageFile(pkg: Record<string, unknown>, records?: Record<string, unknown>) {
  return async (file: string): Promise<string> => {
    if (file.endsWith("package.json")) return JSON.stringify(pkg);
    if (file.endsWith("sources.json") && records) return JSON.stringify(records);
    throw new Error("missing file");
  };
}

test("derives a directory install's source from its checkout remote, not package.json", async () => {
  const probe = await testing.probePlugin(
    { id: "x-comms", path: "/repo/plugins/x-comms", enabled: true, status: "running", source: "directory" },
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      upstream: "origin/main",
      remoteUrl: "ssh://git@forge.example.com:222/xpufx/paseo.git",
      lsRemote: () => branchRemote(REMOTE),
      trees: { [`${LOCAL}:plugins/x-comms`]: TREE_LOCAL, [`${REMOTE}:plugins/x-comms`]: TREE_REMOTE },
      isAncestor: () => 0,
    }),
    {
      readFile: packageFile({ repository: { url: "https://github.com/xpufx/paseo-cross-daemon-comms.git" } }),
      cacheRoot: "/cache",
    },
  );

  assert.equal(
    probe.sourceUrl,
    "https://forge.example.com/xpufx/paseo/src/branch/main/plugins/x-comms",
  );
});

test("derives a git install's source from its managed remote, not package.json", async () => {
  const records = {
    gitty: {
      remote: "https://forge.example.com/xpufx/paseo.git",
      requestedRef: "main",
      trackingBranch: "main",
      commit: REMOTE,
      pluginPath: "plugins/gitty",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("gitty", {}),
    makeRunner({
      toplevel: "/managed/gitty",
      head: REMOTE,
      remoteUrl: "https://github.com/xpufx/declared.git",
      lsRemote: (ref) => `${REMOTE}\trefs/heads/${ref}\n`,
      trees: { [`${REMOTE}:plugins/gitty`]: TREE_REMOTE },
    }),
    { readFile: packageFile({ repository: "https://github.com/xpufx/declared.git" }, records), cacheRoot: "/cache" },
  );

  assert.equal(
    probe.sourceUrl,
    "https://forge.example.com/xpufx/paseo/src/branch/main/plugins/gitty",
  );
});

test("falls back to package.json repository.url when the install has no remote", async () => {
  const probe = await testing.probePlugin(
    plugin("demo", "/repo/plugins/demo"),
    makeRunner({ toplevel: null }),
    {
      readFile: packageFile({
        repository: "git@github.com:xpufx/standalone.git",
        homepage: "https://example.test/docs",
      }),
      cacheRoot: "/cache",
    },
  );

  assert.equal(probe.status, "not-a-repo");
  assert.equal(probe.sourceUrl, "https://github.com/xpufx/standalone");
});

// ---------------------------------------------------------------------------
// Subdir-scoped comparison
// ---------------------------------------------------------------------------

test("equal subdir trees suppress an update despite a repo-level remote change", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: { [`${LOCAL}:plugins/demo`]: TREE_LOCAL, [`${REMOTE}:plugins/demo`]: TREE_LOCAL },
      calls,
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.notEqual(probe.localCommit, probe.remoteCommit);
  assert.equal(probe.localTree, probe.remoteTree);
  assert.equal(probe.status, "current");
  assert.equal(probe.updateAvailable, false);
  // No ancestry probing is needed once the subdir trees match.
  assert.equal(calls.some((call) => call.args.includes("merge-base")), false);
});

test("does not fabricate a subdir change subject from a shallow cache", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: {
        [`${LOCAL}:plugins/demo`]: TREE_LOCAL,
        [`${REMOTE}:plugins/demo`]: TREE_LOCAL,
      },
      refs: { "--is-shallow-repository": "true" },
      log: `${hex("7")}\t2026-01-01T00:00:00Z\tunrelated README change`,
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.latestChange?.commit, REMOTE);
  assert.equal(probe.latestChange?.subject, null);
});

test("reports behind when the remote subdir is ahead", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: { [`${LOCAL}:plugins/demo`]: TREE_LOCAL, [`${REMOTE}:plugins/demo`]: TREE_REMOTE },
      isAncestor: (a, b) => (a === LOCAL && b === REMOTE ? 0 : 1),
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "behind");
  assert.equal(probe.updateAvailable, true);
  assert.match(probe.detail ?? "", /ahead/i);
});

test("does not flag an update when only the local side changed the subdir", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: { [`${LOCAL}:plugins/demo`]: TREE_LOCAL, [`${REMOTE}:plugins/demo`]: TREE_REMOTE },
      isAncestor: (a, b) => (a === REMOTE && b === LOCAL ? 0 : 1),
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "current");
  assert.equal(probe.updateAvailable, false);
  assert.match(probe.detail ?? "", /local is ahead/i);
});

test("a README-only remote commit does not flag a diverged subdir that it never touched", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: {
        [`${LOCAL}:plugins/demo`]: TREE_LOCAL,
        [`${REMOTE}:plugins/demo`]: TREE_REMOTE,
        [`${BASE}:plugins/demo`]: TREE_REMOTE,
      },
      isAncestor: () => 1,
      mergeBase: () => BASE,
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "current");
  assert.equal(probe.updateAvailable, false);
  assert.match(probe.detail ?? "", /did not change/i);
});

test("reports report-only missing when the plugin subdir is absent at the resolved remote ref", async () => {
  const probe = await testing.probePlugin(
    plugin("plugin-updates", "/repo/plugins/plugin-updates"),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: { [`${LOCAL}:plugins/plugin-updates`]: TREE_LOCAL },
      revParseStderr: (expr) => `fatal: path 'plugins/plugin-updates' does not exist in '${expr.split(":")[0]}'`,
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "missing");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
  assert.equal(probe.remoteTree, null);
  assert.equal(probe.detail, "Plugin does not exist at the source it was installed from.");
});

test("reports report-only no-upstream when the tracked ref no longer exists at the remote", async () => {
  const calls: Call[] = [];
  const records = {
    tracked: {
      remote: "https://example.test/repo.git",
      requestedRef: "main",
      trackingBranch: "feature/gone",
      commit: REMOTE,
      pluginPath: "plugins/top",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("tracked", {}),
    makeRunner({
      toplevel: "/managed/tracked",
      head: REMOTE,
      lsRemote: () => "",
      calls,
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.ref, "feature/gone");
  assert.equal(probe.status, "no-upstream");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
  assert.equal(probe.detail, "Plugin does not exist at the source it was installed from.");
  assert.equal(calls.some((call) => call.args.includes("fetch")), false);
});

test("reports report-only missing when the git install's pluginPath is absent at the resolved commit", async () => {
  const records = {
    tracked: {
      remote: "https://example.test/repo.git",
      requestedRef: "main",
      trackingBranch: "main",
      commit: REMOTE,
      pluginPath: "plugins/moved-away",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("tracked", {}),
    makeRunner({
      toplevel: "/managed/tracked",
      head: REMOTE,
      lsRemote: (ref) => `${REMOTE}\trefs/heads/${ref}\n`,
      revParseStderr: (expr) =>
        expr.includes("plugins/moved-away")
          ? `fatal: path 'plugins/moved-away' does not exist in '${REMOTE}'`
          : `fatal: bad revision '${expr}'`,
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.refKind, "branch");
  assert.equal(probe.status, "missing");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
  assert.equal(probe.remoteTree, null);
  assert.equal(probe.detail, "Plugin does not exist at the source it was installed from.");
});

// ---------------------------------------------------------------------------
// Tags and pins
// ---------------------------------------------------------------------------

function gitInstall(id: string, record: Record<string, unknown>): PaseoPluginInfo {
  return { id, path: `/managed/${id}`, enabled: true, status: "running", source: "git" };
}

function sourcesFile(records: Record<string, unknown>) {
  return async (file: string): Promise<string> => {
    if (file.endsWith("sources.json")) return JSON.stringify(records);
    throw new Error("missing file");
  };
}

test("treats an annotated tag install as report-only using the peeled commit", async () => {
  const tagObject = hex("e");
  const tagCommit = hex("f");
  const records = {
    gitty: {
      remote: "https://example.test/gitty.git",
      requestedRef: "v1.0.0",
      trackingBranch: null,
      commit: tagCommit,
      pluginPath: "",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("gitty", {}),
    makeRunner({
      toplevel: "/managed/gitty",
      head: tagCommit,
      lsRemote: () => `${tagObject}\trefs/tags/v1.0.0\n${tagCommit}\trefs/tags/v1.0.0^{}\n`,
      trees: { [`${tagCommit}^{tree}`]: TREE_TAG },
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.refKind, "tag");
  assert.equal(probe.remoteCommit, tagCommit);
  assert.notEqual(probe.remoteCommit, tagObject);
  assert.equal(probe.status, "pinned");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
  assert.match(probe.detail ?? "", /v1\.0\.0/);
  assert.doesNotMatch(probe.detail ?? "", /moved/i);
});

test("stays report-only when an annotated tag's peeled commit changed", async () => {
  const tagObject = hex("e");
  const installed = hex("0");
  const changed = hex("f");
  const records = {
    gitty: {
      remote: "https://example.test/gitty.git",
      requestedRef: "v1.0.0",
      trackingBranch: null,
      commit: installed,
      pluginPath: "",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("gitty", {}),
    makeRunner({
      toplevel: "/managed/gitty",
      head: installed,
      lsRemote: () => `${tagObject}\trefs/tags/v1.0.0\n${changed}\trefs/tags/v1.0.0^{}\n`,
      trees: { [`${changed}^{tree}`]: TREE_TAG },
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  // The peeled commit is compared, never the tag object, and the result is
  // still not actionable: `paseo plugin update` cannot move a tag install.
  assert.equal(probe.remoteCommit, changed);
  assert.notEqual(probe.remoteCommit, tagObject);
  assert.equal(probe.status, "pinned");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
  assert.doesNotMatch(probe.detail ?? "", /moved|update available/i);
});

test("handles a lightweight tag with no peeled ref", async () => {
  const tagCommit = hex("f");
  const records = {
    gitty: {
      remote: "https://example.test/gitty.git",
      requestedRef: "v1.0.0",
      trackingBranch: null,
      commit: tagCommit,
      pluginPath: "",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("gitty", {}),
    makeRunner({
      toplevel: "/managed/gitty",
      head: tagCommit,
      lsRemote: () => `${tagCommit}\trefs/tags/v1.0.0\n`,
      trees: { [`${tagCommit}^{tree}`]: TREE_TAG },
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.refKind, "tag");
  assert.equal(probe.remoteCommit, tagCommit);
  assert.equal(probe.status, "pinned");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
});

test("treats a SHA pin as immutable and never probes the remote", async () => {
  const calls: Call[] = [];
  const past = JSON.stringify({
    pinned: {
      remote: "https://example.test/pinned.git",
      requestedRef: null,
      trackingBranch: null,
      commit: LOCAL,
      pluginPath: "",
    },
  });
  const probe = await testing.probePlugin(
    gitInstall("pinned", {}),
    makeRunner({ toplevel: "/managed/pinned", head: LOCAL, trees: { "LOCAL^{tree}": TREE_LOCAL }, calls }),
    {
      readFile: async (file) => (file.endsWith("sources.json") ? past : (() => { throw new Error("missing"); })()),
      cacheRoot: "/cache",
    },
  );

  assert.equal(probe.status, "pinned");
  assert.equal(probe.updateAvailable, false);
  assert.equal(calls.some((call) => call.args.includes("ls-remote")), false);
  assert.equal(calls.some((call) => call.args.includes("fetch")), false);
});

test("treats an abbreviated SHA requestedRef as an immutable pin and never probes the remote", async () => {
  const calls: Call[] = [];
  const records = {
    pinned: {
      remote: "https://example.test/pinned.git",
      requestedRef: "a31901a",
      trackingBranch: null,
      commit: LOCAL,
      pluginPath: "plugins/top",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("pinned", {}),
    makeRunner({ toplevel: "/managed/pinned", head: LOCAL, calls }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "pinned");
  assert.equal(probe.refKind, "sha");
  assert.equal(probe.ref, "a31901a");
  assert.equal(probe.updateAvailable, false);
  assert.equal(probe.error, null);
  assert.equal(calls.some((call) => call.args.includes("ls-remote")), false);
  assert.equal(calls.some((call) => call.args.includes("fetch")), false);
});

test("compares a branch install against its trackingBranch", async () => {
  const calls: Call[] = [];
  const records = {
    tracked: {
      remote: "https://example.test/repo.git",
      requestedRef: "main",
      trackingBranch: "main",
      commit: REMOTE,
      pluginPath: "plugins/top",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("tracked", {}),
    makeRunner({
      toplevel: "/managed/tracked",
      head: REMOTE,
      lsRemote: (ref) => `${REMOTE}\trefs/heads/${ref}\n`,
      trees: { [`${REMOTE}:plugins/top`]: TREE_REMOTE },
      calls,
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.refKind, "branch");
  assert.equal(probe.ref, "main");
  assert.equal(probe.status, "current");
  const ls = calls.find((call) => call.args[0] === "ls-remote");
  assert.equal(ls?.args[2], "main");
});

test("prefers trackingBranch over a SHA requestedRef instead of pinning", async () => {
  const calls: Call[] = [];
  const records = {
    mixed: {
      remote: "https://example.test/repo.git",
      requestedRef: "a31901a",
      trackingBranch: "main",
      commit: REMOTE,
      pluginPath: "plugins/top",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("mixed", {}),
    makeRunner({
      toplevel: "/managed/mixed",
      head: REMOTE,
      lsRemote: (ref) => `${REMOTE}\trefs/heads/${ref}\n`,
      trees: { [`${REMOTE}:plugins/top`]: TREE_REMOTE },
      calls,
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.refKind, "branch");
  assert.equal(probe.ref, "main");
  assert.equal(probe.status, "current");
  const ls = calls.find((call) => call.args[0] === "ls-remote");
  assert.equal(ls?.args[2], "main");
});

test("probes a tag's peeled ref instead of treating the name as a SHA pin", async () => {
  const remoteTagCommit = hex("f");
  const calls: Call[] = [];
  const records = {
    tagged: {
      remote: "https://example.test/repo.git",
      requestedRef: "v1.2.3",
      trackingBranch: null,
      commit: remoteTagCommit,
      pluginPath: "",
    },
  };
  const probe = await testing.probePlugin(
    gitInstall("tagged", {}),
    makeRunner({
      toplevel: "/managed/tagged",
      head: remoteTagCommit,
      lsRemote: () => `${remoteTagCommit}\trefs/tags/v1.2.3\n`,
      trees: { [`${remoteTagCommit}^{tree}`]: TREE_TAG },
      calls,
    }),
    { readFile: sourcesFile(records), cacheRoot: "/cache" },
  );

  assert.equal(probe.refKind, "tag");
  assert.notEqual(probe.refKind, "sha");
  assert.equal(probe.status, "pinned");
  assert.equal(probe.updateAvailable, false);
  const ls = calls.find((call) => call.args[0] === "ls-remote");
  assert.ok(ls?.args.includes("refs/tags/v1.2.3^{}"));
});

// ---------------------------------------------------------------------------
// Dirty working tree
// ---------------------------------------------------------------------------

test("flags a dirty subdir and reports a working-tree version hash", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      head: LOCAL,
      lsRemote: () => branchRemote(REMOTE),
      trees: {
        [`${LOCAL}:plugins/demo`]: TREE_LOCAL,
        [`${REMOTE}:plugins/demo`]: TREE_LOCAL,
        [`${TREE_WORK}:plugins/demo`]: TREE_WORK,
      },
      stashCreate: TREE_WORK,
      statusPorcelain: " M plugins/demo/a.ts\n",
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.dirty, true);
  assert.equal(probe.workingTree, TREE_WORK);
  assert.equal(probe.status, "current");
});

// ---------------------------------------------------------------------------
// Cache / fetch semantics
// ---------------------------------------------------------------------------

test("fetches once per (remote, ref) for plugins sharing a repo and ref", async () => {
  const calls: Call[] = [];
  const runner = makeRunner({
    toplevel: "/repo",
    head: LOCAL,
    lsRemote: () => branchRemote(REMOTE),
    trees: {
      [`${LOCAL}:plugins/demo`]: TREE_LOCAL,
      [`${REMOTE}:plugins/demo`]: TREE_REMOTE,
      [`${LOCAL}:plugins/slash`]: TREE_LOCAL,
      [`${REMOTE}:plugins/slash`]: TREE_REMOTE,
    },
    isAncestor: () => 0,
    calls,
  });
  const checked = await testing.checkInstalledPlugins(
    undefined,
    runner,
    [plugin("demo", "/repo/plugins/demo"), plugin("slash", "/repo/plugins/slash")],
    { scanOrphans: false, readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(checked.plugins.length, 2);
  const fetches = calls.filter((call) => call.args[0] === "-C" && call.args[2] === "fetch");
  const inits = calls.filter((call) => call.args[0] === "init");
  assert.equal(fetches.length, 1);
  assert.equal(inits.length, 1);
  for (const row of checked.plugins) {
    assert.equal(row.status, "behind");
    assert.equal(row.updateAvailable, true);
  }
});

test("surfaces git ls-remote failures instead of treating them as current", async () => {
  const probe = await testing.probePlugin(
    plugin("broken", "/repo/plugins/broken"),
    makeRunner({
      toplevel: "/repo",
      lsRemoteCode: 128,
      lsRemoteStderr: "fatal: unable to access remote",
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "error");
  assert.equal(probe.updateAvailable, false);
  assert.match(probe.error ?? "", /unable to access remote/);
});

test("surfaces a ls-remote timeout as an error rather than hanging", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/repo",
      lsRemoteThrows: new Error(`Command 'git' timed out after ${testing.PROBE_TIMEOUT_MS}ms`),
    }),
    { readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.equal(probe.status, "error");
  assert.match(probe.error ?? "", /timed out/);
});

// ---------------------------------------------------------------------------
// Unbundled rows
// ---------------------------------------------------------------------------

test("emits one unbundled row per plugin with independent subdir verdicts", async () => {
  const runner = makeRunner({
    toplevel: "/repo",
    head: LOCAL,
    lsRemote: () => branchRemote(REMOTE),
    trees: {
      [`${LOCAL}:plugins/demo`]: TREE_LOCAL,
      [`${REMOTE}:plugins/demo`]: TREE_LOCAL,
      [`${LOCAL}:plugins/slash`]: TREE_LOCAL,
      [`${REMOTE}:plugins/slash`]: TREE_REMOTE,
      [`${LOCAL}:plugins/top`]: TREE_LOCAL,
      [`${REMOTE}:plugins/top`]: TREE_REMOTE,
    },
    isAncestor: (a, b) => (a === LOCAL && b === REMOTE ? 0 : 1),
  });
  const checked = await testing.checkInstalledPlugins(
    undefined,
    runner,
    [
      plugin("demo", "/repo/plugins/demo"),
      plugin("slash", "/repo/plugins/slash"),
      plugin("top", "/repo/plugins/top"),
    ],
    { scanOrphans: false, readFile: NO_FILES, cacheRoot: "/cache" },
  );

  assert.deepEqual(checked.plugins.map((row) => row.id), ["demo", "slash", "top"]);
  assert.deepEqual(checked.plugins.map((row) => row.status), ["current", "behind", "behind"]);
  assert.deepEqual(checked.plugins.map((row) => row.subdir), [
    "plugins/demo",
    "plugins/slash",
    "plugins/top",
  ]);
});


// ---------------------------------------------------------------------------
// Orphans
// ---------------------------------------------------------------------------

test("flags leftover managed directories instead of probing them", async () => {
  const checked = await testing.checkInstalledPlugins(
    undefined,
    makeRunner({ toplevel: () => "/repo" }),
    [plugin("demo", "/repo/plugins/demo")],
    {
      scanOrphans: true,
      pluginsRoot: "/managed",
      readFile: NO_FILES,
      cacheRoot: "/cache",
      readDir: async () => [
        { name: "history", isDirectory: () => true },
        { name: ".staging", isDirectory: () => true },
        { name: "sources.json", isDirectory: () => false },
      ],
    },
  );

  const orphaned = checked.plugins.filter((row) => row.status === "orphaned");
  assert.deepEqual(orphaned.map((row) => row.id), ["orphaned:history"]);
  assert.equal(orphaned[0]?.path, "/managed/history");
});

test("does not flag a managed directory that holds a live install", async () => {
  const rows = await testing.scanOrphanedDirs([plugin("live", "/managed/live")], {
    pluginsRoot: "/managed",
    readFile: NO_FILES,
    readDir: async () => [{ name: "live", isDirectory: () => true }],
  });

  assert.deepEqual(rows, []);
});

import fs from 'fs';
import path4 from 'path';
import os3 from 'os';
import { z } from 'zod';
import { spawn, execSync } from 'child_process';
import net from 'net';

// src/server/storage.ts
var DEFAULT_NAMESPACE_README = `# Paseo Plugins Storage (xpufx)

This directory is managed by \`paseo-plugin-helper\` to store persistent settings, cached metrics, and state for plugins.
- Safe to inspect or backup.
- Avoid editing files manually while the Paseo daemon is active.
`;
var PluginStorage = class {
  pluginId;
  filename;
  pluginDir;
  filePath;
  namespaceDir;
  legacyPluginDir;
  legacyFilePath;
  defaultData;
  schema;
  constructor(pluginId, filename = "state.json", options = {}) {
    this.pluginId = pluginId;
    this.filename = filename;
    this.defaultData = options.defaultData;
    this.schema = options.schema;
    const namespace = options.namespace ?? "xpufx-plugins";
    if (options.baseDir) {
      this.namespaceDir = options.baseDir;
      this.pluginDir = path4.join(options.baseDir, pluginId);
      this.legacyPluginDir = options.legacyDir ?? null;
    } else {
      this.namespaceDir = path4.join(os3.homedir(), ".paseo", namespace);
      this.pluginDir = path4.join(this.namespaceDir, pluginId);
      this.legacyPluginDir = options.legacyDir ?? path4.join(os3.homedir(), ".paseo", pluginId);
    }
    this.filePath = path4.join(this.pluginDir, filename);
    this.legacyFilePath = this.legacyPluginDir ? path4.join(this.legacyPluginDir, filename) : null;
  }
  ensureDir() {
    if (this.namespaceDir && !fs.existsSync(this.namespaceDir)) {
      fs.mkdirSync(this.namespaceDir, { recursive: true });
    }
    if (this.namespaceDir) {
      const readmePath = path4.join(this.namespaceDir, "README.md");
      if (!fs.existsSync(readmePath)) {
        try {
          fs.writeFileSync(readmePath, DEFAULT_NAMESPACE_README, "utf8");
        } catch {
        }
      }
    }
    const dir = path4.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  checkMigrateLegacy() {
    if (!fs.existsSync(this.filePath) && this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      try {
        this.ensureDir();
        fs.copyFileSync(this.legacyFilePath, this.filePath);
      } catch {
      }
    }
  }
  async checkMigrateLegacyAsync() {
    if (!fs.existsSync(this.filePath) && this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      try {
        this.ensureDir();
        await fs.promises.copyFile(this.legacyFilePath, this.filePath);
      } catch {
      }
    }
  }
  getDefault() {
    if (this.schema) {
      const result = this.schema.safeParse(this.defaultData ?? {});
      if (result.success) {
        return result.data;
      }
    }
    return this.defaultData ? JSON.parse(JSON.stringify(this.defaultData)) : {};
  }
  parseData(raw) {
    if (this.schema) {
      const result = this.schema.safeParse(raw);
      if (result.success) {
        return result.data;
      }
      return this.getDefault();
    }
    return raw;
  }
  /**
   * Checks if the backing state file exists (in primary or legacy path).
   */
  exists() {
    if (fs.existsSync(this.filePath)) return true;
    if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) return true;
    return false;
  }
  /**
   * Reads data synchronously. If file does not exist, checks legacy location or returns defaultData.
   */
  read() {
    try {
      this.checkMigrateLegacy();
      if (!fs.existsSync(this.filePath)) {
        if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
          const raw2 = fs.readFileSync(this.legacyFilePath, "utf8");
          return this.parseData(JSON.parse(raw2));
        }
        return this.getDefault();
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      return this.parseData(JSON.parse(raw));
    } catch {
      return this.getDefault();
    }
  }
  /**
   * Reads data asynchronously.
   */
  async readAsync() {
    try {
      await this.checkMigrateLegacyAsync();
      if (!fs.existsSync(this.filePath)) {
        if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
          const raw2 = await fs.promises.readFile(this.legacyFilePath, "utf8");
          return this.parseData(JSON.parse(raw2));
        }
        return this.getDefault();
      }
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      return this.parseData(JSON.parse(raw));
    } catch {
      return this.getDefault();
    }
  }
  /**
   * Writes data atomically using a temporary file and atomic rename.
   */
  write(data) {
    const validated = this.parseData(data);
    this.ensureDir();
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const serialized = JSON.stringify(validated, null, 2);
    fs.writeFileSync(tempPath, serialized, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }
  /**
   * Writes data atomically using async filesystem operations.
   */
  async writeAsync(data) {
    const validated = this.parseData(data);
    this.ensureDir();
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const serialized = JSON.stringify(validated, null, 2);
    await fs.promises.writeFile(tempPath, serialized, "utf8");
    await fs.promises.rename(tempPath, this.filePath);
  }
  /**
   * Updates state synchronously using an updater function.
   */
  update(updater) {
    const current = this.read();
    const updated = updater(current);
    const validated = this.parseData(updated);
    this.write(validated);
    return validated;
  }
  /**
   * Updates state asynchronously using an updater function.
   */
  async updateAsync(updater) {
    const current = await this.readAsync();
    const updated = await updater(current);
    const validated = this.parseData(updated);
    await this.writeAsync(validated);
    return validated;
  }
  /**
   * Removes the state file if it exists.
   */
  reset() {
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
      }
    }
  }
  /**
   * Audits storage consumption, returning path, fileCount, totalBytes, and lastModified.
   */
  async getStorageStats() {
    const stats = {
      path: this.pluginDir,
      fileCount: 0,
      totalBytes: 0,
      lastModified: null
    };
    if (!fs.existsSync(this.pluginDir)) {
      return stats;
    }
    try {
      const entries = await fs.promises.readdir(this.pluginDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          stats.fileCount++;
          const target = path4.join(this.pluginDir, entry.name);
          const st = await fs.promises.stat(target);
          stats.totalBytes += st.size;
          if (!stats.lastModified || st.mtime > stats.lastModified) {
            stats.lastModified = st.mtime;
          }
        }
      }
    } catch {
    }
    return stats;
  }
  /**
   * Alias for getStorageStats()
   */
  async getStats() {
    return this.getStorageStats();
  }
};

// src/server/settings.ts
function registerSettingsRpc(context, contract, storage, options = {}) {
  context.handle(contract.get, async () => {
    return storage.readAsync();
  });
  context.handle(contract.update, async (input) => {
    const prev = await storage.readAsync();
    const updated = await storage.updateAsync((current) => {
      return { ...current, ...input };
    });
    if (options.onUpdate) {
      await options.onUpdate(updated, prev);
    }
    return updated;
  });
  context.handle(contract.reset, async () => {
    const prev = await storage.readAsync();
    storage.reset();
    const fresh = await storage.readAsync();
    if (options.onReset) {
      await options.onReset(fresh, prev);
    }
    return fresh;
  });
}
function createSettingsHandlers(contract, storage, options = {}) {
  return {
    get: async () => {
      return storage.readAsync();
    },
    update: async (input) => {
      const prev = await storage.readAsync();
      const updated = await storage.updateAsync((current) => {
        return { ...current, ...input };
      });
      if (options.onUpdate) {
        await options.onUpdate(updated, prev);
      }
      return updated;
    },
    reset: async () => {
      const prev = await storage.readAsync();
      storage.reset();
      const fresh = await storage.readAsync();
      if (options.onReset) {
        await options.onReset(fresh, prev);
      }
      return fresh;
    }
  };
}

// src/shared/rpc.ts
var RPC_NAME = /^[a-z][a-z0-9._-]*$/;
function defineRpc(definition) {
  const name = definition.name.trim();
  if (!RPC_NAME.test(name)) {
    throw new Error(`Invalid plugin RPC method: ${definition.name}`);
  }
  return { ...definition, name };
}
function defineContract(options) {
  const contract = defineRpc({
    name: options.name,
    input: options.input,
    output: options.output
  });
  if (options.description) {
    Object.defineProperty(contract, "description", {
      value: options.description,
      enumerable: true,
      writable: false
    });
  }
  return contract;
}

// src/shared/settings.ts
var SettingsEmptyInputSchema = z.union([z.void(), z.record(z.string(), z.unknown())]).optional();
function stripDefaults(schema) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (schema instanceof z.ZodDefault) {
    return stripDefaults(schema._def.innerType);
  }
  if (schema instanceof z.ZodOptional) {
    return stripDefaults(schema._def.innerType).optional();
  }
  if (schema instanceof z.ZodNullable) {
    return stripDefaults(schema._def.innerType).nullable();
  }
  if (schema._def && schema._def.schema) {
    return stripDefaults(schema._def.schema);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const newShape = {};
    for (const key of Object.keys(shape)) {
      newShape[key] = stripDefaults(shape[key]).optional();
    }
    let res = z.object(newShape);
    const unknownKeys = schema._def?.unknownKeys;
    if (unknownKeys === "passthrough") {
      res = res.passthrough();
    } else if (unknownKeys === "strict") {
      res = res.strict();
    }
    return res;
  }
  return typeof schema.optional === "function" ? schema.optional() : schema;
}
function defineSettingsContract(options) {
  const { name, schema, defaultData, description } = options;
  let computedDefaults;
  try {
    computedDefaults = schema.parse(defaultData ?? {});
  } catch {
    computedDefaults = defaultData ?? {};
  }
  const sanitizedName = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  const partialSchema = schema instanceof z.ZodObject ? stripDefaults(schema) : typeof schema.partial === "function" ? schema.partial() : z.record(z.string(), z.unknown());
  const getContract = defineContract({
    name: `${sanitizedName}.get`,
    input: SettingsEmptyInputSchema,
    output: schema,
    description: description ? `Get ${description}` : `Get ${name} settings`
  });
  const updateContract = defineContract({
    name: `${sanitizedName}.update`,
    input: partialSchema,
    output: schema,
    description: description ? `Update ${description}` : `Update ${name} settings`
  });
  const resetContract = defineContract({
    name: `${sanitizedName}.reset`,
    input: SettingsEmptyInputSchema,
    output: schema,
    description: description ? `Reset ${description}` : `Reset ${name} settings to defaults`
  });
  return {
    name: sanitizedName,
    schema,
    defaultSettings: computedDefaults,
    get: getContract,
    update: updateContract,
    reset: resetContract,
    ...description !== void 0 ? { description } : {}
  };
}

// src/server/shared-settings.ts
function safeSerialize(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
function createSharedPluginSettings(options) {
  const {
    suite,
    filename = "settings.json",
    schema,
    defaultData,
    description,
    namespace,
    baseDir,
    watchDebounceMs = 25
  } = options;
  const contractName = options.contractName ?? `${suite}.shared-settings`;
  const contract = options.contract ?? defineSettingsContract({
    name: contractName,
    schema,
    ...defaultData !== void 0 ? { defaultData } : {},
    ...description !== void 0 ? { description } : {}
  });
  const storage = new PluginStorage(suite, filename, {
    ...namespace !== void 0 ? { namespace } : {},
    ...baseDir !== void 0 ? { baseDir } : {},
    schema: contract.schema,
    defaultData: contract.defaultSettings
  });
  const listeners = /* @__PURE__ */ new Set();
  let watcher = null;
  let debounceTimer = null;
  let lastSnapshot = "";
  function snapshot() {
    return safeSerialize(storage.read());
  }
  function emitIfChanged() {
    const next = storage.read();
    const nextSnapshot = safeSerialize(next);
    if (nextSnapshot !== lastSnapshot) {
      lastSnapshot = nextSnapshot;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch {
        }
      }
    }
  }
  function scheduleEmit() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        emitIfChanged();
      } catch {
      }
    }, watchDebounceMs);
  }
  function ensureWatcher() {
    if (watcher) return;
    const dir = path4.dirname(storage.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    lastSnapshot = snapshot();
    watcher = fs.watch(dir, (_event, watchedFile) => {
      if (watchedFile && watchedFile.toString() !== path4.basename(storage.filePath)) return;
      scheduleEmit();
    });
    watcher.on("error", () => {
    });
    if (typeof watcher.unref === "function") {
      watcher.unref();
    }
  }
  function disposeWatcher() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
      }
      watcher = null;
    }
  }
  function subscribe(listener) {
    listeners.add(listener);
    try {
      ensureWatcher();
    } catch {
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) disposeWatcher();
    };
  }
  return {
    suite,
    contract,
    storage,
    filePath: storage.filePath,
    async get() {
      return storage.readAsync();
    },
    async update(patch) {
      const updated = await storage.updateAsync((current) => ({
        ...current,
        ...patch
      }));
      lastSnapshot = safeSerialize(updated);
      for (const listener of [...listeners]) {
        try {
          listener(updated);
        } catch {
        }
      }
      return updated;
    },
    async reset() {
      storage.reset();
      const fresh = await storage.readAsync();
      lastSnapshot = safeSerialize(fresh);
      for (const listener of [...listeners]) {
        try {
          listener(fresh);
        } catch {
        }
      }
      return fresh;
    },
    read() {
      return storage.read();
    },
    reload() {
      const next = storage.read();
      lastSnapshot = safeSerialize(next);
      return next;
    },
    subscribe,
    watch: subscribe,
    register(context, rpcOptions = {}) {
      registerSettingsRpc(context, contract, storage, rpcOptions);
    },
    createHandlers(rpcOptions = {}) {
      return createSettingsHandlers(contract, storage, rpcOptions);
    },
    dispose() {
      listeners.clear();
      disposeWatcher();
    }
  };
}

// src/server/jsonc.ts
function stripJsonComments(text) {
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
    if (char === "/" && nextChar === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      if (i < text.length) result += text[i];
      continue;
    }
    if (char === "/" && nextChar === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i++;
      continue;
    }
    result += char;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}
function parseJsonc(text) {
  const sanitized = stripJsonComments(text.trim());
  return JSON.parse(sanitized);
}
function tryParseJsonc(text, fallback) {
  try {
    return parseJsonc(text);
  } catch {
    return fallback;
  }
}

// src/server/redact.ts
var DEFAULT_SENSITIVE_KEYS = [
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
  "certificate"
];
function isSensitiveKey(key, customKeys = []) {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return [...DEFAULT_SENSITIVE_KEYS, ...customKeys].some(
    (k) => normalized.includes(k.replace(/[-_]/g, ""))
  );
}
function maskString(val, mask = "[REDACTED]") {
  if (val.length <= 8) return mask;
  const placeholder = mask === "[REDACTED]" ? "..." : mask;
  return `${val.slice(0, 3)}${placeholder}${val.slice(-3)}`;
}
function redactSecrets(target, options = {}) {
  const mask = options.mask ?? "[REDACTED]";
  const customKeys = options.customSensitiveKeys ?? [];
  if (target === null || target === void 0) return target;
  if (typeof target === "string") {
    let result = target.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, `$1${mask}`);
    result = result.replace(/(https?:\/\/[^:]+:)[^@]+(@)/gi, `$1${mask}$2`);
    result = result.replace(
      /(https?:\/\/app\.paseo\.sh\/#offer=)[A-Za-z0-9\-_.~+/]+=*/gi,
      `$1${mask}`
    );
    return result;
  }
  if (Array.isArray(target)) {
    return target.map((item) => redactSecrets(item, options));
  }
  if (typeof target === "object") {
    const clone = {};
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
    return clone;
  }
  return target;
}
function killProcessGroup(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid !== void 0) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
  }
  try {
    child.kill(signal);
  } catch {
  }
}
function safeSpawn(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 15e3;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    const child = spawn(command, args, {
      ...options,
      shell: false,
      detached: options.detached ?? process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let exited = false;
    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGTERM");
        setTimeout(() => {
          if (!exited) killProcessGroup(child, "SIGKILL");
        }, 2e3);
      }, timeoutMs);
    }
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString();
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
      }
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      exited = true;
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (timedOut) {
        reject(new Error(`Command '${command}' timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        signal,
        durationMs
      });
    });
  });
}
function safeExec(command, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 15e3;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    const child = spawn(command, {
      ...options,
      shell: true,
      detached: options.detached ?? process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let exited = false;
    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGTERM");
        setTimeout(() => {
          if (!exited) killProcessGroup(child, "SIGKILL");
        }, 2e3);
      }, timeoutMs);
    }
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString();
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
      }
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      exited = true;
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (timedOut) {
        reject(new Error(`Command '${command}' timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        signal,
        durationMs
      });
    });
  });
}
var CpuSampler = class {
  lastSample = null;
  constructor() {
    this.lastSample = this.getTicks();
  }
  getTicks() {
    const cpus = os3.cpus();
    return cpus.map((cpu) => {
      const times = cpu.times;
      const total = times.user + times.nice + times.sys + times.idle + times.irq;
      return { idle: times.idle, total };
    });
  }
  /**
   * Computes the CPU usage delta since the previous sample (or between two samples).
   * Returns average usage percentage (0 - 100) and per-core breakdown.
   */
  sample() {
    const current = this.getTicks();
    if (!this.lastSample || this.lastSample.length !== current.length) {
      this.lastSample = current;
      return { usagePercent: 0, perCore: current.map(() => 0) };
    }
    const perCore = [];
    let totalActive = 0;
    let totalTime = 0;
    for (let i = 0; i < current.length; i++) {
      const prev = this.lastSample[i];
      const cur = current[i];
      const deltaTotal = cur.total - prev.total;
      const deltaIdle = cur.idle - prev.idle;
      const deltaActive = Math.max(0, deltaTotal - deltaIdle);
      const corePercent = deltaTotal > 0 ? deltaActive / deltaTotal * 100 : 0;
      perCore.push(Math.round(corePercent * 10) / 10);
      totalActive += deltaActive;
      totalTime += deltaTotal;
    }
    this.lastSample = current;
    const usagePercent = totalTime > 0 ? totalActive / totalTime * 100 : 0;
    return {
      usagePercent: Math.round(usagePercent * 10) / 10,
      perCore
    };
  }
};
var defaultSampler = new CpuSampler();
function getSystemMetrics(sampler = defaultSampler) {
  const cpus = os3.cpus();
  const totalmem = os3.totalmem();
  const freemem = os3.freemem();
  const usedmem = totalmem - freemem;
  const cpuModel = cpus[0]?.model || "Unknown CPU";
  const { usagePercent } = sampler.sample();
  return {
    hostname: os3.hostname(),
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(os3.uptime()),
    cpu: {
      model: cpuModel,
      cores: cpus.length,
      usagePercent,
      loadAverage: os3.loadavg()
    },
    memory: {
      totalBytes: totalmem,
      freeBytes: freemem,
      usedBytes: usedmem,
      usedPercent: Math.round(usedmem / totalmem * 1e3) / 10
    }
  };
}
function findPackageJson(startDir) {
  let current = path4.resolve(startDir);
  const root = path4.parse(current).root;
  while (current !== root) {
    const pkgPath = path4.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, "utf8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    const parent = path4.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
function resolvePluginVersion(options = {}) {
  const {
    cwd = process.cwd(),
    includeGit = true,
    fallback = "0.0.0"
  } = options;
  let pkgVersion;
  const pkg = findPackageJson(cwd);
  if (pkg?.version) {
    pkgVersion = pkg.version;
  }
  if (!includeGit) {
    return pkgVersion || fallback;
  }
  try {
    const gitTag = execSync("git describe --tags --exact-match 2>/dev/null", {
      cwd,
      encoding: "utf8",
      timeout: 1e3
    }).trim();
    if (gitTag) {
      return gitTag.startsWith("v") ? gitTag.slice(1) : gitTag;
    }
  } catch {
  }
  try {
    const gitHash = execSync("git rev-parse --short HEAD 2>/dev/null", {
      cwd,
      encoding: "utf8",
      timeout: 1e3
    }).trim();
    if (gitHash) {
      if (pkgVersion) {
        return `${pkgVersion}+${gitHash}`;
      }
      return `0.0.0+${gitHash}`;
    }
  } catch {
  }
  return pkgVersion || fallback;
}
function stampVersion(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const targetFile = options.targetFile ? path4.resolve(cwd, options.targetFile) : path4.resolve(cwd, "version.ts");
  const version = resolvePluginVersion(options);
  const content = `// Auto-generated by paseo-plugin-helper. Do not edit.
export const PLUGIN_VERSION = "${version}";
`;
  let existing = "";
  if (fs.existsSync(targetFile)) {
    existing = fs.readFileSync(targetFile, "utf8");
  }
  if (existing !== content) {
    fs.mkdirSync(path4.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, content, "utf8");
    return { version, targetFile, updated: true };
  }
  return { version, targetFile, updated: false };
}

// src/server/logger.ts
var LEVEL_SEVERITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
function isLogLevel(value) {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}
function resolveMinLevelFromEnv(env = process.env) {
  const raw = env.PASEO_PLUGIN_LOG_LEVEL ?? env.PASEO_LOG_LEVEL;
  if (typeof raw === "string" && isLogLevel(raw.trim().toLowerCase())) {
    return raw.trim().toLowerCase();
  }
  const debugFlag = env.PASEO_DEBUG ?? env.PASEO_PLUGIN_DEBUG;
  if (typeof debugFlag === "string" && ["1", "true", "yes", "debug"].includes(debugFlag.trim().toLowerCase())) {
    return "debug";
  }
  return void 0;
}
function isProductionEnv(env = process.env) {
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}
function resolveDefaultMinLevel(env = process.env) {
  return resolveMinLevelFromEnv(env) ?? (isProductionEnv(env) ? "info" : "debug");
}
function formatData(data) {
  if (data === void 0) return "";
  if (data instanceof Error) {
    return `error="${data.message}"${data.stack ? `
${data.stack}` : ""}`;
  }
  const sanitized = redactSecrets(data);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    const pairs = Object.entries(sanitized).map(
      ([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`
    );
    return pairs.join(" ");
  }
  return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
}
function createPluginLogger(pluginId, options = {}) {
  const resolvedVer = options.version ?? resolvePluginVersion({ fallback: "" });
  const {
    banner = true,
    subsystem,
    minLevel = resolveDefaultMinLevel(),
    meta = {}
  } = options;
  const minSeverity = LEVEL_SEVERITY[minLevel];
  const versionTag = resolvedVer ? ` v${resolvedVer}` : "";
  const subTag = subsystem ? `:${subsystem}` : "";
  const baseTag = `[${pluginId}${versionTag}${subTag}]`;
  if (banner) {
    const bannerDetails = [
      `pid ${process.pid}`,
      `node ${process.version}`,
      ...Object.entries(meta).map(([k, v]) => `${k} ${v}`)
    ].join(", ");
    console.log(`${baseTag} Initializing plugin (${bannerDetails})`);
  }
  function emit(level, message, data) {
    if (LEVEL_SEVERITY[level] < minSeverity) return;
    const levelTag = `[${level.toUpperCase()}]`;
    const formattedData = formatData(data);
    const line = formattedData ? `${baseTag} ${levelTag} ${message} ${formattedData}` : `${baseTag} ${levelTag} ${message}`;
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
  return {
    debug(message, data) {
      emit("debug", message, data);
    },
    info(message, data) {
      emit("info", message, data);
    },
    warn(message, data) {
      emit("warn", message, data);
    },
    error(message, data) {
      emit("error", message, data);
    },
    suppressed(context, error) {
      const detail = error instanceof Error ? error.message : String(error);
      emit("debug", `${context}: ${detail}`, error);
    },
    child(subsystemOrOptions) {
      const childOptions = typeof subsystemOrOptions === "string" ? { ...options, version: resolvedVer, banner: false, subsystem: subsystemOrOptions } : { ...options, version: resolvedVer, banner: false, ...subsystemOrOptions };
      return createPluginLogger(pluginId, childOptions);
    }
  };
}
function isPortOpen(port, host = "127.0.0.1", options) {
  const timeoutMs = options?.timeoutMs ?? 1e3;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const cleanup = () => {
      if (!settled) {
        settled = true;
        socket.destroy();
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      cleanup();
      resolve(true);
    });
    socket.once("timeout", () => {
      cleanup();
      resolve(false);
    });
    socket.once("error", () => {
      cleanup();
      resolve(false);
    });
    try {
      socket.connect(port, host);
    } catch {
      cleanup();
      resolve(false);
    }
  });
}
function findAvailablePort(startPort = 3e3, maxAttempts = 50, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    const endPort = startPort + maxAttempts;
    function tryNext() {
      if (currentPort >= endPort) {
        return reject(new Error(`No available port found in range [${startPort}, ${endPort})`));
      }
      const server = net.createServer();
      server.once("error", () => {
        currentPort++;
        tryNext();
      });
      server.once("listening", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : currentPort;
        server.close(() => {
          resolve(port);
        });
      });
      server.listen(currentPort, host);
    }
    tryNext();
  });
}
async function pingHost(host, port, options) {
  return isPortOpen(port, host, options);
}

// src/server/task.ts
function createPeriodicTask(options) {
  const {
    intervalMs,
    task,
    onError,
    runImmediately = false,
    maxBackoffMs = 6e4
  } = options;
  let timer = null;
  let running = true;
  let inFlight = false;
  let failureCount = 0;
  async function execute() {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      await task();
      failureCount = 0;
    } catch (err) {
      failureCount++;
      if (onError) {
        try {
          onError(err, failureCount);
        } catch (suppressed) {
          console.debug(
            `[periodic-task] onError handler failed: ${suppressed instanceof Error ? suppressed.message : String(suppressed)}`
          );
        }
      } else {
        console.debug(
          `[periodic-task] suppressed error (failure ${failureCount}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      inFlight = false;
      if (running) {
        scheduleNext();
      }
    }
  }
  function scheduleNext() {
    if (!running) return;
    if (timer) clearTimeout(timer);
    let delay = intervalMs;
    if (failureCount > 0) {
      const backoff = intervalMs * Math.pow(1.5, Math.min(failureCount, 8));
      delay = Math.min(backoff, maxBackoffMs);
    }
    timer = setTimeout(execute, delay);
  }
  if (runImmediately) {
    execute();
  } else {
    scheduleNext();
  }
  return {
    stop: () => {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isRunning: () => running,
    triggerNow: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await execute();
    }
  };
}
var McpConfigPaths = {
  /**
   * Claude Desktop configuration path per operating system:
   * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
   * - Windows: %APPDATA%/Claude/claude_desktop_config.json
   * - Linux: ~/.config/Claude/claude_desktop_config.json
   */
  claudeDesktop() {
    const platform = process.platform;
    const home = os3.homedir();
    if (platform === "darwin") {
      return path4.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    if (platform === "win32") {
      const appData = process.env.APPDATA || path4.join(home, "AppData", "Roaming");
      return path4.join(appData, "Claude", "claude_desktop_config.json");
    }
    const configDir = process.env.XDG_CONFIG_HOME || path4.join(home, ".config");
    return path4.join(configDir, "Claude", "claude_desktop_config.json");
  },
  /**
   * Claude Code CLI global configuration: ~/.claude.json
   */
  claudeCode() {
    return path4.join(os3.homedir(), ".claude.json");
  },
  /**
   * OpenCode configuration path: ~/.config/opencode/opencode.json
   */
  openCode() {
    const home = os3.homedir();
    const configDir = process.env.XDG_CONFIG_HOME || path4.join(home, ".config");
    return path4.join(configDir, "opencode", "opencode.json");
  },
  /**
   * Cursor editor MCP configuration: ~/.cursor/mcp.json
   */
  cursor() {
    return path4.join(os3.homedir(), ".cursor", "mcp.json");
  },
  /**
   * Gemini / Antigravity CLI configuration: ~/.gemini/config/mcp_config.json
   */
  gemini() {
    return path4.join(os3.homedir(), ".gemini", "config", "mcp_config.json");
  },
  /**
   * Pi CLI agent configuration: ~/.pi/config.json
   */
  pi() {
    return path4.join(os3.homedir(), ".pi", "config.json");
  }
};
function expandPath(targetPath) {
  if (targetPath === "~") {
    return os3.homedir();
  }
  if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
    return path4.join(os3.homedir(), targetPath.slice(2));
  }
  return path4.resolve(targetPath);
}
function isDeepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepEqual(a[key], b[key])) return false;
  }
  return true;
}
function normalizeTarget(target, backupOverride) {
  if (typeof target === "string") {
    return {
      filePath: expandPath(target),
      key: "mcpServers",
      backup: Boolean(backupOverride)
    };
  }
  return {
    filePath: expandPath(target.path),
    key: target.key || "mcpServers",
    backup: backupOverride !== void 0 ? backupOverride : Boolean(target.backup)
  };
}
function readConfigDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }
  return parseJsonc(raw);
}
function writeConfigAtomic(filePath, data) {
  const dir = path4.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const serialized = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(tempPath, serialized, "utf8");
  fs.renameSync(tempPath, filePath);
}
function getMcpServer(target, serverName) {
  const { filePath, key } = normalizeTarget(target);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const doc = readConfigDocument(filePath);
    const servers = doc[key];
    if (servers && typeof servers === "object" && serverName in servers) {
      return servers[serverName];
    }
    return null;
  } catch {
    return null;
  }
}
function upsertMcpServer(options) {
  const { filePath, key, backup } = normalizeTarget(options.target, options.backup);
  const { serverName, config } = options;
  let doc;
  const fileExisted = fs.existsSync(filePath);
  if (fileExisted) {
    doc = readConfigDocument(filePath);
  } else {
    doc = {};
  }
  if (typeof doc[key] !== "object" || doc[key] === null || Array.isArray(doc[key])) {
    doc[key] = {};
  }
  const existingConfig = doc[key][serverName];
  const isExisting = existingConfig !== void 0;
  if (isExisting && isDeepEqual(existingConfig, config)) {
    return {
      filePath,
      serverName,
      changed: false,
      action: "unchanged"
    };
  }
  let backupPath;
  if (backup && fileExisted) {
    backupPath = `${filePath}.bak.${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  }
  doc[key][serverName] = config;
  writeConfigAtomic(filePath, doc);
  return {
    filePath,
    serverName,
    changed: true,
    action: isExisting ? "updated" : "created",
    backupPath
  };
}
function removeMcpServer(options) {
  const { filePath, key, backup } = normalizeTarget(options.target, options.backup);
  const { serverName } = options;
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      serverName,
      changed: false,
      action: "not_found"
    };
  }
  const doc = readConfigDocument(filePath);
  if (!doc[key] || typeof doc[key] !== "object" || !(serverName in doc[key])) {
    return {
      filePath,
      serverName,
      changed: false,
      action: "not_found"
    };
  }
  let backupPath;
  if (backup) {
    backupPath = `${filePath}.bak.${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  }
  delete doc[key][serverName];
  writeConfigAtomic(filePath, doc);
  return {
    filePath,
    serverName,
    changed: true,
    action: "removed",
    backupPath
  };
}

// src/server/mcp-injection.ts
function registerMcpInjection(server, options) {
  const { serverName, config, filter } = options;
  return server.before("agent.create", ({ request }) => {
    if (filter && !filter({ request })) return;
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers ?? {},
          [serverName]: config
        }
      }
    };
  });
}
var cachedPlugins = null;
var lastFetchTime = 0;
function clearPluginCache() {
  cachedPlugins = null;
  lastFetchTime = 0;
}
function readConfigPluginsFallback() {
  try {
    const configPath = path4.join(os3.homedir(), ".paseo", "config.json");
    if (!fs.existsSync(configPath)) return [];
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const pluginsObj = parsed?.plugins;
    if (!pluginsObj || typeof pluginsObj !== "object") return [];
    return Object.entries(pluginsObj).map(([id, val]) => {
      const isEnabled = val?.enabled !== false;
      return {
        id,
        path: val?.path ?? "",
        enabled: isEnabled,
        status: isEnabled ? "unknown" : "disabled",
        source: val?.source,
        remote: val?.remote,
        ref: val?.ref,
        commit: val?.commit
      };
    });
  } catch {
    return [];
  }
}
async function listPlugins(options = {}) {
  const { filter = "all", cacheTtlMs = 5e3, forceRefresh = false } = options;
  const now = Date.now();
  if (!forceRefresh && cachedPlugins && now - lastFetchTime < cacheTtlMs) {
    return applyFilter(cachedPlugins, filter);
  }
  let plugins = [];
  try {
    const result = await safeSpawn("paseo", ["plugin", "ls", "--json"], { timeoutMs: 3e3 });
    if (result.code === 0 && result.stdout.trim()) {
      plugins = JSON.parse(result.stdout.trim());
    } else {
      plugins = readConfigPluginsFallback();
    }
  } catch {
    plugins = readConfigPluginsFallback();
  }
  cachedPlugins = plugins;
  lastFetchTime = now;
  return applyFilter(plugins, filter);
}
function applyFilter(plugins, filter) {
  switch (filter) {
    case "enabled":
      return plugins.filter((p) => p.enabled);
    case "disabled":
      return plugins.filter((p) => !p.enabled);
    case "running":
      return plugins.filter((p) => p.status === "running");
    case "failed":
      return plugins.filter((p) => p.status === "failed");
    case "all":
    default:
      return plugins;
  }
}
async function getPluginInfo(pluginId, options) {
  const plugins = await listPlugins(options);
  return plugins.find((p) => p.id === pluginId) ?? null;
}
async function isPluginInstalled(pluginId, options) {
  const info = await getPluginInfo(pluginId, options);
  return info !== null;
}
async function isPluginEnabled(pluginId, options) {
  const info = await getPluginInfo(pluginId, options);
  return info !== null && info.enabled;
}
async function isPluginRunning(pluginId, options) {
  const info = await getPluginInfo(pluginId, options);
  return info !== null && info.status === "running";
}
var CustomPillThresholdsSchema = z.object({
  warning: z.number().optional(),
  danger: z.number().optional(),
  /**
   * If true, lower values trigger warnings/dangers instead of higher values
   * (e.g. disk space remaining, battery percentage).
   */
  invert: z.boolean().optional()
});
var CustomPillModalSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  command: z.string().optional(),
  /**
   * Whether to format command output as monospace preformatted text (default: true).
   */
  preformatted: z.boolean().default(true)
});
var CustomPillDefinitionSchema = z.object({
  /**
   * Unique identifier for the custom pill (e.g. "gpu-util", "docker-count").
   */
  id: z.string().min(1),
  /**
   * Title shown in the composer trackbar (e.g. "GPU", "Docker").
   */
  title: z.string().min(1),
  /**
   * Compact title shown when layout is compact (e.g. "G"). Defaults to title.
   */
  compactTitle: z.string().optional(),
  /**
   * Lucide icon name (e.g. "Cpu", "Flame", "HardDrive", "Layers").
   */
  icon: z.string().optional(),
  /**
   * Optional compact icon name. Defaults to icon.
   */
  compactIcon: z.string().optional(),
  /**
   * Shell command executed periodically to produce the pill's value.
   * Can use session environment variables like $PASEO_AGENT_ID, $PASEO_WORKSPACE_ID.
   */
  command: z.string().min(1),
  /**
   * Optional prefix prepended to the output value (e.g. "$", "#").
   */
  prefix: z.string().optional(),
  /**
   * Optional suffix appended to the output value (e.g. "%", "ms", "GB").
   */
  suffix: z.string().optional(),
  /**
   * Polling interval in milliseconds. Minimum 500ms, defaults to 5000ms.
   */
  intervalMs: z.number().min(500).default(5e3),
  /**
   * Execution timeout in milliseconds. Defaults to 10000ms.
   */
  timeoutMs: z.number().min(500).default(1e4),
  /**
   * Optional threshold rules to automatically transition badge color to warning or danger.
   */
  thresholds: CustomPillThresholdsSchema.optional(),
  /**
   * Optional modal configuration shown when the pill is pressed.
   */
  modal: CustomPillModalSchema.optional(),
  /**
   * Whether this custom pill is enabled. Defaults to true.
   */
  enabled: z.boolean().default(true),
  /**
   * Absolute path to the config file that defined this pill (e.g.
   * ~/.paseo/top/pills/disk-usage.jsonc). Injected at discovery time; not
   * intended to be authored in the config file itself.
   */
  sourceFile: z.string().optional()
});
function parseNumericPillValue(rawValue) {
  const match = rawValue.match(/-?\d+(\.\d+)?/);
  if (!match) return void 0;
  const num = parseFloat(match[0]);
  return Number.isNaN(num) ? void 0 : num;
}
function resolveCustomPillStatus(numericValue, thresholds) {
  if (numericValue === void 0 || !thresholds) {
    return "neutral";
  }
  const { warning, danger, invert } = thresholds;
  if (invert) {
    if (danger !== void 0 && numericValue <= danger) return "danger";
    if (warning !== void 0 && numericValue <= warning) return "warning";
    return "success";
  }
  if (danger !== void 0 && numericValue >= danger) return "danger";
  if (warning !== void 0 && numericValue >= warning) return "warning";
  return "neutral";
}
function formatPillDisplay(rawValue, prefix, suffix) {
  const cleaned = rawValue.trim();
  const pre = prefix ?? "";
  const suf = suffix ?? "";
  return `${pre}${cleaned}${suf}`;
}

// src/server/custom-pills.ts
async function discoverCustomPillConfigs(dirPath, logger) {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const configs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") && !entry.name.endsWith(".jsonc")) {
        continue;
      }
      const filePath = path4.join(dirPath, entry.name);
      try {
        const rawContent = await fs.promises.readFile(filePath, "utf-8");
        const parsed = parseJsonc(rawContent);
        const result = CustomPillDefinitionSchema.safeParse(parsed);
        if (result.success) {
          configs.push({ ...result.data, sourceFile: filePath });
        } else {
          logger?.warn(
            `Invalid custom pill config in ${entry.name}: ${result.error.issues.map((i) => i.message).join(", ")}`
          );
        }
      } catch (err) {
        logger?.warn(
          `Failed to read custom pill config from ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return configs;
  } catch (err) {
    logger?.warn(
      `Error reading custom pills directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}
var CustomPillPoller = class {
  pills = /* @__PURE__ */ new Map();
  states = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  inFlight = /* @__PURE__ */ new Set();
  running = false;
  options;
  constructor(options = {}) {
    this.options = options;
    if (options.pills) {
      for (const pill of options.pills) {
        this.pills.set(pill.id, pill);
      }
    }
  }
  /**
   * Starts the polling loops for all configured custom pills.
   */
  async start() {
    if (this.running) return;
    this.running = true;
    if (this.options.configDir) {
      const discovered = await discoverCustomPillConfigs(
        this.options.configDir,
        this.options.logger
      );
      for (const pill of discovered) {
        this.pills.set(pill.id, pill);
      }
    }
    for (const pill of this.pills.values()) {
      if (pill.enabled) {
        this.schedulePill(pill, 0);
      }
    }
  }
  /**
   * Manually triggers an immediate execution of a single custom pill.
   */
  async pollPill(pillId) {
    const pill = this.pills.get(pillId);
    if (!pill) return void 0;
    if (this.inFlight.has(pillId)) {
      return this.states.get(pillId);
    }
    this.inFlight.add(pillId);
    try {
      const result = await safeExec(pill.command, {
        timeoutMs: pill.timeoutMs,
        env: { ...process.env, ...this.options.env },
        cwd: this.options.cwd
      });
      const rawValue = result.stdout || result.stderr || "";
      const numericValue = parseNumericPillValue(rawValue);
      const status = resolveCustomPillStatus(numericValue, pill.thresholds);
      const displayValue = formatPillDisplay(rawValue, pill.prefix, pill.suffix);
      const state = {
        id: pill.id,
        title: pill.title,
        compactTitle: pill.compactTitle,
        icon: pill.icon,
        compactIcon: pill.compactIcon,
        rawValue,
        displayValue,
        numericValue,
        status,
        lastUpdated: Date.now(),
        sourceFile: pill.sourceFile,
        modalTitle: pill.modal?.title ?? pill.title,
        modalDescription: pill.modal?.description
      };
      this.states.set(pill.id, state);
      this.notifyUpdate();
      return state;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.options.logger?.warn(`Custom pill '${pill.id}' execution failed: ${errorMsg}`);
      const previous = this.states.get(pill.id);
      const state = {
        id: pill.id,
        title: pill.title,
        compactTitle: pill.compactTitle,
        icon: pill.icon,
        compactIcon: pill.compactIcon,
        rawValue: previous?.rawValue ?? "ERR",
        displayValue: previous?.displayValue ?? "ERR",
        status: "danger",
        lastUpdated: Date.now(),
        error: errorMsg,
        sourceFile: pill.sourceFile,
        modalTitle: pill.modal?.title ?? pill.title,
        modalDescription: pill.modal?.description
      };
      this.states.set(pill.id, state);
      this.notifyUpdate();
      return state;
    } finally {
      this.inFlight.delete(pillId);
    }
  }
  /**
   * Executes the on-demand drilldown command configured in pill.modal.command.
   */
  async runModalCommand(pillId) {
    const pill = this.pills.get(pillId);
    if (!pill) {
      return { error: `Custom pill '${pillId}' not found` };
    }
    const commandToRun = pill.modal?.command ?? pill.command;
    try {
      const result = await safeExec(commandToRun, {
        timeoutMs: pill.timeoutMs,
        env: { ...process.env, ...this.options.env },
        cwd: this.options.cwd
      });
      const output = result.stdout || result.stderr || "No output";
      const existing = this.states.get(pillId);
      if (existing) {
        existing.modalOutput = output;
        existing.modalLastUpdated = Date.now();
        delete existing.modalError;
        this.notifyUpdate();
      }
      return { output };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const existing = this.states.get(pillId);
      if (existing) {
        existing.modalError = errorMsg;
        this.notifyUpdate();
      }
      return { error: errorMsg };
    }
  }
  /**
   * Updates or reconciles the list of pill definitions dynamically.
   */
  updatePills(newPills) {
    const nextIds = new Set(newPills.map((p) => p.id));
    for (const [id, timer] of this.timers.entries()) {
      if (!nextIds.has(id)) {
        clearTimeout(timer);
        this.timers.delete(id);
        this.pills.delete(id);
        this.states.delete(id);
      }
    }
    for (const pill of newPills) {
      this.pills.set(pill.id, pill);
      const currentTimer = this.timers.get(pill.id);
      if (currentTimer) {
        clearTimeout(currentTimer);
        this.timers.delete(pill.id);
      }
      if (this.running && pill.enabled) {
        this.schedulePill(pill, 0);
      }
    }
    this.notifyUpdate();
  }
  /**
   * Returns live state for a single custom pill.
   */
  getState(pillId) {
    return this.states.get(pillId);
  }
  /**
   * Returns live states for all custom pills.
   */
  getAllStates() {
    return Array.from(this.states.values());
  }
  /**
   * Stops all active polling loops and clears resources.
   */
  stop() {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.inFlight.clear();
  }
  schedulePill(pill, delayMs) {
    if (!this.running) return;
    const timer = setTimeout(async () => {
      await this.pollPill(pill.id);
      if (this.running && this.pills.has(pill.id)) {
        const nextPill = this.pills.get(pill.id);
        if (nextPill?.enabled) {
          this.schedulePill(nextPill, nextPill.intervalMs);
        }
      }
    }, delayMs);
    this.timers.set(pill.id, timer);
  }
  notifyUpdate() {
    if (this.options.onUpdate) {
      try {
        this.options.onUpdate(this.getAllStates());
      } catch {
      }
    }
  }
};

// src/shared/async.ts
var TimeoutError = class extends Error {
  timeoutMs;
  constructor(message, timeoutMs) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
};
async function withTimeout(promise, timeoutMs, label = "Operation") {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== void 0) {
      clearTimeout(timer);
    }
  }
}

// src/server/rpc-guard.ts
function guardRpcHandler(handler, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5e3;
  const maxInflight = options.maxInflight ?? 4;
  let inflight = 0;
  const guarded = (async (input) => {
    if (inflight >= maxInflight) {
      options.onSaturated?.({ maxInflight });
      const stale = options.getStale?.();
      if (stale != null) {
        return stale;
      }
      throw new Error(
        `RPC handler saturated (${inflight} inflight, cap ${maxInflight}): shedding load`
      );
    }
    inflight += 1;
    try {
      return await withTimeout(
        Promise.resolve().then(() => handler(input)),
        timeoutMs,
        "RPC handler"
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        options.onTimeout?.({ timeoutMs, inflight });
      }
      throw err;
    } finally {
      inflight -= 1;
    }
  });
  guarded.inflight = () => inflight;
  return guarded;
}
function createLoopWatchdog(options = {}) {
  const thresholdMs = options.thresholdMs ?? 1e3;
  const intervalMs = options.intervalMs ?? 1e3;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const lagMs = now - last - intervalMs;
    last = now;
    if (lagMs >= thresholdMs) {
      options.onLag?.(lagMs);
    }
  }, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return () => clearInterval(timer);
}
function readEnvIdentity(env = process.env) {
  const id = env.PASEO_AGENT_ID || env.AGENT_ID || void 0;
  const name = env.AGENT_NAME || void 0;
  const model = env.AGENT_MODEL || void 0;
  const provider = env.AGENT_PROVIDER || void 0;
  if (!id && !name && !model && !provider) return null;
  return { id, name, model, provider };
}
function normalizeEnvelopeJson(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const identity = {
    id: str(o.id) ?? str(o.agentId),
    name: str(o.name) ?? str(o.agentName),
    model: str(o.model),
    provider: str(o.provider),
    repo: str(o.repo) ?? str(o.workspace),
    branch: str(o.branch),
    envelopeText: str(o.envelopeText) ?? str(o.envelope)
  };
  if (!identity.id && !identity.name && !identity.model && !identity.provider && !identity.repo && !identity.branch) return null;
  return identity;
}
async function getAgentIdentity(options = {}) {
  const timeoutMs = options.timeoutMs ?? 5e3;
  const command = options.envelopeCommand ?? "xpufx-tool envelope --format json";
  const envIdentity = readEnvIdentity();
  try {
    const result = await safeExec(command, { timeoutMs });
    if (result.code !== 0) return envIdentity;
    const text = result.stdout.trim();
    if (!text) return envIdentity;
    try {
      const parsed = JSON.parse(text);
      const cliIdentity = normalizeEnvelopeJson(parsed);
      if (!cliIdentity) return envIdentity;
      if (!envIdentity) return cliIdentity;
      return {
        id: envIdentity.id ?? cliIdentity.id,
        name: envIdentity.name ?? cliIdentity.name,
        model: envIdentity.model ?? cliIdentity.model,
        provider: envIdentity.provider ?? cliIdentity.provider,
        repo: cliIdentity.repo,
        branch: cliIdentity.branch,
        envelopeText: cliIdentity.envelopeText
      };
    } catch {
      return envIdentity;
    }
  } catch {
    return envIdentity;
  }
}

// src/server/workspace-beacon.ts
var DEFAULT_BEACON_LABEL_PREFIX = "beacon:";
var BEACON_COLORS = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue"
];
function resolveBeaconLabelName(name, prefix = DEFAULT_BEACON_LABEL_PREFIX) {
  const trimmed = (name ?? "").trim();
  if (!prefix) return trimmed;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed;
  return `${prefix}${trimmed}`;
}
function normalizeBeaconColor(color) {
  if (!color) return void 0;
  const normalized = color.trim().toLowerCase();
  if (BEACON_COLORS.includes(normalized)) return normalized;
  return void 0;
}
function isFunction(value) {
  return typeof value === "function";
}
async function safeInvoke(fn, logger) {
  try {
    await fn();
    return true;
  } catch (err) {
    logger?.debug?.(
      `WorkspaceBeacon host call failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}
function toTimerKey(workspaceId) {
  return workspaceId ?? "__default__";
}
var WorkspaceBeacon = class {
  workspaceHandle;
  daemonClient;
  labelPrefix;
  baseTitle;
  logger;
  originalTitles = /* @__PURE__ */ new Map();
  blinkTimers = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.workspaceHandle = options.workspaceHandle ?? null;
    this.daemonClient = options.daemonClient ?? null;
    this.labelPrefix = options.labelPrefix ?? DEFAULT_BEACON_LABEL_PREFIX;
    this.baseTitle = options.baseTitle;
    this.logger = options.logger;
  }
  setOptions(options) {
    if ("workspaceHandle" in options) this.workspaceHandle = options.workspaceHandle ?? null;
    if ("daemonClient" in options) this.daemonClient = options.daemonClient ?? null;
    if (options.labelPrefix !== void 0) this.labelPrefix = options.labelPrefix;
    if (options.baseTitle !== void 0) this.baseTitle = options.baseTitle;
    if (options.logger !== void 0) this.logger = options.logger;
  }
  get activeBlinks() {
    return this.blinkTimers.size;
  }
  async set(options) {
    const result = { labelApplied: false, titleApplied: false };
    try {
      const workspaceId = options.workspaceId;
      const labelName = options.name ? resolveBeaconLabelName(options.name, this.labelPrefix) : void 0;
      result.labelName = labelName;
      if (workspaceId && labelName) {
        result.labelApplied = await this.applyLabel(workspaceId, labelName, options.color);
      }
      const title = this.resolveTitle(options);
      if (title !== void 0) {
        result.titleApplied = await this.applyTitle(workspaceId, title);
        if (result.titleApplied) result.title = title;
      }
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon.set failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return result;
  }
  blink(options) {
    const intervalMs = Math.max(50, options.intervalMs ?? 3e3);
    const totalRounds = options.rounds ?? Number.POSITIVE_INFINITY;
    const workspaceId = options.workspaceId ?? options.a.workspaceId ?? options.b.workspaceId;
    const key = toTimerKey(workspaceId);
    this.stopBlink(key);
    let stopped = false;
    let settled = false;
    let timer;
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      const current = this.blinkTimers.get(key);
      if (current?.finish === finish) this.blinkTimers.delete(key);
      if (options.restoreOnDone) {
        void this.clear({
          workspaceId,
          name: options.a.name ?? options.b.name,
          restoreTitle: true
        }).catch(
          (err) => this.logger?.debug?.(
            `WorkspaceBeacon blink restore failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      resolveDone();
    };
    try {
      const states = [options.a, options.b];
      const tick = () => {
        if (stopped) {
          finish();
          return;
        }
        if (count >= totalRounds) {
          finish();
          return;
        }
        const state = states[count % 2];
        count += 1;
        void this.set({ ...state, workspaceId: state.workspaceId ?? workspaceId ?? "" }).catch(
          (err) => this.logger?.debug?.(
            `WorkspaceBeacon blink tick failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        if (count >= totalRounds) {
          finish();
        }
      };
      let count = 0;
      void this.set({ ...states[0], workspaceId: states[0].workspaceId ?? workspaceId ?? "" }).catch(
        (err) => this.logger?.debug?.(
          `WorkspaceBeacon blink tick failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      count = 1;
      if (count >= totalRounds) {
        finish();
      } else {
        timer = setInterval(tick, intervalMs);
        this.blinkTimers.set(key, { timer, finish });
      }
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon blink setup failed: ${err instanceof Error ? err.message : String(err)}`
      );
      finish();
    }
    return {
      stop: () => {
        stopped = true;
        finish();
      },
      done
    };
  }
  async clear(options = {}) {
    const result = { labelCleared: false, titleRestored: false };
    try {
      this.stopBlink(toTimerKey(options.workspaceId));
      if (options.workspaceId && options.name) {
        result.labelCleared = await this.detachLabel(
          options.workspaceId,
          resolveBeaconLabelName(options.name, this.labelPrefix)
        );
      } else if (options.workspaceId && !options.name) {
        result.labelCleared = false;
      }
      if (options.restoreTitle !== false) {
        result.titleRestored = await this.restoreTitle(options.workspaceId);
      }
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon.clear failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return result;
  }
  stopAll() {
    for (const entry of this.blinkTimers.values()) {
      clearInterval(entry.timer);
      try {
        entry.finish();
      } catch (err) {
        this.logger?.debug?.(
          `WorkspaceBeacon stopAll finish failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    this.blinkTimers.clear();
  }
  resolveTitle(options) {
    if (options.title !== void 0) return options.title;
    if (options.titleSuffix === void 0) return void 0;
    const base = this.originalTitles.get(options.workspaceId ?? "") ?? this.baseTitle ?? "";
    return `${base}${options.titleSuffix}`;
  }
  async applyLabel(workspaceId, labelName, color) {
    const client = this.daemonClient;
    if (!client || !isFunction(client.setWorkspaceLabel)) return false;
    const label = { name: labelName };
    const normalized = normalizeBeaconColor(color);
    if (normalized) label.color = normalized;
    else if (color) label.color = color;
    return safeInvoke(
      () => client.setWorkspaceLabel({
        workspaceId,
        label,
        assigned: true
      }),
      this.logger
    );
  }
  async detachLabel(workspaceId, labelName) {
    const client = this.daemonClient;
    if (!client) return false;
    try {
      if (isFunction(client.setWorkspaceLabel)) {
        return await safeInvoke(
          () => client.setWorkspaceLabel({
            workspaceId,
            label: { name: labelName },
            assigned: false
          }),
          this.logger
        );
      }
      if (isFunction(client.removeWorkspaceLabel)) {
        return await safeInvoke(
          () => client.removeWorkspaceLabel({
            workspaceId,
            name: labelName
          }),
          this.logger
        );
      }
      return false;
    } catch (err) {
      this.logger?.debug?.(
        `WorkspaceBeacon detachLabel failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  setOriginalTitle(workspaceId, title) {
    this.originalTitles.set(workspaceId, title);
  }
  hasOriginalTitle(workspaceId) {
    return this.originalTitles.has(workspaceId);
  }
  getOriginalTitle(workspaceId) {
    return this.originalTitles.get(workspaceId);
  }
  async applyTitle(workspaceId, title) {
    const handle = this.workspaceHandle;
    if (!handle || !isFunction(handle.setTitle)) return false;
    const key = workspaceId ?? "";
    if (!this.originalTitles.has(key)) {
      if (this.baseTitle !== void 0) {
        this.originalTitles.set(key, this.baseTitle);
      }
    }
    return safeInvoke(() => handle.setTitle(title), this.logger);
  }
  async restoreTitle(workspaceId) {
    const handle = this.workspaceHandle;
    if (!handle || !isFunction(handle.setTitle)) return false;
    const key = workspaceId ?? "";
    const original = this.originalTitles.get(key) ?? this.baseTitle;
    if (original === void 0) return false;
    const ok = await safeInvoke(
      () => handle.setTitle(original),
      this.logger
    );
    if (ok) {
      this.originalTitles.delete(key);
      if (this.baseTitle === original) {
        this.baseTitle = void 0;
      }
    }
    return ok;
  }
  stopBlink(key) {
    const entry = this.blinkTimers.get(key);
    if (entry) {
      clearInterval(entry.timer);
      this.blinkTimers.delete(key);
      try {
        entry.finish();
      } catch (err) {
        this.logger?.debug?.(
          `WorkspaceBeacon stopBlink finish failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
};
function createWorkspaceBeacon(options = {}) {
  return new WorkspaceBeacon(options);
}

export { BEACON_COLORS, CpuSampler, CustomPillPoller, DEFAULT_BEACON_LABEL_PREFIX, DEFAULT_NAMESPACE_README, McpConfigPaths, PluginStorage, WorkspaceBeacon, clearPluginCache, createLoopWatchdog, createPeriodicTask, createPluginLogger, createSettingsHandlers, createSharedPluginSettings, createWorkspaceBeacon, discoverCustomPillConfigs, expandPath, findAvailablePort, getAgentIdentity, getMcpServer, getPluginInfo, getSystemMetrics, guardRpcHandler, isPluginEnabled, isPluginInstalled, isPluginRunning, isPortOpen, isProductionEnv, listPlugins, normalizeBeaconColor, parseJsonc, pingHost, redactSecrets, registerMcpInjection, registerSettingsRpc, removeMcpServer, resolveBeaconLabelName, resolveDefaultMinLevel, resolveMinLevelFromEnv, resolvePluginVersion, safeExec, safeSpawn, stampVersion, stripJsonComments, tryParseJsonc, upsertMcpServer };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map
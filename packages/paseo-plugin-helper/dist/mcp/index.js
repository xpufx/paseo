import { spawn } from 'child_process';
import readline from 'readline';
import crypto from 'crypto';

// src/mcp/client.ts

// src/mcp/ring-buffer.ts
var StderrRingBuffer = class {
  constructor(maxLines = 25) {
    this.maxLines = maxLines;
  }
  maxLines;
  lines = [];
  push(chunk) {
    const newLines = chunk.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    this.lines.push(...newLines);
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines);
    }
  }
  getRecentLines() {
    return [...this.lines];
  }
  getRecentText() {
    return this.lines.join("\n");
  }
  clear() {
    this.lines = [];
  }
};
function killProcessTree(child, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!child || !child.pid || child.killed) {
      resolve();
      return;
    }
    const pid = child.pid;
    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
        killer.on("close", () => resolve());
        killer.on("error", () => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
          resolve();
        });
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        resolve();
      }
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
      }
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }
      resolve();
    }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
var McpHttpClient = class {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.postUrl = url;
  }
  url;
  options;
  pendingRequests = /* @__PURE__ */ new Map();
  initialized = false;
  _serverInfo;
  _instructions;
  _capabilities;
  _protocolVersion;
  initPromise;
  abortController = new AbortController();
  postUrl;
  sessionId;
  isSse = false;
  sseConnectPromise;
  /**
   * Server metadata returned during MCP initialize handshake.
   */
  get serverInfo() {
    return this._serverInfo;
  }
  /**
   * Optional server instructions / prompt guidance returned during initialize handshake.
   */
  get instructions() {
    return this._instructions;
  }
  /**
   * Declared server capabilities returned during initialize handshake.
   */
  get capabilities() {
    return this._capabilities;
  }
  /**
   * Protocol version negotiated during initialize handshake.
   */
  get protocolVersion() {
    return this._protocolVersion;
  }
  async ensureSseConnected() {
    if (this.sseConnectPromise) return this.sseConnectPromise;
    this.sseConnectPromise = (async () => {
      try {
        const res = await fetch(this.url, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            ...this.options.headers
          },
          signal: this.abortController.signal
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream") && res.body) {
          this.isSse = true;
          this.consumeSseStream(res.body);
        }
      } catch {
      }
    })();
    return this.sseConnectPromise;
  }
  async consumeSseStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let currentData = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData += (currentData ? "\n" : "") + line.slice(5).trim();
          } else if (line.trim() === "") {
            if (currentEvent === "endpoint" && currentData) {
              try {
                this.postUrl = new URL(currentData, this.url).toString();
              } catch {
                this.postUrl = currentData;
              }
            } else if (currentData) {
              try {
                const msg = JSON.parse(currentData);
                this.handleIncomingMessage(msg);
              } catch {
              }
            }
            currentEvent = "message";
            currentData = "";
          }
        }
      }
    } catch {
    }
  }
  handleIncomingMessage(msg) {
    if (msg.id !== void 0 && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        const err = new Error(msg.error.message ?? "RPC Error");
        err.code = msg.error.code;
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
    }
  }
  async sendRequest(method, params, timeoutMs, retryOnSessionExpired = true) {
    const timeout = timeoutMs ?? this.options.timeoutMs ?? 1e4;
    const id = crypto.randomUUID();
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...params !== void 0 ? { params } : {}
    };
    if (this.url.includes("/sse")) {
      await this.ensureSseConnected();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`HTTP MCP request "${method}" timed out after ${timeout}ms.`));
      }, timeout);
      this.pendingRequests.set(id, { resolve, reject, timer });
      const reqHeaders = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.options.headers
      };
      if (this.sessionId) {
        reqHeaders["Mcp-Session-Id"] = this.sessionId;
      }
      fetch(this.postUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: this.abortController.signal
      }).then(async (res) => {
        const sid = res.headers.get("mcp-session-id");
        if (sid) {
          this.sessionId = sid;
        }
        if (!res.ok) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          if (res.status === 404 && this.sessionId && retryOnSessionExpired && method !== "initialize") {
            this.sessionId = void 0;
            this.initialized = false;
            this.initPromise = void 0;
            try {
              await this.initialize();
              const retried = await this.sendRequest(method, params, timeoutMs, false);
              resolve(retried);
              return;
            } catch (retryErr) {
              reject(retryErr);
              return;
            }
          }
          reject(new Error(`MCP HTTP POST returned HTTP ${res.status}: ${res.statusText}`));
          return;
        }
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const body = await res.json();
          this.handleIncomingMessage(body);
        } else if (contentType.includes("text/event-stream") && res.body) {
          this.consumeSseStream(res.body);
        } else {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`Unsupported MCP HTTP response content-type: ${contentType}`));
        }
      }).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }
  async sendNotification(method, params) {
    const payload = {
      jsonrpc: "2.0",
      method,
      ...params !== void 0 ? { params } : {}
    };
    const reqHeaders = {
      "Content-Type": "application/json",
      ...this.options.headers
    };
    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }
    try {
      await fetch(this.postUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: this.abortController.signal
      });
    } catch {
    }
  }
  async initialize() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (this.url.includes("/sse")) {
        await this.ensureSseConnected();
      }
      const result = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        clientInfo: this.options.clientInfo ?? {
          name: "paseo-plugin",
          version: "1.0.0"
        }
      });
      this._serverInfo = result?.serverInfo;
      this._instructions = result?.instructions;
      this._capabilities = result?.capabilities;
      this._protocolVersion = result?.protocolVersion;
      await this.sendNotification("notifications/initialized");
      this.initialized = true;
    })();
    return this.initPromise;
  }
  async ping(options = {}) {
    const start = Date.now();
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 1e4;
    try {
      await this.initialize();
      if (options.mode === "tools") {
        await this.listTools();
      } else {
        try {
          await this.sendRequest("ping", {}, timeout);
        } catch (err) {
          if (err.code !== -32601) {
            throw err;
          }
        }
      }
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        serverInfo: this._serverInfo,
        instructions: this._instructions
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err.message
      };
    }
  }
  async listTools() {
    await this.initialize();
    const result = await this.sendRequest("tools/list", {});
    return result?.tools ?? [];
  }
  async callTool(name, args = {}) {
    await this.initialize();
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args
    });
    return result;
  }
  async close() {
    if (this.sessionId) {
      const sid = this.sessionId;
      this.sessionId = void 0;
      const teardownController = new AbortController();
      const teardownTimer = setTimeout(() => teardownController.abort(), 2e3);
      try {
        await fetch(this.postUrl, {
          method: "DELETE",
          headers: {
            "Mcp-Session-Id": sid,
            ...this.options.headers
          },
          signal: teardownController.signal
        });
      } catch {
      } finally {
        clearTimeout(teardownTimer);
      }
    }
    this.abortController.abort();
    for (const [, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("HTTP MCP Client was closed."));
    }
    this.pendingRequests.clear();
    this.initialized = false;
    this.initPromise = void 0;
  }
};

// src/mcp/client.ts
var McpClient = class _McpClient {
  constructor(command, args = [], env, options = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.options = options;
  }
  command;
  args;
  env;
  options;
  child = null;
  stderrBuffer = new StderrRingBuffer(30);
  pendingRequests = /* @__PURE__ */ new Map();
  initialized = false;
  _serverInfo;
  _instructions;
  _capabilities;
  _protocolVersion;
  initPromise;
  /**
   * Server metadata returned during MCP initialize handshake.
   */
  get serverInfo() {
    return this._serverInfo;
  }
  /**
   * Optional server instructions / system prompt guidance returned during MCP initialize handshake.
   */
  get instructions() {
    return this._instructions;
  }
  /**
   * Declared server capabilities returned during initialize handshake.
   */
  get capabilities() {
    return this._capabilities;
  }
  /**
   * Protocol version negotiated during initialize handshake.
   */
  get protocolVersion() {
    return this._protocolVersion;
  }
  /**
   * Creates an MCP client talking to a local process over stdio.
   */
  static forStdio(command, args = [], env, options) {
    return new _McpClient(command, args, env, options);
  }
  /**
   * Creates an MCP client connecting to an HTTP or Server-Sent Events (SSE) MCP server.
   */
  static forHttp(url, options) {
    return new McpHttpClient(url, options);
  }
  startProcess() {
    if (this.child && !this.child.killed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        this.child = spawn(this.command, this.args, {
          env: {
            ...process.env,
            ...this.env
          },
          shell: false,
          detached: process.platform !== "win32"
        });
        this.child.on("error", (err) => {
          const isNotFound = err.code === "ENOENT" || err.code === "EACCES";
          const formattedErr = isNotFound ? new Error(`Executable "${this.command}" not found in PATH or cannot be executed (${err.code}).`) : err;
          this.rejectAllPending(formattedErr);
          reject(formattedErr);
        });
        this.child.stderr?.on("data", (chunk) => {
          this.stderrBuffer.push(chunk.toString());
        });
        if (this.child.stdout) {
          const rl = readline.createInterface({
            input: this.child.stdout,
            crlfDelay: Infinity
          });
          rl.on("line", (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("{")) {
              return;
            }
            try {
              const msg = JSON.parse(trimmed);
              this.handleMessage(msg);
            } catch {
            }
          });
        }
        this.child.on("close", (code, signal) => {
          const stderr = this.stderrBuffer.getRecentText();
          const reason = stderr ? `Process exited with code ${code ?? signal}:
${stderr}` : `Process exited unexpectedly with code ${code ?? signal}.`;
          this.rejectAllPending(new Error(reason));
        });
        resolve();
      } catch (err) {
        const isNotFound = err?.code === "ENOENT" || err?.code === "EACCES";
        const formattedErr = isNotFound ? new Error(`Executable "${this.command}" not found in PATH or cannot be executed (${err?.code}).`) : err;
        reject(formattedErr);
      }
    });
  }
  handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.id !== void 0 && msg.id !== null) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          const err = new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`);
          err.code = msg.error.code;
          err.data = msg.error.data;
          pending.reject(err);
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }
  rejectAllPending(err) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }
  async sendRequest(method, params, timeoutMs) {
    await this.startProcess();
    if (!this.child || !this.child.stdin || this.child.killed) {
      throw new Error(`Process "${this.command}" is not running.`);
    }
    const id = crypto.randomUUID();
    const timeout = timeoutMs ?? this.options.timeoutMs ?? 1e4;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...params !== void 0 ? { params } : {}
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const stderr = this.stderrBuffer.getRecentText();
        const msg = stderr ? `Request "${method}" timed out after ${timeout}ms. Stderr output:
${stderr}` : `Request "${method}" timed out after ${timeout}ms.`;
        reject(new Error(msg));
      }, timeout);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload + "\n", (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }
  sendNotification(method, params) {
    if (!this.child || !this.child.stdin || this.child.killed) return;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...params !== void 0 ? { params } : {}
    });
    this.child.stdin.write(payload + "\n");
  }
  /**
   * Performs the MCP initialize handshake and sends the initialized notification.
   */
  async initialize() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const result = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        clientInfo: this.options.clientInfo ?? {
          name: "paseo-plugin",
          version: "1.0.0"
        }
      });
      this._serverInfo = result?.serverInfo;
      this._instructions = result?.instructions;
      this._capabilities = result?.capabilities;
      this._protocolVersion = result?.protocolVersion;
      this.sendNotification("notifications/initialized");
      this.initialized = true;
    })();
    return this.initPromise;
  }
  /**
   * Checks the health and responsiveness of the MCP server.
   * If protocol ping fails with -32601 (Method not found), seamlessly falls back
   * to handshake validation.
   */
  async ping(options = {}) {
    const start = Date.now();
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 1e4;
    try {
      await this.initialize();
      if (options.mode === "tools") {
        await this.listTools();
      } else {
        try {
          await this.sendRequest("ping", {}, timeout);
        } catch (err) {
          if (err.code !== -32601) {
            throw err;
          }
        }
      }
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        serverInfo: this._serverInfo,
        instructions: this._instructions,
        stderr: this.stderrBuffer.getRecentText()
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err.message,
        stderr: this.stderrBuffer.getRecentText()
      };
    }
  }
  /**
   * Enumerates available tools on the MCP server.
   */
  async listTools() {
    await this.initialize();
    const result = await this.sendRequest("tools/list", {});
    return result?.tools ?? [];
  }
  /**
   * Calls a tool by name with the given arguments.
   */
  async callTool(name, args = {}) {
    await this.initialize();
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args
    });
    return result;
  }
  /**
   * Retrieves the recent stderr lines captured in the ring buffer.
   */
  getStderr() {
    return this.stderrBuffer.getRecentText();
  }
  /**
   * Cleanly closes the client, killing the child process and its process tree.
   */
  async close() {
    this.rejectAllPending(new Error("Client was closed."));
    if (this.child) {
      const child = this.child;
      this.child = null;
      await killProcessTree(child);
    }
    this.initialized = false;
    this.initPromise = void 0;
  }
};

export { McpClient, McpHttpClient, StderrRingBuffer, killProcessTree };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map
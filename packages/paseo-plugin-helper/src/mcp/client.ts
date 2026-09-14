import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import crypto from "node:crypto";
import { StderrRingBuffer } from "./ring-buffer.js";
import { killProcessTree } from "./process-killer.js";
import { McpHttpClient, type McpHttpOptions } from "./http-client.js";
import type {
  McpClientOptions,
  McpPingOptions,
  McpPingResult,
  McpToolCallResult,
  McpToolInfo,
} from "./types.js";

interface PendingRequest {
  resolve: (res: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class McpClient {
  private child: ChildProcess | null = null;
  private stderrBuffer = new StderrRingBuffer(30);
  private pendingRequests = new Map<string | number, PendingRequest>();
  private initialized = false;
  private _serverInfo?: { name: string; version?: string };
  private _instructions?: string;
  private _capabilities?: Record<string, unknown>;
  private _protocolVersion?: string;
  private initPromise?: Promise<void>;

  /**
   * Server metadata returned during MCP initialize handshake.
   */
  get serverInfo(): { name: string; version?: string } | undefined {
    return this._serverInfo;
  }

  /**
   * Optional server instructions / system prompt guidance returned during MCP initialize handshake.
   */
  get instructions(): string | undefined {
    return this._instructions;
  }

  /**
   * Declared server capabilities returned during initialize handshake.
   */
  get capabilities(): Record<string, unknown> | undefined {
    return this._capabilities;
  }

  /**
   * Protocol version negotiated during initialize handshake.
   */
  get protocolVersion(): string | undefined {
    return this._protocolVersion;
  }

  private constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env?: Record<string, string>,
    private readonly options: McpClientOptions = {},
  ) {}

  /**
   * Creates an MCP client talking to a local process over stdio.
   */
  static forStdio(
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
    options?: McpClientOptions,
  ): McpClient {
    return new McpClient(command, args, env, options);
  }

  /**
   * Creates an MCP client connecting to an HTTP or Server-Sent Events (SSE) MCP server.
   */
  static forHttp(url: string, options?: McpHttpOptions): McpHttpClient {
    return new McpHttpClient(url, options);
  }

  private startProcess(): Promise<void> {
    if (this.child && !this.child.killed) return Promise.resolve();

    return new Promise((resolve, reject) => {
      try {
        this.child = spawn(this.command, this.args, {
          env: {
            ...process.env,
            ...this.env,
          },
          shell: false,
          detached: process.platform !== "win32",
        });

        this.child.on("error", (err: any) => {
          const isNotFound = err.code === "ENOENT" || err.code === "EACCES";
          const formattedErr = isNotFound
            ? new Error(`Executable "${this.command}" not found in PATH or cannot be executed (${err.code}).`)
            : err;
          this.rejectAllPending(formattedErr);
          reject(formattedErr);
        });

        this.child.stderr?.on("data", (chunk: Buffer | string) => {
          this.stderrBuffer.push(chunk.toString());
        });

        if (this.child.stdout) {
          const rl = readline.createInterface({
            input: this.child.stdout,
            crlfDelay: Infinity,
          });

          rl.on("line", (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("{")) {
              // Ignore non-JSON output (e.g. startup banners or debug logs)
              return;
            }
            try {
              const msg = JSON.parse(trimmed);
              this.handleMessage(msg);
            } catch {
              // Ignore JSON parse errors from malformed stdout noise
            }
          });
        }

        this.child.on("close", (code, signal) => {
          const stderr = this.stderrBuffer.getRecentText();
          const reason = stderr
            ? `Process exited with code ${code ?? signal}:\n${stderr}`
            : `Process exited unexpectedly with code ${code ?? signal}.`;
          this.rejectAllPending(new Error(reason));
        });

        resolve();
      } catch (err: any) {
        const isNotFound = err?.code === "ENOENT" || err?.code === "EACCES";
        const formattedErr = isNotFound
          ? new Error(`Executable "${this.command}" not found in PATH or cannot be executed (${err?.code}).`)
          : err;
        reject(formattedErr);
      }
    });
  }

  private handleMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;

    // Handle responses to requests
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          const err = new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`);
          (err as any).code = msg.error.code;
          (err as any).data = msg.error.data;
          pending.reject(err);
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  private async sendRequest<T = any>(
    method: string,
    params?: any,
    timeoutMs?: number,
  ): Promise<T> {
    await this.startProcess();

    if (!this.child || !this.child.stdin || this.child.killed) {
      throw new Error(`Process "${this.command}" is not running.`);
    }

    const id = crypto.randomUUID();
    const timeout = timeoutMs ?? this.options.timeoutMs ?? 10000;

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const stderr = this.stderrBuffer.getRecentText();
        const msg = stderr
          ? `Request "${method}" timed out after ${timeout}ms. Stderr output:\n${stderr}`
          : `Request "${method}" timed out after ${timeout}ms.`;
        reject(new Error(msg));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.child!.stdin!.write(payload + "\n", (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  private sendNotification(method: string, params?: any): void {
    if (!this.child || !this.child.stdin || this.child.killed) return;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
    this.child.stdin.write(payload + "\n");
  }

  /**
   * Performs the MCP initialize handshake and sends the initialized notification.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const result = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        clientInfo: this.options.clientInfo ?? {
          name: "paseo-plugin",
          version: "1.0.0",
        },
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
  async ping(options: McpPingOptions = {}): Promise<McpPingResult> {
    const start = Date.now();
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 10000;

    try {
      await this.initialize();

      if (options.mode === "tools") {
        await this.listTools();
      } else {
        try {
          await this.sendRequest("ping", {}, timeout);
        } catch (err: any) {
          // Method not found (-32601) is common on minimalist servers; fallback to handshake
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
        stderr: this.stderrBuffer.getRecentText(),
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err.message,
        stderr: this.stderrBuffer.getRecentText(),
      };
    }
  }

  /**
   * Enumerates available tools on the MCP server.
   */
  async listTools(): Promise<McpToolInfo[]> {
    await this.initialize();
    const result = await this.sendRequest("tools/list", {});
    return (result?.tools as McpToolInfo[]) ?? [];
  }

  /**
   * Calls a tool by name with the given arguments.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    await this.initialize();
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args,
    });
    return result as McpToolCallResult;
  }

  /**
   * Retrieves the recent stderr lines captured in the ring buffer.
   */
  getStderr(): string {
    return this.stderrBuffer.getRecentText();
  }

  /**
   * Cleanly closes the client, killing the child process and its process tree.
   */
  async close(): Promise<void> {
    this.rejectAllPending(new Error("Client was closed."));
    if (this.child) {
      const child = this.child;
      this.child = null;
      await killProcessTree(child);
    }
    this.initialized = false;
    this.initPromise = undefined;
  }
}

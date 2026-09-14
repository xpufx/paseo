import crypto from "node:crypto";
import type {
  McpClientOptions,
  McpPingOptions,
  McpPingResult,
  McpToolCallResult,
  McpToolInfo,
} from "./types.js";

export interface McpHttpOptions extends McpClientOptions {
  headers?: Record<string, string>;
}

interface PendingRequest {
  resolve: (res: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Zero-dependency MCP client supporting direct HTTP POST (Streamable HTTP)
 * and Server-Sent Events (SSE) transports.
 */
export class McpHttpClient {
  private pendingRequests = new Map<string | number, PendingRequest>();
  private initialized = false;
  private _serverInfo?: { name: string; version?: string };
  private _instructions?: string;
  private _capabilities?: Record<string, unknown>;
  private _protocolVersion?: string;
  private initPromise?: Promise<void>;
  private abortController = new AbortController();
  private postUrl: string;
  private sessionId?: string;
  private isSse = false;
  private sseConnectPromise?: Promise<void>;

  constructor(
    private readonly url: string,
    private readonly options: McpHttpOptions = {},
  ) {
    this.postUrl = url;
  }

  /**
   * Server metadata returned during MCP initialize handshake.
   */
  get serverInfo(): { name: string; version?: string } | undefined {
    return this._serverInfo;
  }

  /**
   * Optional server instructions / prompt guidance returned during initialize handshake.
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

  private async ensureSseConnected(): Promise<void> {
    if (this.sseConnectPromise) return this.sseConnectPromise;

    this.sseConnectPromise = (async () => {
      try {
        const res = await fetch(this.url, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            ...this.options.headers,
          },
          signal: this.abortController.signal,
        });

        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream") && res.body) {
          this.isSse = true;
          this.consumeSseStream(res.body);
        }
      } catch {
        // Fall back to direct HTTP POST if SSE connection fails
      }
    })();

    return this.sseConnectPromise;
  }

  private async consumeSseStream(stream: ReadableStream<Uint8Array>): Promise<void> {
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
                // Ignore non-JSON lines
              }
            }
            currentEvent = "message";
            currentData = "";
          }
        }
      }
    } catch {
      // Stream aborted or closed
    }
  }

  private handleIncomingMessage(msg: any): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.error) {
        const err = new Error(msg.error.message ?? "RPC Error");
        (err as any).code = msg.error.code;
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private async sendRequest<T = any>(
    method: string,
    params?: any,
    timeoutMs?: number,
    retryOnSessionExpired = true,
  ): Promise<T> {
    const timeout = timeoutMs ?? this.options.timeoutMs ?? 10000;
    const id = crypto.randomUUID();

    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    if (this.url.includes("/sse")) {
      await this.ensureSseConnected();
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`HTTP MCP request "${method}" timed out after ${timeout}ms.`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const reqHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.options.headers,
      };
      if (this.sessionId) {
        reqHeaders["Mcp-Session-Id"] = this.sessionId;
      }

      fetch(this.postUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: this.abortController.signal,
      })
        .then(async (res) => {
          const sid = res.headers.get("mcp-session-id");
          if (sid) {
            this.sessionId = sid;
          }

          if (!res.ok) {
            clearTimeout(timer);
            this.pendingRequests.delete(id);

            // If a stateful session expired (404), invalidate and retry once with a fresh handshake
            if (
              res.status === 404 &&
              this.sessionId &&
              retryOnSessionExpired &&
              method !== "initialize"
            ) {
              this.sessionId = undefined;
              this.initialized = false;
              this.initPromise = undefined;
              try {
                await this.initialize();
                const retried = await this.sendRequest<T>(method, params, timeoutMs, false);
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
            // Unhandled content type; ensure request does not hang
            clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(new Error(`Unsupported MCP HTTP response content-type: ${contentType}`));
          }
        })
        .catch((err) => {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(err);
        });
    });
  }

  private async sendNotification(method: string, params?: any): Promise<void> {
    const payload = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.options.headers,
    };
    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      await fetch(this.postUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: this.abortController.signal,
      });
    } catch {
      // Fire-and-forget notification
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.url.includes("/sse")) {
        await this.ensureSseConnected();
      }

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
      await this.sendNotification("notifications/initialized");
      this.initialized = true;
    })();

    return this.initPromise;
  }

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
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialize();
    const result = await this.sendRequest("tools/list", {});
    return (result?.tools as McpToolInfo[]) ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    await this.initialize();
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args,
    });
    return result as McpToolCallResult;
  }

  async close(): Promise<void> {
    if (this.sessionId) {
    const sid = this.sessionId;
    this.sessionId = undefined;
    const teardownController = new AbortController();
    const teardownTimer = setTimeout(() => teardownController.abort(), 2000);
    try {
      await fetch(this.postUrl, {
        method: "DELETE",
        headers: {
          "Mcp-Session-Id": sid,
          ...this.options.headers,
        },
        signal: teardownController.signal,
      });
    } catch {
      // Ignore session teardown errors
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
    this.initPromise = undefined;
  }
}

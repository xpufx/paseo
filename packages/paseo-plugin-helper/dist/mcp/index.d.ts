import { ChildProcess } from 'node:child_process';

interface McpClientOptions {
    timeoutMs?: number;
    clientInfo?: {
        name: string;
        version: string;
    };
}
interface McpToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
interface McpToolCallResult {
    content: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
        [key: string]: unknown;
    }>;
    isError?: boolean;
}
interface McpPingResult {
    healthy: boolean;
    latencyMs: number;
    serverInfo?: {
        name: string;
        version?: string;
    };
    instructions?: string;
    error?: string;
    stderr?: string;
}
interface McpPingOptions {
    mode?: "protocol" | "tools";
    timeoutMs?: number;
}

interface McpHttpOptions extends McpClientOptions {
    headers?: Record<string, string>;
}
/**
 * Zero-dependency MCP client supporting direct HTTP POST (Streamable HTTP)
 * and Server-Sent Events (SSE) transports.
 */
declare class McpHttpClient {
    private readonly url;
    private readonly options;
    private pendingRequests;
    private initialized;
    private _serverInfo?;
    private _instructions?;
    private _capabilities?;
    private _protocolVersion?;
    private initPromise?;
    private abortController;
    private postUrl;
    private sessionId?;
    private isSse;
    private sseConnectPromise?;
    constructor(url: string, options?: McpHttpOptions);
    /**
     * Server metadata returned during MCP initialize handshake.
     */
    get serverInfo(): {
        name: string;
        version?: string;
    } | undefined;
    /**
     * Optional server instructions / prompt guidance returned during initialize handshake.
     */
    get instructions(): string | undefined;
    /**
     * Declared server capabilities returned during initialize handshake.
     */
    get capabilities(): Record<string, unknown> | undefined;
    /**
     * Protocol version negotiated during initialize handshake.
     */
    get protocolVersion(): string | undefined;
    private ensureSseConnected;
    private consumeSseStream;
    private handleIncomingMessage;
    private sendRequest;
    private sendNotification;
    initialize(): Promise<void>;
    ping(options?: McpPingOptions): Promise<McpPingResult>;
    listTools(): Promise<McpToolInfo[]>;
    callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult>;
    close(): Promise<void>;
}

declare class McpClient {
    private readonly command;
    private readonly args;
    private readonly env?;
    private readonly options;
    private child;
    private stderrBuffer;
    private pendingRequests;
    private initialized;
    private _serverInfo?;
    private _instructions?;
    private _capabilities?;
    private _protocolVersion?;
    private initPromise?;
    /**
     * Server metadata returned during MCP initialize handshake.
     */
    get serverInfo(): {
        name: string;
        version?: string;
    } | undefined;
    /**
     * Optional server instructions / system prompt guidance returned during MCP initialize handshake.
     */
    get instructions(): string | undefined;
    /**
     * Declared server capabilities returned during initialize handshake.
     */
    get capabilities(): Record<string, unknown> | undefined;
    /**
     * Protocol version negotiated during initialize handshake.
     */
    get protocolVersion(): string | undefined;
    private constructor();
    /**
     * Creates an MCP client talking to a local process over stdio.
     */
    static forStdio(command: string, args?: string[], env?: Record<string, string>, options?: McpClientOptions): McpClient;
    /**
     * Creates an MCP client connecting to an HTTP or Server-Sent Events (SSE) MCP server.
     */
    static forHttp(url: string, options?: McpHttpOptions): McpHttpClient;
    private startProcess;
    private handleMessage;
    private rejectAllPending;
    private sendRequest;
    private sendNotification;
    /**
     * Performs the MCP initialize handshake and sends the initialized notification.
     */
    initialize(): Promise<void>;
    /**
     * Checks the health and responsiveness of the MCP server.
     * If protocol ping fails with -32601 (Method not found), seamlessly falls back
     * to handshake validation.
     */
    ping(options?: McpPingOptions): Promise<McpPingResult>;
    /**
     * Enumerates available tools on the MCP server.
     */
    listTools(): Promise<McpToolInfo[]>;
    /**
     * Calls a tool by name with the given arguments.
     */
    callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult>;
    /**
     * Retrieves the recent stderr lines captured in the ring buffer.
     */
    getStderr(): string;
    /**
     * Cleanly closes the client, killing the child process and its process tree.
     */
    close(): Promise<void>;
}

declare class StderrRingBuffer {
    private readonly maxLines;
    private lines;
    constructor(maxLines?: number);
    push(chunk: string): void;
    getRecentLines(): string[];
    getRecentText(): string;
    clear(): void;
}

/**
 * Cross-platform process tree killer.
 * On POSIX, signals the entire process group (-pid).
 * On Windows, executes taskkill /T /F to terminate parent and descendants.
 */
declare function killProcessTree(child: ChildProcess, timeoutMs?: number): Promise<void>;

export { McpClient, type McpClientOptions, McpHttpClient, type McpHttpOptions, type McpPingOptions, type McpPingResult, type McpToolCallResult, type McpToolInfo, StderrRingBuffer, killProcessTree };

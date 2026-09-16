import net from "node:net";

export interface PingHostOptions {
  timeoutMs?: number;
}

/**
 * Checks whether a TCP port is currently open and accepting connections on a host.
 */
export function isPortOpen(port: number, host = "127.0.0.1", options?: PingHostOptions): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 1000;

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

/**
 * Finds an available TCP port starting from startPort.
 * Tries up to maxAttempts ports.
 */
export function findAvailablePort(startPort = 3000, maxAttempts = 50, host = "127.0.0.1"): Promise<number> {
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

/**
 * Pings a host and port via TCP to verify connectivity.
 */
export async function pingHost(host: string, port: number, options?: PingHostOptions): Promise<boolean> {
  return isPortOpen(port, host, options);
}

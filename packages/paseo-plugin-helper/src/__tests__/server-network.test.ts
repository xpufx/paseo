import { describe, it, expect, afterAll } from "vitest";
import net from "node:net";
import { isPortOpen, findAvailablePort, pingHost } from "../server/network.js";

describe("server/network", () => {
  let testServer: net.Server;
  let testPort: number;

  it("finds an available port and starts a test server", async () => {
    testPort = await findAvailablePort(18000, 50);
    expect(testPort).toBeGreaterThanOrEqual(18000);

    testServer = net.createServer();
    await new Promise<void>((resolve) => {
      testServer.listen(testPort, "127.0.0.1", () => resolve());
    });
  });

  it("detects an open port with isPortOpen and pingHost", async () => {
    const open = await isPortOpen(testPort, "127.0.0.1");
    expect(open).toBe(true);

    const ping = await pingHost("127.0.0.1", testPort, { timeoutMs: 500 });
    expect(ping).toBe(true);
  });

  it("detects a closed port", async () => {
    const closedPort = 19999;
    const open = await isPortOpen(closedPort, "127.0.0.1", { timeoutMs: 200 });
    expect(open).toBe(false);
  });

  afterAll(async () => {
    if (testServer) {
      await new Promise<void>((resolve) => testServer.close(() => resolve()));
    }
  });
});

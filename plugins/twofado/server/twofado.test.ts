import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { listPending, mapAskOptions, submitSelection } from "./twofado";

const originalSocket = process.env.TWOFADO_SOCKET;

interface FakeDaemon {
  socketPath: string;
  requests: unknown[];
  close(): Promise<void>;
}

/** Stand up a unix-socket JSON-lines daemon that replies via `respond`. */
function startFakeDaemon(
  respond: (message: Record<string, unknown>) => unknown | undefined,
): Promise<FakeDaemon> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twofado-test-"));
  const socketPath = path.join(dir, "2fado.sock");
  const requests: unknown[] = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      const message = JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>;
      requests.push(message);
      const reply = respond(message);
      if (reply !== undefined) socket.write(JSON.stringify(reply) + "\n");
      socket.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              fs.rmSync(dir, { recursive: true, force: true });
              done();
            });
          }),
      });
    });
  });
}

let daemon: FakeDaemon | undefined;

beforeEach(() => {
  // Ensure the daemon socket env can never shadow an explicit socketPath.
  delete process.env.TWOFADO_SOCKET;
});

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  if (originalSocket === undefined) delete process.env.TWOFADO_SOCKET;
  else process.env.TWOFADO_SOCKET = originalSocket;
});

describe("mapAskOptions", () => {
  it("assigns stable index ids to plain string options", () => {
    expect(mapAskOptions(["A", "B"])).toEqual([
      { id: "0", label: "A" },
      { id: "1", label: "B" },
    ]);
  });

  it("returns undefined for empty or missing options", () => {
    expect(mapAskOptions([])).toBeUndefined();
    expect(mapAskOptions(undefined)).toBeUndefined();
  });
});

describe("listPending with an ask petition", () => {
  it("maps the daemon's snake_case ask fields to camelCase", async () => {
    daemon = await startFakeDaemon((message) => {
      if ("list" in message) {
        return {
          items: [
            {
              id: "rid-1",
              argv: [],
              uid: 1001,
              cwd: "/srv",
              expires_in: 80,
              kind: "ask",
              question: "Which wire format?",
              options: ["Envelope v5", "Peer-RPC seen-id LRU"],
              multi_select: true,
              allow_write_in: true,
              recommended_index: 2,
            },
          ],
        };
      }
      return undefined;
    });

    const result = await listPending({ socketPath: daemon.socketPath });
    expect(result.items[0]).toMatchObject({
      id: "rid-1",
      kind: "ask",
      question: "Which wire format?",
      multiSelect: true,
      allowWriteIn: true,
      recommendedIndex: 2,
    });
    expect(result.items[0].options).toEqual([
      { id: "0", label: "Envelope v5" },
      { id: "1", label: "Peer-RPC seen-id LRU" },
    ]);
  });
});

describe("submitSelection", () => {
  it("forwards the select op with the selection and index", async () => {
    daemon = await startFakeDaemon((message) => {
      if ("select" in message) return { selected: true };
      return undefined;
    });

    const result = await submitSelection({
      id: "rid-1",
      selection: "Envelope v5",
      selectionIdx: 0,
      socketPath: daemon.socketPath,
    });

    expect(result).toEqual({ selected: true });
    expect(daemon.requests).toContainEqual({
      select: {
        id: "rid-1",
        selection: "Envelope v5",
        selection_idx: 0,
        write_in: undefined,
        by: "paseo",
      },
    });
  });

  it("reports the daemon's error instead of a silent success", async () => {
    daemon = await startFakeDaemon((message) => {
      if ("select" in message) return { error: "unknown-request" };
      return undefined;
    });

    const result = await submitSelection({
      id: "rid-1",
      selection: "Envelope v5",
      socketPath: daemon.socketPath,
    });

    expect(result).toEqual({ selected: false, error: "unknown-request" });
  });

  it("rejects a missing id or selection before touching the socket", async () => {
    expect(await submitSelection({ id: "", selection: "x" })).toEqual({
      selected: false,
      error: "missing id or selection",
    });
  });
});

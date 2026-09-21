import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseConfiguredHosts,
  loadConfiguredHosts,
  readRegistry,
  mutateRegistry,
  startConfiguredHostsWatcher,
  stopConfiguredHostsWatcher,
} from "./registry.ts";

const RELAY_URL =
  "https://app.paseo.sh/#offer=eyJzZXJ2ZXJJZCI6InNydl9yZW1vdGUxMjMiLCJrZXkiOiJ4eXoifQ==";

describe("configured hosts parsing and discovery", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    stopConfiguredHostsWatcher();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createTempDir(): string {
    tempDir = mkdtempSync(join(tmpdir(), "x-comms-hosts-test-"));
    return tempDir;
  }

  it("parses array of host objects", () => {
    const json = JSON.stringify([
      {
        serverId: "srv_remote123",
        label: "gpu-box",
        endpoint: "tcp://192.168.1.100:6767",
        status: "online",
      },
      {
        serverId: "srv_relay456",
        label: "laptop",
        endpoint: RELAY_URL,
        status: "connecting",
      },
    ]);

    const result = parseConfiguredHosts(json);
    assert.equal(result.ok, true);
    assert.equal(result.hosts.length, 2);
    assert.equal(result.hosts[0].name, "gpu-box");
    assert.equal(result.hosts[0].value, "tcp://192.168.1.100:6767");
    assert.equal(result.hosts[0].status, "online");
    assert.equal(result.hosts[0].source, "configured-host");
    assert.equal(result.hosts[0].valid, true);

    assert.equal(result.hosts[1].name, "laptop");
    assert.equal(result.hosts[1].serverId, "srv_relay456"); // explicit serverId preferred
    assert.equal(result.hosts[1].status, "connecting");
    assert.equal(result.hosts[1].source, "configured-host");
  });

  it("parses object wrapper with hosts array", () => {
    const json = JSON.stringify({
      hosts: [
        {
          serverId: "srv_alpha",
          label: "alpha-node",
          endpoint: "10.0.0.1:6767",
        },
      ],
    });

    const result = parseConfiguredHosts(json);
    assert.equal(result.ok, true);
    assert.equal(result.hosts.length, 1);
    assert.equal(result.hosts[0].name, "alpha-node");
    assert.equal(result.hosts[0].value, "10.0.0.1:6767");
    assert.equal(result.hosts[0].valid, true);
  });

  it("parses dictionary map of hosts", () => {
    const json = JSON.stringify({
      "desktop-rig": {
        serverId: "srv_desktop",
        endpoint: "tcp://localhost:6767",
        status: "idle",
      },
      "pi-cluster": "tcp://pi.local:6767",
    });

    const result = parseConfiguredHosts(json);
    assert.equal(result.ok, true);
    assert.equal(result.hosts.length, 2);

    const desktop = result.hosts.find((h) => h.name === "desktop-rig");
    assert.ok(desktop);
    assert.equal(desktop.value, "tcp://localhost:6767");
    assert.equal(desktop.status, "idle");

    const pi = result.hosts.find((h) => h.name === "pi-cluster");
    assert.ok(pi);
    assert.equal(pi.value, "tcp://pi.local:6767");
  });

  it("marks invalid host endpoints and surfaces errors", () => {
    const json = JSON.stringify([
      {
        label: "bad-host",
        endpoint: "invalid protocol://not a host",
      },
      {
        label: "missing-endpoint",
      },
    ]);

    const result = parseConfiguredHosts(json);
    assert.equal(result.ok, true);
    assert.equal(result.hosts.length, 2);
    assert.equal(result.hosts[0].valid, false);
    assert.ok(result.hosts[0].error);
    assert.equal(result.hosts[1].valid, false);
    assert.equal(result.hosts[1].error, "missing endpoint / host value");
  });

  it("loadConfiguredHosts returns empty array for non-existent file", () => {
    const hosts = loadConfiguredHosts("/non/existent/hosts.json");
    assert.deepEqual(hosts, []);
  });

  it("readRegistry merges configured hosts with manual registry entries", () => {
    const dir = createTempDir();
    const registryPath = join(dir, "registry.json");
    const hostsPath = join(dir, "hosts.json");

    // Write manual registry
    writeFileSync(
      registryPath,
      JSON.stringify({
        manual1: "tcp://manual1:6767",
        colliding: "tcp://manual-colliding:6767",
      }),
    );

    // Write configured hosts
    writeFileSync(
      hostsPath,
      JSON.stringify([
        { label: "configured1", endpoint: "tcp://configured1:6767" },
        { label: "colliding", endpoint: "tcp://configured-colliding:6767" },
      ]),
    );

    const merged = readRegistry(registryPath, { hostsPath });
    assert.equal(merged.ok, true);
    assert.equal(merged.daemons.length, 3);

    const manualEntry = merged.daemons.find((d) => d.name === "manual1");
    assert.ok(manualEntry);
    assert.equal(manualEntry.source, "registry");

    const configuredEntry = merged.daemons.find((d) => d.name === "configured1");
    assert.ok(configuredEntry);
    assert.equal(configuredEntry.source, "configured-host");

    // Manual entry takes precedence on collision
    const collidingEntry = merged.daemons.find((d) => d.name === "colliding");
    assert.ok(collidingEntry);
    assert.equal(collidingEntry.value, "tcp://manual-colliding:6767");
    assert.equal(collidingEntry.source, "registry");
  });

  it("readRegistry without configured hosts returns only manual entries", () => {
    const dir = createTempDir();
    const registryPath = join(dir, "registry.json");
    const hostsPath = join(dir, "hosts.json");

    writeFileSync(registryPath, JSON.stringify({ manual1: "tcp://manual1:6767" }));
    writeFileSync(hostsPath, JSON.stringify([{ label: "conf1", endpoint: "tcp://conf1:6767" }]));

    const manualOnly = readRegistry(registryPath, { hostsPath, includeConfiguredHosts: false });
    assert.equal(manualOnly.daemons.length, 1);
    assert.equal(manualOnly.daemons[0].name, "manual1");
  });

  it("mutateRegistry modifies only the registry file and never saves configured hosts", () => {
    const dir = createTempDir();
    const registryPath = join(dir, "registry.json");
    const hostsPath = join(dir, "hosts.json");

    writeFileSync(registryPath, JSON.stringify({ existing: "tcp://existing:6767" }));
    writeFileSync(hostsPath, JSON.stringify([{ label: "conf1", endpoint: "tcp://conf1:6767" }]));

    const result = mutateRegistry(registryPath, (daemons) => ({
      ...daemons,
      added: "tcp://added:6767",
    }));

    assert.equal(result.saved, true);
    // Inspect on-disk file: must NOT contain conf1
    const onDisk = JSON.parse(readFileSync(registryPath, "utf8"));
    assert.deepEqual(onDisk, {
      existing: "tcp://existing:6767",
      added: "tcp://added:6767",
    });
  });

  it("startConfiguredHostsWatcher triggers reload callback when file is updated", async () => {
    const dir = createTempDir();
    const hostsPath = join(dir, "hosts.json");

    let changeTriggered = false;
    let detectedCount = 0;

    const stop = startConfiguredHostsWatcher(hostsPath, (hosts) => {
      changeTriggered = true;
      detectedCount = hosts.length;
    });

    try {
      // Write to hosts file
      writeFileSync(hostsPath, JSON.stringify([{ label: "watcher-test", endpoint: "127.0.0.1:9090" }]));

      // Give fs event loop a tick to process
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.equal(changeTriggered, true);
      assert.equal(detectedCount, 1);
    } finally {
      stop();
    }
  });
});

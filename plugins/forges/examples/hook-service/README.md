# Hook service (example)

The `forges` plugin reads and writes the forge API, but it does not receive
webhooks. Something has to turn "a label changed on `your-org/your-repo`" into a
message the Paseo daemon delivers to an agent. This directory is a **sanitized
skeleton** for that bridge: systemd unit, environment file, and a generic
script. See [`../../docs/workflow.md`](../../docs/workflow.md) §2 for the full
contract.

> **Not a supported configuration.** Replace every placeholder and review the
> TODOs in `hook-server.mjs` (secret rotation, durable queueing, coalescing,
> payload validation) before relying on it.

## Files

| File                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `hook-server.mjs`   | Generic listener: `POST /hook` + `POST /orchestrate`           |
| `forge-hook.service`| systemd unit for a host-wide deploy (many repos)               |
| `hook.env.example`  | Environment placeholders consumed by the script                |

## Option A — systemd (host-wide)

```sh
sudo install -d -o forge-hook -g forge-hook /opt/forge-hook /etc/forge-hook /var/lib/forge-hook
sudo cp hook-server.mjs /opt/forge-hook/
sudo cp hook.env.example /etc/forge-hook/hook.env   # then edit
sudo chmod 600 /etc/forge-hook/hook.env
sudo cp forge-hook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now forge-hook.service
systemctl status forge-hook.service
```

Then point the repo's webhook at `http://127.0.0.1:8099/hook`, set the same
secret, and send a `ping` event to verify delivery.

## Option B — Paseo workspace service

Run the same script as a managed workspace service instead of a host unit:

```jsonc
// paseo.json in the workspace/checkout
{
  "scripts": {
    "hook": { "type": "service", "command": "node plugins/forges/examples/hook-service/hook-server.mjs" }
  }
}
```

Paseo starts/stops it with the workspace and surfaces its logs. It only runs
while that workspace is up; a host-wide unit does not. Run one, not both.

## Registering an orchestrator

Until a repo has an orchestrator, deliveries for it are held. Register one from
the agent's own checkout over loopback (no secret needed):

```sh
curl -s -X POST http://127.0.0.1:8099/orchestrate \
  -H 'content-type: application/json' \
  -d '{"agentId":"<your-agent-id>","repo":"forge.example.com/your-org/your-repo"}'
```

Off-box callers must send the shared secret. The `repo` field is a
forge-qualified `host/owner/repo` key.

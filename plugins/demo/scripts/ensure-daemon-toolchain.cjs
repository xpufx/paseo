// Ensure the daemon host can start node/npm, failing fast with a readable
// error otherwise. Probes spawnability (not mere PATH resolvability)
// by replicating the daemon's own shell-less spawn.
const { spawnSync } = require("child_process");

const bins = [process.env.CHECK_BIN_NODE || "node", process.env.CHECK_BIN_NPM || "npm"];
let failed = false;
for (const b of bins) {
  const r = spawnSync(b, ["--version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) {
    console.error(
      `\nERROR: required binary '${b}' could not be started by the daemon host (this plugin requires node and npm — not a Paseo error; see the plugin README prerequisites)`,
    );
    failed = true;
  }
}
if (failed) process.exit(1);

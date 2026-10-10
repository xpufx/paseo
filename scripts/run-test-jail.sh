#!/usr/bin/env bash
# Run a command in an isolated rootless-Podman jail that mounts only the
# active worktree. Tests never touch host daemon state, ports, or config:
# no host home, ~/.paseo, or ~/.config is mounted, and the network is off.
#
# Usage: scripts/run-test-jail.sh <command> [args...]
#
# Env:
#   TEST_CONTAINER_IMAGE  image to run (default docker.io/library/node:22-bookworm-slim)
#   ALLOW_MAIN_TESTS=1    explicitly permit running from a main/master checkout
set -euo pipefail

# Prefer the self-contained Podman build on hosts that ship one.
PODMAN="podman"
if [[ -x /opt/podman/current/bin/podman ]]; then
	PODMAN="/opt/podman/current/bin/podman"
fi

# The jail mounts exactly this directory; refuse to bake the wrong checkout.
WORKTREE_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]] \
	&& [[ "${ALLOW_MAIN_TESTS:-0}" != "1" ]]; then
	echo "[test-jail] refusing to run tests on the '$CURRENT_BRANCH' checkout at $WORKTREE_DIR" >&2
	echo "[test-jail] create an isolated worktree branch, or set ALLOW_MAIN_TESTS=1 to override" >&2
	exit 1
fi

IMAGE="${TEST_CONTAINER_IMAGE:-docker.io/library/node:22-bookworm-slim}"

exec "$PODMAN" run --rm \
	--interactive \
	--network none \
	--user "$(id -u):$(id -g)" \
	--volume "$WORKTREE_DIR:/workspace:rw" \
	--workdir /workspace \
	--env HOME=/tmp \
	--env NODE_ENV=test \
	"$IMAGE" \
	"$@"

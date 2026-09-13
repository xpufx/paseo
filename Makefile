.PHONY: all doctor reload check test typecheck build clean help

# Default target: diagnostic freshness check
all: doctor

## doctor: Inspect helper compilation, version stamps, and live Paseo daemons
doctor:
	@node scripts/doctor-live.mjs

## reload: Auto-rebuild helper if stale, stamp version, and reload running daemons
reload:
	@node scripts/doctor-live.mjs --reload

## check: Run full typecheck and test suite across all packages and plugins
check: typecheck test

## typecheck: Run TypeScript compiler check across workspaces
typecheck:
	@npm run typecheck

## test: Run unit tests across workspaces
test:
	@npm test

## build: Build helper and compile plugin bundles
build:
	@npm run build --workspaces --if-present

## npm-push-helper-dry: Dry-run publish paseo-plugin-helper to npm
npm-push-helper-dry:
	@npm publish --workspace=packages/paseo-plugin-helper --access public --dry-run

## npm-push-helper: Publish paseo-plugin-helper to npm
npm-push-helper:
	@npm publish --workspace=packages/paseo-plugin-helper --access public

## npm-push-x-comms-dry: Dry-run publish @xpufx/paseo-x-comms to npm
npm-push-x-comms-dry:
	@npm publish plugins/x-comms/mcp --access public --dry-run

## npm-push-x-comms: Publish @xpufx/paseo-x-comms to npm
npm-push-x-comms:
	@npm publish plugins/x-comms/mcp --access public

## github-mirror: Synchronize target(s) to GitHub mirror (e.g. make github-mirror TARGET=top,helper DRY=1)
github-mirror:
	@node scripts/mirror-github.mjs $(if $(TARGET),--target=$(TARGET)) $(if $(PLUGIN),--target=$(PLUGIN)) $(if $(DRY),--dry-run)

## github-mirror-top-dry: Dry-run synchronize top plugin to GitHub mirror
github-mirror-top-dry:
	@node scripts/mirror-github.mjs --target=top --dry-run

## github-mirror-top: Synchronize top plugin and monorepo baseline to GitHub mirror
github-mirror-top:
	@node scripts/mirror-github.mjs --target=top

## github-mirror-helper-dry: Dry-run synchronize helper package to GitHub mirror
github-mirror-helper-dry:
	@node scripts/mirror-github.mjs --target=helper --dry-run

## github-mirror-helper: Synchronize helper package and monorepo baseline to GitHub mirror
github-mirror-helper:
	@node scripts/mirror-github.mjs --target=helper

## github-mirror-top-and-helper-dry: Dry-run synchronize top and helper to GitHub mirror
github-mirror-top-and-helper-dry:
	@node scripts/mirror-github.mjs --target=top,helper --dry-run

## github-mirror-top-and-helper: Synchronize top and helper to GitHub mirror
github-mirror-top-and-helper:
	@node scripts/mirror-github.mjs --target=top,helper

## help: Display this help message
help:
	@echo "Paseo Monorepo Developer Commands:"
	@echo "  make doctor    - Inspect helper dist sync and running daemon freshness"
	@echo "  make reload    - Auto-rebuild helper, stamp git versions, and reload daemons"
	@echo "  make check     - Run monorepo typecheck and test suite"
	@echo "  make typecheck - Run tsc across all workspaces"
	@echo "  make test      - Run unit tests across all workspaces"
	@echo "  make build     - Build packages and plugins"

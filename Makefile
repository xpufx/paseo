.PHONY: all doctor reload check test typecheck conformance build clean help

# Default target: diagnostic freshness check
all: doctor

## doctor: Inspect helper compilation, version stamps, and live Paseo daemons
doctor:
	@node scripts/doctor-live.mjs

## reload: Auto-rebuild and vendor helper, stamp version, and reload affected daemons
reload:
	@node scripts/doctor-live.mjs --reload

## check: Run typecheck, tests, and plugin UI conformance across the monorepo
check: typecheck test conformance

## typecheck: Run TypeScript compiler check across workspaces
typecheck:
	@npm run typecheck

## test: Run unit tests across workspaces
test:
	@npm test

## conformance: Check helper UI conformance for every plugin
conformance:
	@node packages/paseo-plugin-helper/bin/paseo-plugin-helper.js conformance --all plugins --strict

## build: Build helper and compile plugin bundles
build:
	@npm run build --workspaces --if-present

## vendor-sync: Re-copy helper src into top vendor trees (Track B, #71)
vendor-sync:
	@node scripts/vendor-sync.mjs

## vendor-link: Symlink plugin vendor trees to live helper src for dev (never commit)
vendor-link:
	@node scripts/vendor-sync.mjs --link

## vendor-check: Fail if vendor trees drifted from helper src
vendor-check:
	@node scripts/vendor-sync.mjs --check

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

## cafe-submit: Emit Biome-clean paseo.cafe registry JSON (e.g. make cafe-submit PLUGIN=top CATEGORIES=monitoring)
cafe-submit:
	@node scripts/paseo-cafe-submit.mjs --plugin=$(PLUGIN) --categories=$(CATEGORIES) --write

## help: Display this help message
help:
	@echo "Paseo Monorepo Developer Commands:"
	@echo "  make doctor    - Inspect helper dist sync and running daemon freshness"
	@echo "  make reload    - Auto-rebuild helper, stamp git versions, and reload daemons"
	@echo "  make check     - Run typecheck, tests, and plugin UI conformance"
	@echo "  make typecheck - Run tsc across all workspaces"
	@echo "  make test      - Run unit tests across all workspaces"
	@echo "  make conformance - Check helper UI conformance for every plugin"
	@echo "  make build     - Build packages and plugins"
	@echo "  make cafe-submit PLUGIN=top CATEGORIES=monitoring - Emit Biome-clean paseo.cafe registry JSON"

.PHONY: all doctor reload check test typecheck conformance build clean help migrate-numberless-labels packages-build packages-publish-dry packages-publish

# Default target: diagnostic freshness check
all: doctor

## doctor: Inspect helper compilation, version stamps, and live Paseo daemons
doctor:
	@node scripts/doctor-live.mjs

## reload: Auto-rebuild helper, stamp version, and reload affected daemons
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

## board-hygiene: Flag board issues whose labels contradict their state (#217)
board-hygiene:
	@node scripts/board-hygiene.test.mjs
	@node scripts/board-hygiene.mjs

## migrate-numberless-labels: Test and dry-run the numeric-to-numberless label migration (#1007)
migrate-numberless-labels:
	@node scripts/migrate-numberless-labels.test.mjs
	@node scripts/migrate-numberless-labels.mjs

## build: Build helper and compile plugin bundles
build:
	@npm run build --workspaces --if-present

## stamp: Refresh plugin version stamps explicitly (typecheck/test no longer stamp)
stamp:
	@for p in demo top mcp-tools; do npm run stamp --prefix plugins/$$p; done

## npm-stage: Stage all plugin tarballs (agent/CI uploads the artifact; no 2FA)
npm-stage:
	@node scripts/publish-npm.mjs --stage

## npm-publish-dry: Print the human npm publish commands from the staged tarballs
npm-publish-dry:
	@node scripts/publish-npm.mjs --publish --dry-run

## npm-publish: Human publish of the staged tarballs (prompts for npm 2FA/OTP)
npm-publish:
	@node scripts/publish-npm.mjs --publish

## npm-publish-test: Unit-test the stage/publish flow logic
npm-publish-test:
	@node scripts/publish-npm.test.mjs

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

## packages-build: Build all headless backend packages and plugin-ui
packages-build:
	@npm run build --workspace=packages/backend/tickets
	@npm run build --workspace=packages/backend/fleet
	@npm run build --workspace=packages/backend/hook
	@npm run build --workspace=packages/mcp-gateway
	@npm run build --workspace=packages/paseo-plugin-ui

## packages-publish-dry: Dry-run publish headless packages
packages-publish-dry: packages-build
	@npm publish --workspace=packages/backend/tickets --access public --dry-run
	@npm publish --workspace=packages/backend/fleet --access public --dry-run
	@npm publish --workspace=packages/backend/hook --access public --dry-run
	@npm publish --workspace=packages/mcp-gateway --access public --dry-run
	@npm publish --workspace=packages/paseo-plugin-ui --access public --dry-run

## packages-publish: Publish headless packages to npm
packages-publish: packages-build
	@npm publish --workspace=packages/backend/tickets --access public
	@npm publish --workspace=packages/backend/fleet --access public
	@npm publish --workspace=packages/backend/hook --access public
	@npm publish --workspace=packages/mcp-gateway --access public
	@npm publish --workspace=packages/paseo-plugin-ui --access public

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
	@echo "  make check     - Run typecheck, tests, and plugin UI conformance"
	@echo "  make typecheck - Run tsc across all workspaces"
	@echo "  make test      - Run unit tests across all workspaces"
	@echo "  make conformance - Check helper UI conformance for every plugin"
	@echo "  make build     - Build packages and plugins"
	@echo "  make npm-stage  - Stage plugin tarballs for an agent/CI upload (no 2FA)"
	@echo "  make npm-publish - Human publish of staged tarballs (prompts for 2FA/OTP)"
	@echo "  make npm-publish-dry - Print the human publish commands without publishing"

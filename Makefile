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

## help: Display this help message
help:
	@echo "Paseo Monorepo Developer Commands:"
	@echo "  make doctor    - Inspect helper dist sync and running daemon freshness"
	@echo "  make reload    - Auto-rebuild helper, stamp git versions, and reload daemons"
	@echo "  make check     - Run monorepo typecheck and test suite"
	@echo "  make typecheck - Run tsc across all workspaces"
	@echo "  make test      - Run unit tests across all workspaces"
	@echo "  make build     - Build packages and plugins"

# Architectural Investigation: Remote Repository Support Without Local Clones

## 1. Overview and Problem Statement

In autonomous multi-agent engineering setups, a fleet often needs to monitor, triage, and dispatch work across dozens of software repositories across an organization. Today, many developer workflows assume each managed repository exists as a complete, pre-cloned local Git repository in the primary daemon workspace tree.

However, requiring a permanent local clone for every repository creates significant friction:
- **Storage bloat**: Dozens or hundreds of repositories consume gigabytes of disk space, even when inactive.
- **Maintenance overhead**: Daemons must continually fetch, prune, and reconcile branches across multiple remotes.
- **Resource constraints**: Edge or resource-constrained nodes running a Paseo daemon may only need to triage or execute occasional tasks for distant repositories.
- **Security & isolation**: Retaining long-lived full checkouts of sensitive repositories increases the attack surface if an agent or runner is compromised.

This document investigates how Paseo and the `uppidi-fleet` plugin can support **remote repositories** seamlessly without requiring persistent local clones.

---

## 2. Remote Metadata & Work Queue via Forgejo API

Rather than querying local Git logs or worktrees to discover issues, pull requests, and commit states, the fleet control plane queries the Forgejo REST API directly.

### 2.1 API Ingestion Architecture
- **Issues & Pull Requests**:
  `GET /api/v1/repos/{owner}/{repo}/issues?state=open&type=all`
  - Fetches backlog items, labels (`state/*`, `attention/*`), and review milestones without touching Git storage.
- **Branch & Ref Metadata**:
  `GET /api/v1/repos/{owner}/{repo}/branches/{branch}`
  - Verifies head commits, branch protection rules, and mergeability before allocating agents.
- **Webhook Ingestion**:
  Forgejo delivers push, issue, and PR events to the bundled Hook Router (`/forgejo`).
  - Hook payloads contain full commit context, diff URLs, and attributed metadata.
  - The fleet router updates in-memory queue depths and dispatches tasks without needing a local Git mirror.

### 2.2 Client Caching & Rate-Limit Strategy
- **Short-Lived Memory Cache (TTL ~15–30s)**:
  Repeated queries from cockpit UI surfaces (e.g. Work Queue and Lineage Tree) read from in-memory cache to avoid rate limiting.
- **Conditional HTTP Headers**:
  Use `ETag` and `If-None-Match` on Forgejo API calls to return `304 Not Modified` when queues haven't changed.
- **Per-Repository Polling Buckets**:
  Active repositories (those with open triage issues or active agents) poll at short intervals (e.g., 5-10s), while passive repositories back off to 60s or purely event-driven webhook invalidation.

---

## 3. Dispatch Mechanisms for Remote Repositories

When an issue is selected or an autonomous agent is dispatched to execute work on a remote repository, code must be inspected, edited, and tested. Two primary dispatch models are viable:

### Model A: On-Demand Shallow Clone to Cache Directory
In this model, the local daemon creates an ephemeral, shallow clone only when an agent begins execution.

- **Mechanism**:
  1. Daemon receives dispatch command for repository `{owner}/{repo}` on issue `#N`.
  2. Daemon queries cache path: `~/.paseo/cache/repos/{owner}/{repo}.git` (bare or shallow mirror).
  3. If not present, daemon performs a single-branch shallow clone:
     ```bash
     git clone --depth 1 --filter=blob:none https://<forge-host>/<owner>/<repo>.git <cache-dir>
     ```
  4. Worktree is created off the shallow cache for the issue branch:
     ```bash
     git worktree add ~/.paseo/worktrees/<workspace-id>/<branch-name> -b <branch-name> origin/main
     ```
  5. Upon task completion, PR submission, and cleanup, the ephemeral worktree is pruned. The bare cache can be garbage-collected based on LRU eviction policies.

### Model B: Cross-Daemon Dispatch Over `x-comms`
In a distributed fleet, repositories may be homed on specific specialized nodes (e.g., build servers with native toolchains, macOS nodes for iOS, or GPUs for ML models).

- **Mechanism**:
  1. The central Cockpit / Front Desk identifies the repository home or suitable execution target via the fleet roster.
  2. The orchestrator packages the prompt and execution envelope into an `x-comms` RPC message.
  3. The message is routed to the remote node daemon via secure TLS/mesh transport.
  4. The remote daemon, which already maintains the repository or appropriate execution environment, spawns the worker agent locally.
  5. State updates, log streams, and status lights stream back to the central cockpit over `x-comms` subscriptions.

---

## 4. Trade-Off Analysis

| Metric | Persistent Local Clones (Status Quo) | Model A: Ephemeral Shallow Clone | Model B: Cross-Daemon `x-comms` Dispatch |
| :--- | :--- | :--- | :--- |
| **Initial Dispatch Latency** | Instant (0–1s) | Low (2–8s for shallow clone) | Sub-second RPC latency; execution runs where repo lives |
| **Local Disk Footprint** | High (GBs per repo, grows indefinitely) | Minimal (bounded LRU cache; blobs pruned on demand) | Zero on control plane; distributed across runner nodes |
| **Network Consumption** | High upfront; periodic git fetches | On-demand only; blobs fetched only when accessed | Minimal control traffic; code stays on target node |
| **Security & Isolation** | Low (all repos co-located on single host) | High (isolated worktrees, short-lived tokens per job) | Highest (compartmentalized daemons, zero control plane checkout) |
| **Implementation Complexity** | Low | Moderate (requires cache eviction & partial clone management) | Moderate-to-High (requires x-comms message schema & routing table) |

---

## 5. Rollout Recommendations & Phased Roadmap

### Phase 1: Global Repo Discovery & Remote Backlog (Completed in #425)
- Cockpit provides unified global repository dropdown.
- Backlog, metrics, and work queue query remote Forgejo API without requiring local Git clones.
- Selected issues and agent rosters reflect all enrolled organization repositories.

### Phase 2: Ephemeral Shallow Caching (Model A)
- Implement `git-cache-manager` in server backend:
  - Cache location: `~/.paseo/cache/repos/<owner>/<repo>`.
  - Use Blobless/Treeless clones (`--filter=blob:none`) to minimize network bandwidth.
  - Implement LRU eviction with a configurable quota (e.g., max 5GB or 10 inactive repos).
- Dispatch button creates on-demand worktree from cache without manual clone commands.

### Phase 3: Distributed Fleet Routing via `x-comms` (Model B)
- Integrate repository routing table into `uppidi-fleet` daemon config.
- When dispatching to a remote repository registered with an external daemon, route the task through `x-comms` rather than attempting a local clone.
- Surface remote execution telemetry and status lights seamlessly in the central Cockpit Lineage Tree.

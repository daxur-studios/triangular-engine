---
type: Plan
title: "Fast Cross-Repo Library Development and Sync"
description: "Sub-2-second development sync between triangular-engine and consumer apps without .tgz or symlinks."
timestamp: 2026-11-02T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/082_fast-library-sync.md
map_schema: 1
document_id: plan-082
initiative_id: "fast-library-sync"
performance: []
---

# Plan 082: Fast Cross-Repo Library Development and Sync

Status: **in_progress**. Evidence and decisions: [ER 082](/docs/engineering-records/082_fast-library-sync.md).

<!-- tri:scope -->

## Intended outcome

Enable sub-2-second development feedback cycles when modifying `triangular-engine` for consuming applications (specifically `brunos-space-program`) as well as the internal `triangular-workspace` demo app.

### Constraints & Invariants
- **No symlinks or directory junctions:** Symlinks cause Node module resolution to climb into `triangular-workspace/node_modules/`, resolving duplicate instances of `@angular/core` and `three.js`. This triggers `NG0203` (DI injection failure) and breaks Three.js `instanceof` checks. Symlinks also suffer from Windows permission constraints and watcher fragility.
- **No `.tgz` overhead during active iteration:** Rebuilding with `ng-packagr`, running `npm pack`, copying tarballs, and running `npm install` takes 30–60+ seconds per edit. The `.tgz` workflow remains the formal distribution and pre-commit verification standard, but should not block rapid dev iteration.
- **Angular 20 compatibility:** Consuming apps use `@angular/build:application` (Vite/esbuild) and `@angular/build:dev-server`. Solutions must respect Vite dependency pre-bundling rules.

## Phases and acceptance

- **fls-canary** — Verify Angular 20 `@angular/build:dev-server` `prebundle.exclude` behavior with physical `node_modules` modifications in BSP. Acceptance: Modifications to physical files in `brunos-space-program/node_modules/triangular-engine` trigger an immediate rebuild in `@angular/build:dev-server` with 0 errors and push a live reload to clients.
- **fls-daemon-sync** — Implement multi-app library synchronization at the orchestrator layer in Daxur Daemon (`daxur app sync-lib` and automatic watcher fanout in `LocalAppWatcher`). Acceptance: Public repos remain generic (`triangular-workspace` runs standard `ng build triangular-engine --watch --configuration development`). When built output changes, the daemon automatically fans out physical copies to all active/live apps in `local-apps.json` that depend on the library.
- **fls-docs** — Document the generic multi-app workflow, recording rejection of private consumer coupling in public repos. Acceptance: Plans and engineering records reflect daemon-level multi-app fanout and pass `npm run test:docs:records`.

## Relationships

<!-- /tri:scope -->

## Current phase status

| Phase           | State |
| --------------- | ----- |
| fls-canary      | done  |
| fls-daemon-sync | done  |
| fls-docs        | done  |

<!-- tri:review version="1" scope-hash="64fe7c5916043f076da6ec61db3f9b2d90fe3d009e024e3441ef1436fbb35c62" reviewed="2026-11-02" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="fls-daemon-sync" blocks="none" state="resolved" -->

- [x] Where should the library syncing mechanism live?
  - Why it matters: `triangular-workspace` is a public open-source repository. Hardcoding private consumer repository names, scripts, or paths into public libraries pollutes open source code and fails to scale to the 20+ other apps in the workspace.
  - Next action: Keep `triangular-workspace` completely generic and decoupled. Centralize all library-to-app syncing into `Daxur-Daemon` (`daxur app sync-lib` and `LocalAppWatcher`).
  - Resolution: Centralized in Daxur Daemon, automatically propagating built outputs to all active/live apps in `local-apps.json` without any private repo references in public libraries.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

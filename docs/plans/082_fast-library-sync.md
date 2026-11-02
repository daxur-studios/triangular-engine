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
- **fls-script** — Implement a debounced watch-and-sync script (`scripts/sync-to-bsp.mjs`) and npm run target (`dev:bsp`) in `triangular-workspace`. Acceptance: Running `npm run dev:bsp` launches incremental library watching and mirrors built `dist/triangular-engine` files into `brunos-space-program/node_modules/triangular-engine`. An edit in the engine compiles and updates BSP in <3 seconds without manual intervention.
- **fls-docs** — Document the developer workflow in both repositories, detailing the difference between live dev sync and formal `.tgz` package updates. Acceptance: Plans, engineering records, and repository README / developer scripts link reciprocally and pass `npm run test:docs:records`.

## Relationships

<!-- /tri:scope -->

## Current phase status

| Phase      | State |
| ---------- | ----- |
| fls-canary | done  |
| fls-script | done  |
| fls-docs   | done  |

<!-- tri:review version="1" scope-hash="636cecfc650335a54f3a6c6a5d46255adfb9b80c7a7a1749d2d0fec70370afd5" reviewed="2026-11-02" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="fls-script" blocks="none" state="resolved" -->

- [x] Should `sync-to-bsp.mjs` delete extraneous files or perform additive updates only?
  - Why it matters: Full directory mirroring can momentarily remove entry files if done naively, which might trigger brief compile errors during build passes.
  - Next action: Implement additive copying with `cpSync({ recursive: true, force: true })` after a 150ms debounce following `ng-packagr` output completion.
  - Resolution: Additive copying with `cpSync({ recursive: true, force: true })` avoids deleting entry files mid-turn, keeping Vite stable.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

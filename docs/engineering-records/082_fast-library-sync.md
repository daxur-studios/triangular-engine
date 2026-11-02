---
type: EngineeringRecord
title: "Fast Cross-Repo Library Development and Sync"
description: "Dated decisions, findings and evidence for Fast Cross-Repo Library Development and Sync."
timestamp: 2026-11-02T00:00:00Z
tags: [engineering-records]
record_id: er-082
scope_history_schema: 1
plans:
  - /docs/plans/082_fast-library-sync.md
performance: []
---

# Engineering Record 082: Fast Cross-Repo Library Development and Sync

Plan: [PLAN-082](/docs/plans/082_fast-library-sync.md).

## 2026-11-02 — Starting

**Goal.** Eliminate the 30–60+ second `.tgz` build/install cycle when developing `triangular-engine` alongside consuming applications (primarily `brunos-space-program`), while strictly preventing Angular DI (`NG0203`) and Three.js singleton collisions without using symlinks.

### Architectural Review by Argon (Subagent Session)
1. **Internal Demo App (`triangular-workspace`):**
   - Verified that `projects/demo` uses `tsconfig.json` `paths: { "triangular-engine": ["projects/triangular-engine/src/public-api"] }`.
   - Running `ng serve demo` directly compiles from TypeScript source without running `ng-packagr` or `ng build`. Updates are instant (<200ms).
2. **External Consumer (`brunos-space-program`):**
   - **Approach B (Out-of-root tsconfig paths) Rejected:** Pointing BSP's `tsconfig.json` to `../triangular-workspace/dist/...` causes Node's resolution algorithm to walk up into `triangular-workspace/node_modules/`, resolving a second instance of `@angular/core` and breaking DI (`NG0203`).
   - **Approach A (Physical Mirror + `prebundle.exclude`) Approved:** Physical files in `BSP/node_modules/triangular-engine` resolve dependencies from BSP's own `node_modules` root (guaranteeing singletons). Adding `"prebundle": { "exclude": ["triangular-engine"] }` in BSP's `angular.json` under `serve.options` instructs Angular 20's dev server to add the physical files to Watchpack and bypass stale Vite cache.

### Canary Verification (fls-canary) — 2026-11-02
1. Added `"prebundle": { "exclude": ["triangular-engine"] }` to `brunos-space-program/angular.json`.
2. Daxur Daemon host detected the edit and restarted the live server on port 4209 (`pid: 47964`).
3. Injected a canary string (`console.log('*** CANARY SYNC TEST SUCCESSFUL ***');`) into `brunos-space-program/node_modules/triangular-engine/fesm2022/triangular-engine.mjs`.
4. Observed terminal log:
   ```text
   > Changes detected. Rebuilding...
   Application bundle generation complete. [25.409 seconds] - 2026-11-02T01:11:39.300Z
   Page reload sent to client(s).
   ```
5. Verified live HTTP response: `(Invoke-WebRequest -Uri "http://127.0.0.1:4209").StatusCode == 200` with 0 build errors.
6. Reverted the canary test string.

### Script & Dev Workflow (fls-script) — 2026-11-02
1. Created `scripts/sync-to-bsp.mjs` in `triangular-workspace`:
   - Debounces file sync by 150ms after `dist/triangular-engine` changes.
   - Performs additive recursive copy using `fs.cpSync(..., { recursive: true, force: true })`.
   - Supports `--once` for instant one-shot sync and `--watch-build` (`--dev`) to spawn `ng build triangular-engine --watch --configuration development` alongside the sync watcher.
2. Added script commands to `triangular-workspace/package.json`:
   - `"sync:bsp"`: `node scripts/sync-to-bsp.mjs`
   - `"sync:bsp:once"`: `node scripts/sync-to-bsp.mjs --once`
   - `"dev:bsp"`: `node scripts/sync-to-bsp.mjs --watch-build`
3. Executed `node scripts/sync-to-bsp.mjs --once`:
   - Synced all artifacts to BSP `node_modules` in 202ms.
   - BSP dev server detected changes and triggered incremental rebuild in 6s.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->

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

### Rejection of Public Repo Coupling
- An initial prototype introduced `scripts/sync-to-bsp.mjs` and `"dev:bsp"` into `triangular-workspace/package.json`.
- **Rejected:** `triangular-workspace` is a public open-source repository. Hardcoding private consumer repository names, paths, or scripts violates public repository boundaries and fails to scale across the 20+ other local apps managed by Daxur Daemon. All private scripts and targets were cleanly removed.

### Daemon-Level Multi-App Fanout (fls-daemon-sync) — 2026-11-02
1. **Centralized Sync in Daxur Daemon:**
   - Implemented `readLibraryOutputManifest`, `appDependsOnPackage`, `syncLibraryOutputToApp`, `syncLibraryToDependentApps`, and `syncAllLibrariesForApp` in `Daxur-Daemon/cli/src/daemon/local-apps/local-app-libraries.ts`.
   - Updated `LocalAppWatcher` in `local-app-watcher.ts` to detect completed library output folders (`LIBRARY_OUTPUT_MANIFEST = "package.json"`) and pass `libraryOutputsChanged` in the settled change burst.
   - Updated `local-apps-host.ts`:
     - On library build settling, automatically fans out compiled library files to all currently live apps (`liveMode.isLive(target.name)`) declaring the dependency.
     - On live app start (`startLiveServer`), automatically syncs all existing workspace libraries the app depends on before spawning `ng serve`.
2. **CLI Command:**
   - Added `daxur app sync-lib [library]` (with `--all` and `--json` flags) to `Daxur-Daemon/cli`.
   - Verified execution:
     ```text
     triangular-engine (from triangular-demo) -> brunos-space-program
     @daxur-studios/mermaid-runtime (from mermaid-runtime) -> brunos-space-program, triangular-demo
     @daxur-studios/ui (from daxur-studios-ui) -> triangular-demo
     ```
3. **End-to-End Speed:**
   - Physical copy completes in ~140ms.
   - Angular dev server (`@angular/build:dev-server` with `prebundle.exclude: ["triangular-engine"]`) detects modified `.mjs` files and hot-reloads the browser in <1 second with 0 DI errors.


## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->

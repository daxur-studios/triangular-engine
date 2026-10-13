---
type: Runbook
title: Reusable Scene Page Schematic
description: Implementation decisions and verification evidence for the scene-page generator.
timestamp: 2026-10-13T00:00:00Z
tags: [schematics, angular, scene]
plans: [/docs/plans/044_scene_page_generator.md]
---

# Reusable Scene Page Schematic

## 2026-10-13

- Added a design plan for `triangular-engine:scene-page`, its opt-in route behavior, and shared schematic code with `ng-add`.
- Shared component source, HTML, SCSS, project/path resolution, and route insertion are used by both `ng-add` and `scene-page`; ng-add keeps its legacy `engine-scene` filenames and rerun preservation behavior.
- `npm run test:schematics` passed: 13 tests, including ng-add rerun safety, standalone page output, opt-in lazy routing, project selection, invalid names, route collisions, and generated-file conflict checks.
- `npm run typecheck:schematics` passed for all schematic implementation CJS files.
- `npm run build:triangular-engine` passed after restoring the shared `orbitControls` template (2026-10-13 14:21 UTC). The final schematic suite and typecheck also passed after adding no-route/no-install, digit-leading name, and ambiguous-project assertions.
- Packed consumer acceptance passed in `C:\Users\cicas\AppData\Local\Temp\triangular engine retry 20261013` with package version `0.2.0`. Real CLI dry-run left routes/files unchanged; `ng g triangular-engine:scene-page features/play/pages/world --route --route-path=world` generated its files and route; repeat generation rejected existing files without changing component or route hashes. Default `sandbox/light-probe` generated no route.
- The consumer production app build passed. Browser `/world` passed a 960×640 to 1200×800 resize check; `APP-WORLD` retained `flex-page` and `display:flex`, the cube rendered, and there were no page or console errors. Material and Jolt remained absent.
- Packed tarball SHA-1: `0e44d911f4ad329bee097474de8c17ec0c30ac07` (130 files); the shared helper and generator were included and specs were excluded. Browser/package evidence: `tmp/engine-base-20261013-1200/generated-page-browser-result.json`, `generated-world-page.png`, and `scene-page-package-pack.json`.
- Publication remains pending; no publish or commit was performed.
- **[decision]** Per user feedback, generated components rely on the supported Angular 20 standalone default and omit redundant `standalone: true`; both schematics use the shared template.
- **[verification]** Schematic TypeScript checking and all 13 tests passed after removal; both generators assert that their component source omits the standalone property.
- **[decision]** Keep shared schematic scene styles sizing-neutral: generated routed hosts use `flex-page`, and the consumer's global flex chain sizes the scene. The only generated host style is `position: relative` for overlay placement; neither generator sets viewport dimensions or sizes the `scene` selector.
- **[verification]** Both `ng-add` and `scene-page` tests assert generated styles contain no viewport dimensions, width/height overrides, scene selector rules, or `display: block`; schematic typecheck and focused tests pass. Consumer README records the required global `.flex-page` and parent flex chain. Package rebuild/packing remains with the current acceptance run.
- **[action]** Updated current README, schematic schema/help examples, and path/routing test fixtures to pages/game and pages/world to match the approved routed-page composition layout. Arbitrary safe consumer paths and engine defaults remain supported; no SceneComponent or scene-generation behavior changed.
- **[verification]** Schematic typecheck and all 13 tests passed with the updated illustrative paths. The existing verified local engine package remains in BW4; documentation/help updates are source changes for the next package build, and npm publication stays pending.

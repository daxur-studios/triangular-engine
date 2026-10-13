---
type: Runbook
title: Optional Scene Tree and Game Install — Runbook
description: Decisions and package-consumer evidence for the optional Material UI boundary.
timestamp: 2026-10-13T00:00:00Z
plans: [/docs/plans/043_optional_scene_tree_and_game_install.md]
tags: [packaging, material, scaffolding, scene-tree]
---

# Optional Scene Tree and Game Install — Runbook

## 2026-10-13

- **[finding]** Core Engine UI/module/export paths import Scene Tree, which imports Material Menu. Hiding the panel does not remove the package dependency; Portal Layout independently needs CDK.
- **[decision]** Move the panel to `triangular-engine/scene-tree`, with a provider for a core UI component token. Retain `showSceneTree` as the visibility flag after opt-in; leave SceneComponent layout unchanged.
- **[finding]** The directly imported RxJS dependency is absent from package peer metadata. The workspace builds against Jolt `0.38.0`, while its library peer says `^1.0.1`; treat physics compatibility as a separate release prerequisite.
- **[action]** Moved Scene Tree into its own entry point, added `provideSceneTree()` and the core component token, marked Material optional, and declared RxJS. The existing `showSceneTree` option now renders the supplied optional panel; SceneComponent remains unchanged.
- **[verification]** Three focused Engine UI tests passed in ChromeHeadless: no adapter is safe, an adapter inherits the owning scene injector, and toggling visibility removes the panel. The existing CJS schematic's TypeScript check also passed.
- **[verification]** The production library built with the new secondary entry point. A fresh Angular 20 app installed the packed engine via `ng add` and published Portal Layout `0.0.1`; its build passed with Material, Jolt, and Rapier absent.
- **[verification]** Browser checks rendered the cube without page errors at 960×640 and resized its canvas to 1200×800; the route host remained `flex-page`/`display: flex`. Rerunning `ng add` retained one route and an edited template marker.
- **[finding]** Angular CLI rejects `ng new` when invoked through a CLI inside an existing workspace; absolute `--directory` also produced an invalid Windows path. The successful fixture used pinned CLI 20.3.23 through npm outside the workspace with a relative new-directory name — apply this to future generator trials.
- **[verification]** Copying the consumer without node_modules/dist/cache to another path and running `npm ci` succeeded using the project-relative engine tarball and public peers; optional UI checks run in this copy.
- **[verification]** The copied base built before adding Material. After installing Material `20.2.14` and configuring `provideSceneTree()`, its build/browser checks passed, including selecting a mesh and opening the Material menu with no browser or console errors.
- **[finding]** A separate consumer with the declared public Jolt `1.0.1` failed Angular's browser build because its WASM-compat bundle imports `node:module`. The README also had stale sphere inputs; correct the example and verify public `0.38.0` before aligning the declared peer/workspace setup.
- **[finding]** Public `0.38.0` has the equivalent Node-only `module` import. The demo already externalizes `module`; fresh browser apps need both names excluded when Jolt is selected. Physics itself ran with that configuration, but eager LoaderService initialization exposed missing `/draco/` assets.
- **[action]** Extend `ng add` with idempotent Draco/engine asset mappings and an opt-in `--physics=jolt` package/build setup. The sample remains a core scene; physics pages use the optional module and route guard. No global `process` replacement or Node polyfill is needed.
- **[action]** Add caller-selected component/route paths, insertion before wildcard fallbacks, and explicit route collision/path validation. Seven schematic tests passed; tests are excluded from the published schematic assets.
- **[verification]** The workspace now builds against registry Jolt `1.0.1`, matching the existing `^1.0.1` peer. Packed `ng add --physics=jolt` automatically resolved `1.1.0`, mapped assets and Node externals, and generated `features/play/pages` at `/play`; its build passed without Material or Rapier.
- **[verification]** The Jolt browser trial passed with no page/console errors: two bodies initialized, the ball moved from y=5 to y≈0.5, and one contact was recorded. The earlier bundling failure was missing browser setup, rather than proof of an incompatible physics API.
- **[verification]** A second independent Angular consumer was created in a directory with spaces, then installed the packed engine with `--path=features/play/pages --route-path=play` and no physics. Its production build passed; browser checks confirmed a `flex-page` host, canvas sizing at 960×640 and 1200×800, and no page/console errors.
- **[verification]** Final CJS type checking and all seven schematic tests passed, followed by the production library build. The packed `triangular-engine@0.2.0` contains 127 files, excludes schematic tests, exports `/scene-tree`, declares RxJS, and keeps Material optional with no core Material import. Package SHA-1: `a853c602e380134632cd61bf0b6fe515e1708d5d`; npm publish dry-run passed. Evidence is in ignored `tmp/engine-base-20261013-1200/`.
- **[constraint]** No engine publication was performed. The package represents the current shared checkout, including separate ongoing engine work; coordinate the complete release scope before uploading. These focused checks establish installation/layout/optional UI/basic physics behavior, not an audit of every engine feature or the future Daxur generator.

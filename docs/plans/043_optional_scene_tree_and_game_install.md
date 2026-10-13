---
type: Plan
title: Optional Scene Tree and Game Install
description: Remove Material from core, declare required peers, and prove the packed engine in a fresh Angular consumer.
timestamp: 2026-10-13T00:00:00Z
status: done
runbook: /docs/runbook/043_optional_scene_tree_and_game_install.md
tags: [packaging, material, scaffolding, scene-tree]
---

# Optional Scene Tree and Game Install

Make Material optional through a separate Scene Tree entry point. Keep CDK, Angular Forms, Portal Layout, BVH, Dexie, and RxJS in the base; preserve the scene's flex contract. [Trace](/docs/runbook/043_optional_scene_tree_and_game_install.md#2026-10-13).

- [x] Move Scene Tree into an optional entry point and provide its component to core UI through a token; `showSceneTree` controls visibility after opting in.
- [x] Mark Material optional, declare RxJS, and align docs/export paths.
- [x] Run focused UI adapter tests, build/pack the library, and type-check the existing CJS schematic.
- [x] Generate/install a fresh Angular consumer using the packed engine and published Portal Layout; build and render without Material/physics packages.
- [x] Prove opt-in Scene Tree renders after adding Material and its provider.
- [x] Automate assets, opt-in Jolt browser/package setup, and custom component/route placement; verify rerun/collision behavior with focused schematic tests.
- [x] Align workspace Jolt to registry `1.0.1`; packed opt-in consumer resolved `1.1.0` and passed build/falling-body/contact checks with decoder assets present.
- [x] Finish the independent spaced-path base retry, record the final package evidence, and prepare a publication candidate. Actual publication and review of separate ongoing changes in the shared checkout remain release work; a broader game physics or performance audit is outside these installation checks.

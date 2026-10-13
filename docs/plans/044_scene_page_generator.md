---
type: Plan
title: Reusable Scene Page Schematic
description: Add a standalone scene page generator with optional lazy routing.
timestamp: 2026-10-13T00:00:00Z
tags: [schematics, angular, scene]
runbook: /docs/runbook/044_scene_page_generator.md
status: done
---

# Reusable Scene Page Schematic

## Goal

Add `ng generate triangular-engine:scene-page <name>` for a standalone Angular page with a reusable Triangular Engine scene template. Route insertion is opt-in.

## Contract

- Generate `.component.ts`, `.component.html`, and `.component.scss` below the selected application's `src/app`.
- Use a standalone component, `EngineModule`, `EngineService.provide`, and the `flex-page` host class.
- Optionally add a lazy route before wildcard fallbacks with `--route --route-path=<path>`.
- Resolve an explicit project or the sole workspace application safely.
- Reject invalid names, unsafe paths, missing routes files, route collisions, and any generated-file conflict before writing.
- Share route/project/name helpers and the scene template with `ng-add`; retain ng-add rerun safety and legacy `engine-scene` filenames.
- Do not install dependencies or configure physics.

## Verification

- Focused schematic node tests cover generated output, routing, workspace selection, and conflict safety.
- Run schematic typecheck and tests, then build the triangular-engine library.

## Status

- [x] Record the implementation contract and verification plan.
- [x] Implement shared helpers and register the schematic.
- [x] Add tests and package documentation.
- [x] Complete package/consumer verification and record results in the runbook.

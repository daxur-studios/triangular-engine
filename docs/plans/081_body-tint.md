---
type: Plan
title: "Body tint for meshes in atmosphere"
description: "Tint real 3D meshes (a moon, a station) seen through an atmosphere, matching terrain haze, with an opt-in per-material hook."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/081_body-tint.md
map_schema: 1
document_id: plan-081
initiative_id: "body-tint"
performance: []
---

# Plan 081: Body tint for meshes in atmosphere

Status: **planned**. Evidence and decisions: [ER 081](/docs/engineering-records/081_body-tint.md).

## Roles

- **Architect:** `claude-opus-5-5`, session `CONTEXT: body-tint` (`local_7b365d96-7436-446b-b722-523021a382d5`), 2026-11-01. Plan text only; it wrote no files.
- **Supervisor (reviewer):** session `SUPERVISOR: body-tint` (`local_c027370f-acd3-4b42-b3ed-2ea5f6907390`), started 2026-11-01 in bypass permissions. Model still to be switched to Sonnet, pending owner approval.
- **Worker (main session):** `claude-haiku-5-5`, this session, 2026-11-01. Writes the files and runs the acceptance commands.

<!-- tri:scope -->

## Intended outcome

A real 3D mesh (a moon, a station, a large structure) that is seen through the air of an atmosphere picks up that air's haze, matching terrain haze at the same range. From space the mesh is not tinted. The sky-disc API (`addSkyBody`) is unchanged and stays distant-only. Out of scope: transparent materials (a later phase), flat-map morph on tinted meshes, and any limb tint from a non-owner atmosphere seen from space.

Constraints:

- Opt-in per opaque material, so materials that don't ask pay no cost.
- The in-air lookup reuses the existing froxel table, so it matches terrain by construction.
- The beyond-air term reuses `atmosphereSky`, so the mesh blends into the sky behind it.
- Public API changes are additive. `withAtmosphere` and `addSkyBody` signatures are unchanged.

## Phases and acceptance

- **bt-spike** — Measure where the froxel haze and the beyond-air sky term meet at the froxel range limit, on a demo-only test mesh. Acceptance: a saved run of the spike case shows the two results meet with no visible step, and the blend-band width is chosen from that run.
- **bt-hook** — Add `PlanetAtmosphere.tintMaterial(material, options?)` with TSDoc and specs, and a `meshPerspective()` stage that takes only `{cameraDistance}`. Acceptance: the existing atmosphere specs stay green, the new specs pass, and `npm run build:triangular-engine` succeeds.
- **bt-lab** — Add suite version 2 to `atmosphere-multi-lab` with mesh-moon and in-air mesh cases. Version 1 is kept unchanged. Acceptance: a saved v2 run on the owner's GPU meets the pass numbers below, and the recorded adapter is the RTX 3080.
- **bt-docs** — Update the atmosphere README and CHANGELOG, mark Plan 078 Q2 answered, and state the limits. Acceptance: `npm run triangular -- docs records check` reports OK.

### Pass numbers (lab v2)

- A mesh moon seen from inside the air has a mean blue/red ratio at least 1.15× the same mesh seen from space.
- From space the tinted mesh is within 2% per channel of the untinted mesh.
- An in-air mesh is within 3/255 per channel of terrain at the same range, at 2, 5 and 20 km.
- A mesh crossing the froxel range limit shows no luminance step above 4/255 across the blend band on a horizontal scan.
- With one mesh-moon-sized tinted material, frame time rises by at most 0.3 ms or 5% (whichever is larger) over the untinted case, across at least 300 sample frames.
- v1 cases rerun with no change beyond noise.
- One case with the forced WebGL2 backend is recorded as evidence. It does not gate the phase.

### Packets

- **bt-spike P1 (design work, demo-only).** Temporary shader on a test mesh in `projects/demo-app/src/app/pages/atmosphere-multi-lab/*`, showing the froxel and sky results side by side near the range limit. Invariant: no library edits. Feeds the blend-band decision. Acceptance: a saved spike run, and the owner reviews the screenshot.
- **bt-hook P2.** Files: `atmosphere/atmosphere-planet-stages.ts` (new `meshPerspective()` on the binding) and `atmosphere/atmosphere-planet-stages.spec.ts`. Invariants: takes only `{cameraDistance}`; uses the froxel table only, never the slab, so morph is ignored and documented as globe-only; the graph `perspective()` builds today is byte-identical. Acceptance: `npx ng test triangular-engine --watch=false --browsers=ChromeHeadless --include='**/atmosphere/atmosphere-planet-stages.spec.ts'`.
- **bt-hook P3.** Files: `atmosphere/atmosphere-backdrop.ts` (public `tintAlong(worldDir, color)`, a thin wrapper over `atmosphereSky`) and `atmosphere/atmosphere-backdrop.spec.ts`. Invariant: `skyObject` output unchanged. Acceptance: the same command with `--include='**/atmosphere/atmosphere-backdrop.spec.ts'`.
- **bt-hook P4.** Files: `atmosphere/planet-atmosphere.ts`, `atmosphere/planet-atmosphere.spec.ts`, `atmosphere/public-api.ts`. API: `tintMaterial(material: NodeMaterial, options?: { blendBand?: number }): () => void`, which wraps `material.outputNode`. Invariants: opt-in per material; opaque materials only (transparent ones are rejected with a dev warning); tone mapping and colour space still run after the tint; the returned disposer restores the previous `outputNode`. Acceptance: the same command with `--include='**/atmosphere/planet-atmosphere.spec.ts'`, then `npm run build:triangular-engine`.
- **bt-lab P5.** Files: `projects/demo-app/src/app/pages/atmosphere-multi-lab/atmosphere-multi-lab-tests.ts` (new suite version 2; v1 kept) and `atmosphere-multi-lab-page.component.ts`. Cases: mesh moon from inside A and from space; a mesh at 2, 5 and 20 km inside A beside terrain at the same range; a large mesh crossing the range limit. Invariants: the page keeps `showFPS`, `[showFps]` and the portal layout; v1 case ids unchanged. Acceptance: the `test:run` command under Testing.
- **bt-docs P6.** Files: `atmosphere/README.md`, `projects/triangular-engine/CHANGELOG.md`, this plan (Q2 answered, phase states), and the Engineering Record (dated evidence). Invariant: the scope block is unchanged, so no baseline is needed. Acceptance: `npm run triangular -- docs records check`.

### Always-review paths

Owner-level review before any edit to these:

- **Public API:** `atmosphere/public-api.ts`; `planet-atmosphere.ts` (`tintMaterial`, `IAtmosphereSurface`); `atmosphere-backdrop.ts` (`atmosphereSky`, `skyObject`, new `tintAlong`); `atmosphere-planet-stages.ts` (`IAtmospherePlanetContext`, `perspective()`).
- **Frame conversions:** `AtmosphereBackdrop.frame` (world to atmosphere local); `bodyToView`, `cameraBody`, `metersPerUnit`, `radiusUnits` in `atmosphere-planet-stages.ts`; the world-to-body update in `planet-atmosphere.ts` `update()`; any use of `positionWorld` and `cameraPosition` under floating origin.
- **Serialization formats:** the `atmosphere-multi-lab` suite id, version, and result JSON fields read by `test:summary` and history.
- **Physics step timing:** not touched. Tint uniforms update per render frame in `update()`. Flag any change that moves them into the physics step.

### Testing

- Unit tests: headless and single-run only, `npx ng test triangular-engine --watch=false --browsers=ChromeHeadless --include=<spec>`. Run the full `npm test` before bt-lab.
- Browser runs: against the already-running server, one launcher per case:
  `npm run test:run '--' --url "http://triangular-demo.localhost:4200/atmosphere-multi-lab?testCases=<id>" --suite atmosphere-multi-lab --version 2 --profile headless-hardware --mode standard`
- Read results with `npm run test:summary '--' --suite atmosphere-multi-lab --last 3`, and check the recorded adapter.

<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| bt-spike | planned |
| bt-hook  | planned |
| bt-lab   | planned |
| bt-docs  | planned |

<!-- tri:review version="1" scope-hash="pending" reviewed="2026-11-01" reviewer="architect" -->
<!-- tri:item id="Q1" kind="intent" applies-to="bt-lab" blocks="bt-lab" state="open" -->

- [ ] Put the new lab cases on the existing `atmosphere-multi-lab` page (architect recommends yes), or on a new page?
  - Why it matters: a new page separates v2 from v1 in the sidebar, but adds a route and a demo card.
  - Next action: owner decides.
    <!-- /tri:item -->
    <!-- tri:item id="Q2" kind="intent" applies-to="bt-hook" blocks="bt-hook" state="open" -->

- [ ] Must transparent materials be tinted in this plan (architect recommends no, deferred)?
  - Why it matters: transparent materials need a different blend path and more specs.
  - Next action: owner decides.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.

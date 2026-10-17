# Plan 049 review handoff (morphing planet atmosphere)

Compact trace for a reviewing agent. Details: [049_morphing_planet_atmosphere.md](049_morphing_planet_atmosphere.md). Nothing is committed (repo rule).

## Where it stands

| Area | State |
| --- | --- |
| Globe sky and haze | Done, user-verified. |
| White harshness on the slab | **Fixed** by the two external reviews. Do not re-raise. |
| Slab elevation floor (`atmosphere-planet-stages.ts`, `slabPerspective`) | Permanent. It adds detail that would otherwise be missing. The debug toggle was removed. |
| Flat-pose sky (option A) | Built: own sky frame, `skyAltitude`, sun and `voidFade` in `PlanetAtmosphereBinding.sync` and `AtmosphereBackdrop`. Looked at on screen by the user: "somewhat works". |
| Morph camera rig | Done, user-verified ("sorted"). |
| Library build, look pass, phases 4 to 6 | Not done. |

## Work done this stretch

1. **Flat-pose sky.** Sky up slerps radial to +Z by `morph`; `skyAltitude` blends sphere altitude to `z`; sky sun keeps the sun angle under the camera; `voidFade = morph` darkens below the horizon.
2. **Wrong-plane bug.** The flat map is the plane `z = 0` through the centre (flat `z` is only terrain height), not `z = radius`. Fixed in the rig, `skyAltitude`, specs and docs.
3. **`CellPlanetMorphCameraRig`** (`worldgen/render/cell-planet-morph-camera.ts`, exported from `worldgen/render/public-api.ts`). Keeps position, angle to the ground, place over the ground and up through the morph.
   - Anchor is the ground point straight below the camera (fixed-point search, two seeds, nearest wins).
   - Called from `engine.postTick$` on the cell page, which also writes `uMorph` in the same step. This removed the slider flicker. The rig must not run in `beforeRender$`.
   - Specs in `cell-planet-morph-camera.spec.ts`. Worldgen suite was 322/322.
4. **Docs.** Runbook sections "Flat-pose sky" and "Morph camera" are current; CHANGELOG has the rig bullet.

## Open: the user's latest observation

On the flat map the blue is global, not local. There is no visible atmosphere layer above the map as the sphere has with its limb.

- Behind the map the backdrop is a view-direction dome that fades to black below the horizon (`voidFade`).
- On the map the slab haze is per fragment (camera height and distance), so it reads as a uniform disc.
- Proposed (not started, awaiting the user's go-ahead): in the backdrop, integrate the slab in-scatter for rays that pass beyond or skim over the map, down to the `z = 0` plane, clipped to the map footprint (`2πR x πR`), instead of fading to black. This also covers the runbook's `flatMapEdge` item. Risk: a second backdrop term, so the mid-morph blend needs checking.

## Other open items (all optional)

- Slab airmass cap: keep the true camera height and cap the column, instead of raising the camera.
- Flat-map edge glow outline.
- Two-evaluation sky crossfade, only if mid-morph looks squashed.
- Eclipse slider.
- Guard the four froxel shadow-cut fetches in `lookup()` (measure first).
- Option to keep the globe's pole-lock up while the rig runs.
- Relief-aware rig height (it measures from the base surface).
- Library rebuild (`npm run build:triangular-engine`), then the look pass.

## Working-tree files to review

- `projects/triangular-engine/worldgen/render/cell-planet-morph-camera.ts` and `.spec.ts`
- `projects/demo-app/src/app/pages/cell-planet-tsl/cell-planet-tsl-page.component.ts`
- `docs/runbook/049_morphing_planet_atmosphere.md`
- Also modified, not mine, leave alone: cloud-volumes files (`051_cloud_volumes.md`, `cloud-volume-screen-pass.ts`, `cloud-volumes-lab-page.component.ts`).

## Rules in force

- Never `git commit`.
- Tests headless and single-run only (`npm run test:triangular-engine:worldgen`).
- Do not edit `dist/`.
- Keep specs colocated.
- Update CHANGELOG and docs for public API changes.
- `worldgen/render/core` stays Three-free.
- Name no private repos.

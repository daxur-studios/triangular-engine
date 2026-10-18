# Handover: Plan 050, TSL planet surface material (2026-10-18)

Plan: `docs/plans/050_tsl_planet_surface_material.md`. Runbook: `docs/runbook/050_tsl_planet_surface_material.md`
(read its last two sections, "Phase 5 ... Suite result" and "Review fixes", first).

## Rules for the next session

- **Never `git commit`.** Leave all changes in the working tree; the maintainer commits.
- No private repo or app names anywhere in this public repo.
- Tests are headless and single-run only: `npm run test:triangular-engine:planet-material`, `:atmosphere`, `npm test`.
  Never run a watching or windowed test run.
- Check `git status --short` first and keep unrelated changes (atmosphere and cloud-volume work from other sessions is also in the tree).
- Plan/runbook pair must be updated with any change (convention: `docs/plans-and-runbooks.md`).

## State

Everything below is **uncommitted in the working tree**. The planet-material specs pass 69/69 and the atmosphere specs 136/136
(headless). The demo app type-checks. The owner confirmed the pole, dawn and dusk areas "look a lot better now" on the live demo.

### Done this stretch

1. **Benchmark suite.** "run ALL" on `/cell-planet-tsl` and `/cell-planet-morph-streaming`
   (`projects/demo-app/src/app/pages/cell-planet-tsl/benchmark-suite.ts`, `frame-benchmark.ts`). It runs 3 alternating rounds
   (TSL webgl2, TSL webgpu, GLSL) across page reloads through `sessionStorage`; the last page has "copy suite result". The owner ran
   it and it worked. Numbers and findings are in the runbook ("Suite result, 3 alternating rounds").
2. **Review fixes 1 to 5** (details in the runbook's "Review fixes" section):
   - `radialDirection` added to `IPlanetContext`, `IPlanetMorphGraph` and the atmosphere context; used by cell lookup, `latLon`,
     road, moon eclipse, night lights and the atmosphere `muSun` and `surfacePoint`. `sphereNormal` stays for shading.
   - `simpleDayNightLighting` and `sunVisibilityLighting` now dim `(color - emissive)` and add the emissive back.
   - `cell-planet-tsl`: map frame shifted `+radius` in z; the projection button reloads with `?projection=`; the worker request uses
     `projectionKind()`; `setCells` reads `cellsOn()` after the await; `isSettled` also waits for the surface's `queued` and `pending.size`.
   - Dynamic mode: flat normal is `(0, 0, 1)`; the morph-blend `normalize` is guarded.
   - Seam cull: new GPU test with no `aOtherDir*` attributes, and `SEAM_LON_MISMATCH` lowered 0.5 to 0.3 in
     `planet-material/planet-morph-nodes.ts`. The owner is keeping 0.3. If holes appear in streamed tiles near the poles, raise it.
3. Runbook 050 and the Plan 050 status line were updated with the above.

### Key benchmark findings (3-round suite, ~165 Hz display, nothing throttled)

- GLSL sits at the display cap (6.1 ms), so its headroom is unknown.
- TSL WebGL2 with batching **on** is **25 to 30 % slower** than batching off (morph 0: 9.5 to 10.1 ms against 7.4 to 7.7 ms), although it
  cuts draws from 36 to 48 down to 5 to 7. Cause unknown.
- TSL WebGPU: batching on and off are identical (one draw per instance); about 9.6 ms at morph 0.
- Atmosphere costs about 3 ms at morph 0.
- The GLSL and TSL scenes are not identical (42,560 against 90,472 triangles at morph 0.5).

## What is left, in the recommended order

1. **Low-priority review items** (listed at the end of the runbook's earlier review section): fixed scene light, seam shards,
   cell table width, leaks, draw-count labels, slot ids; plus the review's plan notes and missing tests. Do not dispose
   `QuadMesh.geometry` in `gpu-eval.testing.ts` (shared; the review's suggestion was rejected).
2. **Investigate the WebGL2 batching slowdown.** First test from the runbook: `?tiles=0&macro=off&backend=webgl2`, batching on against
   off; also check whether batch draws are unsorted (`sortObjects` false when `frustumCulled` is false). Fixes may touch
   `TerrainSurfaceComponent` or the view defaults, which are off-limits without an approved diff.
3. **Open gates:** the Phase 3 and 4 visual gates are not run (need a visible window). Delete the throwaway `/tsl-webgpu-spike`
   page now that the benchmark numbers are final.
4. **Make the GLSL and TSL comparison scenes identical** so the TSL-versus-GLSL gap is clean.
5. **Plan 052** (`docs/plans/052_page_test_sessions_and_performance_comparison.md` plus its runbook): rewritten by an Opus agent for a
   one-action, token-efficient flow (`/page-test` launcher, Playwright `npm run perf:suite`, a compact `triangular-perf-suite v1`
   report under 2 KB). The owner has **not reviewed it**. Open decisions: 15 % noise threshold, 1.3x drift threshold, 3-round
   default, and whether headless Playwright gets a real GPU. Phase 1 would delete `frame-benchmark.ts` and Phase 2 would replace
   `benchmark-suite.ts`, so do not extend those two files further if 052 is going ahead.

## Needs the maintainer

- Commit the working tree (this session never commits). A review note said the runbook's benchmark section might not be on `master`;
  check it is committed before other agents' work lands on top.
- Review Plan 052 and answer its open decisions.

## Useful commands

```powershell
npm run test:triangular-engine:planet-material
npm run test:triangular-engine:atmosphere
npx tsc --noEmit -p projects/demo-app/tsconfig.app.json
npx ng serve demo-app --port 4241   # or the `demo-app` entry in .claude/launch.json
```

Benchmark pages: `/cell-planet-tsl?backend=webgl2|webgpu` and `/cell-planet-morph-streaming`. Keep the tab visible and focused; a hidden
pane throttles `requestAnimationFrame` to about 1 fps.

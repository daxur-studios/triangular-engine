---
type: Runbook
title: Morphing Planet Atmosphere
description: Findings and decisions for the new cell-planet atmosphere that follows the globe ↔ flat-map morph.
timestamp: 2026-10-16T00:00:00Z
tags: [atmosphere, scattering, sky, cell-planet, morph, rendering, performance, webgpu, tsl]
plans: [/docs/plans/049_morphing_planet_atmosphere.md]
performance:
  - id: bent-atmosphere-look-v1
    url: http://triangular-demo.localhost:4200/atmosphere-lab?testSuite=bent-atmosphere-look&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1
    status: runnable-functional-review-pending
  - id: bent-atmosphere-cost-v1
    url: http://triangular-demo.localhost:4200/atmosphere-lab?testSuite=bent-atmosphere-cost&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1
    status: superseded-by-v2
  - id: bent-atmosphere-cost-v2
    url: http://triangular-demo.localhost:4200/atmosphere-lab?testSuite=bent-atmosphere-cost&testVersion=2&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1
    status: measured-rtx3080-no-baseline
---

# Runbook 049: Morphing Planet Atmosphere

Plan: [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md).

## 2026-10-16 — Initial investigation (cloud session, code reading only)

Nothing was built, run or measured. Findings from reading the code:

- **Morph shape.** `enablePlanetMorphProjection` (`worldgen/render/planet-morph-material.ts`) places
  each vertex at `mix(aSpherePos, flatPos, uMorph)` and its normal at `mix(aSphereNorm, +Z, uMorph)`.
  Flat positions come from equirectangular or Equal Earth, computed in the shader. Mid-morph, the
  surface is neither sphere nor plane, and there's no closed-form inverse from a world point back to
  a sphere direction. The demo's raycast handles this by marching the CPU copy of the morphed triangles.
- **Per-point sun angle is available.** `enablePlanetMorphLighting` lights the flat map with each
  point's sphere normal. `computeSunDirectionFromTime` gives a body-frame sun. So `μs` per fragment
  is intrinsic and survives the morph. The new atmosphere relies on this.
- **Earlier atmosphere work is out of scope (owner decision).** `takram/atmosphere/*` (Bruneton via
  Takram, ECEF + `postprocessing`), the finite-cylinder ray-march effect, `ICelestialBody.atmosphere.visual`
  and the commented-out sky sphere are not reused or modified. One lesson is kept as a generic
  pitfall: ground exactly at `r == bottomRadius` bands in the standard transmittance parameterization.
- **Demo render setup** (`cell-planet-morph-streaming-page.component.html`): `logarithmicDepthBuffer`,
  fixed `ambientLight` 1.2 + two `directionalLight`s, no composer. R = 600 km (`medium` tier) with
  terrain height scale ~59 km (Runbook 047), so relief is ~10% of radius.
- **Renderer.** `EngineService.initRenderer` defaults to classic `WebGLRenderer`. `WebGPURenderer` is
  opt-in via `preferredRenderer: 'webgpu'`, falling back to classic WebGL. No TSL / `NodeMaterial` is
  used anywhere. About 20 `onBeforeCompile` patches in `worldgen/` and `terrain/` make up the
  cell-planet surface, and `WebGPURenderer` ignores all of them. So a single-source TSL atmosphere
  would need the planet materials ported to TSL first.

### Decisions (proposed, waiting on owner)

- New `triangular-engine/atmosphere` entry point. New files only, additive exports.
- Technique: Hillaire-style LUTs (physical) + artist ramps (stylized) writing the same LUTs.
- Surface aerial perspective as a forward material patch, so it can read `aSphereNorm`.
- Sky objects composite through a shared `atmosphereSky(dir)` function (WebGL has no dual-source blending).
- Per-profile LUTs baked on CPU in a worker (renderer-agnostic, doubles as test reference). Per-frame
  passes as fragment passes. Froxels in a 2D atlas. This keeps both W1 (TSL only) and W2 (GLSL + TSL) open.

## 2026-10-16 — Owner decisions and follow-up findings

Decisions from the owner:

- Technique: Hillaire LUTs + stylized ramps.
- **TSL only, one version.** The cell-planet materials get an extensible TSL port first or alongside.
  The TSL material must stay as extendable as the GLSL patches were, e.g. games adding their own
  solar-eclipse shading or road layers.
- **Planet sizes:** support Kerbin-sized (600 km), ~100 km and Earth-scale planets, and small
  planets must look good.

Findings:

- `WORLD_SIZE_TIER_RADIUS_M`: mini ≈ 6.4 km, extra-small ≈ 64 km, small ≈ 191 km, medium = 600 km
  (`HOME_PLANET`), large ≈ 1,911 km, extra-large = Earth. Mini isn't selectable in-game yet.
- The agent skill game repos load is `.agent/skills/triangular-engine/SKILL.md`. User docs live in
  `projects/triangular-engine/docs/`. Both get an atmosphere section (Phase 9).
- The plan now covers: similarity scaling plus scale-free art knobs (`thickness`, `hazeAtHorizon`,
  `nearHazeFadeM`, `reliefFit`), a staged `PlanetSurfaceMaterial` with slot and building-block
  extension, automatic atmosphere coverage (screen pass + MRT mask + coverage debug overlay), and
  the flat-map edge default (soft fade, optional glow).

## 2026-10-16 — TSL material split into Plan 050

- Owner decision: the TSL planet-material port becomes its own plan,
  [Plan 050](/docs/plans/050_tsl_planet_surface_material.md), and is picked up first.
- The material design (stage table, slot API, building blocks, porting scope) moved to Plan 050
  so it lives in one place. Plan 049 now only describes what it puts into stages 3, 4 and 6.
- The old Phase 0 `WebGPURenderer` check and Phases 1 and 6 (material parts 1 and 2) moved to Plan 050.
  Plan 049's phases were renumbered: 0 = CPU foundations, 1 = presets. From Phase 2 on, it needs
  Plan 050 through its Phase 4.
- Correction to the first entry: the cell-planet path is 7 `onBeforeCompile` patches plus 3
  `ShaderMaterial`s, not "about 20" (inventory in [Runbook 050](/docs/runbook/050_tsl_planet_surface_material.md)).
- Plan 049's frontmatter gained the missing `runbook:` back-link.

## 2026-10-16 — three 0.186.1 upgrade: what it changes for this plan

- The workspace is on three 0.186.1 (`docs/upgrades/01_threejs_0.183_to_0.186.md`). The technique, the
  phases and the TSL-only decision don't change.
- r186 adds `DirectRenderPipeline`, which skips the half-float target and the output pass. Runbook 050
  measured it: it removes the MSAA surcharge but not the gap to classic. It can't bloom, so this plan stays
  on an HDR `RenderPipeline` with MSAA off plus a post AA pass. Recorded in the plan's WebGL/WebGPU
  section and as a Proposed decision.
- The WebGL2 fallback's cost is now uncertain: about classic speed on 0.183, 2-5x slower on 0.186.1 (busy
  machine). Plan 050 Phase 1 re-measures it. The plan's performance section now says G8 needs a decision if
  the slowdown holds.
- Phases 0-1 (CPU integrator, profiles, presets) don't depend on the renderer and can start now.

## 2026-10-16 — Phases 0–1 built (local Sonnet session)

Built the CPU foundations and the three presets as the new `triangular-engine/atmosphere` entry point
(`projects/triangular-engine/atmosphere/`). Pure TypeScript: no three, no Angular, no GPU, no TSL. Nothing
under `planet-material/`, the Takram atmosphere code or Plan/Runbook 050 was touched. Not committed.

### What exists

| File | Contents |
|---|---|
| `atmosphere-profile.ts` | `PhysicalAtmosphereProfile` / `NoAtmosphereProfile` (`AtmosphereProfile` union, `version: 1`), `validateAtmosphereProfile` (returns every issue with a dotted path), `assertValidAtmosphereProfile` |
| `atmosphere-medium.ts` | Coefficients at an altitude (Rayleigh, Mie, tent/exponential absorbers), Rayleigh and Cornette-Shanks phases |
| `atmosphere-reference-integrator.ts` | Ray/shell geometry, optical depth, transmittance, sun transmittance with planet shadow, Hillaire multiple-scattering term, a baked-table form of it, `integrateRadiance` |
| `atmosphere-scaling.ts` | `similarityScaleAtmosphere` and `scaleAtmosphereProfile` with `thickness`, `reliefFit`, `hazeAtHorizon`, `nearHazeFadeM` |
| `atmosphere-presets.ts` | `earth`, `mars`, `none` and `createAtmospherePreset(id, scaling?)` |

Wiring copied from `planet-material`: `ng-package.json`, `public-api.ts`, `tsconfig.json` path (and the
demo-app `tsconfig.app.json` path, as `planet-material` has), `angular.json` `test-atmosphere` target plus
the specs glob in the main test target, `npm run test:triangular-engine:atmosphere`. Also an
`entry-points.md` row and a CHANGELOG line.

### Decisions (mine; flag if you disagree)

- **Profile shape.** Lengths in metres, coefficients in 1/m at sea level. `planetRadiusM` is the radius the
  profile is authored for, so a scaled profile is just another profile (no separate "scaled" type). `kind`
  is `'physical' | 'none'`, leaving room for `'stylized'` in Phase 7. Mie `phaseG` is a number or one value
  per channel (needed for Mars, below). Ozone-like layers are generic `absorbers` with an exponential or tent
  density.
- **Reference values.** Earth uses Hillaire 2020's numbers (Rayleigh 5.802/13.558/33.1 per Mm at 8 km, Mie
  3.996 + 0.444 per Mm at 1.2 km with g 0.8, ozone tent 25 km ± 15 km, top 60 km). Radius is 6,371 km to
  match `WORLD_SIZE_TIER_RADIUS_M` (Hillaire uses 6,360 km; it makes no visible difference).
- **Similarity scaling** is exactly the plan's rule (lengths × k, coefficients ÷ k). Knob order: thickness →
  reliefFit → hazeAtHorizon. `reliefFit` only ever raises the air (default margin 1.25).
  `nearHazeFadeM` is stored as given and is **not** scaled, since it is a world distance for props.
- **`hazeAtHorizon` interpretation.** The plan says "target transmittance to the horizon from the surface".
  I defined it as the green-channel transmittance along the horizontal ray that grazes the ground and
  leaves through the top of the air. Optical depth is linear in the coefficients, so one multiplier hits the
  target exactly (no solver). It is a scale-free proxy, not the haze at a given distance. **Open for review:**
  if you meant haze over a fixed fraction of the horizon distance, this needs changing.
- **Multiple scattering** is Hillaire's isotropic approximation (`psi = L2 / (1 - fms)`, 64 Fibonacci
  directions), **not** an exact radiative-transfer solution. The Phase 2 GPU-vs-CPU checks therefore
  validate "the same approximation", not physical truth. An independent brute-force check is still open.
- **Integration scheme.** Midpoint rule. Optical-depth and sun-transmittance integrals cluster samples
  near the ray start (`t = T u²`); view rays are uniform. Defaults are 128 view samples and 32 sun samples;
  both converge as N⁻².
- **Mars is art-tuned, not fitted.** Derivation is in the doc comment of `marsAtmosphereProfile`: Rayleigh
  from CO2 number density and cross section, dust optical depth ~0.5, single-scattering albedo falling in
  blue. **Please review these numbers** before anything relies on them.
- **Mars blue sunset needs per-channel g.** One Cornette-Shanks g cannot make blue scatter more forward
  than red, so `phaseG` accepts `[r, g, b]`; Mars uses 0.55/0.65/0.78. A single g gave an orange sunset
  glow like Earth's.
- **Not built:** transmittance/sky-view LUT baking and parameterizations (Phase 2), Venus/Titan/gas giant
  (Phase 8), the stylized producer (Phase 7), per-`WorldProfileKind` defaults, `flatMapEdge`.

### Traps found

1. **Float rounding shadows ground points.** A point computed on the ground sits a few ulps either side of
   the sphere (about 4e-3 m² in `|p|² - R²` at Earth scale). An upward sun ray from one that landed inside
   counted as a ground hit at distance 0, so the sun transmittance came out 0 at random. Symptom: the same
   scene gave results that differed ~1.4% between planet sizes and wobbled non-monotonically with size.
   Fix: `groundHitDistance` ignores `c > -1e-9 R²` for non-downward rays. Two regression specs cover it.
   This is the same family as the plan's "ground exactly at `bottomRadius` bands" warning, and the GPU
   code will need the same tolerance (or ground rendered slightly above `bottomRadius`).
2. **Coarse multiple-scattering tables break at the terminator.** At 20 km altitude the sun sets at
   `μs = -√(1 - (R/(R+h))²) = -0.079` and the term collapses within a couple of percent of `μs`. A 16×16
   table is within ~1% elsewhere but off by 12–23% at `μs = 0`, 30 km. Phase 2 needs finer sampling or a
   horizon-concentrated parameterization.
3. **Limb glow is gentler than the plan's wording suggests.** With the sun just behind the limb, forward
   Mie raises green radiance by only ~1.2–1.3× over Rayleigh alone at a 3 km grazing altitude, and nothing
   at 8 km and above (Mie scale height is 1.2 km). A view ray lying exactly along the sun ray at low
   altitude is *dark*, because the sun path crosses the thick tangent region. The visible glow comes from
   the contrast against a black sky plus HDR/bloom. G6 should be tuned in Phase 2 on screen, not assumed.
4. **Mars multiple scattering is large and probably too strong.** Dust is highly forward-scattering and
   scattering-dominated, so `ms / ss` reaches 2.7–4.4 at Mars sunset, and the isotropic approximation
   ignores the forward peak. Check against a brute-force solution before trusting the Mars dusk look.
5. **Earth `ms / ss` at the zenith is 1.46–1.72 (day, with 0.3 ground albedo).** Plausible for Hillaire's
   approximation, but it is the first thing to check if the GPU sky looks too bright.

### Results

| Check | Result |
|---|---|
| Earth zenith Rayleigh depth, green | 0.108 vs 0.0973 published (Bodhaine 1999, 550 nm): +11%, the test allows 15%. Hillaire's coefficient is for a slightly shorter green |
| Blue/red Rayleigh depth ratio | 5.70 vs (680/440)⁴ = 5.70 |
| Horizon air mass | 35.40 vs Chapman √(πR/2H) = 35.37 |
| 60° air mass | 2.00× zenith (plane-parallel) within 1% |
| Sun transmittance (ground, green) | 0.85 overhead, 0.25 at 5°, 0.0095 at 0°; red/blue ratio 1.3 → 8.5 → 2000 |
| Earth sunset | Near-sun glow B/R ≈ 0.13 (orange); sky away from the sun B/R ≈ 1.9 (blue) |
| Earth twilight | Zenith stays bluer than the no-ozone case (Hulburt effect) |
| Mars | Rayleigh zenith depth 0.003 (< 5% of Earth's); dust 0.43/0.45/0.48 (RGB); ochre day zenith (R > G > B); sunset glow B/R ≈ 1.7 near the sun vs ≈ 0.5 away |
| Scaling across 64 km, 100 km, 600 km, 6,371 km | Equivalent viewpoints (ground zenith, sun-ward/away at sunset, twilight, 10 km altitude, orbital limb) agree to < 1e-6, and with multiple scattering to < 1e-3; zenith/60°/horizon optical depth to < 1e-9 |
| Why scaling is needed | Earth coefficients on a 100 km planet: green transmittance along the grazing ray 0.93 (almost clear). Scaled: ≈ 0.0095, same as Earth |
| Specs | `npm run test:triangular-engine:atmosphere`: **98 of 98 passed**, ~1.3 s in headless Chrome |
| Library build | `npm run build:triangular-engine` passed; the `triangular-engine/atmosphere` entry point built |

### Environment notes (this session, not repo changes)

- `npm install` fails in a fresh checkout because `package.json` points at
  `file:./daxur-studios-portal-layout-0.0.1.tgz`, which isn't in the repo. To run the specs and the build
  here I installed from a copy of `package.json` without that dependency (outside the repo, symlinked as
  `node_modules`) and stubbed `@daxur-studios/portal-layout` just enough to compile. The real package was
  not used, so a build on your machine is still the real confirmation for that dependency.
- Karma needed `CHROME_BIN` pointing at a wrapper that adds `--no-sandbox` (running as root).
- `daxur tokens map status` could not be run (no `daxur` CLI here). The token map for the new entry point
  hasn't been checked.

### Re-verified in the real workspace (2026-10-16, local)

The cloud session's commit was moved back to uncommitted changes. In the real environment (real
`@daxur-studios/portal-layout`, no stubs): `npm run test:triangular-engine:atmosphere` 98 of 98 passed, and
`npm run build:triangular-engine` passed. `daxur tokens map status` lists no atmosphere section (it is below the
tracking floor, nothing to sync). Phase 2 stays blocked on Plan 050 Phase 4 (extension slots + reference demo),
which is not built yet.

### Left for review

- The `hazeAtHorizon` interpretation, the Mars numbers and the per-channel `phaseG` addition (above).
- Whether the `demo-app/tsconfig.app.json` path entry should stay (it mirrors `planet-material`).
- `.daxur/token-map.json` / architecture docs for the new sublibrary.

## 2026-10-16 — Phase 2a: atmosphere on a plain sphere (local Sonnet session)

Owner asked to see the atmosphere before Plan 050 finishes. Phase 2 was split: **2a** is a plain sphere with no
cell planet involved (this entry), **2b** is the cell-planet lighting stage and stage 6 (needs Plan 050 Phase 4),
**2c** is the cached sky-view table plus the budget. The plan is updated.

### What exists

| File | Contents |
|---|---|
| `atmosphere-luts.ts` | `bakeAtmosphereLuts`: transmittance 256x64 (Bruneton parameterization, ground ignored, shadow applied by the consumer), multi-scatter 64x32, sky irradiance 64x16, all RGBA float32. Transmittance is baked first and read by the other two, so the whole bake is ~1-2 s. CPU samplers mirror the GPU lookups |
| `atmosphere-gpu-model.ts` | `AtmosphereGpuModel`: tables as half-float textures, profile as uniforms, `march()` (TSL), `sunTransmittance()`, `groundIrradiance()`. `setProfile()` rebakes in place |
| `atmosphere-backdrop.ts` | `AtmosphereBackdrop`: one full-screen quad, per-pixel ray from the scene camera's orientation, analytic ground sphere + sky + sun disc |
| `atmosphere-reference-integrator.ts` | Additive: `sunTransmittance` override option on `integrateRadiance` / `computeMultiScattering` (so tables can be baked from the LUT) |
| demo `/atmosphere-lab` | Presets (ground noon/dusk/after sunset, 5 km, low orbit, space x3), 64 km / 100 km / 600 km / Earth, Earth / Mars, sun and camera sliders, exposure |

### Decisions (mine; flag if you disagree)

- **Analytic ground, not a mesh.** A sphere mesh at Earth radius sags ~470 m below the true sphere at 256 segments, and
  float32 vertex transforms jitter at 6,000 km. The backdrop ray-traces the ground sphere in the same pass as the sky.
  The mesh path comes back in 2b with the cell planet (using intrinsic terrain height, per the plan's precision note).
- **Per-pixel march is the reference path** (32 midpoint samples; the plan's final design is cached sky-view + froxels).
  Chosen to get a visible, testable result first; 2c replaces it for the sky and must match its output.
- **Precision.** The shader works in a frame local to the camera's ground point: ray constants are products
  (`h(2R + h)`, `(h - H)(h + H + 2R)`), altitude is `(x^2 + y^2 + z^2 + 2Ry)/(r + R)`, the LUT distance term is
  `(top - alt)(top + r) + r^2 mu^2`. No `r^2 - R^2` cancellation anywhere, so Earth scale keeps float32 precision. The
  camera altitude is a number (double on the CPU), never a position.
- **Soft planet shadow** (smoothstep over the sun's angular radius) instead of the CPU's hard test, so the terminator
  and the sun disc setting are not aliased. The spec avoids the boundary.
- **Sky irradiance on a flat ground** from a table (altitude x sun-zenith); the multi-scatter term is Hillaire's isotropic
  `psi` as before. One absorber layer only (the GPU model throws on more).
- **Half-float table textures** (filterable on WebGPU without extensions). Transmittance stored as T, not optical depth.
- Bake is synchronous on the main thread (1.7 s for a profile change at the defaults); the plan's worker move comes later,
  and needs the CPU files split into a framework-free `atmosphere/core` entry (see `projects/triangular-engine/AGENTS.md`).

### Results

| Check | Result |
|---|---|
| Baked sun transmittance vs direct integration (4 altitudes x 5 elevations) | within 3% where T > 1e-3 |
| Table round trip, irradiance sanity (blue > red, noon sky 4-40% of the beam, ~0 at night), similarity across 100 km vs Earth | pass |
| **TSL `march` vs `integrateRadiance` (same tables, same 24 steps), on a real GPU backend via `forceWebGL`** | within 2% + 2e-5 for 14 rays: Earth ground/orbit/dusk/shadow, Earth scaled to 100 km, Mars dusk and noon |
| Specs | `npm run test:triangular-engine:atmosphere`: 109 (before this entry's last edits) passed |
| By eye, `/atmosphere-lab` (browser pane) | Earth dusk: orange horizon glow, purple-blue zenith, tiny bright sun, dark checkered ground fading with distance. **100 km dusk is indistinguishable from Earth dusk** (similarity scaling holds). Space day side: pale blue-white limb. "Space, sun behind planet" (3 R away): nothing visible, because Earth's air is under 1 px thick at that distance. "Limb, backlit by the sun" (0.15 R up): a red-orange band under a blue band along the horizon, like orbital sunset photos |

### Not verified

- **Performance.** The browser pane here runs ~1-2 fps (software rendering), so there is no usable timing. The per-pixel
  march has never been timed on a real GPU; measuring it is Phase 2c's gate (see the next entry).
- Mars and the other size/view combinations were checked numerically (spec) but not all by eye.
- The WebGL2 fallback ran only through the spec harness, not the demo.
- Limb glow is thin on Earth (runbook trap 3); the exposure/HDR/bloom tuning is open.


## 2026-10-16 — Phase 2c: cached sky-view table (local Sonnet session)

### What exists

| File | Contents |
|---|---|
| `atmosphere-sky-view.ts` | `AtmosphereSkyViewLut`: a 192x108 render target holding radiance (left) and transmittance (right), rendered by one full-screen pass that calls `march` per texel. `lookup(dir)` is one filtered fetch per half. `update(renderer, altitude)` re-renders only when the altitude (1% of `max(h, 0.2% of top)`) or the sun's elevation (0.05 degrees) moves, or the profile version changes |
| `atmosphere-gpu-model.ts` | `traceRay()` split out of `march()` (ray/air/ground geometry only); the march loop is wrapped in `If(span > 0)` so pixels that miss the air skip it; `profileVersion` |
| `atmosphere-backdrop.ts` | `skyView` option, `skyViewEnabled` uniform, `update(renderer)`. Inside the air (camera below the top) with the table on, sky and ground haze come from the table; outside, the per-pixel march runs only on the limb pixels |
| lab | "sky from table / per-pixel march" toggle, table render counter, GPU timestamp readout (`trackTimestamp`) |

### Parameterization

Rows: zenith angle, split at the horizon `pi/2 + dip` (`dip = atan(sqrt(h(2R+h))/R)`, stable at small `h`), square-root
mapping on each side so texels crowd at the horizon. Columns: `sqrt(phi/pi)` with `phi` the azimuth from the sun
(unsigned: the sky is symmetric about the sun's vertical plane), so texels crowd around the sun. Both halves of the
target are edge-aligned to texel centres so linear filtering never bleeds across the seam.

### Results

| Check | Result |
|---|---|
| Table vs per-pixel march (same steps), 5 scenarios x 36 directions x radiance and transmittance, on a real GPU backend (`forceWebGL`) | within 6% + 1e-4: Earth ground at high sun, dusk, noon with the default 192x108 table and 32 steps, 8 km up, Earth scaled to 100 km. Directions within ~1.5 degrees of the horizon are excluded (the table is discontinuous there by design) |
| Re-render skipping (`update`) | no render for the same or a slightly moved camera or sun; renders for a real change or a new profile |
| By eye | dusk and noon through the table are indistinguishable from the per-pixel march |
| Specs | `npm run test:triangular-engine:atmosphere`: 115 pass |

### Trap found: values read inside an `If` block

The first table build showed black ground with a correct sky. `traceRay`'s outputs were plain expression nodes; TSL
emitted them at their first use, which was inside the `If` branch of the march, so uses elsewhere read an out-of-scope
value and the ground branch never ran. Making `traceRay` return `.toVar()` values (computed at the top of the shader)
fixed it. The spec did not catch it because it never used `traceRay` outputs inside a branch. Rule for later stages:
any value that is read inside an `If` and also outside it should be a `toVar()`.

### Not verified / open

- **The timing gate.** The pane here has no real GPU (1 fps, no timestamp query most frames), so nothing was measured.
  On a real GPU, open `/atmosphere-lab` (and again with `?backend=webgl2`), pick a view, and compare the GPU readout
  with "sky from table" on and off. Record the numbers here; the budget is <= 0.5 ms total from any camera position.
- Froxel table (aerial perspective for arbitrary objects) is not built; it belongs with Phase 4's coverage work.
- The ground still uses the per-pixel ground shading and the table for haze. The space view marches every pixel
  that crosses the air, which includes the whole planet disc, not only the limb (corrected below).
- The table is a 1-camera-altitude cache. Two cameras (split view) would need two tables.

## 2026-10-16 — Phase 2c follow-up: reduced-resolution march from space

### Why

The first timing on a real GPU (reported by the maintainer): much faster than the pure march at the surface, and
nothing to draw when far out in space, but the performance drops in between (camera above the air, planet filling
much of the view). That follows from the design: the sky-view table only serves a camera inside the air, so above it
every pixel on the planet disc runs the full 32-step march. Cost is about `steps x planet pixels`, which peaks where
the planet fills the screen.

### What changed

| File | Contents |
|---|---|
| `atmosphere-backdrop.ts` | `spaceScale` option (default 0.5, 0 = off), `spaceLowResEnabled` uniform, `spaceRenderCount`, `spaceSize`. `update(renderer, camera?)` renders radiance and transmittance of the camera view (one march, two colour attachments) into a `scale x drawing buffer` target while the camera is above the top of the air, and the main pass bilinearly upsamples it instead of marching. Inside the air nothing changes (table, or the full-res march when the table is off). Without a camera argument the pass is skipped and the full-res march is used |
| `atmosphere-backdrop.spec.ts` | pass runs only above the air, size follows the drawing buffer, the checkbox uniform and a missing camera turn it off |
| lab | "half-res march from space" checkbox, with the pass size shown |

The ground disc is still shaded at full resolution (analytic ground, checker, sun disc); only the air's radiance and
transmittance come from the small target, so the checker stays sharp and half-res only softens the haze.

### Results / open

- Checked by eye in the lab (Earth, space day side and the backlit limb): checkbox on and off look the same at the
  limb; the thin backlit limb stays coloured and crisp enough. The pane is software-rendered, so no timing here.
- **Not timed.** Maintainer: compare the GPU readout with the checkbox on and off from "Low orbit, limb" through
  "Space, day side". Expected about a 4x cut in march cost there. If the limb shows stair-stepping or a halo on the
  ground disc's edge (the bilinear mix of ground-hit and sky-only rays), try `spaceScale: 0.75` or a depth-aware upsample.
- If half-res is still too slow in the mid range, the next step is the proper from-space table indexed by
  (altitude, view zenith, sun angle) (option 3 in the discussion), or fewer steps from space.

### Correction: the first version did the march twice

The maintainer measured the checkbox on the "small planet at 735 m" case and still saw a drop from about 165 fps to 87 fps.
Cause: the first version packed radiance and transmittance side by side in one target, so each of the half-res texels ran
the full march once for each half; half-res (a quarter of the pixels) therefore only halved the work. It now writes
both with two colour attachments (`outputStruct`, one march per texel), which is the intended 4x. In TSL the struct
must be the material's `fragmentNode` itself (inside an `Fn` it is not recognised and the pipeline fails with
"struct member m0 not found"), so the march is computed in an `Fn` returning a `mat3` and unpacked outside it.
Note the sky-view table still uses the side-by-side layout (it only renders on altitude or sun changes).
Also unverified: whether 735 m on the 64 km planet is above the top of the air (the profile top scales with the planet).

## Phase 2b: atmosphere on the planet material (2026-10-16)

Plan 050 reached Phase 4 (slots built), so Phase 2b started. The first slice is on a `PlanetSurfaceMaterial` globe with the
morph at 0 (`/atmosphere-planet`). The cell-planet streaming demo and the eclipse hookup are not done.

### What was built

| File | Contents |
|---|---|
| `atmosphere-planet-stages.ts` | `PlanetAtmosphereBinding`: uniforms (sun in the body frame, camera in the body frame, camera altitude, metres per unit, exposure), `sync(camera, planet, backdrop?)`, `lighting()` (stage 4) and `perspective()` (stage 6). Structural context types, so the atmosphere entry does not import `planet-material`. |
| `atmosphere-backdrop.ts` | `frame` (world to local rotation, identity by default) applied to the view ray in the main and the space pass, so a planet seen from any side can use the backdrop for the sky and limb. |
| `atmosphere-gpu-model.ts` | `groundIrradiance(up, sunDir?)`: the sun can be passed in (the stage uses the body-frame sun). |
| `planet-lighting.ts`, `planet-surface-material.ts` | `ILightingInput.emissive`: the emissive sum, so a lighting stage that relights from the albedo can add it back. |
| spec | `sync` maths (altitude, local frame, planet turned), and on the GPU: bright toward the sun, dark away, aerial perspective adds blue. |
| demo | `/atmosphere-planet`: size, preset, three camera heights, toggles for each stage and the sky, sun and exposure sliders. |

### Decisions

- The atmosphere stage works in the planet's body frame, with a local frame built from the camera's radial direction, so the
  planet can sit and turn anywhere. The camera altitude is a float64 number (as in the lab); the camera position is a float32
  uniform in metres.
- `lighting()` replaces the PBR result (it relights from the surface albedo) instead of modulating it: the atmosphere's sun
  colour and sky light cannot be expressed as a scale on white-light PBR. Normal maps and scene lights do not reach it.
- Aerial perspective is one 16-32 step march per fragment for now. It takes the surface point on the sphere of the radius, so
  terrain height and the mid-morph flat map are not modelled; the froxel table is the planned replacement.

### Results / open

- Checked by eye in the browser pane (software rendering, no timings): the globe is lit with a soft terminator, the aerial
  perspective washes it with a blue-lilac haze from space, the sky toggle adds the blue limb. No console errors from the page.
- **Open:** the maintainer's visual check (dusk on the ground, low orbit, the 64 km vs Earth sizes, Mars air), timing of the
  per-fragment march on a real GPU, the horizon view from the ground (the demo's view buttons look straight down), the
  `/planet-material-extensions` eclipse with the atmosphere on, the `cell-planet-tsl` demo, and the gate shots at `m = 0`.

### Cell planet wiring (2026-10-17)

- `/atmosphere-planet`: the maintainer's visual check passed, and fast camera rotation showed the atmosphere fading because it
  was updated on `tick$`, before the orbit controls moved the camera. It now updates on `beforeRender$`; fast rotation is
  clean. A "Horizon (on the ground)" camera view was added.
- `/cell-planet-tsl` now fills the lighting and atmosphere stages with `PlanetAtmosphereBinding` and draws the backdrop behind
  the globe (`?atmosphere=0` leaves the stock lighting). Both stages are blended by a uniform equal to `1 - morph`, and the
  backdrop is hidden past `morph = 0.5`, since the stages model a sphere: mid-morph haze is Phase 3. The scene stands in for
  the planet transform (the planet is at the origin) and one world unit is a metre. The ocean shell, map frame and grid lines
  have their own materials and are not hazed yet.
- Not yet checked on a real GPU: the browser pane renders at about 1 fps, too slow for the streamed tiles to arrive, so only
  the maintainer's look at `m = 0` is outstanding (cells, macro variation, terrain relief losing its normal-map shading).

- `/cell-planet-tsl`: the Atmosphere panel is a collapsible section, with an air-height slider (percent of the radius, rebaked on
  release, with a "preset height" reset) so the air can clear the page's exaggerated relief.

### Froxel aerial perspective (2026-10-17)

The maintainer's timings showed the surface march was nearly the whole cost on the planet pages: `/cell-planet-tsl` ran 165 fps with
`?atmosphere=0` and 42 fps with it, `/atmosphere-planet` 80 fps, the lab (backdrop only) 160 fps. The page's checkbox is not a
baseline: it blends the result away but the march stays in the shader.

- `atmosphere-aerial-perspective.ts`: `AtmosphereAerialPerspectiveLut`, a two-attachment render target (radiance and optical depth)
  of `64 x 36` screen texels by 32 distance slices laid side by side, filtered by hand between two slices. Each texel marches its own
  ray to its slice's distance with `ignoreGround` (new on `march` and `traceRay`), so a ray that dips under the sphere still stands
  for the distance it is asked about. It is re-rendered only when the camera, the sun or the profile moved
  (`PlanetAtmosphereBinding.update(renderer)`).
- In the air the slices run `rangeMin + w^3 (rangeMax - rangeMin)`, from where the air begins to past the horizon. From above the
  air they run along each ray's own span instead (last slice at the ground hit or, for a ray that misses, its closest approach),
  and texels that miss the planet are aimed at its limb. Reason: the sphere falls away under a ray tilted by one texel by an amount
  comparable to the air's height; with absolute distances that under-hazed the nadir of a far small planet by 2.4x.
- Optical depth, not transmittance, is stored and filtered: it is far smoother across a limb.
- The lookup in `perspective()` takes the screen position from `cameraProjectionMatrix * positionView` and the distance from
  `context.cameraDistance`. The unprojection uses depth 0, not the far plane: with a huge far the far-plane point cancels to zero
  in float32 (the first version found no air).
- Both planet pages opt in (`aerialPerspective: true`, `binding.update(renderer)` before the backdrop update).
- Spec: the table matches the per-ray march within 8% (plus a small absolute margin) at the ground, 8 km up and from space, and
  re-renders only on movement; `binding.update` is covered too. Known limit: within one texel of the planet's limb the table
  under-hazes (about 2x at the worst sample of a 100 km planet at 2.2 radii), so the spec's space samples stay clear of it.
- Open: the maintainer's frame rates on the two pages (expected near the 165 fps baseline), and the look at the rim and at the
  horizon from the ground. The mid-morph flat map is still Phase 3.

### Ocean shell and checkbox (2026-10-17)

- `/cell-planet-tsl`: the ocean shell takes the same lighting and haze stages as the terrain (it is a `PlanetSurfaceMaterial`), so the sea no longer reads flatter than the land. Its opacity is unchanged, so the haze tints the sea colour rather than adding to it. The map frame stays unhazed: it only shows once the globe has unrolled, where the atmosphere amount is already zero.
- The Atmosphere checkbox is now a real cost toggle: both stages sit behind a uniform branch on the atmosphere amount, so with it off (or the globe unrolled) the shader skips the sky lookups and the haze fetch. Needs the maintainer's fps check against `?atmosphere=0` (165 fps); the fallback is rebuilding the stages on toggle.

- Terminator stair-steps (maintainer screenshot, dusk from space): the table's texels showed where the sunlit/shadow edge is sharper than a texel (bilinear of a step reads as blocks). Default grid raised from 64x36 to 128x72 slices (4096x72 target); `width`/`height` options trade it back. A sharper fix, if still visible, is to march the last slice per pixel near the limb.

- Terminator stair-steps, second pass (second opinion from a subagent: a screen-space fix cannot work, a sharp edge is blocks in any table): the table is now built without the planet's shadow (`march({ unshadowed: true })` reads the sun's transmittance at no lower than the horizon direction) in three attachments, sunlit single scattering, optical depth and multiple scattering. `lookup` cuts the stretch of the ray that lies in the shadow cylinder out of the sunlit part per pixel (`sunlit(d) - (sunlit(to) - sunlit(from))`), so the terminator is exact at pixel resolution for six texture fetches more. Spec: a dusk case at 40 km looking into the shadow matches the per-ray march. Open: maintainer's look at the terminator, and the cost (fps) of the extra fetches.

## Phase 3, first slice: haze through the morph (2026-10-17)

What exists: the surfaces keep their atmosphere through the whole morph and on the flat map (it used to fade out with `1 - morph`).

- `AtmosphereGpuModel.slab({ distance, cameraHeight, cosNu, muSun })`: the air between a surface point and the camera on a flat map, closed form. Density falls off with the height above the point's own plane, so each species' column is the path length times `(1 - e^-x) / x` (`x = cameraHeight / H`); the sun and the sky are read once at the point's own sun angle; in-scatter is `source * (1 - T) / tau` per channel. The absorber (ozone) is not modelled, so twilight is a little less blue. Spec: matches the per-ray march within 15% where the sphere is flat enough (3 km up looking down, 500 m grazing).
- `PlanetAtmosphereBinding.morph` (0 globe, 1 map) and `bodyToView` (set by `sync`): `perspective()` is now `mix(spherical haze, slab haze, morph)`, the slab part behind an `If(morph > 0)` so the globe pays nothing. The slab's up is `normalize(mix(sphereNormal, +Z, morph))` (the morphed sea-level normal), its sun angle the intrinsic `dot(sphereNormal, sunBody)`. The lighting stage already used the point's own sun angle, so dusk crosses the map where it should.
- `/cell-planet-tsl`: sets `binding.morph`; the surface amount stays 1 through the morph; only the backdrop (the sphere's sky) is hidden at `morph >= 0.5`.

Limits and open, in order:

1. Not looked at on a real GPU: scrub the morph at dusk for pops (the crossfade is linear in `morph`), and the flat map from low angles.
2. The sky behind the map: the backdrop is still a sphere's sky and just switches off at 0.5. A crossfade of the camera's sky for its sphere and flat poses (plan, section Morph) is not built, and neither is the flat map's edge fade or glow (`flatMapEdge`).
3. The slab ignores the fragment's own height (terrain on the map reads as sea level, slightly over-hazed) and the sun's change along the path (fine except right at the terminator).
4. Per-sample sun angles through the froxel table on the flat map (plan: "froxels with per-sample mu_s") are not done; the slab uses the fragment's angle for the whole path.

### Deferred items noted for later (maintainer asked for these to be written down)

- Look pass on a real GPU: the planet's rim (the table under-hazes the last texel of the disc by about 2x), the ground horizon, dusk, the Mars preset and the lilac tuning.
- Eclipse hookup (`sunVisibility` into the atmosphere so the sky darkens as well as the ground).
- Re-run `npm run build:triangular-engine` (not run since the froxel table, the unshadowed table or the slab).
- Maintainer's fps on both planet pages after the terminator change (three attachments, six more fetches) and the checkbox branch; fallbacks: table back to 96x54 or 64x36 (`aerialPerspective: { width, height }`), rebuild stages on toggle.
- The map frame is not hazed on purpose (it only shows once the atmosphere is already off); revisit with the flat-map edge.
- Plan 049 phases 4 to 6 (coverage, sky objects, extensions demo).

### Phase 3, second slice: sky crossfade and `sunVisibility`

- `AtmosphereBackdrop.opacity` (0..1) fades the sky to space. The cell page fades it with a smoothstep over morph 0.2 to 0.8 (it used to switch off at 0.5) and hides the mesh at 0. The sky stays opaque and fades to black: a `transparent` backdrop is drawn after the opaque terrain and paints over the land.
- `PlanetAtmosphereBinding.sunVisibility` and `AtmosphereBackdrop.sunVisibility` (0..1) are the eclipse hookup: the haze in-scatter, the sky light on surfaces, the sky and the sun disc scale by it (`sync` copies the binding's value to the backdrop). Surfaces still multiply their own occluders into the direct light. The cell page does not drive it yet; nothing has been seen on a GPU.
- Still open: flat-map edge fade or glow, the slab's fixed sun angle and ground height, per-sample sun froxels on the map.

- Whitewash at dusk mid-morph (user report): a ray grazing the blended plane counted the full distance in dense air. `slabPerspective` floors the ray's elevation (height >= distance x 0.6 x morph x (1 - morph)), so the airmass stays near 7 at morph 0.5 and nothing changes at 0 or 1.
- Follow-up: the floor is now 0.15 x min(3 morph, 1), so it also covers the flat map (morph 1), where a low view of the map was still whitewashed. Only morph 0 is unchanged.

## 2026-10-17 — External review, checked against the code (cloud session, code reading only)

An external agent reviewed `atmosphere/**` and the two atmosphere labs (commits `3116d9b..ceda232`). Each finding was then checked against the code at `ceda232`. Nothing was changed in code; this entry is the verdict and the fix order.

### Confirmed, fix now (in this order, a spec for each)

1. **Sky-view halo ignores the sun's azimuth.** The table is already baked relative to the sun's horizontal direction (`buildRenderNode` rotates the ray directions by it), so its content does not depend on azimuth. The bug is only in `lookup()` (`atmosphere-sky-view.ts:161`): it reads `sunHorizontal()` from the frozen `lutSunDirection`, which updates only on a re-render, and `isDirty()` only watches altitude and sun elevation. Moving the sun's azimuth at a fixed elevation (lab), or orbiting the camera on the planet page (the sun rotates in the local frame), leaves the glow behind while the sun disc moves. Fix: take the horizontal direction in `lookup()` from the live `model.sunDirection`; no rebuild needed. Spec: change the azimuth at a fixed elevation and check that `lookup()` follows it without a re-render.
2. **Irradiance and multi-scatter tables read the wrong altitude at the ground.** Both are baked at texel centres (`atmosphere-luts.ts:191`, `(y + 0.5) / height`) but sampled with a plain `alt / top` (`atmosphere-gpu-model.ts:308`, and the slab's `psi` at line 509), so altitude 0 clamps to the first row: about 1.9 km for irradiance (16 rows, Earth) and about 0.9 km for multi-scatter. Every lit ground pixel's sky light is read above most of the Mie layer. The CPU sampler has the same offset, so the GPU-vs-CPU specs could not catch it. Fix: bake edge-aligned (`y / (height - 1)`, `x / (width - 1)`) and sample with `unitRangeToTexcoord`, like the transmittance table. Spec: ground irradiance at altitude 0 matches the reference integrator at altitude 0.
3. **The two `sunVisibility` values do not agree** (`atmosphere-planet-stages.ts:207-209`). Direct light is scaled only by the stage-3 occluder input, sky light only by `binding.sunVisibility`. Setting `binding.sunVisibility = 0` darkens the sky and the haze but leaves the ground in full sun; a stage-3 eclipse darkens direct light but not the sky light. No page drives either yet. Fix: scale direct and sky light by both. Spec: either value at 0 darkens both direct and sky light.
4. **Reduced-resolution space pass renders every frame** (`atmosphere-backdrop.ts:300`). Unlike the sky-view and froxel tables it has no dirty check, so idling in orbit re-marches it each frame. Fix: skip when altitude, target size, profile version, sun, projection inverse and camera matrix are unchanged.
5. **Globe haze is computed on the flat map.** `perspective()` always runs the spherical lookup and then mixes it out at morph 1, and the cell page still calls `binding.update()` there, re-rendering the froxel table as the camera moves. Fix: skip both at `morph >= 0.999`. The four shadow-cut fetches in `lookup()` could sit behind `If(shadow.to > shadow.from)`; measure before doing it.

### Confirmed, design call or lower priority

- **Slab elevation floor fakes the camera height.** The floor (`max(height, distance x 0.15)`) is deliberate (it stops grazing rays whitening), but it works by raising the camera: at 10 m looking 50 km across the map, the slab sees a camera at 7.5 km, which cuts the low Mie haze about sixfold and distorts the Rayleigh-to-Mie ratio. Better: keep the true height and cap the airmass (the column) directly. Compare low views of the flat map before and after.
- **Backdrop fades to black during the morph.** The plan asks for a crossfade between the camera's sky for its sphere and flat poses; the code dims the sphere's sky to black over morph 0.2 to 0.8 while the surfaces keep full haze, so a low view mid-morph can show a hazed horizon under a black sky. Maintainer decides: build the flat-pose sky, or fade by camera height above the slab instead of by morph.
- **Planet scale.** `sync()` converts the camera through `planet.worldToLocal` (scale included), but `context.cameraDistance` is in world units times `metersPerUnit`, so a scaled planet breaks the units. The pages pass the scene (unit scale). Document "planet must have unit scale", or fold the world scale into `metersPerUnit`.
- **Precision in the no-froxel fallback.** `sphericalPerspective()` without the table builds the ray from `surfacePoint - cameraBody`, two Earth-sized float32 vectors. Taking the direction from `viewToLocal x normalize(positionView)` is camera-relative and also drops the per-fragment basis. Cheap; do it with item 5.
- **Nits.** `AtmosphereAerialPerspectiveLut.isDirty()` allocates its signature array every frame. The `'none'` profile has no zero-cost path in the GPU model or the binding; write it into the plan as deferred.

### Not taken

- **Ocean shell alpha and in-scatter.** The reviewer's own derivation shows the blend is right where the shell lies over the seabed, which is the case on the planet. The ocean losing its specular under atmosphere lighting is by design (stage 4 replaces the PBR result).
- **"`docs/atmosphere.md` does not exist".** It does, at `projects/triangular-engine/docs/atmosphere.md`.
- **Worker baking** is already recorded as deferred above (bake is synchronous on the main thread).

### Plan drift worth writing into Plan 049's status (owner's call)

- `nearHazeFadeM` is validated on the profile but never applied on the GPU.
- The labs render without an HDR `RenderPipeline`, bloom or post AA; exposure is applied inside the atmosphere shaders.
- Scene-light sync from the tables (sun colour, ambient at the focus point) is not built.
- The flat map uses the closed-form slab, not froxels with per-sample sun angles, and the froxel table is 128x72x32, not 32x32x32. Both are improvements on the plan; the plan should follow the code.

### Untested paths the review found

Sun azimuth changes on the sky-view table; `binding.sunVisibility`, the stage-3 input and `backdrop.opacity`; `perspective()` at `0 < morph <= 1` (the slab is only tested alone); horizon-straddling elevations in the sky-view spec (it skips -4° to +4°).

### 2026-10-17 — Review fixes 1 to 5 done (atmosphere agent)

All five confirmed findings are fixed, each with a spec (136 atmosphere specs pass):

1. `AtmosphereSkyViewLut.lookup()` reads the horizontal sun direction from the live `model.sunDirection`; the table is still rendered with the frozen one. Spec: a new azimuth at the same elevation matches a freshly baked table with no re-render.
2. The irradiance and multi-scatter tables are baked edge-aligned (`x / (w - 1)`, `y / (h - 1)`) and read through the same mapping on the CPU (`sampleIrradianceLut`, `sampleMultiScatteringTable`) and the GPU (`edgeAlignedUv`, `multiScatterAt`), so altitude 0 is a row of its own. Specs: the ground row is returned at altitude 0 on the CPU, it matches a direct hemisphere integral, and the GPU reads agree with the CPU.
3. `lighting()` multiplies direct and sky light by both sun visibilities (the stage-3 input and `binding.sunVisibility`). Spec: either at 0 darkens the whole lit colour.
4. `AtmosphereBackdrop` skips the reduced-resolution space pass while altitude, size, profile version, sun, frame, projection inverse and camera matrix are unchanged. Spec: counts the renders across each change.
5. `perspective()` computes only the slab from `morph >= 0.999`, and `binding.update()` returns false there (so the pages need no guard of their own). Specs: no table re-render at morph 1, and a flat-map pixel is the same with or without a table. The four shadow-cut fetches in `lookup()` are not guarded: measure first.

Open design items (maintainer's call, not done):
- **The slab's minimum ray elevation** (`max(height, distance x 0.15)` from morph 0.33 up) raises the camera instead of capping the airmass; a low view of the map sees a higher camera than it has. Better: keep the true height and cap the column. Compare low views before and after.
- **The backdrop crossfade**: the sky fades to black over morph 0.2 to 0.8 instead of crossfading to a flat-map sky as the plan says. Build the flat-pose sky, or fade by camera height above the slab.

Notes:
- `nearHazeFadeM` is validated on the profile but never applied on the GPU.
- The planet must have unit scale: `sync()` converts the camera through `planet.worldToLocal` (scale included) while `cameraDistance` is world units times `metersPerUnit`. The pages pass the scene.
- Not done from the review's smaller items: the camera-relative ray in the no-froxel fallback, the per-frame array in `AtmosphereAerialPerspectiveLut.isDirty()`.

- Sky fade, option B (maintainer chose it): the cell page now fades the backdrop by morph (0.2 to 0.8) times camera height (one to four air heights above the planet), so a low camera keeps the sphere's sky behind the hazed horizon at any morph. The flat-pose sky (option A) is still the plan's version and is not built.

### Flat-pose sky (option A, built)

- `PlanetAtmosphereBinding.sync` now gives the backdrop its own sky frame, height and sun; the haze keeps the radial frame (`frameMatrix`, `sunLocal`, `cameraAltitude`), pinned by a spec that compares them at morph 0, 0.5 and 1. The sky's up slerps from the camera's radial direction to the map's +Z by `morph`; `skyAltitude` blends the sphere altitude to `z` (the map is the plane z = 0 through the centre; the material's flat positions carry only the terrain height); the sky sun keeps the sun angle under the camera (`skyAnchorBody`, default the camera's own direction) with the azimuth projected onto the sky's horizon. Only the backdrop and the sky-view table read `model.sunDirection`, so nothing else moves.
- `AtmosphereBackdrop.voidFade` (set to `morph` by `sync`) fades the sky below the horizon to dark over about 10 degrees, so the map edge meets the sky without a hard line. This is the `flatMapEdge: 'fade'` default for the sky; the glow outline and the haze fade near the edge are not built.
- The cell page fades the sphere sky by `skyAltitude` (above the air's top) instead of the sphere altitude. A single blended up replaces the plan's two-evaluation crossfade (no second sky table, no double horizon); revisit if mid-morph looks squashed.
- Not looked at on a real GPU yet.
- The slab's elevation floor stays permanent (it adds detail the maintainer wants; the whitewash itself was fixed by the external reviews).

### Morph camera (ground-anchored)

- Problem: the camera and the orbit target live in the scene, but the morph moves every surface point by `mix(sphere, flat, morph)`, so scrubbing the morph slid the ground out from under the camera, lost the viewing angle, and left the orbit controls' up at +Y.
- `CellPlanetMorphCameraRig` (`triangular-engine/worldgen/render`) holds an anchor: the ground point straight below the camera (the point whose surface normal passes through it), found by a fixed-point search on the ground's own morph (`mix(radius * dir, projected map point, morph)`) seeded with the previous anchor. A low, level look therefore keeps its exact altitude (the view ray would hit the horizon, or never hit the map). When `morph` changes it carries the camera and the target rigidly from the anchor's ground frame (east, north, normal) at the old morph to its frame at the new one, so height, angle to the surface, bearing and place over the ground are kept. The frame blends as the material does (normal toward +Z, north toward +Y). It then sets the controls' up to the ground normal and re-aims the camera (no roll jitter). While the morph is steady it re-finds the anchor each frame, so orbiting and panning move it.
- A straight top-down view has no horizon to roll against, so the rig tilts the camera 1e-4 rad off the normal (as the orbit controls keep their polar angle off the pole).
- Limits: the anchor sits on the base surface (terrain relief ignored); the flat map is the plane `z = 0`; the orbit controls' up becomes the ground normal even at morph 0 (no pole lock) once the rig runs.
- The cell page runs it every frame, after the orbit controls and before the sky sync, with a "keep ground in morph" checkbox (on). Specs cover the frames, the anchor solve, invariants over a full morph and back, small steps, panning, the top-down tilt and a view that misses the ground.
- Checked on the live page by driving the rig by hand: a camera 0.4R above and 0.3R behind an off-centre ground point stays at the same east, north and height offsets at morph 0, 0.25, 0.5, 0.75 and 1, and its up goes from the radial direction to +Z. The browser pane's frame loop did not run, so the scrub itself was not watched on screen.

## 2026-10-18 — Morph redesigned: bend instead of a straight-line blend (cloud session, code reading only)

The owner reported the flat map and mid-morph atmosphere as not working, with three screenshots:

1. The globe: the rim glow is good.
2. The flat map from above: half the map is dark, and there is a hazy tint with no glow at the map's edges.
3. The flat map seen from the side, low: the whole background is blue sky, "added globally at the back", not
   attached to the map the way the globe's air is.

What the code does (read at `ac165b8`):

- Screenshot 3 is by design. `AtmosphereBackdrop` is a full-screen sky for a camera `skyAltitude` above an
  endless ground (`atmosphere-backdrop.ts`, "It does not use scene depth or any planet geometry"). On the flat
  pose a low camera is inside that endless air, so every pixel is sky. That is right for an infinite plane and
  wrong for a finite map.
- Screenshot 2's dark half is the night side: each point's sun angle comes from its globe direction, so dusk
  crosses the map. Deliberate. The owner wants to keep it and add an always-day toggle.
- The missing edge glow is the `flatMapEdge: 'glow'` option, which was never built. A flat sheet of air has no
  rim, so from above every ray is short.
- Underneath it all: the straight-line morph `mix(spherePos, flatPos, morph)` gives mid-morph shapes that are
  no sphere at all (the owner also sees the map's four corners curl up sharply). Every atmosphere piece
  assumes a sphere, so each got a stand-in (the slab, the flat-pose sky, the sky fade, the elevation floor),
  and that is where the bugs of the last two days came from.

Decisions (owner, 2026-10-18), written into Plan 049 (§Day and night, §Morph, Phase 3, §Decisions) and Plan 050
(§Morph shape: bend):

- **Bend morph.** Every in-between shape is a piece of a sphere whose radius grows from R to infinity
  (curvature `k = curve(morph) / R`). The atmosphere's radius is already a uniform (`uRadius`, `uTopRadius` in
  `AtmosphereGpuModel`), so the globe maths applies at every morph value with radius `1/k`, written in a
  curvature form that is exact at `k = 0`. TSL material only; the GLSL materials keep the straight-line morph.
- **Map mask.** The space view's density is zero outside the map's outline (soft falloff). That gives glowing
  map edges for free and no air where there is no map. It replaces the edge fade and outline question. The
  stylized outline stays optional (Phase 7).
- **Atmosphere supported through the whole morph.** The owner asked for this. Only the baked tables
  (transmittance, multi-scatter, irradiance) are approximate on a larger sphere; bake a few radii if the lab
  shows it.
- **Day/night:** real by default, plus a `dayNight: 'alwaysDay'` toggle.
- An air-skin mesh (a morphing transparent shell shaded by thickness) was considered and dropped. It works for
  any shape but only roughly, and with the bend there is a real sphere to use.

Kept until Phase 3c replaces them, then retired: the flat-pose sky blend (`skyAltitude`, `skyAnchorBody`), the
sky fade by morph and height, `voidFade`, and the slab as the mid-morph haze. The slab stays as the exact
`k = 0` case. The elevation floor stays until it is compared on low views of the bent map. The camera rig is
kept and moved onto the bent ground (3b).

Next: Phase 3a, the lab spike (Plan 049, Phases). Built and checked in the entry below.

## 2026-10-18 — Phase 3a: bent planet lab spike (built, gate checked in the Browser pane)

**What was built** (no planet material, no `/cell-planet-tsl` change; the slab, flat-pose sky and camera rig are untouched):

- `atmosphere/bent-planet.ts` (+ spec): pure maths. `bend(x, y, k, height)`, `bendFrame`, `curvatureAltitude`, `curvatureUp`, `rayAtAltitude` (the ray against any altitude sphere, stable form), `bentMapCoords` (inverse of the bend for the ground), `mapMaskFactor`, `sinc`/`asinc`/`atanc`/`vers`. `1/k` is never formed; `k = 0` is exact.
- `atmosphere/bent-atmosphere.ts` (+ GPU spec): `BentAtmosphere`. `traceRay` and `march` are the globe's, with the sphere's radius `1/k` in the curvature form; per-sample map coordinates feed the **map mask** and the **day/night sun angle**. Tables are read by altitude and sun angle on the baked radius.
- `/atmosphere-lab` (`bent-planet-lab.ts`, page): "bent planet" toggle, morph slider and a 0 → 1 → 0 sweep, camera anchor sliders (where over the map the camera hangs), `real` / `alwaysDay (50°)`, mask on/off, and four gate views. A 360 x 180 lon/lat grid mesh is rebuilt on the CPU with `bend()` whenever the morph or anchor changes (equirect coordinates; Equal Earth not done). Its fragments take a checker/graticule colour, table lighting and a 16-step march to the camera. A full-screen pass marches the bent air per pixel (32 steps, no sky-view table, no half-res space pass).

**Specs (headless): atmosphere suite 165/165.**
- Maths: morph 0 is the exact globe (centre `(0,0,-R)`), morph 1 is the flat map point, `k = 1e-9` vs `k = 0` agree, every in-between shape lies on the sphere of radius `1/k`, a ground point has altitude 0, and the curvature-form altitude, up and ray hit match a brute-force sphere at `k = 1/R .. 0.01/R`.
- GPU (headless WebGL): **at morph 0 `BentAtmosphere.march` equals `AtmosphereGpuModel.march`** (within 2% radiance, 0.01 transmittance, 8 rays from the ground to 3 Mm, mask on and off, so the mask cuts nothing from the closed globe). Stays finite from morph 0.9 to 1; `k = 1e-12` matches `k = 0`. The mask removes the air beyond the map edge (rays looking out past the edge see under 20% of the radiance of rays looking back over the map). `mapCoords` and `mapMask` match the CPU twins.
- The library builds (`npm run build:triangular-engine`) and the demo app compiles.

**Gate, by eye** (Browser pane, WebGPU, AMD GCN5; 800 x 600 canvas; screenshots taken in the session, not saved to the repo):
- *Space (3 R):* the globe, the bent patch at morph 0.5 (rounded rectangle, the sphere's limb glowing on the left, the night side dark with real day/night), 0.9 and 1 (the whole map, light blue tint, no air outside the outline). No pops between steps; nothing black except space.
- *Low orbit (0.05 R):* bright limb glow at morph 0 and 0.5; at morph 1 a haze band along the flat map's horizon with black above.
- *Low, side-on over the map (the old full-screen blue sky):* at morph 1 the sky above the map is dark with a thin glow along the horizon and the sun as a point. **No sky fills the screen.** Same at 0.5 and 0.9 (a curved horizon with glow).
- Not done by eye: a live scrub (the pane's frame loop only runs while it paints, so I stepped the slider and captured each step); glowing map edges from a close side view (the edge is far from the camera in the preset views); Equal Earth; `alwaysDay` was only checked from space.

**Frame time** (median of 15 frames of `renderAsync` + `queue.onSubmittedWorkDone`, 800 x 600; includes submission overhead, so treat differences under about 1 ms as noise): plain globe 4.1 ms (space), 4.3 ms (low orbit). Bent: space 4.7 / 4.1 / 4.5 (morph 0 / 0.5 / 1), low orbit 4.5 / 4.0 / 4.0, low side-on 5.4 (0.5) and 4.9 (1). **The bent planet is no slower than the plain globe at this size**, though it runs a full-resolution march plus a fragment march on the mesh. The page's `GPU` timestamp readout stalled in the background pane, so these are wall clock. Re-measure at 1080p with the pane in view.

**Things in §Morph that turned out wrong or incomplete**
1. **The sky-view table cannot carry the map mask.** The table is symmetric about the sun's azimuth and assumes an endless sphere, while the mask depends on where each sample sits on the map. §Morph says to fade between the space view and the table by "inside the air"; inside the air on a masked map the table would still fill the screen. The lab marches every pixel when bent. A real fix needs either the masked march inside the air at reduced resolution, or the table only for rays that stay inside the map.
2. **The shadow cut, not the baked tables, is the horizon problem.** `sunTransmittance` cuts the sun off at the *baked* planet's horizon dip, so on a large radius (flat map) the sun is cut off roughly 4.5° below the horizon at 10 km altitude instead of 0°. Invisible in the lab; a real error for dusk on the flat map. Needs a radius-aware dip (use `1/k`, as the geometry does) rather than baking more radii.
3. **Flat-limit rays need a span limit.** At `k → 0` the far root of the air's top is at infinity. `BentAtmosphere` clamps every march to the map's diagonal (about 44,700 km on Earth), and 32 uniform steps then span up to 1,400 km each on near-horizontal rays. It looks fine, but the integration is coarse there; an exponential step distribution would fix it if it shows.
4. **The mask needed two details the plan does not mention:** (a) wrap-around edges (the closed globe's seam and poles) get a falloff shrunk to the gap that has opened, and no mask at all while the gap is under `1e-5` of the map (`MASK_GAP_RAMP`), otherwise float32 noise cuts a line through the closed globe; (b) the day/night sun angle needs the same per-sample map coordinates, so it costs nothing extra.
5. **Shader precision:** the GPU's `asin` is a polynomial with about 2% relative error near 0.003, which put the map latitude 380 m off at 20 km. `BentAtmosphere` uses `atan(a / sqrt(1 - a²))`. `atan` is good to about 1e-4 relative (100 m at 1,000 km), fine for a mask with an 8 km falloff.
6. **Frame mapping: consistent, with one thing left for 3b.** `uProjForward/Up/Right` in `planet-morph-nodes.ts` form a right-handed frame (`right x up = forward`, `right = up x forward`). The bend's map frame (x right, y up, z forward, centre at `R·forward` at morph 0) matches it for equirect, and morph 0 lands exactly on the globe in the lab. It is not checked against the real material (3b). Equal Earth is *not* the globe at `k = 1/R` unless the coordinates are blended `mix(R(lon, lat), flatXY, p)` as the plan says; the lab uses equirect, so that blend is untested, and the mask outline then needs a per-row half-width.
7. **Sun for the phase function.** The march takes the sun angle per sample (`real`: the globe direction; `alwaysDay`: a constant), but the phase function needs one direction. The lab uses the anchor's local sun (`real`) or a fixed one (`alwaysDay`, 50° elevation, azimuth 135°). Revisit if the sun disc and the glow disagree on a wide flat map.

**Not done / limits of the spike:** Equal Earth blend; the slab fallback at morph >= 0.999 (the sphere path was stable at `k = 0` and `1e-12`, so it was not needed); surface haze through the froxel table (the lab's mesh uses a direct 16-step march); coarse tessellation of the grid mesh is visible at low altitude on Earth-size planets (sag, flat quads); the sweep was not watched live.

Next: 3b (bend in the planet material and the rig). Before that, decide item 1 (table versus masked march inside the air) and item 2 (radius-aware shadow dip).

## 2026-10-18 — Phase 3a follow-up: sky near edges, sun cut-off, outline clamp, Equal Earth, timings

Decisions applied from Plan 049 (§Morph: "Map edges from inside the air", "Sun cut-off", "March length on the flat limit"). The planet material, `/cell-planet-tsl`, the slab, the flat-pose sky and the rig are untouched. Atmosphere suite headless: **183/183** (165 before; 18 new). `npm run build:triangular-engine` succeeds.

**What changed**
- `bent-planet.ts`: `sunDipHalfSine` / `sunDip` / `sunHorizonCos` (the shared dip helper: `sin(dip/2) = sqrt(k h / (2 (1 + k h)))`, 0 when flat, `acos(R / (R + h))` at morph 0); `rayExitRect` (where a straight ray leaves the map rectangle plus a margin); Equal Earth (`equalEarthRow`, `blendedProjection`, `blendedExtents`, `projectionRows`, `projectionRowAt`).
- `BentAtmosphere`: `sunLight` (the sun's transmittance with the horizon cut at the current curvature's dip); the outline clamp in `traceRay` (`tExit`, `uClampMargin`); `skyGate` (per-ray choice between table and masked march); an outline-row table for Equal Earth (`mapRow`, used by the mask and by the sun angle); `mapEdgeDistance` and `clearAirDistance` for the camera-level switch; `revision`; `projection` in `setShape`.
- `AtmosphereSkyViewLut`: option `bent`. The table is baked for the sphere of radius `1/k` (horizon row from the curvature, no map, the local sun) and re-renders when `revision` changes.
- Lab (`bent-planet-lab.ts`): the sky is one table fetch by default; a half-resolution masked pass is rendered only when it is needed and is blended in per ray; the per-fragment grid march is gone; the checker and graticule are filtered; buttons for projection (equirect / Equal Earth) and sky path (table + edges / table only / march every pixel).

**Sun cut-off.** The tables cut the sun at the *baked* sphere's horizon. `BentAtmosphere.sunLight` shifts the angle it reads by (baked horizon) − (horizon of the current curvature), so the cut lands where the current sphere puts it and the table still gives the transmittance of the rest of the path. Spec: at morph 0 it equals `sunTransmittance`; flat at 10 km, `mu = -0.02` (a degree down) is dark and `mu = +0.02` is lit, where the baked planet still lit `mu = -0.02` (transmittance > 0.05). Limit: on the flat map a sun just above the horizon reads the baked sphere's grazing transmittance; the true flat-map value (infinite airmass) would be darker. Not a visible problem yet.

**Sky near edges.** Kept the plan's rule (table by default; masked pass at half resolution near edges and from above the air) and added a **per-ray gate** (`skyGate`), because the camera-level switch alone was far over budget (below). A ray needs the masked march only if it leaves the map outline before it leaves the air *and* the air in front of it is not already opaque: the weight is `smoothstep(0.003, 0.03, exp(-tau))` with `tau` the optical depth to the outline in the clearest channel (Rayleigh, exponential layer, closed form). Rays that end on the ground inside the map at a steep angle (`dot(dir, up) < -0.2`) are skipped: the mesh covers them. Grazing rays are kept so a bilinear fetch near the horizon has no hole to bleed into. The camera-level switch is the plan's: the pass is rendered only when the camera is above the air, or within `1.5 D` of an open edge (`D` = horizontal transmittance ~1%, Rayleigh red only, so it errs toward rendering). At `1.5 D` the per-ray weights are already 0 for every ray, so nothing pops at the switch.

**Outline clamp.** Each march stops where its (straight, in the map frame) ray leaves the map rectangle plus `margin = softness + 1.5 k top max(W, H)` (the second term covers the `1 + k h` factor between a point's map-frame coordinate and its map coordinate). Exact at `k = 0`. The table's march (`local`) has no map and no clamp (a first version clamped it too: a hairline across the sky where the clamp bit, found by eye).

**Equal Earth.** `(x, y) = mix(R (lon, lat), EqualEarth(lon, lat) R, p)` with `p = morph`. Equal Earth is `x = lon c(lat)`, `y = y(lat)`, so a row's width and latitude are functions of the row alone: the outline is a 256-row table (latitude, half-width) rebuilt when `p` or `R` changes. The mask uses the row's half-width; the sun angle uses the row's latitude and `lon = pi x / halfWidth(row)`. Specs: published extents (2.7066 R by 1.3174 R), equal area (4 pi R^2), blend ends, table inversion, GPU row lookup vs CPU, mask in and out of a row at 60 degrees, sun cosine. By eye from space: the flat Equal Earth map has the right outline with no air outside it ([morph 1](049_assets/3a-followup-equal-earth-space.jpg), [morph 0.5](049_assets/3a-followup-equal-earth-half.jpg)).

**Gate, by eye** (Browser pane, WebGPU, AMD GCN5; 600 km planet; screenshots in `049_assets/`; not a live scrub, each state captured after rendering 8 frames):
- *Low near an edge* (3 km up, 7.5 km from the east edge, looking at it): the air over the map shows as a bright blue band right above the ground strip, then black where the map ends, and dark sky above the horizon: [3a-followup-edge-close.jpg](049_assets/3a-followup-edge-close.jpg). That is the glowing edge, and nothing fills the screen beyond it.
- *Low, 200 m, 75 km from the edge:* blue sky, no seam, no hairline ([edge-low](049_assets/3a-followup-edge-low.jpg)).
- *Side-on, `alwaysDay`:* inside the air (200 m, 5 km: on this scaled planet the scale height is 0.75 km, so 5 km up is already dark sky) and above it (30 km, [side-on above the air](049_assets/3a-followup-side-on-above-air.jpg)): the checker fades to grey toward the horizon instead of aliasing, and no sky fills the screen.
- *From space framed on an edge* (600 km up over the east edge): a clean straight edge, black void beyond.
- Not seen: a thick rim glow from space at the edge (needs a grazing view along it that the camera, always over the map, cannot take); a morph scrub through Equal Earth at small morph (0.05-0.3).
- The dark ring in the reported screenshot is not reproduced. Between that screenshot and now the per-fragment grid march (which carried the baked horizon) was dropped and the dip fixed, so I cannot say which removed it. Without the grid march the ground has no haze in the lab; that comes from the froxel table in the planet.

**Timings** (GPU timestamps, a manual `renderAsync` + `resolveTimestampsAsync('render')` loop, median of 40 frames; canvas 1896 x 1080 (1.5 DPR in a 1280 x 720 viewport, 0.88 of 1080p); Earth-size planet except the Equal Earth and space rows (600 km); AMD GCN5; noise about 0.3 ms). The page's own timestamp readout stalled in the background pane, hence the manual loop. An empty frame is 0.4 ms; a trivial full-screen quad is 1.05-1.1 ms; the sky numbers are *over the quad*.

| Sky only (grid hidden) | total ms | over a trivial quad |
| --- | --- | --- |
| Table path (in the air, edges far, morph 0 or 1) | 1.25 | **+0.14 to +0.2** (budget 0.5) |
| Masked pass active in the air, 25 km up, morph 0.5 / 1 | 1.38 / 1.77 | +0.33 / +0.72 (budget 1.0) |
| Masked pass active, 10 m up, 200 km from the edge, morph 0.5 / 1 | 1.77 / 1.64 | +0.7 / +0.6 |
| 600 km planet, 10 m up, 0.98 of the way to the east edge, Equal Earth vs equirect, morph 1 | 2.88 vs 1.84 | +1.8 vs +0.8 |
| 600 km planet, space (3 R), morph 1, equirect / Equal Earth | 3.0 / 3.5 | |

Whole frame (grid mesh included, about 1.0-1.3 ms of it; plain = the globe backdrop of the same page):

| view | plain | bent, auto (table + edges) m 0 / 0.5 / 1 | bent, march every pixel m 0 / 0.5 / 1 |
| --- | --- | --- | --- |
| Space, 3 R | 1.05 | 2.03 / 2.36 / 3.6 | 4.3 / 8.5 / 23.1 |
| Low orbit, 0.05 R | 1.51 | 3.6 / 3.74 / 4.06 | 21.8 / 24.6 / 26.4 |
| 25 km up | | 1.97 / 2.29 / 2.69 | 44.5 / 43.2 / 39.1 |
| 2 m up | 1.64 | 1.7 / 1.9 / 1.64 | 1.77 / 1.77 / 1.57 |
| 10 m up, 200 km from the edge | | 1.57 / 2.10 / 1.97 | 1.84 / 1.64 / 1.31 |

Before the per-ray gate (camera-level switch only): 25 km up at morph 1 cost 9.5 ms (8.7 ms for the masked pass), and space at morph 1 cost 6.2 ms. The reported 12 fps was the 3a spike's per-fragment march plus a full-resolution march for every pixel: the "march every pixel" column above, now only a diagnostic.

**Findings for 3b / the plan**
1. **A TSL trap, found the hard way.** A node used both inside another variable's initializer and on its own was built twice, and the second copy could read the wrong value: `traceRay`'s `hitsGround` read 0 for a ray that plainly hit the ground (and `groundDistance` 0 for one row) depending only on which outputs the test used. Fix: every shared quantity is its own `toVar()` in dependency order, and later code uses the variables. The globe's `AtmosphereGpuModel.traceRay` has the same shape as the bent one had (and I did not touch it); the backdrop's ground and sun-disc tests read its `hitsGround`. It looks right in the lab, but it is worth a spec that checks `hitsGround` and `groundDistance` against the geometry for a few rays before anything else leans on it.
2. **The camera-level switch is not enough** at this scale: the masked march in the air was 8.7 ms at morph 1 even far from edges, because `1.5 D` of a thin upper air is huge. The per-ray gate is what makes the budget. Worth putting into the plan's wording ("masked march only where a ray leaves the outline in air that is still clear").
3. **Equal Earth costs about +1 ms** in the masked pass (two nearest-neighbour fetches and a blend per march step, for the mask and the sun). Options: one linearly filtered fetch (needs half-float and normalised values, about 20 km of error at Earth size against an 8 km falloff, so probably 16-bit unorm with more rows), fewer rows, or fewer march steps in the masked pass (16 instead of 32 halves the cost for both projections; not tried).
4. **The camera tick order matters:** the masked pass reads the camera's orientation, so the page now updates the camera before it renders the pass (it lagged one frame).
5. **`D` and the gate use Rayleigh only.** Mie and the absorber shorten the real clear distance; the estimate errs toward rendering the pass, never toward a missing edge.
6. **Skipping ground rays is valid because the lab's mesh covers them.** In the planet the ground comes from the material and the haze from the froxel table, so the sky pass can skip exactly these rays there too; the 0.2 grazing threshold is a tunable.
7. **Mesh sag still shows at low altitude on Earth size** (1 degree cells, a few hundred metres of sag at the equator); unrelated to the atmosphere.
8. **The `1 + k h` margin term and the mask gap for Equal Earth** (the wrap-around gap uses the row's half-width) are covered by specs only at `k = 0` and by eye at 0.5; the seam opening at small morph with Equal Earth has not been looked at.

**Not done:** the slab fallback at morph >= 0.999 (never needed); a live scrub; froxel haze on the mesh (dropped by decision); 16-step masked pass; the globe `traceRay` spec above.

## 2026-10-18 — globe `traceRay` spec and the 16-step masked pass (accuracy only)

**Globe `traceRay`.** `atmosphere-gpu-model.spec.ts` now checks `hitsGround`, `groundDistance` and the air span against the analytic sphere geometry for six rays (up, steep and shallow down, shallow up, from 40 km, ground beyond `maxDistance`). It passes unchanged, so the globe `traceRay` did not need the `toVar()` reordering that the bent one did. Finding 1 above is closed.

**16 steps vs 32, accuracy (headless, max relative radiance error against a 96-step reference, five rays toward the edge and the sky; throwaway spec, not kept):**

| Case | 16 steps | 32 steps |
|---|---|---|
| equirect, morph 0.5, anchor at centre | 1.7 % | 0.4 % |
| equirect, morph 1, anchor at centre | 5.5 % | 1.9 % |
| equirect, morph 1, 500 m from the edge | 26 % | 5.6 % |

Equal Earth at morph 0.5 gave the same numbers as equirect there. The Equal Earth morph-1 cases were not measured (the run timed out). The 26 % case is the one the masked pass exists for, so 16 steps is not a free halving: the cost saving would buy a visibly noisier edge. Not adopted; the lab default stays 32. Timing of 16 steps was not measured.

**Still open:** a filtered 16-bit row table for Equal Earth; the k>0 specs; the by-eye checks; 3b.

## 2026-10-18 — Repeatable tests for `/atmosphere-lab` (`triangular-engine/testing`)

The three "not verified by eye" items from the handover can now be run from a link instead of by hand. The lab page hosts `<tri-test-runner>`; everything lab-specific sits behind a host interface, as on the morph streaming page.

### What exists
- `atmosphere-lab/atmosphere-lab-tests.ts`: the suites, oldest first.
  - `bent-atmosphere-look` v1 (functional, `requiresVisualReview`): morph scrub 0→1→0 (equirect and Equal Earth), Equal Earth near flat (0.05→0.3→0.05), rim glow from space at the map edge (both projections, anchor 0.9), low and side-on at the east edge.
  - `bent-atmosphere-cost` v1 (performance): space and low orbit at morph 0 / 0.5 / 1, for the diagnostic GPU frame readout.
- `atmosphere-lab/atmosphere-lab-test-adapter.ts`: the adapter, the host interface and the pure helpers (`sweepMorphAt`, `sweepTraceProblems`, `stateMismatches`).
- The page (`atmosphere-lab-page.component.ts`): implements the host through its own setters, locks the panel (a `fieldset`), drag and wheel while a run is active, and restores every captured field afterwards.
- Specs: `atmosphere-lab-test-adapter.spec.ts` (12, fake host, headless) and `tests/scene/specs/atmosphere-lab-runner.spec.ts` (Playwright, real page).

### Checks each case makes
Scenario state applied as specified; frames rendered; morph reached its final state (a sweep must hit every keyframe in order); no window, rejection or `console.error` during the run (three.js logs shader and pipeline failures there); and, where a scenario says so, the masked pass active on every frame (above the air). Metrics: frame interval (required) and GPU render time (optional, from the timestamp query).

### Run it
- Look suite, human-observed: `/atmosphere-lab?testSuite=bent-atmosphere-look&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1`
- Cost suite: `/atmosphere-lab?testSuite=bent-atmosphere-cost&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1`
- Headless: `npx playwright test -c playwright.runner.config.ts atmosphere-lab-runner` (writes `artifacts/test-runner/atmosphere-lab-look.json`).

### Results
- Adapter specs 12/12. Headless Playwright run on SwiftShader: 6/6 scenarios completed, every check passed, `automatedVerdict` pass, `visualReview` pending. GPU time came back on the sweeps and not on the 3 s static cases at about 2 fps (few samples); that is software rendering, not a measurement.
- In the Browser pane the run stalls ("Rendering stalled", "Page was not focused") unless something keeps painting the pane, as in the handover's gotchas. That is the pane, not the page; use the headless run or a real browser tab.

### Decisions (mine; flag if you disagree)
- The page's own GPU read-out now goes through `GpuTimer` (shared with the cloud lab). Two concurrent `resolveTimestampsAsync` readers steal each other's samples, so the page and the adapter must share one.
- During a run the page's own sweep and sun animation are off, and the morph comes from the adapter through one `testMorph` value read in the page's tick, so the grid, the table and the sky always see the same morph in a frame.
- `rebake` counts pending bakes, because a size change plus a preset change queue two timers and the "baking" flag used to clear after the first.

### Not done
- Nobody has looked at the look suite on real hardware yet: this is the runnable link, not the review. Acceptance of `visualReview` stays with the maintainer.
- No per-scenario screenshot is stored with the result (the runner's result has no image field).
- The cost suite has not been run on the AMD GCN5 machine, so no new timings are recorded here.

## 2026-10-18 — Acceptance requirements consolidated into the owning plan

The owner requested center/four-edge/corner/seam and altitude coverage, continuous
forward/reverse cycles and a stable horizon-target experiment. The plan now retains
that full matrix, tolerances to define, completed-frame/occlusion evidence and
explicit human review. Existing lab suites cover their documented cases, not the
whole matrix by implication. Their existing launch URLs are now indexed in matching
plan/runbook performance arrays; latest is the cost suite, still without controlled
hardware acceptance. No benchmark or visual review was rerun by this documentation
update, and the earlier integration results remain dated evidence.

[Run latest atmosphere diagnostic](http://triangular-demo.localhost:4200/atmosphere-lab?testSuite=bent-atmosphere-cost&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1).

### 2026-10-18 — First visible-tab results (saved by the Plan 052 result sink)

Both `/atmosphere-lab` suites were run by the owner in a visible browser on the AMD GCN5
machine and saved automatically under `artifacts/test-runs/` (gitignored). Read with
`node projects/triangular-engine/bin/triangular-test-summary.mjs`.

- `bent-atmosphere-cost@v1`, two runs (20:45 and 21:07 UTC, `visible-browser`), automated
  `pass`, performance `unassessed` (no baseline). GPU render median (ms), identical across
  both runs to about 0.1 ms: space morph 0 / 0.5 / 1 = 0.79 / 1.18 / 1.97; low orbit
  morph 0 / 0.5 / 1 = 2.75 / 2.69 / 3.74. Frame interval was 1-2 ms lower in the second
  run, so treat it as noisier than GPU time. The first run's fingerprint is marked stale
  (code changed after it); the second is current. These are the first real-hardware
  timings for this lab; not yet compared with the Phase 3a table.
- `bent-atmosphere-look@v1`, one run (21:08 UTC), automated `pass`, visual review
  **pending** (owner's call). GPU render median 0.13-2.6 ms; the two morph-scrub
  scenarios were slowest at about 12-13 ms frame interval (likely rebakes during the
  sweep). The agent has not judged appearance.

Not done: the owner's by-eye acceptance, comparison against Phase 3a, any baseline.
Nothing committed.

## 2026-10-21 — Re-measured on the RTX 3080 (per-pass GPU timing, cost suite v2)

**Every earlier timing in this runbook was taken on the AMD GCN5 iGPU.** That includes the Phase 3a follow-up tables and the 2026-10-18
`bent-atmosphere-cost@v1` runs. On this hybrid laptop Chrome picked the iGPU until it was set to High performance in Windows.
Treat those numbers as iGPU numbers, not as the target hardware. The built-in browser pane still reports `amd / gcn-5`, so it
is not usable for timing either.

### Tooling change
- The lab now uses the engine's `gpuTiming: true`. The engine owns `resolveTimestampsAsync`, and `FrameSampler.stop()`
  returns per-pass `gpuPasses`. The page's `GpuTimer` read-out is gone, because a second timestamp reader would steal samples. The FPS overlay shows
  GPU time instead.
- The page reports its adapter (`describeGpuAdapter`) in the run's environment. So every result says which GPU it ran on.
- New suite `bent-atmosphere-cost` **v2** (v1 is kept unchanged), `expectedGpuVendor: 'nvidia'`, so a run on any other
  vendor is inconclusive. It covers four views (space 3 R, low orbit, 25 km up, 2 m up). In each view it runs the plain globe (`bentOn: false`), the bent
  table path ("auto") at morph 0 / 0.5 / 1, and "march every pixel" at the same morphs (not at 2 m). That makes 25 scenarios, 3 s each.
- Metrics: `gpuScenePass` (sky backdrop + grid mesh), `gpuFullscreenPasses` (the masked edge pass), `gpuOutputPass`,
  `gpuPassTotal`, all optional; frame interval is still required. There is a "GPU timer self-test" check.
- Fix found by the first v2 run: `stateMismatches` always demanded the bent planet on, so every `plain-*` case failed to
  settle. It now compares against the scenario's `bentOn`.

### Run
`bent-atmosphere-cost@v2`, 2026-10-20 23:32 UTC, `visible-browser`, standard mode, 1 repetition, owner's Chrome. Automated
`pass`, 25/25 valid, performance `unassessed` (no baseline yet).
- Adapter recorded: `nvidia / ampere / 0x249c / NVIDIA GeForce RTX 3080 Laptop GPU`. Timestamp step 1024 ns (the WebGPU
  developer-features flag is on).
- Canvas 2538 x 1308 (DPR 1.5). That is 1.6x the pixels of the 1896 x 1080 AMD tables.
- Warnings: `gpu-busy-before-start` and `gpu-throttled`. nvidia-smi saw a median GPU load of 100% at 71 C, and throttle reasons
  were set in 4 of 25 cases. Treat single tenths of a millisecond as noise until a second run on a cool GPU agrees.
- Frame interval is about 6.1 ms in every case except the 25 km march. That is the display cap (about 165 Hz), not a cost.

GPU pass total, median ms (scene pass + masked pass + output pass; the output pass is a constant 0.04-0.05):

| view | plain | bent, auto m 0 / 0.5 / 1 | of which masked pass | bent, march every pixel m 0 / 0.5 / 1 |
| --- | --- | --- | --- | --- |
| Space, 3 R | 0.10 | 0.24 / 0.30 / 0.39 | 0.12 / 0.16 / 0.17 | 0.57 / 1.50 / 2.93 |
| Low orbit | 0.13 | 0.45 / 0.46 / 0.47 | 0.23 / 0.23 / 0.27 | 3.04 / 3.16 / 3.42 |
| 25 km up | 0.18 | 0.24 / 0.31 / 0.29 | – / 0.03 / 0.08 | 6.77 / 6.65 / 5.79 |
| 2 m up | 0.16 | 0.18 / 0.19 / 0.15 | – | not run |

p95 is within 0.03 ms of the median everywhere except the march rows.

A second run (2026-10-21 21:52 UTC, same adapter) had no `gpu-busy-before-start` warning but was again `gpu-throttled` (70 C).
It matched the table within 0.01 ms on the plain and auto rows. The march rows moved by up to 0.4 ms (low orbit at morph 1 went to
3.82 ms).

**The suite checks state, frames and errors, not pixels.** A black or missing sky would still pass. The owner has
accepted the look by eye. They report a thin black band between the horizon and the sky from some views, and a slightly
blocky froxel haze from some angles (minor).

### What it says
1. **The table path meets the budget everywhere on the RTX.** Bent auto minus the plain globe: space +0.14 / +0.20 / +0.29,
   low orbit +0.32 / +0.33 / +0.34, 25 km +0.06 / +0.13 / +0.11, 2 m +0.02 / +0.03 / -0.01. The budget is <= 0.5 ms total. The
   masked pass peaks at 0.27 ms (low orbit, morph 1), against its 1.0 ms budget.
2. **Low orbit is now the most expensive view**, not space at morph 1 (that was the worst case on the AMD iGPU). The masked pass runs at
   every morph there, including morph 0.
3. **March every pixel stays a diagnostic.** At 25 km up it costs 5.8-6.8 ms, enough to push frame interval past the
   display cap (median 6.8-6.9 ms). The per-ray gate is still what makes the budget.
4. On the AMD iGPU the same auto cases cost 2.0-4.1 ms per whole frame, about 8-10x more. The measurement differs too: whole-frame
   timestamps, over a 1.05 ms trivial-quad floor, at fewer pixels. So the ratio is a rough guide, not a like-for-like
   comparison.

### Not done
- No second run, no baseline (performance stays `unassessed`), no run on a GPU that is cool and idle before it starts.
- Equal Earth is not in v2. The Phase 3a table's +1 ms Equal Earth cost is an iGPU number and was not re-measured.
- The look suite has not been re-run on NVIDIA. Its visual review is still pending.
- Nothing committed.

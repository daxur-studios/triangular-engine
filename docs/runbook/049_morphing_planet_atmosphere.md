---
type: Runbook
title: Morphing Planet Atmosphere
description: Findings and decisions for the new cell-planet atmosphere that follows the globe ↔ flat-map morph.
timestamp: 2026-10-16T00:00:00Z
tags: [atmosphere, scattering, sky, cell-planet, morph, rendering, performance, webgpu, tsl]
plans: [/docs/plans/049_morphing_planet_atmosphere.md]
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

- `AtmosphereBackdrop.opacity` (0..1) makes the sky blend into the scene. The cell page fades it with a smoothstep over morph 0.2 to 0.8 (it used to switch off at 0.5) and hides the mesh at 0. The backdrop material is now `transparent` (still first in draw order, no depth).
- `PlanetAtmosphereBinding.sunVisibility` and `AtmosphereBackdrop.sunVisibility` (0..1) are the eclipse hookup: the haze in-scatter, the sky light on surfaces, the sky and the sun disc scale by it (`sync` copies the binding's value to the backdrop). Surfaces still multiply their own occluders into the direct light. The cell page does not drive it yet; nothing has been seen on a GPU.
- Still open: flat-map edge fade or glow, the slab's fixed sun angle and ground height, per-sample sun froxels on the map.

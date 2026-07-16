# Takram Mini-Planet — 3D Cloud Fix Plan

Date: 2026-07-16
Audience: implementing agent (Sonnet). Read
[002_takram_mini_planet_handover.md](002_takram_mini_planet_handover.md) first —
its "Failed/discarded approaches" section is binding. This plan adds code-level
findings gathered after that handover and turns the investigation into ordered,
gated phases.

## Problem statement

`/takram-clouds-spike` and `/takram-clouds` (Earth radius, camera near the
ground) render volumetric clouds correctly. `/takram-mini-planet`
(radius 100 km) does not: concentric blue bands around the planet centre that
grow/shrink with zoom, and clouds that look like separated curved
pancakes/shell slices instead of a continuous volume.

The two working pages prove the adapter pipeline (composer, buffer routing,
asset loading, LUT generation) is sound at Earth scale. Everything that is
**radius-dependent or exercised only by the mini-planet camera regime** is
suspect. Two regime differences matter, not just one:

1. The planet is ~64× smaller than Earth (100 km vs 6,371 km), so surface
   curvature per metre is ~64× higher, while several Takram tunables are
   **absolute metres**, not radius-relative.
2. The camera leaves the atmosphere entirely (up to hundreds of planet radii
   away). The working pages never render from outside the atmosphere, so that
   whole code path is unexercised at any radius.

## Ground rules

- One change at a time. After each visually significant change, stop and ask
  the user for visual verification with a fixed camera description (e.g.
  "surface view looking up", "limb view at 50 km", "full globe at 1,000 km").
  You cannot see the render; the user is the oracle.
- Do not modify `/takram-clouds`, `/takram-clouds-spike`, or their shared
  behaviour in ways that change their output. They are the regression baseline.
  Shared controls (`TakramCloudControlsStore`) may gain new optional signals,
  but defaults must leave the working pages pixel-identical.
- Respect every item in the handover's "Failed/discarded approaches": no orbit
  restrictions, no whole-composer cutoff, no `local_weather.png` as globe
  texture, no below-surface local geometry.
- Engine changes go in `projects/triangular-engine/takram/**`; demo/diagnostic
  changes go in the mini-planet page. Prefer page-level experiments through the
  existing `effect` escape-hatch getters before adding engine inputs; promote
  to engine inputs only what proves useful.
- Builds: `npm run build` (workspace), `ng build triangular-engine` for the
  library alone. There is no consolidated verify script in this workspace.
- Do not patch files under `node_modules/@takram/**`. If a library-internal
  value must change, set it at runtime from the adapter (uniforms, defines,
  and most tunables are exposed on the effect instances).

## Code facts (verified 2026-07-16, receipts included)

These were read directly from the installed `@takram/*` builds and the adapter
source. Re-verify line numbers if package versions changed.

### F1 — CloudsEffect defaults mix globe-relative and absolute-metre scales

`node_modules/@takram/three-clouds/build/shared.js` (~line 3448, CloudsEffect
constructor):

- `localWeatherRepeat = 100` — weather texture tiles 100× across the **globe
  UV** (cube-sphere projection of ECEF position, `getGlobeUv`, ~line 1577).
  Globe-relative: one weather cell is ~400 km on Earth but ~6.3 km on a 100 km
  planet. Weather features shrink 64×.
- `shapeRepeat = 3e-4`, `shapeDetailRepeat = 6e-3` (per metre, ~line 3448) —
  **absolute** noise frequencies; cloud shapes stay Earth-sized (~3.3 km base
  wavelength) regardless of radius.
- So the ratio of weather-cell size to shape-noise size is ~64× off vs Earth.

### F2 — Ray-march step sizes are absolute metres, tuned for Earth curvature

Quality presets, `@takram/three-clouds/build/shared.js` ~lines 427–524:
`minStepSize: 50–100`, `maxStepSize: 1000`, `maxRayDistance: 2e5`,
`maxIterationCount: 200–500` (per preset).

On a 100 km planet the cloud layer (3–5 km altitude) falls below the horizon
within ~25–32 km, and a grazing ray's height above the surface changes ~64×
faster per metre than on Earth. 1 km max steps through a 2 km-thick shell with
64× curvature is a textbook cause of the observed "separated concentric shell
slices". On Earth the same numbers work because the layer is locally almost
flat. This is the leading hypothesis for the pancake artifact.

### F3 — The shaders sample height analytically; the demo planet mesh is coarse

Cloud/aerial shaders compute `height = length(positionECEF) - bottomRadius`
(`shared.js` ~lines 899, 1028, 2797) from **depth-reconstructed** positions.
The demo planet is a `sphereGeometry` with 96×64 segments; its facets deviate
from the analytic sphere by up to ~50 m (sagitta `R(1−cos(π/96))`). Aerial
perspective evaluated on a faceted sphere produces height oscillation in rings
concentric around the sub-camera point. The working pages used a flat plane,
so this class of artifact could never appear there. Candidate for the
concentric-band symptom (cheap to test: raise segments).

### F4 — Both effects already handle logarithmic depth

`reverseLogDepth(...)` is applied in both packages
(`three-atmosphere/build/shared.js` ~408, 2778; `three-clouds` ~1345) and the
clouds material auto-detects `renderer.capabilities.logarithmicDepthBuffer`
(~line 2009). Log depth is supported, consistent with the handover's
observation that enabling it helped but didn't fix the bands.

### F5 — Altitude correction and shadow-map distance have Earth-scale inputs

`CloudsEffect.updateSharedUniforms` (`shared.js` ~3537): when
`correctAltitude = true` (the default) it calls the altitude-correction with
`this.atmosphere.bottomRadius` and `this.ellipsoid` — correct **only if** both
carry the 100 km configuration at that moment. The same method computes the
cloud shadow-map far distance as `remap(1e6, 1e3, sunDot)` — an **absolute**
1,000 km-to-1 km range, Earth-tuned.

### F6 — What the adapter already propagates (and what it doesn't)

`projects/triangular-engine/takram/atmosphere/takram-atmosphere.service.ts`:
`configurePlanet()` sets `ellipsoid`, `atmosphere.bottomRadius/topRadius`,
rebuilds `worldToECEFMatrix`, regenerates LUTs; `applySharedState()` copies
ellipsoid/sun/matrix into both effects after every LUT rebuild. Both adapter
components construct their effect with the shared `AtmosphereParameters`
(`takram-clouds.component.ts` `createEffect`, `takram-aerial-perspective.component.ts`
`createEffect`). Not propagated anywhere: step sizes, repeats, shadow
distances, density profiles — i.e. everything in F1/F2/F5.

### F7 — Built-in shader debug modes exist

The clouds materials compile optional defines: `DEBUG_SHOW_UV` (renders a
checker in globe UV space — directly visualises F1's cube-sphere mapping and
scale), `DEBUG_SHOW_SAMPLE_COUNT`, `DEBUG_SHOW_CASCADES`,
`DEBUG_SHOW_SHADOW_MAP` (`three-clouds/build/shared.js` ~660–1410). They can
be enabled at runtime through the effect's pass materials via the adapter's
`effect` getter — no library edits needed.

### F8 — Atmosphere LUT parameterisation is radius-derived, but scale heights are absolute

`AtmosphereParameters` converts radii by `METER_TO_LENGTH_UNIT`
(`three-atmosphere/build/shared.js` ~line 67) and derives horizon terms from
`sqrt(topRadius² − bottomRadius²)` (~line 2701), so custom radii are
structurally supported. However the density profiles (Rayleigh ~8 km,
Mie ~1.2 km scale heights), `muSMin`, and `sunAngularRadius` are Earth
defaults. With a 20 km atmosphere on a 100 km planet (20% vs Earth's 0.9%),
the LUT angular parameterisation runs far outside its tuned regime — a
plausible source of the blue concentric bands on **sky** pixels, which F3
cannot explain (F3 only affects ground pixels).

## Symptom → hypothesis map

| Symptom | Ranked hypotheses |
|---|---|
| Curved pancakes / shell slices near surface | H-steps (F2) ≫ H-repeats (F1) |
| Concentric blue bands over the **planet disc** | H-facets (F3), then H-LUT (F8) |
| Bands over the **sky/limb**, encasing planet when zoomed out | H-LUT (F8), exterior-camera regime; then H-shadow (F5) |
| Structure swims/grows with camera at fixed weather | H-steps (F2, view-dependent march), H-facets (F3) |

## Phased plan

Each phase ends with a **gate**: report what changed, give the user exact
camera positions to check, and wait for their verdict before the next phase.
Screenshots at three canonical views every time: (a) surface looking up at
clouds, (b) ~10 km altitude limb view, (c) 1,000 km full-globe view.

### Phase 0 — Diagnostic toggles and numeric dump (no visual change intended)

1. Add independent toggles to the mini-planet page (page-level `@if` blocks
   and signals, or optional signals on `TakramCloudControlsStore` defaulting
   to current behaviour): **clouds effect**, **aerial perspective**,
   **2D shell mesh**, and aerial `sky` input. The handover explicitly asks for
   this isolation; today the bands cannot be attributed to a single effect.
2. Add a dev-only "dump state" button on the page that logs, from the live
   effect instances (via the adapters' `effect` getters and the service):
   `atmosphere.bottomRadius/topRadius`, `ellipsoid` radii,
   `worldToECEFMatrix` elements, clouds `altitudeCorrection`,
   clouds pass uniforms `bottomRadius`, `minHeight/maxHeight`,
   `minStepSize/maxStepSize/maxRayDistance/maxIterationCount`,
   `localWeatherRepeat/shapeRepeat/shapeDetailRepeat`, and aerial's
   uniform set. Every value must reflect the 100 km configuration
   (handover item 6). If any reports Earth values, fix that propagation
   first — it invalidates all later phases.
3. Gate: user toggles combinations at the three canonical views and reports
   which effect(s) produce the bands. Expected outcome: bands attributed to
   clouds-only, aerial-only, or interaction.

### Phase 1 — Concentric bands on the planet disc (cheapest test first)

1. Raise planet mesh tessellation 96×64 → 512×256 (F3). Pure page change.
2. If bands shrink/change spacing but persist, also test aerial
   `[ground]="false"` temporarily (input already exists) to fully exclude
   ground pixels.
3. Gate: bands gone on the disc ⇒ F3 confirmed; keep high tessellation and
   note that real terrain will need analytic-sphere-consistent geometry.
   Bands unchanged ⇒ F3 rejected; they are sky/limb pixels ⇒ Phase 3 matters
   more.

### Phase 2 — Pancake clouds: ray-march scale (H-steps, F2)

1. Through the clouds adapter's `effect` getter (page-level first), scale the
   march parameters by `radiusScale = 100_000 / 6_371_000` (~1/64), clamped to
   sane floors: `minStepSize ≈ max(minStepSize × s, 5)`,
   `maxStepSize ≈ max(maxStepSize × s, 50)`, keep `maxRayDistance` (200 km
   still covers the whole planet) but raise `maxIterationCount` only if the
   user reports the layer still truncating. Start with the `low` preset to
   keep iteration counts affordable, and warn the user smaller steps cost GPU
   time.
2. Independently (separate gate), test weather scale: drop
   `localWeatherRepeat` from 100 toward ~8–16 so weather cells are tens of km
   on the mini planet, closer to Earth's relative pattern (F1). Use
   `DEBUG_SHOW_UV` (F7) to visually confirm the globe-UV checker density
   before/after.
3. Gate after each sub-step. Success criterion: surface view shows continuous
   volumetric shapes, no shell slices, stable under camera motion.
4. If confirmed, promote the working values as adapter inputs on
   `takram-clouds` (e.g. optional `marchScale` or explicit
   `minStepSize/maxStepSize` inputs), defaulting to Takram's values so the
   Earth pages are untouched.

### Phase 3 — Sky/limb bands: atmosphere thickness regime (F8)

1. Handover item 3: change **only** the ratio — atmosphere 20 km → 6 km,
   clouds at 2–4 km. If bands vanish, the LUT parameterisation is the issue
   for thick relative atmospheres; document the supported ratio envelope
   rather than chasing Bruneton internals.
2. If a thick atmosphere must be supported later, the follow-up is scaling the
   density profile scale heights with atmosphere height (F8) — do not start
   that without user confirmation, it changes the atmosphere's look.
3. Gate: full-globe view at 1,000 km with clouds off, aerial on — no rings, no
   encasing shell.

### Phase 4 — Residual issues (only if earlier phases leave artifacts)

- Cloud shadow-map distance: scale the `1e6/1e3` far-distance regime via
  `clouds.shadow` settings if shadows band or swim (F5).
- `correctAltitude`: verify the correction vector is ~0 at the surface target;
  test toggling it off only as a diagnostic, not a fix.
- Verify behaviour with `temporalUpscale` re-enabled (it is off on this page;
  turning it on changes buffer routing and history reprojection).

### Phase 5 — Wrap-up

1. Keep the 2D shell fade exactly as-is until 3D clouds pass acceptance
   (handover item 7), then re-tune `TRANSITION_START/END` against the fixed
   visuals with user sign-off.
2. Update `docs/runbook/002_takram_mini_planet_handover.md` status and append
   findings (confirmed/rejected hypotheses with the receipts) to this file.
3. Final regression: user visually confirms `/takram-clouds` and
   `/takram-clouds-spike` are unchanged; `npm run build` passes.

## Acceptance (unchanged from handover)

- Surface view: continuous volumetric clouds, no shell slices.
- Fixed camera: no growth/shrink/swimming without weather animation.
- Full-globe view: no concentric rings, no noise sphere, no encasing shell.
- Exterior texture visible beyond 1,000 km, fading per displayed opacity.
- Changing radius keeps mesh, orbit target, atmosphere, ellipsoid, cloud
  layer, LUTs, and clipping mutually consistent.

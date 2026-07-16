# Takram Mini-Planet — Agent Handover 2

Date: 2026-07-16
Supersedes the "Current status" section of
[002_takram_mini_planet_handover.md](002_takram_mini_planet_handover.md).
Read 002 and [003_takram_mini_planet_fix_plan.md](003_takram_mini_planet_fix_plan.md)
first — this document only covers what changed after 003 was written, in the
same session and one following session. 003's F1–F8 receipts and phased plan
are unchanged and still apply; nothing here has executed that plan's phases
in order, work went a different direction (planet-size preset switcher) before
returning to phase-plan-style diagnosis.

## Status at end of session

- `/takram-clouds` and `/takram-clouds-spike` (Earth radius, near-surface
  camera): unaffected by this session's work, still the regression baseline.
- `/takram-mini-planet` now has a **Small (100 km) / Medium (1,000 km) /
  Large (6,360 km, matches `AtmosphereParameters.DEFAULT` exactly) radio
  switcher** in the diagnostics panel, replacing the old fixed 100 km preset.
- User-reported, as of the last visual test round:
  - **Large**: "almost working... from the surface it looks fine now, but
    zooming out, literally as reaching the bottom of the cloud layer it
    disappears. so cannot view clouds from above." A fix for this specific
    symptom was applied after the report (see "Fix D" below) but has **not
    been re-tested by the user yet**.
  - **Medium/Small**: "completely fucked" — user's exact words, no further
    visual description or screenshot obtained. Numeric diagnostic dump for
    Small (below) shows no anomaly versus Large. **Root cause for Small is
    unresolved and unidentified.**
  - Earlier in the session, before the preset switcher existed: "orbit
    controls should ensure its always at the surface of the planet as size
    changes" and "going from small to medium... i see a mini atmosphere
    inside the now larger planet" — both were about a since-replaced
    mechanism (see Fix A/B below); not re-reported since.

## Changes made this session

All in `projects/demo-app/src/app/pages/takram-mini-planet/` unless noted.
`takram-atmosphere.service.ts`'s density-profile rescaling (`configurePlanet()`
scaling Rayleigh/Mie/absorption profiles by `atmosphereHeight / 60_000`) is
**pre-existing from before this session**, not new — included here only
because its correctness was re-verified numerically this session (see F9).

### Fix A — Planet-size preset switcher

`takram-mini-planet-page.component.ts`: `PLANET_SIZE_PRESETS` record
(`small`/`medium`/`large`, each with `radius`/`atmosphereHeight`/`label`),
`planetSizePreset` signal, `planetRadius`/`planetCentre`/`cloudShellRadius`/
`atmosphereHeight` converted from static fields to `computed()` signals
keyed off it. Radio buttons in the diagnostics panel
(`takram-mini-planet-page.component.html`) call `setPlanetSizePreset()`.

### Fix B — Remount on preset change

`AerialPerspectiveEffect` and `CloudsEffect` bake their `ATMOSPHERE` GPU
uniform once at construction, via `AtmosphereParameters.toUniform()` — a
one-time snapshot of `bottomRadius`/`topRadius`/density profiles, not a live
reference. Verified by reading `node_modules/@takram/three-atmosphere/build/shared.js`:
class `Vi` (exported `AerialPerspectiveEffect`) constructor sets
`ATMOSPHERE: r.toUniform()` once (~line 737); `toUniform()` itself
(class `ie`/`n0`, ~line 63) builds a fresh plain object from current field
values each call. The whole bundle has exactly 3 `toUniform` call sites: the
two effect constructors and one inside `PrecomputedTexturesGenerator.update()`
for LUT precompute — nothing re-reads it per frame.
`CloudsEffect.uniforms` (public) does not expose the `ATMOSPHERE` key at all;
the real field is `private readonly atmosphereUniforms` per
`node_modules/@takram/three-clouds/types/CloudsEffect.d.ts` — no public,
type-safe way to refresh it after construction.

So mutating `TakramAtmosphereService.atmosphere` in place (what
`configurePlanet()` does) never propagates into already-constructed effects.
Fix: `planetMounted` signal wraps the entire `<takram-atmosphere>` subtree in
`@if (planetMounted())`. `setPlanetSizePreset()` sets it `false`, updates the
preset signal, then `setTimeout(() => this.planetMounted.set(true))` — the
macrotask boundary (vs. `queueMicrotask`) is deliberate, to avoid Angular's
signal scheduler coalescing a same-tick false→true flip into a no-op that
never actually destroys the view. This forces `TakramAtmosphereComponent`
(and everything projected into it — clouds, aerial-perspective, sun/sky
lights) to fully destroy (`ngOnDestroy` → `TakramAtmosphereService.dispose()`)
and reconstruct on every preset switch, so effects are always freshly baked
with the current radius, matching how the single-preset case already worked
correctly from first mount.

Not independently re-verified visually against the "mini atmosphere inside
bigger planet" symptom after this fix landed — the user's testing since has
been about the newer symptoms (zoom-out disappearance at Large, "completely
fucked" at Small), not a retest of the original mini-atmosphere report.

### Fix C — Camera home framing scales with radius

`cameraHomePosition` computed signal, bound to `orbitControls[cameraPosition]`
(previously a static `[0, 3000, 8000]` literal). Formula:
`altitude = clamp(planetRadius * 0.03, 2_000, 60_000)`, position
`[0, altitude, altitude * 2.5]`. Verified reactive via
`projects/triangular-engine/src/lib/engine/components/object-3d/orbit-controls.component.ts`
`#initCameraPositionChanges()`, an `effect()` on the `cameraPosition` input
that calls `internalCamera.position.set(...)`.

The altitude cap was originally `200_000`, lowered to `60_000` after Fix D was
identified (see below) — both changes are in the current file, only the final
`60_000` cap is live.

### Fix D — maxRayDistance vs. camera home altitude at Large

`clouds.clouds.maxRayDistance` (the volumetric cloud raymarcher's maximum
reach) is **100,000 m, fixed regardless of planet radius**, set by the
`'low'` `qualityPreset` (`node_modules/@takram/three-clouds/build/shared.js`
~line 474: `low: { maxIterationCount: 200, minStepSize: 100,
maxRayDistance: 1e5, ... }`). Confirmed this value cannot be safely
overridden from outside: `CloudsEffect`'s `set qualityPreset(e)`
(~line 3597) unconditionally does
`Object.assign(this.clouds, presetParams)` including `maxRayDistance` — and
`TakramCloudsComponent`'s reactive `effect()`
(`projects/triangular-engine/takram/clouds/takram-clouds.component.ts`
~line 83) re-runs `Object.assign(this.clouds, settings)` with
`qualityPreset: this.qualityPreset()` on every settings-signal change
(`coverage`, `localWeatherVelocity`, etc.), regardless of whether the preset
string actually changed — so a manual `maxRayDistance` override would be
stomped on the next unrelated settings update.

Before this fix, Fix C's altitude formula produced ~190,800 m at Large
(uncapped `planetRadius * 0.03`), already exceeding the 100,000 m raymarch
budget from the home camera position — meaning the cloud layer (3,000–5,000 m
altitude) was farther from the camera than the raymarcher can reach, at the
default framing. This matches the reported symptom precisely (clouds vanish
once the camera's distance from the cloud layer crosses ~100 km while zooming
out). Fix: lowered the `cameraHomePosition` altitude cap from `200_000` to
`60_000` (Fix C, above). **Not yet re-tested by the user.**

### Fix E (reverted) — logarithmicDepthBuffer theory

A theory that `logarithmicDepthBuffer: true` (mini-planet's engine option,
vs. `false` on `/takram-clouds` and `/takram-clouds-spike`) broke Takram's
depth-based cloud/aerial-perspective compositing, because the `postprocessing`
library's generic `EffectPass` (which composites custom effects like
`AerialPerspectiveEffect`) only sets the `LOG_DEPTH` shader define for two
built-in passes (`DepthOfFieldEffect`'s CoC pass, `DepthMaskPass`) — confirmed
via grep of `node_modules/postprocessing/build/index.js`, no other
`defines.LOG_DEPTH` assignment exists in the bundle.

**Disproven by direct user test**: the user enabled
`logarithmicDepthBuffer: true` on `/takram-clouds` (matching mini-planet) and
reported it "works perfectly fine," including zoomed out — contradicting the
theory. All code changes from this theory (mini-planet's
`logarithmicDepthBuffer: false`, a `cameraNear.set(50)` override, and test
toggles on `/takram-clouds` and `/takram-clouds-spike`) were reverted.
`/takram-clouds` and `/takram-clouds-spike` currently have
`logarithmicDepthBuffer: true` set — **this was the user's own manual edit
after the revert, not this session's default state, and was left in place**.
Mini-planet's `logarithmicDepthBuffer` is currently `true` (also the user's
manual edit, reverting an agent change back to the original value).

### Diagnostic tooling — dumpState() copies to clipboard

`dumpState()` (bound to the "Copy state to clipboard" button in the
diagnostics panel) no longer does verbose `console.group`/many `console.log`
calls. It builds a compact, one-line-per-section string (preset/radius/
atmosphere height; atmosphere bottom/top radius, ellipsoid, ECEF translation;
Rayleigh/Mie/absorption density-profile width and scale/linear/constant
terms; clouds correctAltitude and texture repeats; raymarch min/max step,
max distance, iteration count; shadow march params; aerial-perspective
correctAltitude, ellipsoid, ECEF translation, buffer-wiring booleans),
`console.log`s it as a fallback, and writes it to the clipboard via
`navigator.clipboard.writeText()`. Button label flashes "Copied to
clipboard" / "Copy failed — see console" for 2 s.

## F9 — Density profile units are kilometres, not metres; rescale math verified correct with real numbers

Captured dumps (verbatim, see below) show, for the **unscaled** Large preset
(`densityScale = atmosphereHeight / 60_000 = 1.0`, a no-op):
`ray es=-1.250e-1` (= −1/8), `mie es=-8.333e-1` (= −1/1.2),
`abs w=25`, `abs lt=6.667e-2` (= 1/15), `abs ct=-6.667e-1` (= −2/3).
These are Bruneton's canonical reference constants in **kilometres**
(8 km Rayleigh scale height, 1.2 km Mie scale height, 25 km ozone layer
width), not the equivalent metre-scale numbers — i.e. `AtmosphereParameters`'
density-profile fields are stored in km while `bottomRadius`/`topRadius` are
stored in metres (matching `atm b=6360000 t=6420000` in the same dump). This
asymmetry is presumed intentional in the upstream library (a metres-to-km
conversion factor is applied to radii only inside `toUniform()`, per prior
session's reading of `shared.js` ~line 63) — not confirmed as a bug.

For the **Small** preset (`densityScale = 20_000 / 60_000 = 0.333...`):
`abs w=8.33` = 25 × 0.333, `ray es` and `mie es` scale reciprocally as
expected. Checked by hand: the fraction each profile occupies within its
atmosphere shell is identical between Small and Large (Rayleigh scale
height / atmosphere height ≈ 13% in both; ozone width / atmosphere height
≈ 42% in both). The rescale formula in `configurePlanet()`
(`scaleDensityProfileLayer`: `width *= scale`, `expScale /= scale`,
`linearTerm /= scale`, `constantTerm` unchanged) is dimensionally correct
for this substitution regardless of the km-vs-metres question, because it
operates on a unitless ratio of two metre-valued heights. **This rules out
the density-profile rescaling logic as a cause of the Small-preset
breakage** — the numbers it produces are proportionally identical to the
working Large case.

## Captured diagnostic dumps

Small (`preset=small r=100000 atmH=20000`):

```
preset=small r=100000 atmH=20000
atm b=100000 t=120000 ell=[100000,100000,100000] ecefTx=100000
ray w=0 es=-3.750e-1
mie w=0 es=-2.500e+0
abs w=8.33 lt=2.000e-1 ct=-6.667e-1
clouds corrAlt=true lwRep=[100,100] shRep=[0,0] sdRep=[0.01,0.01] turbRep=[20,20]
march min=100 max=1000 dist=100000 iter=200
shadow min=100 max=1000 iter=25 casc=1 map=[object Object] far=null
aerial corrAlt=true ell=[100000,100000,100000] ecefTx=100000 overlay=true shadow=true shadowLen=false
```

Large (`preset=large r=6360000 atmH=60000`):

```
preset=large r=6360000 atmH=60000
atm b=6360000 t=6420000 ell=[6360000,6360000,6360000] ecefTx=6360000
ray w=0 es=-1.250e-1
mie w=0 es=-8.333e-1
abs w=25 lt=6.667e-2 ct=-6.667e-1
clouds corrAlt=true lwRep=[100,100] shRep=[0,0] sdRep=[0.01,0.01] turbRep=[20,20]
march min=100 max=1000 dist=100000 iter=200
shadow min=100 max=1000 iter=25 casc=1 map=[object Object] far=null
aerial corrAlt=true ell=[6360000,6360000,6360000] ecefTx=6360000 overlay=true shadow=true shadowLen=false
```

Both dumps captured before Fix D (the `cameraHomePosition` cap lowered from
200,000 to 60,000) was applied — i.e. captured under the state where Large's
home altitude already exceeded `maxRayDistance`. Not yet recaptured after
Fix D.

Notable: `lwRep`/`shRep`/`sdRep`/`turbRep` (texture tiling repeats) are
**identical** between Small and Large despite the ~64× radius difference.
Not established whether this is expected library behaviour (repeats are a
fixed world-unit tiling density, independent of planet radius by design) or
a propagation gap — not investigated this session. `map=[object Object]`
in the shadow line is a dump-formatting artifact (`clouds.shadow.mapSize` is
an object, e.g. a `Vector2`, not a scalar — the compact dump's `r()`/plain
interpolation doesn't unwrap it) — the underlying value was not separately
inspected.

## F10 — Confirmed root cause: cloud camera height always uses WGS84

Follow-up source inspection identified the primary cause of both the
Small/Medium failure and the angle-dependent cloud disappearance at Large.
This supersedes the earlier statement that the Small-preset cause was
unidentified and substantially downgrades Fix D (`maxRayDistance`) from a
root-cause fix to a secondary viewing-distance constraint.

In installed `@takram/three-clouds` 0.7.6, `CloudsMaterial` transforms the
camera into ECEF and then calculates its height with:

```ts
geodeticScratch.setFromECEF(cameraPositionECEF).height
```

No ellipsoid is passed. `Geodetic.setFromECEF()` therefore defaults to
`Ellipsoid.WGS84`, even though `CloudsEffect.ellipsoid` has correctly been
set to the current planet. The shader uses this incorrect value as
`cameraHeight` to select its below-cloud / inside-cloud / above-cloud ray
intersection branch. In the below-cloud branch, a ray that intersects the
ground can return `vec2(-1)`, causing the cloud march to be skipped entirely.
As the viewing angle changes, the ground-intersection result changes, which
explains clouds disappearing and reappearing at particular angles/heights.

The error becomes more extreme as planet radius decreases. Reproducing the
library calculation for a camera at the surface gives approximately:

- 100 km planet: reported height `-6,278,137 m` instead of `0 m`.
- 1,000 km planet: reported height `-5,378,137 m` instead of `0 m`.
- 6,360 km planet: reported height `-18,137 m` instead of `0 m`.

For the Large preset, a real 20 km altitude is consequently reported as only
about 1.9 km, so even the Earth-sized spherical preset crosses cloud-state
branches at the wrong height. This directly matches the reported failure at
the bottom/top of the cloud layer. The fixed 100 km `maxRayDistance` can
still prevent clouds being reached from a sufficiently distant camera, but
it does not explain the close-range, angle-dependent failure and is not the
principal defect.

`AerialPerspectiveEffect` contains the same omitted-ellipsoid height
conversion. There it feeds geometric-error correction rather than the cloud
shell branch, so it is a likely contributor to atmosphere/angle artifacts,
but not the direct cause of the cloud layer being skipped.

## F11 — Adapter LUT generation can race

`TakramAtmosphereService` currently starts
`PrecomputedTexturesGenerator.updateTextures()` in its constructor using the
default Earth atmosphere, then `configurePlanet()` mutates the parameters and
starts a second update for the selected planet. The Takram generator is
asynchronous and uses shared materials, uniforms, render targets, and idle
callbacks. Its `updating` boolean does not serialize or cancel concurrent
updates. The service's generation token only ignores stale completion
callbacks; it does not stop the old GPU work.

The default-Earth and custom-planet precomputations can therefore interleave,
including additive scattering passes. This is a credible independent cause
of blue rings, inconsistent LUTs, and results that vary between remounts.
The adapter must configure the final atmosphere before starting generation
and permit exactly one LUT job per effect/service instance.

The diagnostic "Thin atmosphere" mutation is also not a valid dynamic test:
the effects snapshot their `ATMOSPHERE` uniforms at construction, so changing
the atmosphere and regenerating LUTs without reconstructing the effects
leaves geometry uniforms stale. Radius/atmosphere changes must be treated as
an atomic rebuild until the adapter explicitly supports refreshing all
snapshots.

## F12 — No-fork remediation

A maintained Takram fork is not required. The preferred remediation is a
small, guarded compatibility shim in the local Takram adapter:

1. After constructing `CloudsEffect`, feature-detect its internal cloud
   material/pass and override the per-frame camera-height calculation.
2. Calculate height in the same corrected spherical frame used by Takram's
   cloud shader: corrected ECEF camera distance minus `bottomRadius`. This is
   exact for the spherical custom planets used by the demo and avoids the
   hard-coded WGS84 fallback.
3. Apply an equivalent configured-ellipsoid correction to aerial perspective
   if its runtime internals can be reached safely.
4. Guard the shim by installed Takram version and expected field/method shape;
   fail loudly in development if an upgrade changes those internals.
5. Add regression coverage for 100 km, 1,000 km, and 6,360 km radii, including
   cameras below, inside, and above the cloud layer.

If runtime internals prove too unstable, the fallback is the package
manager's patch mechanism (`patch-package` or equivalent). That maintains a
small source diff in this repository and reapplies it at install time, but
still does not require publishing or maintaining a fork. Public settings
alone cannot correct the internal WGS84 calculation.

Upstream also lists rendering cloud views from space as planned functionality
in the installed `@takram/three-clouds` README. The height fix should resolve
the demonstrated branch-selection defect, but fully robust orbital/global
cloud views are outside the stated support of version 0.7.6. A separate 2D
cloud shell remains the safer fallback for distant orbital views.

Recommended execution order:

1. Add the guarded camera-height compatibility shim.
2. Remove concurrent/default LUT generation and generate once from final
   planet parameters.
3. Make every radius/atmosphere change an atomic parameter → LUT → effect
   reconstruction.
4. Re-test all three radii before tuning ray steps, texture repeats,
   tessellation, or `maxRayDistance`.

## F13 — F10/F11 fixes implemented (2026-07-16)

The no-fork remediation is now implemented in the local adapter.

- Added `takram-clouds-compat.ts`. It wraps the public
  `CloudsEffect.cloudsPass.currentMaterial.copyCameraSettings()` method,
  preserves Takram's original camera setup, then replaces only
  `cameraHeight` with the corrected ECEF camera distance (including Takram's
  `altitudeCorrection`) minus the configured `bottomRadius`.
- The shim validates the expected runtime uniforms/method before patching and
  throws a clear compatibility error if a future Takram release changes the
  relevant runtime shape. A `WeakSet` prevents double wrapping.
- `TakramCloudsComponent` applies the shim immediately after constructing each
  `CloudsEffect`, before registering it with the atmosphere service.
- Removed the eager default-Earth LUT generation from
  `TakramAtmosphereService`'s constructor. `TakramAtmosphereComponent` now
  initializes the default atmosphere only when no custom radius is provided;
  custom planets configure their final parameters first.
- LUT requests are keyed/deduplicated and serialized. A request arriving while
  generation is active is queued and begins only after the active update
  settles, preventing concurrent use of Takram's shared generator resources.
- Added adapter regression tests for 100 km, 1,000 km, and 6,360 km spheres,
  plus a test that verifies altitude correction is included.

Verification receipts:

- `npx ng build demo-app --configuration development` — succeeded.
- `npx ng test triangular-engine --watch=false --browsers=ChromeHeadless` —
  7/7 tests succeeded.

Visual testing in the interactive demo is still required. In particular,
verify clouds from below, within, and above the layer at all three presets,
and distinguish the fixed height-branch defect from Takram 0.7.6's remaining
100 km ray distance / unsupported orbital-view limitations.

User visual verification later on 2026-07-16: all three sizes are fixed for
the angle-dependent disappearance bug, and clouds are visible correctly from
all tested angles. This confirms F10 as the principal visibility root cause.

## F14 — Remaining cloud-proportion mismatch explained

Source inspection of `clouds.glsl` confirms Takram mixes planet-normalized and
physical-coordinate sampling:

- Local weather coverage uses normalized globe UV multiplied by the fixed
  `localWeatherRepeat` (default 100). Its physical wavelength is therefore
  proportional to planet radius, so weather features become physically much
  smaller/compressed on smaller planets.
- Turbulence UV derives from the same normalized weather UV and fixed repeats,
  so it has the same radius-dependent physical scaling.
- Shape and shape-detail noise sample ECEF `position` multiplied by fixed
  metre-scale repeats, so those features remain approximately constant in
  physical size instead of scaling with radius.
- Cloud altitude and thickness are currently fixed at 3,000 m and 2,000 m.
  A 2 km layer is 2% of the Small planet's radius but only about 0.03% of the
  Large planet's radius, so it necessarily appears much thicker/farther
  outward relative to the Small globe.

This mixed coordinate system explains the reported combination of more packed
small-planet clouds and a disproportionately thick/outward cloud volume. It is
not a recurrence of the camera-height bug. The next implementation must first
choose an artistic invariant:

- Constant real-world cloud dimensions: scale normalized weather/turbulence
  repeats with radius to preserve a target wavelength in metres, while keeping
  altitude/height and 3D-noise repeats fixed.
- Constant planet-relative appearance: scale altitude/height with radius and
  keep normalized weather repeat fixed; 3D-noise repeats must inversely scale
  with radius as well.

No cloud-scale adjustment was applied with this finding because those two
targets require intentionally different behavior.

The mini-planet diagnostics now include a "Re-center camera on surface"
button. It restores the current preset's `cameraHomePosition`, resets the
orbit target to the surface origin, and immediately updates OrbitControls.

## F15 — Constant-physical-size weather scaling implemented

Subsequent user testing described the checker preset changing from a thin
square at Large, to rounder/thicker at Medium, to a narrow vertical "hotdog"
at Small. This confirms F14: normalized horizontal weather dimensions were
shrinking with radius while the fixed 2 km vertical dimension did not.

The adapter now exposes a `localWeatherRepeat` input (default `[100, 100]`, so
existing Earth demos are unchanged). Mini-planet supplies:

```text
repeat = 100 * planetRadius / 6,360,000
```

Resulting repeats are Large `100`, Medium approximately `15.72`, and Small
approximately `1.57`. Because normalized UV arc length grows with radius,
scaling repeat linearly with radius preserves the Large preset's checker and
weather feature width in physical metres. Cloud altitude/height and ECEF 3D
shape/detail repeats remain fixed, matching the chosen constant-real-world-
cloud-size invariant.

Verification receipts:

- Demo development build succeeded.
- Triangular-engine adapter tests succeeded, 8/8.

Interactive aspect-ratio verification remains required.

## Open / unresolved

- **Small/Medium visibility**: verified fixed by the user at every tested
  angle. Remaining scale/proportion differences are tracked separately in
  F14.
- **Medium preset**: user grouped it with Small ("at lower scales its not
  working") but no dump or description was captured for Medium specifically.
- **Fix B (remount) and Fix D (camera altitude cap)**: code-complete and
  build-verified (`npx ng build demo-app --configuration development`
  succeeded after each), not yet visually re-verified by the user. Fix D is
  now understood as a secondary distance guard, not the root fix (F10).
- **Atmosphere LUT lifecycle**: the constructor/configuration race is corrected
  and generation requests are serialized (F13); visual verification remains.
- **`shadow.mapSize` dump formatting bug**: the compact dumpState() output
  renders it as `[object Object]` instead of a usable value.
- 003's F1–F8 hypotheses (texture-repeat/shape-noise scale mismatch,
  ray-march step size vs. planet curvature, planet-mesh facet count, LUT
  parameterisation at high atmosphere/radius ratio, shadow-map distance
  regime) were not tested this session in the order 003 specifies. F2 (march
  step size) and F8 (LUT ratio) are partially informed by this session's
  finding that `maxRayDistance` is fixed and non-overridable, but the step
  sizes (`min=100 max=1000`) themselves were not tested against the F2
  hypothesis this session.

## Current key values (both engine options and page constants)

- Small: radius 100,000 m, atmosphere height 20,000 m.
- Medium: radius 1,000,000 m, atmosphere height 40,000 m.
- Large: radius 6,360,000 m, atmosphere height 60,000 m (exactly
  `AtmosphereParameters.DEFAULT`).
- Cloud layer: altitude 3,000 m, height 2,000 m — fixed absolute values,
  identical across all three presets (not preset-scaled).
- `cameraHomePosition` altitude: `clamp(radius * 0.03, 2_000, 60_000)`.
- `cameraFar`: 50,000,000 m (unchanged all session).
- `cameraNear`: 1 m (library/store default; the session's temporary override
  to 50 m was reverted along with Fix E).
- `logarithmicDepthBuffer`: `true` on all three of `/takram-mini-planet`,
  `/takram-clouds`, `/takram-clouds-spike` (user's manual edits, current as
  of this writing).
- Clouds `qualityPreset`: `'low'` (via `TakramCloudControlsStore` default,
  unchanged), giving `maxRayDistance = 100,000 m` fixed.

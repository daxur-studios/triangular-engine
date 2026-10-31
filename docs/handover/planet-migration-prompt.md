# Prompt: move a game onto `<planet>` (terrain, atmosphere, clouds, surface detail, morph)

Paste everything below the line into a session opened in the game's repository. It is self-contained and generic. It asks for a plan first, then the change.

---

## Task

Move this game's planet rendering onto the `triangular-engine` high-level planet components. Today the game draws its planet with an older globe-to-map morph and has no atmosphere, clouds, scatter or surface detail. After the change it uses one `<planet>` with layers inside it, and the globe-to-map morph works for all of them.

Do this in two steps. **Step 1: write a short plan and stop for my OK** (what you will replace, what you will keep, any decision you need from me, with options). **Step 2: do it.** Do not commit; leave changes in the working tree.

## Read first (in the installed package, version of this repo)

- The package README, then `lod-surface/README.md` (sections: Minimal use, `<planet>`, Planet material, Standing on the ground, Globe-to-map morph).
- `atmosphere/README.md`, `cloud-volumes/README.md`, and the TSDoc on `PlanetComponent`, `PlanetTerrainComponent`, `PlanetAtmosphereComponent`, `PlanetCloudsComponent`, `PlanetSurfaceDetailComponent`.
- The engine's `PLANET_CONTEXT` (root `triangular-engine` entry): `<planet>` provides radius, sun and morph; layers inject it and an input given directly wins.

## Target shape

```html
<scene>
  <planet [radius]="radiusM" [sunDirection]="sun" [world]="world" [bake]="bake" [morph]="morph()">
    <planetTerrain />
    <planetAtmosphere preset="earth" [surfaces]="surfaces()" />
    <planetClouds [coverage]="0.45" />
    <planetSurfaceDetail [surface]="detailSurface()" [layers]="gameLayers" />
  </planet>
</scene>
```

- `radius`, `sunDirection` and the morph are given once to `<planet>`; no layer repeats them.
- `[world]` is `{ seed, cellCount, relaxationIterations, heightScaleM }` and must equal what the game already uses to build its cell-planet world, so the bake matches the game's planet.
- `[bake]`: the default bakes on the main thread (a visible stall). Pass a worker-backed `BakeClient` (the pattern is `runBake` inside a Web Worker; the package exports `runBake` from `lod-surface/core`).
- `[surfaces]` for the atmosphere is the terrain's material when it is a `TerrainPlanetMaterial` (so lighting and haze land on the ground). `[surface]` for surface detail is the same material when it is a `PlanetSurfaceMaterial` (use `instanceof` to narrow `terrain.surface()`).
- **Surface detail is generic machinery.** `<planetSurfaceDetail [layers]>` takes this game's own layers (`{ id, layer, order? }`, later layers draw over earlier ones). The library ships no runway, road or building content; this game decides what to draw. If the game needs flat ground under a feature, apply `new FlatFeatureSet(features, radius).heightStamp()` in the height bake's `modifyElevation`; the component does not flatten terrain. A layer id used twice on one material throws.
- The camera stands in the scene frame with the planet's centre at the origin. The terrain keeps its own `groundAt(position, out)` to keep the eye above the ground.

## The morph

Bind one signal to `<planet [morph]>` (0 globe, 1 flat map; `projection` and `projectionCentre` are optional inputs). Everything inside follows it. Delete the game's old morph path once the new one works; do not run both.

## Known limits (do not try to fix these in the game; tell me if one blocks you)

- Preview status; WebGPU only. Say what the game does on a browser without WebGPU.
- The terrain bends; the **atmosphere's surface lighting and haze follow the morph**; the **sky backdrop dissolves** when the camera is high and the planet is unrolled, and the **cloud shell fades** with the morph (bending it into the map is a library follow-up).
- Pole fan (the leaves at the projection poles) is a flat-colour sphere above morph 0; relief fades as the map flattens; direct shadows are off above morph 0.
- Scattered objects (trees, buildings) do not morph yet: the game must hide or place them itself while the morph is above 0.

## Acceptance

1. The game builds and its own tests pass; list what you ran.
2. Planet at morph 0, 0.5 and 1 draws terrain, sky and clouds without console errors (report anything on `engine.error$`).
3. Nothing from the old morph path is left referenced.
4. A short note listing what you removed, what you kept, and anything you needed from the library that was missing (as a question for me, not a workaround).

Stop and ask rather than guess when a choice is not covered here.

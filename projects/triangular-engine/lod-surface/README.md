# triangular-engine/lod-surface

Level-of-detail terrain for games: `<planetTerrain>` for a sphere (optionally inside a `<planet>` that shares its radius, sun, morph and cell-planet world) and `<flatTerrain>` for a bounded square. Both draw a quadtree of patches in one instanced draw call, selected on the CPU every frame from the active camera, with cracks closed by edge folding. WebGPU only (`preferredRenderer: 'webgpu'`); on another renderer the terrain stays hidden and does nothing.

Status: **preview** (Plan 059, step G5). Try it at `/lod-surface-lab` in the demo app, and the whole `<planet>` scene (terrain, atmosphere, clouds placeholder) at `/planet-scene`.

## Entries

| Import | What it holds |
|---|---|
| `triangular-engine/lod-surface` | The Angular components: `<planet>`, `<planetTerrain>`, `<flatTerrain>`. |
| `triangular-engine/lod-surface/core` | Framework-free pieces: domains, selector, mesh, height sources, baking. A worker file imports this one, because workers cannot link Angular declarations. |

## Minimal use

```ts
import { PlanetTerrainComponent } from 'triangular-engine/lod-surface';

@Component({
  imports: [PlanetTerrainComponent],
  template: `<planetTerrain [radius]="600_000" [detailNoise]="0.04" />`,
})
export class GameComponent {}
```

The component needs `EngineService` (so it lives inside a `<tri-engine>` tree), a `PerspectiveCamera` whose near and far planes you set (a reversed depth buffer covers a 2 cm near plane and an orbit view together), and the WebGPU renderer. The planet's centre is the scene origin. `<flatTerrain [size]="100_000" />` is the same on the XZ plane, centred on the origin with +Y up.

## Behaviour

- **Selection** runs in `beforeRender$` and does not depend on the view direction: the tree is the same however the camera turns. Only which selected leaves are drawn depends on the frustum (`cull`).
- **Camera-relative drawing.** The terrain's group follows the camera, and vertex positions are computed relative to it, so precision holds at planet scale.
- **Rebuilds.** Changing `radius`/`size`, `warp`, `heights`, `patchCells`, `leafCap`, `material` or switching `detailNoise` on or off rebuilds the mesh. Other inputs only update it.
- **Pipeline warm-up.** A new mesh (the first, and every rebuild) is compiled with `renderer.compileAsync` before it is drawn: the terrain stays hidden, still selecting, until that finishes, so a new material (the planet material most of all) does not stall the first frame. A failed or very slow (over 60 s) compile is reported on `engine.error$` (phase `compile`) and the terrain is shown anyway. Scene lights and the environment should be in place before the terrain is created; one added later makes the first draw compile again.
- **Telemetry** is on the `terrain` signal of each component: `stats` (leaves, drawn leaves, selection time), `triangles`, `selector` and `surface` for anything the wrapper does not cover.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `radius` (planet) / `size` (flat) | required (`radius`: or from a [`<planet>`](#planet-one-place-for-the-radius-sun-morph-and-world)) | Sphere radius or square side, metres. |
| `heights` | flat | A `HeightSource`: analytic (`createHeightSource(id, kind)`) or baked (see below). |
| `detailNoise` | 0.04 | Noise below the height texture's texel, as a share of the texel; 0 is off. |
| `detailCells` | texture size, else 1,024 | Texels per side the noise is sized by. |
| `leafCap` | 4,096 | Most leaves selected. |
| `cellPixels` | 4 | Target cell size on screen (2 px floor). |
| `patchCells` | 16 | Grid cells per leaf side: 16, 32 or 64. |
| `hysteresis` | 0.15 | Split/merge hysteresis ratio; 0 is a single threshold. |
| `cull` | true | Draw only leaves inside the frustum. |
| `warp` (planet only) | `'equal-angle'` | Cube warp; baked heights must use the same one. |
| `material` | debug material | A `NodeMaterial`; the terrain sets its `positionNode`. Pass a `TerrainPlanetMaterial` to draw with the planet material ([below](#planet-material)). You dispose it. |
| `sunDirection`, `view`, `lighting`, `bounds`, `wireframe` | see TSDoc | Options of the default debug material. `sunDirection` also reaches a `TerrainPlanetMaterial`; inside a `<planet>` it defaults to the planet's. |

## Heights

Analytic sources come from `createHeightSource`. Baked sources run a heavy sampler once into a texture and read it in the vertex stage; the CPU twin reads the same texels with the same float32 arithmetic, so the selector's heights match the GPU's.

```ts
// worker file in your app (not shipped by the library):
import { serveBakeRequests } from 'triangular-engine/lod-surface/core';
serveBakeRequests(self);

// elsewhere:
import { createBakeClient, createTextureHeightSource } from 'triangular-engine/lod-surface/core';
const bakeInWorker = createBakeClient(
  () => new Worker(new URL('./height-bake.worker', import.meta.url), { type: 'module' }),
);
const result = await bakeInWorker('biome-mix', layout);
const heights = createTextureHeightSource('biome-mix', result.baked);
```

`layout` is a `BakeLayout` (body, cube warp and texture size exponent between `MIN_BAKE_K` and `MAX_BAKE_K`). A bake made for a different body or warp than the component's is rejected with an explicit error. Dispose a texture source when you replace it.

## Cell-planet heights

A game that builds a `triangular-engine/worldgen` cell planet can put `<planetTerrain>` on it with `cellPlanetHeights`. It does not take the built world: worldgen is deterministic, so the worker rebuilds the same world from its parameters. **They must match the ones the game used for `buildCellPlanetWorld`** (`seed`, `cellCount`, `relaxationIterations`); a world built with a non-default `jitter`, `plateCount`, `worldProfileKind` or `terrain` is not reproduced. The height at a point is `(elevation - seaLevel) * heightScaleM` metres above `radius`, the sea at 0.

```ts
// height-bake.worker.ts (in your app)
import { serveBakeRequests } from 'triangular-engine/lod-surface/core';
serveBakeRequests(self);
```

```ts
// game.component.ts
import { createBakeClient, cellPlanetHeights, type TextureHeightSource } from 'triangular-engine/lod-surface/core';

const bake = createBakeClient(() => new Worker(new URL('./height-bake.worker', import.meta.url), { type: 'module' }));

@Component({
  imports: [PlanetTerrainComponent],
  template: `@if (heights(); as h) { <planetTerrain [radius]="radius" [heights]="h" /> }`,
})
export class GameComponent {
  readonly radius = 600_000;
  readonly heights = signal<TextureHeightSource | undefined>(undefined);

  async ngOnInit() {
    this.heights.set(await cellPlanetHeights(bake, { seed: 7, cellCount: 1500, heightScaleM: 4_000, radius: this.radius }));
  }
}
```

The bake takes seconds (the world build, then the texture), so the terrain appears once the promise resolves; before that, omit `heights` for a flat sphere. `radius` and `warp` must equal the component's, or the terrain throws. The source is sphere-only: given to `<flatTerrain>` it throws "use `<planetTerrain>`". Dispose it (`heights.dispose()`) when you replace it.

## Planet material

`TerrainPlanetMaterial` draws the terrain with `PlanetSurfaceMaterial` (`triangular-engine/planet-material`), so the ground has the planet material's layer, occluder, emissive, lighting and atmosphere stacks and the colours of the cell-planet globe (Plan 059, step G3; preview). It goes in the `material` input with nothing else to wire: the terrain mesh gives the material its vertex nodes (`bindLodSurfaceNodes`) and its sun direction.

```ts
import { buildCellPlanetWorld } from 'triangular-engine/worldgen';
import { PlanetTerrainComponent, TerrainPlanetMaterial } from 'triangular-engine/lod-surface';

const world = buildCellPlanetWorld({ seed: 7, cellCount: 1500 });     // the world the heights were baked from
material = new TerrainPlanetMaterial({ cellPlanet: world });
// template: <planetTerrain [radius]="r" [heights]="heights()" [material]="material" [sunDirection]="sun" />
// add a DirectionalLight and an AmbientLight to the scene: this material is lit by them (standard PBR)
```

Why the `material` input and not a new input or component: the terrain already hands a supplied material the nodes it needs, so the one object a game creates is the material, and `cellPlanet` is its ground-colour option. You dispose the material, which also frees its cell textures.

- **Colours come from the same world.** `cellPlanet` takes the built world (`ICellPlanetWorld`) or the description given to `cellPlanetHeights` (`{ seed, cellCount, relaxationIterations? }`, built on the calling thread and kept). Land and ice take their biome colour, the sea the ocean colour (lava for a lava world): the globe's `natural` colours for that world. Pass the **same** world as the heights, or ground and heights disagree. `material.cells` has `opacity` and `updatePalette(Float32Array)` to recolour cells (territory overlays) without a rebuild; `cellLookup: { atlasWidth, colours }` overrides the atlas size and the palette.
- **Exact cell edges at any zoom.** The ground uses `cellVoronoiLayer`, not the plain atlas lookup (nearest-filtered, so an edge is a staircase of atlas texels up close). A 1,024 x 512 atlas finds a nearby cell; the shader then picks the true one, the cell centre with the largest dot product among that cell and its neighbours, so an edge is a straight Voronoi edge at 2 cm. Memory for 1,000 cells: a 2 MB atlas plus 64 KB of tables. Cost: 12 texture fetches per fragment where the plain lookup has 2. The atlas grows past about 20,000 cells to keep a texel under a quarter of a cell. Building it takes about 50 ms for 1,000 cells on the calling thread, after the world itself (about 100 ms).
- **Sea level.** The terrain puts the sea at `radius`; the morph globe puts it `seaLevelElevation * heightScale` higher (0.3232 for the lab seed: 48 m on the 10 km sphere). Defaults are unchanged. To draw both in one scene, give the globe `seaAlignedGlobeRadius(radius, world, heightScaleM)` (from `lod-surface/core`) as its radius and keep the terrain's `radius`. `<planet [world]>` computes it for you: `seaAlignedGlobeRadius()`.
- **Sun.** The PBR lighting reads the scene's lights. `material.setSunDirection(dir)` (called by `<planetTerrain [sunDirection]>`) keeps `material.dayNight.uSunDirection` in step, which is where a parent's day/night lighting stage reads it; moving the scene's directional light to match is the parent's job.
- **Without a cell planet** `new TerrainPlanetMaterial()` is a solid colour to which you add your own layers (`addSurfaceLayer`). Layers that read a vertex attribute (the vertex-colour base, the macro layer's land mask, streamed tiles) do not work here: the terrain has none.
- **How it plugs in.** The material calls `PlanetSurfaceMaterial.setStageOverride` with the terrain's nodes (see the [planet material README](../planet-material/README.md#using-the-material-on-another-mesh)). Layers that lift `position` through the model matrix need the mesh at the camera, which `LodTerrainBody` keeps.

## `<planet>`: one place for the radius, sun, morph and world

`<planet>` is a light parent that holds what the layers drawn on a planet share, so a game writes it once (Plan 059, step G5; preview). It draws nothing and is not an `Object3D`; the planet's centre is the scene origin. Children read it through the `PLANET_CONTEXT` token (root entry), and a child's own input always wins, so `<planetTerrain>` and `<planetAtmosphere>` still work on their own.

```html
<planet [radius]="600_000" [sunDirection]="sun" [world]="world" [bake]="bake">
  <planetTerrain />
  <planetAtmosphere preset="earth" [surfaces]="surfaces" />
</planet>
```

```ts
import { createBakeClient } from 'triangular-engine/lod-surface/core';

readonly sun = [0.4, 0.8, 0.45];
readonly world = { seed: 7, cellCount: 1500, heightScaleM: 4_000 };   // as given to buildCellPlanetWorld
readonly bake = createBakeClient(() => new Worker(new URL('./height-bake.worker', import.meta.url), { type: 'module' }));
```

| Input | Default | Meaning |
|---|---|---|
| `radius` | required | Sea-level radius, metres. |
| `sunDirection` | `[0.4, 0.8, 0.45]` | Direction to the sun in the scene frame; any length, read back normalised. |
| `morph` | 0 | Globe (0) to flat map (1); clamped. |
| `projection` | `'equal-earth'` | Map projection: `'equal-earth'` or `'equirectangular'`. |
| `projectionCentre` | `null` | `{ lonDeg, latDeg }` to centre the map on, or `null` for the baked centre. |
| `world` | none | A cell planet `{ seed, cellCount, relaxationIterations?, heightScaleM, bakeK? }`: the `cellPlanetHeights` options without `radius` and `warp`. |
| `bake` | inline | The `BakeClient` that bakes the world's heights. The default runs on the calling thread and blocks the page for the bake (seconds at large `cellCount`); pass `createBakeClient(() => new Worker(...))` in a real game. |

- **Terrain inside it.** `<planetTerrain>` takes `radius` and `sunDirection` from the planet unless it has its own. With a `world` it also takes the planet's baked `heights` (flat until the bake lands, then the mesh is rebuilt) and, unless it has its own `material`, makes and owns a `TerrainPlanetMaterial` for that world (disposed when the world changes and on destroy). Leave `<planetTerrain [warp]>` at its default: the planet bakes with `'equal-angle'`. With no radius from either, the terrain shows nothing and reports once on `engine.error$` (phase `config`).
- **Atmosphere on the terrain.** `<planetTerrain>.surface` is a signal of the node material the ground is drawn with when it is a planet material (your `material` input, else the `TerrainPlanetMaterial` the terrain made for the planet's `world`), and `undefined` while the terrain draws its own debug material or has no radius. A `TerrainPlanetMaterial` is a `PlanetSurfaceMaterial`, so `<planetAtmosphere>` can light and haze it: put the signal's value in the atmosphere's `[surfaces]`. Reading it never disposes anything, and the signal changes when the material is replaced, so a computed over it keeps `[surfaces]` current.

  ```ts
  readonly terrain = viewChild(PlanetTerrainComponent);
  readonly surfaces = computed(() => {
    const material = this.terrain()?.surface();
    return material instanceof TerrainPlanetMaterial ? [material] : [];
  });
  ```

  `<planetAtmosphere [enabled]="false">` then takes the sky and the lighting and haze stages off the terrain without a recompile, which is how the demo's `planet-scene` suite measures the cost of the air. The `/planet-scene` demo page is this wiring end to end.
- **World outputs.** `heights()` (a `HeightSource`, undefined until the bake resolves; a stale bake never replaces a newer one, and a failed one is reported on `engine.error$` with phase `bake`), `cellPlanet()` (the description for `TerrainPlanetMaterial`) and `seaAlignedGlobeRadius()` (the radius for a separate morph globe so its sea meets the terrain's; reading it builds the world on the calling thread). The planet owns the baked source and frees its texture when it is replaced and on destroy.
- **Morph.** The planet owns one `createPlanetMorphUniforms()` set (`morphUniforms`), writes `morph`, `projection`, `projectionCentre` and the map extent from `radius` into it, and exposes `morphUniform` (its `uMorph`, the same object for the planet's life). `<planetAtmosphere>` follows it every frame. **The terrain does not bend yet** (step G6): while `morph` is above 0 it keeps drawing the sphere and reports once on `engine.error$` (phase `morph`).

## Standing on the ground

`groundAt(position, out?)` answers "what is under this point" from the CPU twin of the heights, detail noise included. It is on `LodTerrainBody`, `<planetTerrain>` and `<flatTerrain>` (the components return `undefined` until the terrain exists); `groundAt(source, domain, position, out?, stepM?)` and `createGroundSample()` are the pure function and a reusable sample in `lod-surface/core`, which also run in a worker.

```ts
import { createGroundSample } from 'triangular-engine/lod-surface/core';

private readonly ground = createGroundSample();   // reused: nothing is allocated per frame

update(dt: number): void {
  const sample = this.terrain.groundAt(this.feet, this.ground);   // feet: a point in the scene frame
  if (!sample) return;
  if (sample.altitudeM <= 0) {                 // at or below the ground: snap onto it
    this.feet.set(...sample.point);
  }
  this.body.quaternion.setFromUnitVectors(UP, new Vector3(...sample.normal));   // align to the slope
}
```

- `point` is the ground under the query (`up` times `radius + heightM` on a sphere, `y = heightM` on a plane), `normal` its unit normal, `up` the base surface's up (away from the sphere's centre, +Y on the plane), `altitudeM` how far the query is above the ground along `up` (negative: underground).
- The normal is a central difference of `heightAt` in two tangent directions, half a texel of the height texture each way, so it follows the relief the texture can hold and ignores the finest noise octaves. The step is the body's own; pass `stepM` to the pure function for an analytic source with finer features.
- It is the full-detail surface. What is drawn can differ from it by the LOD error, which is smallest near the camera, so use it for characters and vehicles near the camera. Baked sources read the same texels as the vertex stage.
- It is not a ray cast: the answer is the ground along `up`, one height per point, so a cliff face or overhang is not represented.
- On a plane a query outside the square is clamped to the nearest edge point. The sphere's exact centre has no direction; `up` is then +Y.
- Cost: five `heightAt` calls, about 1 to 4 microseconds per call in Node (see runbook 059, G4).

## Morph-aware selection (preview)

For the globe-to-map morph, `lod-surface/core` has a per-node geometry hook on `LodSelector` (`setGeometryHook`, `invalidateGeometry`) and `StretchMetric`, a hook that measures each node on the bent, stretched surface instead of the sphere (a pole corner of the projection is a whole edge of the map, so the sphere metric would call it small and far). With no hook, or at morph 0, the selection is the default one. Each frame: `metric.update({ morph })` (node geometry is re-measured only when the morph moves by a step, 0.01 by default, or the projection, radius or projection centre changes), then select with the camera from `metric.selectionPoint(direction, altitude)` and a frustum built from that camera. This is the CPU half; the terrain does not use it yet (wired up in G6e), so `<planetTerrain>` still draws the sphere while `morph` is above 0.

## Globe-to-map morph in the surface mesh (preview)

`createLodSurfaceMesh({ ..., morph: true })` (and `LodTerrainSettings.morph` for `LodTerrainBody`) builds the globe-to-map bend into the vertex stage of a sphere surface. It is a preview: `<planetTerrain>` does not use it yet, because the morph also needs the selector's bent bounds (G6c, `StretchMetric`), the pole fan (G6d) and the planet material, normals and shadows on the bent surface (G6e). Without the option the shader is exactly today's. With it, and morph 0, the drawn position is today's too, through a `select` on a uniform; above 0 it is the bent map position.

```ts
const body = new LodTerrainBody({ ...settings, morph: true });
body.setMorph(planet.morphUniforms);            // or { morph: 0.5, projection: 'equal-earth', projectionCentre: { lonDeg, latDeg } }
// each frame: body.update(camera, viewportHeightPx) — the camera is the bent camera (the one that sees the bent surface)
```

- **Inputs.** `setMorph` takes a `LodMorphSettings` or `<planet>`'s `morphUniforms` (`IPlanetMorphUniforms`, read again on every update, so animating `uMorph` is all it takes). The CPU needs the morph, the projection and the centre in doubles for the per-frame anchor; the GPU reads uniforms only, so changing them recompiles nothing. The map is `planetMapXY`: Equal Earth scaled by `PLANET_MAP_EQUAL_EARTH_SCALE` (1.1607) in x and y; equirectangular is `(R lon, R lat)` at every morph and never blends.
- **Precision.** Vertices are placed from their offset to a per-frame anchor (the lattice point nearest the camera) by difference forms, with the large angles computed on the CPU in doubles (`computeMorphFrame`). Within about 1 km of a pole of the projection a second lattice stage measures from the pole. Seam vertices depend only on their lattice point and the frame, so neighbouring leaves agree bit for bit. In float32 emulation a vertex 1 m to 1 km from the pole stays under 1 px at 2 m altitude when the camera is 60 m or more away; closer than that the error floor is the float32 resolution of the vertex's longitude, a few centimetres at 6,371 km (see `lod-morph-pole.spec.ts`).
- **The cut.** The map is cut at the meridian opposite the projection centre. Each leaf is drawn on the side of its centre; a leaf that reaches the cut is drawn twice (once per side), so the instance capacity is doubled, and fragments outside the map's outline are discarded. `surface.morphPack` reports the duplicates, torn leaves and drops.
- **Culling.** Above morph 0 frustum culling is off (temporary): the selector would cull against the unbent globe. `body.setMorphCulling('bent-bounds')` keeps the frustum for when the selector's bent bounds (`StretchMetric` via `body.setGeometryHook`) are in place. In both modes the selector sees the unbent camera (`surface.unbend`).
- **For G6d and G6e.** `surface.morphFrame` (the last frame's anchor and outline values), `surface.setSkipPoleLeaves(true)` (leave out the leaves a pole fan draws; `isPoleFanLeaf`), `createMorphStage` and `p2FromAngles` (build a fan's vertices from polar differences), the `lod-morph-*` modules of `lod-surface/core`, and `surface.nodes.bentUp` (the bend's up, for the material).

## Not included

Ray hits against the ground (cliffs, overhangs), physics colliders (Plan 059 M5), the terrain's globe-to-map bend in the components (step G6e; the selection half is in `StretchMetric` above, the mesh half is the preview above, and `<planet>` already carries the morph state) and a `<planetClouds>` wrapper are later steps or separate work. The older `triangular-engine/terrain` entry is a different system and is unchanged.

# triangular-engine/lod-surface

Level-of-detail terrain for games: `<planetTerrain>` for a sphere and `<flatTerrain>` for a bounded square. Both draw a quadtree of patches in one instanced draw call, selected on the CPU every frame from the active camera, with cracks closed by edge folding. WebGPU only (`preferredRenderer: 'webgpu'`); on another renderer the terrain stays hidden and does nothing.

Status: **preview** (Plan 059, step G1). Try it at `/lod-surface-lab` in the demo app.

## Entries

| Import | What it holds |
|---|---|
| `triangular-engine/lod-surface` | The two Angular components. |
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
- **Telemetry** is on the `terrain` signal of each component: `stats` (leaves, drawn leaves, selection time), `triangles`, `selector` and `surface` for anything the wrapper does not cover.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `radius` (planet) / `size` (flat) | required | Sphere radius or square side, metres. |
| `heights` | flat | A `HeightSource`: analytic (`createHeightSource(id, kind)`) or baked (see below). |
| `detailNoise` | 0.04 | Noise below the height texture's texel, as a share of the texel; 0 is off. |
| `detailCells` | texture size, else 1,024 | Texels per side the noise is sized by. |
| `leafCap` | 4,096 | Most leaves selected. |
| `cellPixels` | 4 | Target cell size on screen (2 px floor). |
| `patchCells` | 16 | Grid cells per leaf side: 16, 32 or 64. |
| `hysteresis` | 0.15 | Split/merge hysteresis ratio; 0 is a single threshold. |
| `cull` | true | Draw only leaves inside the frustum. |
| `warp` (planet only) | `'equal-angle'` | Cube warp; baked heights must use the same one. |
| `material` | debug material | A `NodeMaterial`; the terrain sets its `positionNode`. You dispose it. |
| `sunDirection`, `view`, `lighting`, `bounds`, `wireframe` | see TSDoc | Options of the default debug material. |

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

## Planet material (spike, preview)

`TerrainPlanetMaterial` is `PlanetSurfaceMaterial` for the terrain (Plan 059, step G3 spike). The plain material reads vertex attributes only the morph globe has, so on the terrain it draws black; this subclass keeps its layer, occluder, emissive, lighting and atmosphere stacks and rebuilds the planet context from the terrain's own vertex nodes (`LodSurfaceMesh.nodes`). It is lit by scene lights, so add a directional light.

```ts
const material = new TerrainPlanetMaterial();           // solid base colour; add layers on top
const cells = cellLookupLayer();                        // from triangular-engine/planet-material
material.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
// <planetTerrain [radius]="r" [heights]="h" [material]="material" />
```

Layers that read a vertex attribute (the vertex-colour base, the macro layer's land mask, streamed tiles) still need that attribute and do not work here. Preview: the shape may change in G3 (see the Plan 059 runbook). The sea sits at `radius` on the terrain but at `radius + seaLevelElevation * heightScale` on the morph globe; see the runbook for the offset.

## Not included

Gameplay height and normal queries, the finished planet material integration and a parent `<planet>` component are later steps of Plan 059. The older `triangular-engine/terrain` entry is a different system and is unchanged.

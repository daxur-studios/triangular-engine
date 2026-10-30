# 039 — Cell-terrain app integration contract

**Status:** draft reference, 2026-09-20. This is the compact "what a game must do
to use the cell-planet streaming terrain" contract that
[`035_unified_cell_terrain_delivery.md`](035_unified_cell_terrain_delivery.md)
defers to its **L6** ("Document how a game supplies a world/style and selects
flat, sphere or morph mode"). It is written from the three working
implementations and their footguns, not from the API docstrings alone, and is
expected to be folded into L6 when that milestone lands.

**Scope:** `TerrainSurfaceComponent` + `LatLonTerrainDomain` streaming (the
`triangular-engine/terrain` secondary entry point), as used by the demo app's
`cell-planet-morph-streaming` page, BSP's `cell-planet-physics` example, and
BSP's `full-environment` example. It does **not** cover the legacy
`worlds` quadtree or `<cdlodPlanet>`.

**TL;DR:** the engine owns camera tracking, selection, queueing and batching.
You supply `field`/`domain`/`roots` + a worker mesher + a material. There are
five footguns (§3); the two that cost real time are the **observer space** and
the **worker `@angular/compiler` import**.

---

## 1. What the engine provides

`TerrainSurfaceComponent` (`projects/triangular-engine/terrain/components/terrain-surface.component.ts`):

- Per-frame camera-driven LOD: subscribes to `EngineService.beforeRender$`
  (`:244-248`), observer = `lodPosition() ?? engine.camera.position` (`:263`,
  `:765-768`), with an early-out when the observed position/inputs are unchanged
  (`:271-276`). You do **not** need an OrbitControls listener.
- Quadtree selection + hysteresis + `maxPatches` budget (built-in selector
  `selectAdaptiveTerrainPatches`, `terrain/streaming/terrain-patch-selection.ts:30-76`;
  generic request contract `terrain/streaming/terrain-surface-patch-selector.ts:5-18`).
- Async generation queue: priority (near-first), reconcile, drain, stale-result
  rejection via epoch (`terrain/streaming/terrain-generation-queue.ts`).
- Coarse-cover bootstrap + coverage-safe progressive replacement (`:280-281`,
  `:448-514`), residency, eviction, geometry disposal (`:720-746`).
- `BatchedMesh` single-draw batching for skirt-free patches (`:592-595`,
  `:637-681`; stats count the batch as 1 draw, `:780-781`).
- Default synchronous mesher, or an injected `meshGenerator` (`:419-424`).
- `lodChange` stats output: desired/resident/queued/drawCalls/triangles/
  geometryBytes/levels (`:38-49`, `:770-794`).
- Reusable morph-projection material helper + map projections in
  `triangular-engine/worldgen/render` (`planet-morph-material.ts:88`,
  `map-projections.ts`, `planet-map-picking.ts`).
- Input API with defaults: `terrain/README.md:12-75`.

---

## 2. What an app must supply

| Supply | Notes |
|---|---|
| `field` | The component only uses it for the default mesher; a custom `meshGenerator` can pass a no-op field. |
| `domain` | `new LatLonTerrainDomain(radiusM, uSegments, vSegments)` for the sphere. |
| `roots` | `domain.createLevelZeroRoots()`. |
| `getLevel` / `getKey` | Required for a custom address shape; defaults expect an integer `level` field / `JSON.stringify`. |
| `meshGenerator` (for a real app) | A Web Worker that builds the patch from **your** world/sampler. See §3.1 for the mandatory import. |
| `createMaterial` | Any `Material`. |
| `lodPosition` (optional) | Only if the engine camera is not the right observer in the right space. See §3.2. |
| Quality presets | `maxLod`, `resolution`, `generationBudget`, `maxPatches`, `batching`, `frustumCulled`, `skirtDepth`. |
| Worker simplification (optional) | Meshoptimizer via `triangular-engine/meshoptimizer`'s `simplifyIndexedGeometry(..., { flags: ['LockBorder'] })`, plus index compaction to `Uint16`. This is **consumer-side today**; see §5. |

Minimum for camera-driven streaming: host an `EngineService` (via `<scene>`) and
bind `field`, `domain`, `roots`. Everything else has a default.

---

## 3. Footguns (read these)

### 3.1 A worker importing an engine *entry point* must `import '@angular/compiler';`

Angular's `bundleWebWorker` builds worker bundles without the Angular linker
(`buildSync({ plugins: undefined })`), so a partially-compiled library
(`ɵɵngDeclareComponent`) throws at module load ("needs to be compiled using the
JIT compiler"). The worker `onerror` then rejects every request — usually seen
as a silently **black/empty scene**.

Put this as the **first import** of any worker that imports `triangular-engine/terrain`
or `/worldgen/render`:

```ts
import '@angular/compiler';
```

`worldgen/core` and `celestial` are declaration-free and worker-safe;
`terrain`, `worldgen/render`, `jolt`, `takram`, etc. are not.
See the root `README.md` and `terrain/README.md` troubleshooting entries.

### 3.2 The observer position must be in the *same space* as the domain centres

The built-in selector compares `cameraWorldM` against `domain.getSurfacePosition(address)`
— **body-fixed absolute** metres (≈ planet radius for a real body). The engine's
default observer is `engine.camera.position`, which is **render-space**.

- If your scene does **not** recentre (planet centre at the origin, camera orbits
  at radius + altitude), the default camera observer is correct — this is why the
  morph demo and `full-environment` bind no `lodPosition`.
- If your scene **recentres** for float32 precision (BSP's flight scene and the
  `cell-planet-physics` example subtract a `renderOriginBodyFixedM`), the raw
  camera is *not* in body-fixed space. Bind `lodPosition` to the camera converted
  back: `bodyFixed = camera.position + renderOriginBodyFixedM`. **If you instead
  pin `lodPosition` to some other object (e.g. the vessel), the camera will never
  drive refinement and the far side stays coarse/blurry — orbiting does nothing.**
- Beware `[frustumCulled]="false"`: it does not reduce draw calls, it forces every
  resident patch to draw even when off-screen. It is a correctness aid (never drop
  a patch while orbiting), not an optimisation.

When the flight scene is involved, do not hand-roll the conversion; use the
canonical render-frame helpers per BSP's `src/app/shared/celestial/AGENTS.md`.

### 3.3 Batching has preconditions

`[batching]="true"` only merges patches that have **no skirt** (`skirtDepth = 0`)
and share one material (`:592`, `:587-635`). On a real body this is usually what
you want (cracks are handled by `calculateTerrainPatchEdgeRefinementMasks` +
edge-conforming meshing, not skirts). Caveat: an earlier hand-rolled
`THREE.BatchedMesh` attempt in BSP broke planetary ring shadows / grazing-angle
disappears — see BSP `docs/runbook/15…:109` and case study 015. The engine's
path is exercised by the morph demo, but verify shadows/grazing angles in your
scene before trusting it.

### 3.4 The default selector is projection/morph-blind

`selectAdaptiveTerrainPatches` only knows the domain's sphere surface. A 2.5D
morph/flat-map mode needs a **custom `patchSelector`** that recomputes candidate
centres in the projected space (the morph demo does this:
`cell-planet-morph-streaming-page.component.ts:494-608`). The engine forwards a
rich request (`terrain-surface-patch-selector.ts:5-18`) but no projection context.
Runbook 035 L6 explicitly calls the current selection contract insufficient for
morph (`:98-101`).

### 3.5 Local libs resolve through `dist/`

After `ng build terrain` (or `npm run build:libs`), a running `ng serve` will not
hot-reload the rebuilt package — restart `ng serve`. See
`docs/troubleshooting/local-libs-build.md`.

---

## 4. Minimum wiring recipe

```html
<scene [logarithmicDepthBuffer]="true">
  <terrainSurface
    [field]="field"
    [domain]="domain"
    [roots]="roots"
    [maxLod]="6"
    [resolution]="32"
    [generationBudget]="4"
    [maxPatches]="160"
    [batching]="true"
    [frustumCulled]="false"
    [getKey]="getKey"
    [getLevel]="getLevel"
    [meshGenerator]="meshGenerator"
    [createMaterial]="createMaterial"
    (lodChange)="onLodChange($event)"
  />
</scene>
```

Add `[lodPosition]="..."` only per §3.2. Read `lodChange`'s `drawCalls` to confirm
batching took (should be ≈ 1, not one per resident patch).

---

## 5. Performance levers (in rough order of impact)

1. **`batching`** — collapses resident patches to ~1 draw.
2. **`maxPatches`** — hard-caps the quadtree cut and the queue. Without it a
   custom selector can still blow the budget.
3. **`generationBudget`** — bounds per-frame worker meshing.
4. **Worker-side simplification** — `simplifyIndexedGeometry` with `LockBorder`
   (never simplify a shared border differently per side), and index compaction to
   `Uint16` where possible. Demo: `cell-planet-morph-streaming.worker.ts:586-621`,
   `:307-354`.
5. **`resolution` / `maxLod`** — per-preset; higher is quadratically more work.
6. Skirts only if you are **not** batching; they force the per-patch draw path.

---

## 6. Reference implementations

| Purpose | Where | Notes |
|---|---|---|
| Full morph + batching + worker simplification + custom selector | demo `cell-planet-morph-streaming` | The performance reference. |
| Physics / single surface authority, recentred | BSP `cell-planet-physics` | Camera-driven LOD via converted `lodPosition`; batching on. |
| Simplest sphere, engine-camera LOD | BSP `full-environment` | No `lodPosition`, no batching. |

---

## 7. Known gaps (not engine-provided yet — consumer must own)

- Morph/projection-aware `patchSelector` (§3.4).
- Morph-aware raycast against batched geometry (the demo hand-rolls
  `raycastMorphedTerrain`; `CellPlanetMorphViewComponent` has only a CPU
  `syncPickGeometry`).
- The worker mesher itself (world cache, cell sampling, colour modes, edge
  conforming, simplification, compaction, transferables).
- The dual-space morph attribute contract (`aSpherePos`/`aFlatPos`/norms +
  macro land factor) shared between worker and material.

---

## 8. Verification checklist

- [ ] Observer is the intended one **and in the right space** (§3.2): orbit far
      from the pinned object and confirm the near side refines.
- [ ] Worker starts with `import '@angular/compiler';` (§3.1) — no black scene.
- [ ] `lodChange.drawCalls` ≈ 1 with `batching` on and no skirts (§3.3).
- [ ] `resident/desired/queued` stay bounded (custom selectors can ignore
      `maxPatches`).
- [ ] After a lib rebuild, `ng serve` was restarted (§3.5).

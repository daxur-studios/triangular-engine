# 032 — Cell planet globe prototype

## Status and ownership

- **2026-09-13: prototype implemented; automated geometry checks pass; browser visual
  acceptance not run.**
- Goal: validate that the shared world snapshot's geography reads correctly when wrapped onto
  a fixed-resolution sphere and displaced radially, before committing to the shared chunked
  terrain infrastructure.
- [022 — Cell planets](022_v4_voronoi_cell_planets.md) owns world generation and ridge/river
  meaning. [030 — 2.5D map](030_cell_planet_25d_map.md) owns the planar adapter and map
  experience. [031 — Shared terrain chunks](031_shared_planet_terrain_chunks.md) owns
  Meshoptimizer simplification, quadtree LOD, seams, scheduling, caching, edits, cube-face
  coverage and global error budgets. **This document owns only the fixed-resolution spherical
  geometry adapter and the `/cell-planet-globe` prototype page.**
- This prototype is a stepping stone: it proves sampling/displacement parity with the maps and
  records spherical edge behaviour. It is explicitly **not** a performance claim for a
  whole planet and does not pre-empt 031's C4 globe milestone.

## Reuse decision

Inspected the existing sphere-related code before adding anything:

- `worldgen/core/fibonacci-sphere.ts` distributes Voronoi *sites* for the graph, not render
  vertices.
- `terrain/domains/sphere-terrain-domain.ts`,
  `terrain/streaming/sphere-terrain-quadtree-selection.ts` and `terrain/cdlod/**` are the
  streaming cubesphere/quadtree path owned by 031.
- `worldgen/core/chunking.ts`'s `buildChunkMeshData()` tessellates Voronoi cells into chunk
  meshes — the chunk path, not a regular grid.
- `worldgen/core/planet-surface-bake.ts` is the planar bake (030); its `directionAt` is
  projection-specific.
- `worldgen/render/components/planet-view.component.ts` is the chunked/LOD sphere renderer.

None of these produce a fixed-resolution, sampler-driven displaced sphere with plain typed
output, so the prototype adds one small framework-free adapter. It lives in
`worldgen/render` because it is the rendering boundary where a graph/surface snapshot becomes
drawable data, while remaining free of Three.js/Angular so it stays usable by tests and future
consumers.

## Design

### Reusable adapter — `worldgen/render/globe-geometry.ts`

- `buildPlanetGlobeGeometry(params)` tessellates a latitude/longitude grid at a caller-chosen
  fixed resolution (`longitudeSegments >= 3`, `latitudeRings >= 2`) and samples
  `IPlanetSurfaceSampler` once per vertex direction. Displacement is
  `direction * (radius + elevation * heightScale)`.
- Returns plain typed arrays: `positions`, `normals`, `directions`, `elevations`, `landMask`,
  `cellIds`, `indices`, plus resolution/radius metadata. No Three.js types, no LOD, no
  streaming, no caching.
- `cellIdAt?: (direction) => number` optionally records discrete cell identity per vertex
  (documented runbook-031 requirement: never interpolate cell ids). The page passes
  `findCellAt(graph, direction).id`.
- `writePlanetGlobePositions(out, directions, elevations, radius, heightScale)` and
  `writePlanetGlobeNormals(out, positions, indices)` are exported so a display exaggeration /
  seabed toggle can re-displace and re-normal an existing geometry **without another sampler
  pass or graph rebuild**.
- Exported intentionally from `projects/triangular-engine/worldgen/render/public-api.ts`. No
  new sublibrary or entry point was added, so `daxur tokens map` coverage is unchanged.

### Demo page — `pages/cell-planet-globe/`

- Declarative `<scene [showFps]>` + `<orbitControls>` + `<ambientLight>` + `<directionalLight>`;
  the custom `BufferGeometry` mesh and ocean shell are added through `EngineService.scene`
  (`projects/demo-app/src/app/AGENTS.md` convention). No hand-rolled renderer/RAF.
- Reuses the shared chain and defaults exactly as the maps:
  `CELL_PLANET_GENERATION_DEFAULTS` → `buildPlanetGraphCore` → `buildPlanetTectonics` →
  `deriveIsLand` → `buildPlanetEcology` → `createPlanetSurfaceSampler`.
- Colour modes reuse the exported ramps (`biomeColor`, `elevationColor`, `moistureColor`,
  `plateColor`, `temperatureColor`, `lavaOceanColor`) with the same precedence as the 2.5D
  bake's `makeColorTexture`, so equivalent cells agree. The colour attribute is rebuilt
  independently of geometry/topology — changing the data layer never resamples or rebuilds the
  mesh.
- Height exaggeration re-displaces positions/normals from the stored directions/elevations.
  Seabed relief keeps canonical below-sea bathymetry when on and clamps underwater vertices to
  the sea datum when off; a translucent sea-level shell provides water context.
- Route `/cell-planet-globe` (append-only) and demo-index entry `02d`, category `terrain`.
  Controls: cell count, seed, relaxation, world profile, water level, data layer, height
  exaggeration, seabed relief, ocean shell. Reciprocal links to `/cell-planet-map` and
  `/cell-planet-25d-map` carry the shared geography/colour query keys.

## Seam, pole, winding and normal findings

- **Longitude seam / antimeridian:** the grid starts at longitude `-PI`, so `+PI` and `-PI` are
  the **same column** (`c === 0`), not two duplicated vertices. The wrap face reuses column 0,
  so there is no crack and both longitudes sample identical elevation. Vertex count is
  `2 + (rings - 1) * segments`; a naive duplicated seam would be
  `2 + (rings - 1) * (segments + 1)`. Verified in `globe-geometry.spec.ts`.
- **Poles:** each pole is a single vertex and the caps are triangle fans (never zero-area
  quads). All triangles are non-degenerate at the default and test resolutions; positions and
  normals are finite.
- **Winding:** derived for a Y-up grid (`lon` increasing east): north cap
  `(pole, nextCol, col)`, middle bands `(topLeft, topRight, bottomLeft)` +
  `(topRight, bottomRight, bottomLeft)`, south cap `(ring, nextCol, southPole)`. Every triangle's
  geometric normal has a positive dot with its centroid (outward). The page uses `FrontSide`, so
  a winding regression becomes visible rather than silently double-sided.
- **Normals:** area-weighted accumulation from triangle winding, then normalized. Vertex normals
  point outward (`dot(normal, direction) > 0`). The shared seam column receives contributions
  from both neighbouring faces, so its normal is continuous across the seam.
- **Float32 precision:** direction/elevation arrays are `Float32Array`, so tests compare at
  ~5 decimal places, not float64 tolerance. This is expected storage precision, not sample
  disagreement.

## Prototype results vs whole-planet acceptance

Recorded separately, per the runbook convention:

- **Prototype, automated:** `globe-geometry.spec.ts` — 9/9 passing (determinism; shared
  antimeridian seam; finite/radial poles with no degenerate triangles; all triangles outward and
  vertex normals outward; per-vertex `cellIdAt`; re-displacement without resampling; parameter
  clamping/validation). `npm run build:triangular-engine` passes. `ng build demo-app` passes.
- **Prototype, visual:** **not run.** The standing instruction forbids starting a dev server, so
  geography, colours, exaggeration, seabed relief and the ocean shell were not reviewed in a
  browser. A successful build is not visual acceptance.
- **Whole-planet performance acceptance:** **not established.** No FPS/frame-time/memory/draw
  numbers, no streaming, no LOD transitions, no cube-face coverage, no simplification error
  budgets. Those belong to 031's milestones (notably C4 — globe fixture), which will replace
  this fixed mesh with sphere-specific chunk geometry and error handling. This prototype must
  not be cited as whole-planet evidence.

- **2026-09-16 — Shared material adapter:** the globe now exposes a `material` data layer and
  consumes the terrain entry point's shared semantic material evaluator, stylized palette and
  deterministic planet-space macro variation. Its fixed sphere still applies the result as
  vertex colours, while the 2.5D clipmap applies the equivalent variation in its shader. The
  canvas 2D page is intentionally unchanged; sphere LOD material streaming remains future work.

- **2026-09-16 — Globe material colour-space fix:** the shared palette is authored in sRGB, but
  the globe stores lit vertex colours in Three.js's working colour space. The material path now
  converts palette RGB with `SRGBColorSpace` before upload, matching the 2.5D colour texture and
  preventing the globe's material view from appearing whitewashed.

- **2026-09-16 — Globe physical scale alignment:** the globe now follows the 2.5D page's real-scale
  display model. Its selected `worldSize` tier supplies the sphere radius in metres, terrain relief
  uses the shared `getTerrainHeightScaleM(radius, relief)` conversion, the ocean shell uses the same
  metre-based displacement, and logarithmic depth plus radius-derived orbit near/far values are
  enabled. The former unit-sphere `globeHeightScale` query is accepted as a compatibility fallback;
  the comparison links now use `worldSize` and `terrainHeightScale`. The fixed 96×48 globe remains a
  prototype without spherical chunk LOD or local-origin rendering; those remain runbook 031 work.

## Verification commands

```powershell
npm run build:triangular-engine
npx ng build demo-app --configuration development
npx ng run triangular-engine:test-worldgen-render --watch=false --browsers=ChromeHeadless
```

- Library and demo builds: pass.
- `test-worldgen-render`: the target itself is currently blocked by a **pre-existing** type
  error unrelated to this work — `worldgen/core/planet-surface-bake.spec.ts` calls
  `expect(typedArray).toHaveLength(...)`, which the installed `@types/jasmine` (5.1.15) does
  not declare, and `tsconfig.spec.json` typechecks all `**/*.spec.ts`. To validate this
  adapter, the spec was run in isolation with a temporary tsconfig that scoped compilation to
  `globe-geometry.spec.ts`; `9/9 SUCCESS`. The temporary file was deleted. The broken core spec
  is left untouched (out of scope, shared with concurrent work).

## Deferred to runbook 031

Meshoptimizer simplification, quadtree selection/LOD, seams and stitching, skirts, scheduling
and workers, caching/IndexedDB, cube-face coverage and shared boundaries, error metrics and
horizon culling, terrain edits/flattening, and all whole-planet performance measurement. The
sphere geometry here is fixed-resolution and disposable by design.

## Progress

- **2026-09-13 — Prototype implemented:** added the framework-free fixed-resolution adapter
  (`worldgen/render/globe-geometry.ts` + spec, exported from the render entry point) and the
  `/cell-planet-globe` page. The adapter samples the shared surface sampler per vertex, applies
  radial displacement, records discrete cell ids, and returns plain typed arrays; display
  exaggeration and seabed relief re-displace from stored directions/elevations without
  resampling. Verified seam/pole/winding/normal behaviour with 9 isolated unit checks; library
  and demo builds pass. Browser visual review and whole-planet performance remain for 031's C4.
  Next: hand the adapter to 031 as the sphere specific-geometry input, or add a coarse
  visual smoke check if/when a dev-server session is authorised.
- **2026-09-13 — Handover for a follow-up agent:** first browser run of
  `/cell-planet-globe` reported a defect — **only the top of the sphere shows terrain**. The
  adapter's own topology checks (seam/pole/winding/normals) pass and the page builds, but the
  index buffer was undersized: it allocated one entry per triangle even though each triangle needs
  three indices. Writes after the north-facing portion were silently discarded. A handover brief
  with the diagnosis and follow-up checks is appended below ("Handover: globe shows terrain only
  near the top").

## Handover: globe shows terrain only near the top

**Audience:** a follow-up agent asked to take the prototype to a working state. This section is
self-contained: read the rest of this runbook first, then work from here.

**Reported symptom (user, first browser run):** "not working as intended. only top of the
sphere has terrain." No screenshot was captured and no dev server was running in the agent
session that wrote this; the follow-up agent is expected to reproduce it in a browser.

**Environment / how to reproduce:**

```powershell
npx ng serve demo-app
# open http://localhost:4200/cell-planet-globe
```

Route and page exist: `projects/demo-app/src/app/pages/cell-planet-globe/`
(`cell-planet-globe-page.component.ts` / `.html` / `.scss`), registered in
`app.routes.ts` and `pages/demo-index/demo-index.component.ts`.

**What is known good (do not re-litigate):**

- `globe-geometry.ts` winding is correct at all three fan types. Verified numerically for a
  `rings=4, segments=8` grid: north cap `(pole, ring1[c+1], ring1[c])`, middle band
  `(topLeft, topRight, bottomLeft)`, and south cap `(ring[n-1][c], ring[n-1][c+1], southPole)`
  each give `dot(faceNormal, centroid) ≈ +0.354` (outward). So the "visible only where the cap
  is" theory via inverted winding is **ruled out**.
- Poles are single vertices; no degenerate triangles; positions/normals finite (spec).
- Seam is one shared `±π` column; vertex count `2 + (rings-1)*segments` (spec).
- `writePlanetGlobeNormals` accumulation/normalization is finite and outward (spec).
- `npm run build:triangular-engine` and `ng build demo-app` pass.

**Prime suspects, in order, with the reasoning that led there:**

1. **Colour resolution reads the wrong field / the geometry's `cellIds` are being used to
   colour raw per-cell data, not the sampled surface.** In
   `cell-planet-globe-page.component.ts`, `resolveCellColor()` (around line 364) resolves via
   `this.tectonics.elevation[cellId]`, `this.ecology.*[cellId]`, and
   `this.tectonics.isLand[cellId]`. `cellIdAt` is
   `(direction) => findCellAt(graph, direction).id`, so `cellIds` is always `0..cellCount-1`
   and the `cellId < 0 || >= length` ocean fallback **never fires**. The 2.5D bake
   (`cell-planet-25d-map-page.component.ts`'s `makeColorTexture`, ~line 255) uses the same
   fields and precedence — compare them line by line. Any divergence (e.g. globe using
   `elevation` where the map uses `isLand`, or a mode whose ramp input is wrong) shows as
   wrong-coloured geography, which can read as "no terrain" if land and ocean both end up the
   same shade. Confirm the `fillMode` default (`biome`) and that `biomeColor()` gets a real
   biome string.
2. **Ocean shell occluding the land.** `updateOceanMesh()` builds
   `new SphereGeometry(1, ...)` scaled to `GLOBE_RADIUS + seaLevelElevation * heightScale()`.
   `GLOBE_RADIUS = 1`, default `heightScale = 0.25`. For the default terran snapshot,
   `continentalBase = 0.35`, `oceanicBase = -0.5`, and sea level is the ~30% land percentile
   (`computeElevation`), so `seaLevelElevation` sits roughly in `[-0.2, 0.06]` and the shell
   radius is ~`0.985..1.015`. Land can reach ~`1 + (1 - seaLevel)*0.25`. That ordering looks
   safe, but the shell is `transparent, opacity 0.45` and `SphereGeometry(1, 96, 48)` is a
   **unit** sphere scaled — verify at runtime that land actually pokes through, and test with
   "Ocean shell at sea level" unchecked. If unchecked fixes it, the shell radius/opacity is the
   bug (e.g. `seaLevelElevation` positive and large, or `heightScale` stale).
3. **`refreshDisplacement()` writes into arrays that the live `BufferGeometry` no longer
   owns.** `installMesh()` binds `geometry.positions`/`geometry.normals` into `BufferAttribute`s.
   `refreshDisplacement()` mutates `this.geometry.positions` in place and calls
   `needsUpdate = true` — that should work, but it uses `this.heightScale()` at call time while
   the geometry was built with the value at build time. Trace whether a `rebuildWorld()` after
   a height/exaggeration change re-binds attributes to a **new** `Float32Array` while
   `this.geometry.positions` still points at the old one (a stale-array-on-rebuild bug would
   freeze displacement, not restrict it to the top, but check it while there).
4. **Normals/lighting:** page uses `FrontSide` and `MeshStandardMaterial({ vertexColors: true,
   roughness: 1, metalness: 0, flatShading: false })`. If normals were inverted anywhere the
   surface would go black under the directional light and read as absent; the adapter spec says
   they are outward, but the **page overwrites** normals via `writePlanetGlobeNormals` on every
   `refreshDisplacement()` — confirm that call uses the post-rebuild `positions`/`indices`, and
   that `flatShading:false` isn't mixing a stale normal attribute.
5. **Displacement axis:** displacement is radial (`direction * radius`) in the adapter, which is
   correct. If you observe terrain clustered at the **north pole** specifically (not "the top of
   the visible sphere"), suspect the colour/`cellIdAt` path or a `findCellAt` tie at the pole
   rather than geometry. Distinguish these two readings of "top" before fixing: *top of the
   visible sphere* (camera-facing hemisphere shows terrain only up high) vs *north pole cap*
   (a geographic region). Ask the user for a screenshot if unclear.

**Suggested fix plan for the follow-up agent:**

1. Re-read `resolveCellColor()` against `makeColorTexture()` in the 2.5D page and make the
   globe's precedence identical, field for field. Add a small note in the runbook about any
   intentional divergence.
2. Add a **debug colour mode** (temporary) that colours by `landMask` only, so terrain vs
   ocean is unambiguous without ramps. This isolates "is displacement present?" from "is the
   colour right?".
3. Toggle the ocean shell off and re-check; if that fixes it, correct the shell radius to
   derive from the same `seaLevelElevation` the sampler reports and/or lower opacity.
4. If still broken, add a temporary wireframe overlay (`material.wireframe = true` on the
   globe mesh directly — do **not** use `<scene>`'s `[wireframe]` override, per
   `projects/demo-app/src/app/AGENTS.md`) to see whether the mesh itself spans the whole sphere.
5. Once working, capture a screenshot or describe the visual result and record it under
   "Prototype, visual" above; update the status line at the top of the runbook.

**Guardrails (unchanged from this runbook):**

- Do not implement Meshoptimizer, quadtree LOD, seams, scheduling or caching — those belong to
  runbook 031.
- Preserve concurrent working-tree changes (`git status --short` first; the tree currently has
  staged and unstaged work across `app.routes.ts`, `demo-index.component.ts`, the 2.5D map,
  `planet-map-picking.*`, and `meshoptimizer/*`). Do not revert or reformat them.
- Keep shared-file wiring append-only and minimal.
- The user's standing instruction forbids starting a dev server without approval; for this
  fix, reproduction requires one, so **ask the user before running `ng serve`** or have them run
  it and report/screenshot.
- Do not edit `dist/` or `out-tsc/`; rebuild instead.

**Known unrelated blocker:** the library test target `test-worldgen-render` fails to compile
because `worldgen/core/planet-surface-bake.spec.ts` uses `expect(typedArray).toHaveLength(...)`,
which the installed `@types/jasmine@5.1.15` does not declare. This predates the globe work; if
it blocks running `globe-geometry.spec.ts` normally, either fix the core spec (preferred, small)
or scope a temporary tsconfig as the original agent did (then delete it).

**Follow-up diagnosis:** the globe coverage defect was caused by the index allocation in
`globe-geometry.ts` using the triangle count as the number of typed-array entries. The topology
writer emits three indices per triangle, so later writes were silently discarded. The allocation
now reserves `triangleCount * 3` entries, asserts the final write cursor, and has a regression check
for complete vertex reference and two-triangle-per-edge closure. Library and demo builds pass;
browser visual acceptance remains pending.

# 02 — Three.js 0.186.1 → 0.187.0

Assessment and checklist for the next upgrade. Status: **not applied**; the
workspace is still on 0.186.1. Written from a source and migration-guide
review on 2026-10-30; replace each "pending" line with the observed result when
the bump is done, then move this file's status to "applied".
Companion checklist: `instructions/triangular-engine-threejs-upgrade.md`.

## Target versions

| Package | From | To |
| --- | --- | --- |
| `three` | 0.186.1 | **0.187.0** (exact pin) |
| `@types/three` | ^0.186.0 | **^0.187.0** |
| `three-mesh-bvh` | ^0.9.16 | unchanged (`peer three >= 0.159.0`) |
| `postprocessing` | 6.39.5 | check its `three` peer before installing |
| `@webgpu/types` | ^0.1.74 | unchanged |
| `triangular-engine` peers | `three ^0.186.0` | `three ^0.187.0` |

On 0.x, `^0.186.0` means `<0.187.0`. The engine peer range is the one hard
blocker: consumers cannot install 0.187.0 until it moves.

## Exposed code (what actually uses these APIs)

- A consumer app that imports only math (`Vector3`/`Quaternion`/tuples) and
  renders through the engine has effectively no exposure.
- A consumer app that is WebGPU/TSL/storage-buffer heavy gains the most,
  because that is where r187 helps.
- The workspace is the real surface: WebGL and WebGPU, TSL, `BatchedMesh`,
  render targets, multi-viewport.

## Removed APIs (r177 deprecations dropped in r187)

- `ColorManagement.fromWorkingColorSpace()` / `toWorkingColorSpace()`.
- TSL `transformedNormalView`, `transformedNormalWorld`,
  `transformedClearcoatNormalView` (use `normalView`, `normalWorld`,
  `clearcoatNormalView`).
- Grepped all three repos: **not used**. No code change expected.

## Expected effects

### 1. PMREM now uses cube render targets (visual change)

`CubeUVReflectionMapping` is removed and PMREM quality changed, so materials
with environment lighting/reflections shift slightly. The engine does not call
`PMREMGenerator`; a consumer app that builds a studio environment with
`fromScene(new RoomEnvironment(), …)` will see its clearcoat reflections move a
little. Expect a visual-review item in that app, not a fix here.

### 2. `setViewport()` / `setScissor()` no longer scale by pixel ratio when a render target is bound

Only one call site binds a render target and sets a viewport:
`projects/triangular-engine/impostor/three/create-octahedral-impostor-atlas.ts`
(`setViewport`/`setScissor` at ~183/229). It pins `setPixelRatio(1)`, so the
numbers are unchanged. `multi-viewport.service.ts` draws to the canvas (still
scaled), and `render-target.component.ts` / `screenshot.service.ts` also pin
ratio 1. Expected: no change; re-run the impostor bake specs to confirm.

### 3. `BatchedMesh`

Mostly fixes on paths the terrain uses: draw ranges after `setGeometrySize()`
(`terrain-surface.component.ts`), sort corruption, matrix-data leak, shadows,
bounds in precise mode. The only API change is a clearer error message when an
added geometry's attribute `itemSize`/`normalized` disagrees with the first
geometry added (no behaviour change).

### 4. WebGPU disposal and GC

`WebGPURenderer`/`WebGLRenderer` now use `WeakRef` and `FinalizationRegistry`
internally, and textures/geometries no longer leak dispose listeners. Do not
rely on GC to free storage buffers; use explicit disposal (below).

## Reusable gains

- **Public storage-buffer disposal.** In 0.186.1 `BufferAttribute.dispose()`
  dispatches an event nothing listens to. r187 wires the listener and frees
  the buffer. A consumer app that reaches into the WebGPU backend to call
  `get(attribute).buffer?.destroy()` and `delete(attribute)` (the known
  pattern for freeing compute storage buffers) can replace that helper and its
  per-simulation copies with `attribute.dispose()`. Both
  `StorageBufferAttribute` and `StorageInstancedBufferAttribute` are covered.
- `FrustumArray` support and camera type in the render-context key
  (`WebGLRenderer`) — relevant to `multi-viewport.service.ts` culling.
- `Texture.mipmapsAutoUpdate` — useful for streamed/morphing textures.
- `Object3D.pivot` is now honoured when decomposing local matrices. The
  existing `pivot` fields in `capsule-hands-and-boots.ts` are the component's
  own `Group`s, so this does not affect them.
- `Color.setStyle()` accepts negative hues and decimal percentages (several
  demo pages generate `hsl()` strings).
- `WebGLRenderer.getProgramVariant()`; WebGPU parallel `compileAsync()`,
  depth-only render targets, `ProxyNodeMaterial`, and several dispose fixes.
- Smaller: Math tree-shaking (bundle size), `MeshPhysicalMaterial` EON
  rough-diffuse BRDF, `iridescenceThicknessMinimum`/`Maximum` (the old
  `iridescenceThicknessRange` is deprecated; unused here).

## Steps

1. Workspace: bump `three` to `0.187.0`, `@types/three` to `^0.187.0`, and
   `projects/triangular-engine/package.json` peers to `three ^0.187.0`; plain
   `npm install` (no `--force`).
2. Check `postprocessing@6.39.5`'s `three` peer; bump it if it excludes
   `>=0.187.0`.
3. Replace version strings (`grep -rn "0\.186"`): package READMEs,
   `docs/getting-started.md`, the engine skill file, and the baseline line in
   `instructions/triangular-engine-threejs-upgrade.md`.
4. Add a `triangular-engine` CHANGELOG bullet when the peer/version change
   ships.
5. Re-pack the engine tarball, then bump `three`/`@types/three` in the two
   consumer apps so they install the same versions.
6. Run headless tests and the library build; then browser-smoke WebGL and
   WebGPU pages, including the impostor bake, and have the consumer app that
   uses PMREM re-check its look.

## Verification

| Check | Result |
| --- | --- |
| `npm run build:triangular-engine` | pending |
| engine `npm test` | pending |
| impostor atlas / multi-viewport specs | pending |
| terrain `BatchedMesh` specs | pending |
| demo WebGL and WebGPU smoke | pending |
| consumer-app PMREM visual review | pending |
| consumer `tsc` app + spec, test suites | pending |

## Open questions

- Whether `postprocessing@6.39.5` accepts r187 as-is.
- Whether the PMREM look change is acceptable for the consumer app that uses
  it, or needs a parameter tweak.
- Whether the multi-viewport path should adopt `FrustumArray` in this bump or
  a separate plan.

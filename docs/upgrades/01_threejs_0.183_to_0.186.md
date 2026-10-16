# 01 — Three.js 0.183.2 → 0.186.1

Compact trace of the upgrade for reuse in other apps. Steps in order; each
issue lists symptom, cause and the fix that worked. Date: 2026-10-16.
Companion checklist: `instructions/triangular-engine-threejs-upgrade.md`.

## Target versions

| Package | From | To |
| --- | --- | --- |
| `three` | 0.183.2 | **0.186.1** (exact pin) |
| `@types/three` | ^0.183.x | **^0.186.0** |
| `postprocessing` | 6.3x | **6.39.5** |
| `three-mesh-bvh` | ^0.9.x | **^0.9.16** |
| `@webgpu/types` (new devDep) | transitive | **^0.1.74** |
| `triangular-engine` peers | `three ^0.183.0` | `three ^0.186.0`, `three-mesh-bvh ^0.9.16`, `postprocessing ^6.39.5` |

On 0.x, `^0.183.0` means `<0.184.0`. Peer ranges **must** move with three, or
consumers get ERESOLVE.

## Steps

1. Bump `three`, `@types/three`, `postprocessing`, `three-mesh-bvh` in the app
   `package.json`; run plain `npm install` (no `--force`). No peer conflicts
   appeared when the engine peers were moved at the same time.
2. Library repos: bump the `peerDependencies` in the library `package.json`,
   add a CHANGELOG bullet, and replace the old version in README, getting-started,
   docs index and the agent skill file (`grep -rn "0\.183"`).
3. Consumer apps that install the library as a tarball: re-pack the library
   first (mycelia: `npm run update:engine`, which rebuilds and packs it), then
   bump the app's own `three` pins to the identical versions.
4. Type-check every tsconfig (`app` and `spec`), build, run headless tests.

## Issues and fixes

### 1. `Cannot find name 'GPUDevice' / 'GPUBuffer' / …` (hundreds of errors)
- **Cause:** `@types/three` 0.183 shipped `/// <reference types="@webgpu/types" />`
  (in `WebGPUBackend.d.ts`); 0.186 dropped it. WebGPU globals vanish for any
  project that uses them, including `types: []` projects.
- **Fix:** `npm i -D @webgpu/types` and list it in `compilerOptions.types` of
  each tsconfig that compiles WebGPU code (`"types": ["@webgpu/types"]`, specs:
  `["jasmine", "@webgpu/types"]`). Done in the workspace demo-app and mycelia.
- Seen first as 274 errors in mycelia; 1 error (`GPUDevice`) in the demo app.

### 2. TSL constructor overloads narrowed (TS2769 / TS2345)
- **Symptoms:** "No overload matches this call" on `float(atomicLoad(...))`,
  `vec3(color('#hex'))`, `vec3(float(..), float(..), float(..))`,
  `vec4(mix(..), 0)`, `mix(vec3, vec3, uniform)`; and
  `UniformNode<"float">` not assignable to `Node<"int"> | Node<"uint">`.
- **Cause:** r186 typings of `float/vec3/vec4/mix` only accept specific node
  value types; `color` nodes and `AtomicFunctionNode<unknown>` are rejected.
  All of it still works at runtime.
- **Fix (type-only, generated shader unchanged):** a shared
  `tsl-loose.ts` that re-exports `float/mix/vec3/vec4` cast to
  `(...args: any[]) => any`, then swap those names in the failing files'
  `three/tsl` imports. Prefer this over per-line `@ts-expect-error`.
- Index/compare uniforms: type them correctly instead of casting, e.g.
  `uniform(0, 'uint')` when compared with `instanceIndex`.
- 23 sites in 12 mycelia sandbox files; engine library code needed no change.

### 3. `Object3D.userData` / SVGLoader path userData typed as `{}`
- **Symptoms:** `TS7053 ... can't be used to index type '{}'`,
  `TS2339: Property 'getAttribute' does not exist on type '{}'`
  (demo `character-lab-page.component.ts`: `path.userData?.['style']?.['fill']`).
- **Fix:** local typed cast of `userData`; no runtime change.

### 4. `PostProcessing` → `RenderPipeline` rename
- Documented in the r18x migration notes. **Not applicable** where the
  engine uses its own `EngineRenderPipeline` interface instead of three's
  `PostProcessing`. In other repos: `grep -rn "PostProcessing" src` before
  assuming either way.

### 5. ShaderMaterial tone-mapping includes (WebGL)
- A hand-written `ShaderMaterial` with `#include <tonemapping_pars_fragment>` fails to compile on r186
  (`toneMappingExposure : redefinition`, plus every tone-map function "already has a body"): three now
  injects those chunks itself. Seen in the spike's `rt=1` quad. **Fix:** drop the include (not done for the
  throwaway spike; its `rt=1` benchmark rows are invalid on r186). `grep -rn "tonemapping_pars_fragment|colorspace_pars_fragment" src projects`.

### 6. Browser-pane gotcha for smoke tests
- A hidden Browser pane gives a 0x0 canvas: WebGPU logs `texture size ... is empty` and nothing renders. Show the
  pane (`show_pane preview`) before judging a page. Leftover console errors may be from an earlier page load.

### 7. Monitored but unchanged
- `OrbitControls`: diff 0.183.2 → 0.186.1 shows only touch-action/cursor/state
  cleanup changes; dolly/zoom math is identical.
- `renderMultiDrawInstances` is not referenced anywhere in our sources.

## Verification (what passed)

| Check | Result |
| --- | --- |
| `npm run build:triangular-engine` | pass |
| engine `planet-material` / `worldgen` specs | 20/20, 310/310 |
| engine `npm test` | 1224 pass, 1 fail: pre-existing (see 'Open items') |
| workspace demo-app `tsc` app + spec, daxur `triangular-demo` build | 0 errors, build ok |
| Smoke (visible Browser pane, WebGPU): `/cell-planet-tsl` webgpu + webgl2, `/tsl-webgpu-spike`, mycelia menu, microbe / clouds sandboxes | render, 165 FPS, no new errors |
| mycelia `tsc -p tsconfig.app.json` / `tsconfig.spec.json` | 0 errors (after fixes 1–2) |
| mycelia daxur build (`daxur app status mycelia --json --wait`) | ok |
| mycelia `npm test` | 1141 SUCCESS, 27 skipped, 0 failed |

Note: running `npm test` while the daxur dev build is compiling made Karma
disconnect at spec 140 (ping timeout). Re-run it alone.

## Gotchas for the next repo

- Do the `@webgpu/types` step **first**; it removes the bulk of the errors
  and exposes the real TSL typing issues.
- Run the type-check against both the app and spec tsconfig; both report
  the same TSL errors.
- Do not use `--force` / `--legacy-peer-deps` to get past a peer conflict;
  fix the peer range. (mycelia's `tools/update-triangular-engine.js` already
  uses `--legacy-peer-deps` for the tarball install; that predates this upgrade.)
- Check any `.agents/` vs `.agent/` path in docs before editing skill files.

## Open items

- Engine `npm test`: 1 failure at `raycast-orbit-controls.component.spec.ts:108` ("rebases every repeated
  zoom…", expected distance >= 0.5, got 0.4683617673316646). **Pre-existing, not caused by the bump:** the spec
  fails with the identical value when node_modules/three is temporarily swapped back to 0.183.2 (run alone with
  `ng test triangular-engine --include=**/raycast-orbit-controls.component.spec.ts`). Not fixed here.
- Mycelia WebGL (non-WebGPU) renderer path was not smoke-tested; only WebGPU was.
- Re-benchmark and `DirectRenderPipeline` results: `docs/runbook/050_tsl_planet_surface_material.md` (2026-10-16, three 0.186.1).

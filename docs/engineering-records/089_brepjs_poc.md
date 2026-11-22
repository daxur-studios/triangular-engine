---
type: EngineeringRecord
title: "brepjs parametric part POC"
description: "Findings from rendering a live brepjs B-Rep part inside a Triangular Engine scene."
timestamp: 2026-11-22T00:00:00Z
tags: [engineering-records, brepjs, poc]
record_id: er-089
scope_history_schema: 1
plans:
  - /docs/plans/089_brepjs_poc.md
performance: []
---

# Engineering Record 089: brepjs parametric part POC

Plan: [PLAN-089](/docs/plans/089_brepjs_poc.md).

## 2026-11-22 - POC built and verified

**Goal.** Prove brepjs and Triangular Engine compose: exact solids rendered by
the engine, rebuilt from parameters, exported as STEP/STL.

**Where.** `projects/brep-poc` — a third Angular application in the workspace
(port 4223), using the local engine source via the existing tsconfig paths.
`npm run serve:brep-poc`.

**Shape.** `part/bracket.ts` builds plate → flange fuse → two drilled holes →
vertical-edge fillet, all in millimetres and Z-up, and returns tessellation plus
volume, triangles and build time. `scene/part-scene.ts` is the only Three.js
code: it converts Z-up/mm to the engine's Y-up/metres, rests the part on the
grid, and keeps a `meshEdges` overlay because B-Rep edges beat angle-threshold
wireframes.

**Kernel loading.** `init()` alone is not enough here: the Angular build
bundles `occt-wasm`'s JS into a chunk, so Emscripten's default `locateFile`
looks for `occt-wasm.wasm` next to the chunk. The POC copies the 20 MB wasm
from `node_modules/occt-wasm/dist` to `assets/` and calls
`OcctKernel.init({ wasm: 'assets/occt-wasm.wasm' })`, then
`registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel))`. `brepjs`
itself is a dynamic import, so it stays in a lazy chunk.

**Measured (Chrome, this machine, 120×80×8 mm bracket with two 9 mm holes).**

- final tolerance (0.08 mm): ~50–115 ms per rebuild, tag-toggled debounce at 120 ms.
- preview tolerance (0.4 mm) on first paint, final tolerance right after.
- 1.9k triangles filleted, 1.0k without fillets.
- production bundle: 1.65 MB initial (371 kB transferred), 977 kB lazy brepjs
  chunk, 67 kB lazy occt-wasm chunk, 20 MB wasm asset.

**Findings.**

- Fillet failure is common enough at the parameter extremes that the builder
  returns the square-edged solid plus a note instead of throwing; the panel
  shows "square" in that case. Good default for a parametric UI.
- Rebuild is synchronous on the main thread. At ~100 ms it is fine for a POC;
  a worker is the obvious next step for heavier parts (brepjs ships
  `createWorkerHandler`/`createWorkerClient`, and the typed arrays transfer).
- `brepjs` API naming differs between the npm 20.x line and older 4.x
  (`init()` + `box()`/`cut()` vs `initFromOC` + `makeBaseBox`/`cutShape`).
  The POC pins 20.28.3; `brepjs/quick` is the auto-init entry point.
- The engine takes the geometry unchanged once units and up-axis are handled;
  no engine changes were needed.

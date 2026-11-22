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

## 2026-11-22 - Part moved out of the app, verify gate added

**Goal.** Make the part an artifact an agent can author and check, not geometry
buried in a component. Background:
[Authoring CAD with AI](https://brepjs.dev/agent/overview) — an LLM cannot see
geometry, so kernel measurements are its only feedback.

**What changed.**

- `part/bracket.brep.ts` is now a `brep` part: `params` from `defineParams`,
  an `expected` block, `buildBracket()`, and a default export returning the
  shape. `part/bracket-render.ts` keeps the app-only work (tessellation,
  volume, export closures). `part-parameters.ts` and the old `bracket.ts` are
  deleted: the slider table is generated from `params.defs`.
- `npm run verify:brep-poc` runs `brep verify ... --check`. `AGENTS.md` says to
  treat a report that is not `ok` as a failure even when the app still renders.
- `brepjs-cad@0.194.1` is a dev dependency. It bundles the `brep` CLI, a
  `brep-mcp` stdio server, and `reference/llms-full.txt` (83 kB, every export).
  The plugin *skills* are not in the npm package — they ship through the Claude
  Code marketplace from the git repo (`packages/brepjs-cad/skills/`).

**The gate earned its place immediately.** `brep verify` reported
`isValidSolid: false` for the part the app had been rendering happily:

- Filleting *every* vertical edge (`edgeFinder().inDirection('Z')`) returns an
  invalid solid at every radius tried (1, 2, 4 mm). Volume, area and bounds all
  looked correct; BRepCheck did not. The viewport cannot show that difference —
  this is exactly the class of bug an agent authoring geometry would ship.
- Cause: that finder also matches the flange's four corners and the two
  hole-bore seam edges (a cylindrical face has a vertical seam), and blending
  them together fails. Selecting only the plate's four outline corners by
  `getBounds` gives a valid solid at every tested size.
- Fillet radius limit is about one plate thickness: 7 mm is valid on an 8 mm
  plate, 8 mm is not. The builder now tries the requested radius, then a
  ceiling of `0.9 × min(thickness, width/2, depth/2)`, and says so in the panel
  ("Fillet reduced to 7.20 mm: the kernel rejected 10 mm here").
- The old `0.45 × min(thickness/2, …)` clamp was silently reducing a 4 mm
  request to 1.8 mm and reporting "applied". The part now really is filleted
  at 4 mm: 101.00 cm³ instead of 101.25 cm³ at defaults.

**Memory.** Shapes live in WASM memory and the JS GC does not free them, so
every rebuild was leaking the previous solid and its intermediates.
`buildBracket` wraps the build in `withScope` and registers each intermediate;
the component calls `delete()` on the previous solid before keeping the new one.
The panel shows `getDisposalStats().liveHandles`, which stays at 1 across dozens
of slider rebuilds.

**`expected` uses bounds only.** Bounds are exact and fillet-independent (a
fillet only removes material), so they assert the plate's footprint and the
flange's top face. Volume was rejected as an assertion: the unfilleted formula
is 101,382 mm³ against 100,998 mm³ measured, so any tolerance wide enough to
accept the fillet is also wide enough to miss a dropped hole.

**Measured after the change (defaults: 120×80×8 mm, 40 mm flange, 2×9 mm holes,
4 mm fillets).**

- `brep verify`: `ok: true`, valid solid, 19 faces, 100,997.56 mm³, bounds
  exactly ±60 / ±40 / −4…44.
- Panel: 101.00 cm³, 1,680 triangles, 67–120 ms per rebuild, 1 live shape.
- Exports: STEP 57 kB, STL 325 kB.
- `brepjs-cad` runs on Node 22.23.2 (its `engines` field says 24+), so the
  verify loop works without changing Node.
- `npm install` again needed `--legacy-peer-deps` for the existing
  `postprocessing` ↔ `three` peer conflict.

**Still open.** Rebuilds stay on the main thread; `brep publish` already covers
"sliders + STEP/3MF/STL as a static page", so this app's reason to exist is the
engine (scene, future colliders, gameplay), not the panel.

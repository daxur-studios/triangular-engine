# demo-app agent instructions

Scoped to `projects/demo-app/src/app/`. See the repo-root `AGENTS.md` first.

## Demo scene layout

These rules apply whenever a page or component under this directory creates or
modifies a Triangular Engine scene.

- Set both `EngineService.provide({ showFPS: true })` on the scene host and
  `[showFps]="true"` on its `<scene>`. Keep the engine FPS panel visible in demo
  scenes so rendering cost is immediately inspectable.
- Use the Triangular Engine portal layout for every independently placed UI
  element over the scene: controls, hints, labels and status/HUD blocks belong
  in `<ng-template portalTarget="overlay" lane="...">`, not in locally
  absolute-positioned viewport markup. Use `topStart`, `topCenter`, `topEnd`,
  `center`, `bottomStart`, `bottomCenter` or `bottomEnd`.
- Portal entries in the same lane flex-stack with a gap and sort by ascending
  numeric `[order]`; group elements that should stay together in one template.
  The built-in `engine-stats` panel uses `overlay/topEnd` at order `0`. The
  app-wide catalog-thumbnail control uses `overlay/bottomEnd` at order `0`.
  Give additional entries in those lanes a higher explicit order (for example
  `[order]="10"`) so they stack predictably. Local absolute positioning is for
  panel decoration only, not UI that competes for the same viewport space.
- `EngineModule` provides the `portalTarget` directive. Read
  `projects/triangular-engine/docs/core-concepts.md`, “Portal Layout (Dynamic UI
  Overlay System)”, for available areas and lanes.

## Spikes: always start from the template

A "spike" (top-level `<name>-spike/` folder, e.g. `gpu-morph-lod-spike/`,
registered in `pages/spikes-index/spikes-index.component.ts`'s `SPIKES`
array — see `docs/runbook/028_planet_terrain_attempt_history.md`
"Falsifiable spike suite") is a disposable, timeboxed test of one specific
mechanism. Never build one from a blank component. Run `/new-spike` (see
`.claude/commands/new-spike.md`) to clone `_spike-template/` — it already
wires up everything below correctly.

### Why this rule exists

An earlier spike (`gpu-morph-lod-spike`) hand-rolled its own
`WebGLRenderer` + `PerspectiveCamera` + `OrbitControls` +
`requestAnimationFrame` loop instead of using `<scene>`, on the reasoning
that the spike was "testing a mechanism, not a feature" and needed direct
control. That reasoning was wrong in a way that cost real debugging time:
the mechanism (a GPU vertex-shader morph LOD) had a genuine bug, and the
bespoke renderer setup added surface area to search through before the real
bug (a grid-cell-size unit mismatch in the shader) was found. `<scene>`
does not get in the way of low-level control — see the rules below — it
only removes boilerplate that has nothing to do with what a spike is
actually testing.

### Rules

- **Use `<scene [showFps]="true">` + `EngineService.provide({ showFPS: true })` for every spike scene.** This
  gives you the renderer, camera, resize handling, tick loop, and an FPS
  overlay for free. Do not construct your own `WebGLRenderer`,
  `PerspectiveCamera`, `OrbitControls`, or `requestAnimationFrame` loop
  unless the spike is specifically falsifying a raw Three.js
  renderer-level integration that `<scene>` cannot host (e.g.
  a former Takram spike's custom `EffectComposer` pipeline (now under `projects/demo-app/deprecated/`) with
  atmosphere/cloud passes — a real, narrow exception; document why in a
  class-doc comment if you hit another one).
- **Add objects via `engine.scene.add(...)`** for anything without a
  declarative component (custom `BufferGeometry`, `InstancedMesh`,
  `HemisphereLight`, etc.). Use the declarative components
  (`<directionalLight>`, `<ambientLight>`, `<orbitControls>`, ...) for
  anything that already has one.
- **Drive per-frame logic off `engine.tick$.subscribe(...)`**, never your
  own `requestAnimationFrame`.
- **Read the camera via `engine.camera$.value`** — null-check it; it can
  be `null` for the first frame or two before `<orbitControls>` finishes
  initializing.
- **Never bind a shader-under-test's wireframe toggle to `<scene>`'s
  `[wireframe]` input.** That input (`SceneMaterialOverride`) replaces the
  whole material with a generic green debug material — exactly what you do
  NOT want when the spike's point is inspecting your own shader's actual
  vertex/fragment output. Toggle `material.wireframe` on your own material
  directly instead (see `_spike-template/core/create-spike-template-scene.ts`).
- Keep the actual mechanism under test in `core/*.ts`, structured as a
  factory function that takes the injected `EngineService` (plus any
  diagnostics callback) and returns a handle with `set*()`/`dispose()` —
  see `_spike-template/core/create-spike-template-scene.ts`. Keep it
  plain-Three.js/engine-agnostic wherever the spike's whole point is
  isolating that mechanism from production code (as `gpu-morph-lod-spike`'s
  shader/clipmap/geometry files do); only the factory function itself needs
  the `EngineService` for scene/tick/camera access.
- After creating a spike, register it in `app.routes.ts` (lazy `loadComponent`)
  and add an entry to `SPIKES` in `pages/spikes-index/spikes-index.component.ts`
  with `status: 'pending'`. `/new-spike` does both.

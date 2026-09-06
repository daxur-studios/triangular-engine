# demo-app agent instructions

Scoped to `projects/demo-app/src/app/`. See the repo-root `AGENTS.md` first.

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

- **Use `<scene>` + `EngineService.provide({ showFPS: true })`.** This
  gives you the renderer, camera, resize handling, tick loop, and an FPS
  overlay for free. Do not construct your own `WebGLRenderer`,
  `PerspectiveCamera`, `OrbitControls`, or `requestAnimationFrame` loop
  unless the spike is specifically falsifying a raw Three.js
  renderer-level integration that `<scene>` cannot host (e.g.
  `takram-clouds-spike`'s custom `EffectComposer` pipeline with
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

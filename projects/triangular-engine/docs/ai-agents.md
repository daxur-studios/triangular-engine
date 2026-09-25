# Guide for AI Agents

This guide provides conventions and reliable entry points to control the engine programmatically.

## Git & Workspace Conventions

- **DO NOT COMMIT**: Never execute `git commit`. Multiple agents and developers work simultaneously in this repository. All changes must remain uncommitted in the working tree.

## Import/Provide

- Always import `EngineModule` in the host component.
- Provide the engine at the component that owns `<scene>`. Prefer the convenience API shown below; it registers `EngineService` and `provideEngineOptions` together.

```ts
providers: EngineService.provide({ showFPS: true });
```

The equivalent explicit form is `providers: [EngineService, provideEngineOptions({ showFPS: true })]`.

## Scene Ownership

- Create exactly one `<scene>` root per viewport.
- Switch cameras via `<camera [isActive]="true">` or `<orbitControls [isActive]="true">`.

## Deterministic Selectors

Use these template selectors when generating UI:

- Scene: `scene`
- Cameras: `camera`, `orbitControls`
- Geometry: `boxGeometry`, `sphereGeometry`, `planeGeometry`, `bufferGeometry`
- Materials: `meshStandardMaterial`, `meshNormalMaterial`, `shaderMaterial`, `rawShaderMaterial`
- Physics: `physics`, `rigidBody`, `cuboidCollider`, `ballCollider`

See: ./api/selectors.md

## Event & Input Streams

- Subscribe to `EngineService.tick$` for frame updates.
- Use `keydown$`, `mousemove$`, etc., to react to input.

## Physics Patterns

- For draggable bodies, temporarily set body to KinematicPositionBased while dragging, then restore.
- Use `PhysicsService.getRigidBodyById(id)` to fetch and drive bodies by identifier.

## GLTF & Assets

- Prefer `LoaderService.loadAndCacheGltf` and `loadAndCacheTexture`.
- Ensure Draco assets are available at `/draco/`.

## Performance Tips

- Use `instancedRigidBody` or `instancedMesh` when many similar objects exist.
- Enable BVH for complex meshes to speed raycasting.

## Documentation Naming

- Number every new runbook or design document with a zero-padded sequence prefix, for example `009-dynamic-habitats-seasons-migration.md`.
- Preserve the existing sequence when adding documents; do not create unnumbered runbooks.
- Use the numbered filename in links and references.

## Browser, Visual and Performance Test Planning

See [037 — Agent-driven visual and performance testing](../../../docs/runbook/037_agent_driven_visual_and_performance_testing.md)
for the proposed shared test infrastructure, text-only agent authoring workflow,
scene-control contract, evidence storage and baseline policy. The runbook distinguishes
existing inspection/capture capabilities from planned tools; its proposed commands
are not yet available.

Implementation starts with **M1 only** in
[038 — Agent testing implementation plan](../../../docs/runbook/038_agent_testing_implementation_plan.md).
That document owns the milestone checklist, bounded Playwright/scene-adapter handoff
and acceptance evidence; follow it instead of implementing the full design at once.

Available today:

- `npm run test:scene` — M1 scene/agent tests; `npm run test:scene:walkthrough` records a WebM walkthrough.
- `npm run test:perf` — performance smoke for instanced meshes, the `<instancedMesh>` component,
  individual meshes and scatter LOD rebuilds (`/perf-lab`). Functional checks (draw calls, instance
  counts) always gate; timings are compared against `tests/perf/history/perf-history.jsonl` for the
  same machine profile. `npm run test:perf:record` appends results; `npm run perf:report` prints trends.
  To cover a new system, add a scenario in `projects/demo-app/src/app/testing/perf-harness/perf-scenarios.ts`
  and a spec in `tests/perf/specs/`. See [tests/perf/README.md](../../../tests/perf/README.md).

## Semantic Facial Animation & Character Controls

Use `FacialAnimationController` from `triangular-engine/characters` to direct facial performances via serializable commands (`FaceCommand`):

```ts
import { FacialAnimationController } from 'triangular-engine/characters';

const face = new FacialAnimationController();

// 1. Direct gaze (yaw/pitch clamped to safe limits ±30°/±20°)
face.execute({ type: 'lookAt', target: { x: 0.2, y: 0.1, z: 0.8 }, transitionSeconds: 0.15 });

// 2. Set emotion presets (happy, sad, surprised, angry, skeptical, neutral)
face.execute({ type: 'setExpression', expression: 'happy', intensity: 0.8, transitionSeconds: 0.2 });

// 3. Fine semantic channel control (e.g. raise only right eyebrow)
face.execute({ type: 'setChannel', channel: 'brow.right.raise', value: 0.9, transitionSeconds: 0.1 });

// 4. Trigger natural or independent eyelid blinks
face.execute({ type: 'blink', eye: 'both', durationSeconds: 0.18 });

// 5. Play timed articulatory speech viseme tracks (smooth transitions & rest return)
face.execute({ type: 'playVisemes', sequence: timedKeyframes });

// 6. Each frame, evaluate state and apply to reference face or skinned mesh
const frameState = face.update(deltaSeconds);
referenceFace.applyPose(frameState.blendShapes, frameState.gaze);
```

## Minimal Example

See: ./examples/basic-scene.md

# Guide for AI Agents

This guide provides conventions and reliable entry points to control the engine programmatically.

## Import/Provide

- Always import `EngineModule` in the host component.
- Provide `EngineService` and `provideEngineOptions` at the component that owns `<scene>`.

```ts
providers: [EngineService, provideEngineOptions({ showFPS: true })];
```

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

## Minimal Example

See: ./examples/basic-scene.md

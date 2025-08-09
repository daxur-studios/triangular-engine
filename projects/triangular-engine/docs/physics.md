# Physics Guide (Rapier)

Physics is powered by `@dimforge/rapier3d-compat` and integrated with the engine tick.

## Physics World

Wrap physics-enabled content in `<physics>`:

```html
<physics [gravity]="[0,-9.81,0]" [debug]="true" [paused]="false"> ...rigid bodies and colliders... </physics>
```

Inputs:

- `gravity: [x,y,z]`
- `debug: boolean` toggles debug lines
- `paused: boolean` pauses stepping

Events/Observables (via service):

- `world$`, `beforeStep$`, `stepped$`

## Rigid Bodies

```html
<rigidBody [rigidBodyType]="0" [position]="[0,1,0]" [velocity]="[0,0,0]" [mass]="1">
  <!-- attach colliders and renderables under a rigid body -->
  <cuboidCollider [halfExtents]="[0.5,0.5,0.5]" />
  <mesh>
    <boxGeometry [params]="[1,1,1]" />
    <meshStandardMaterial />
  </mesh>
</rigidBody>
```

Inputs:

- `rigidBodyType`: 0 Dynamic, 1 Fixed, 2 KinematicPositionBased, 3 KinematicVelocityBased
- `id?: string` for lookup via service
- `mass?: number`, `angularDamping?: number`
- `velocity?: [x,y,z]`
- `rigidBodyRotation?: [x,y,z,w]`

## Colliders

Attach one or more colliders under a rigid body. Use local `position`/`rotation` relative to the body.

- `<cuboidCollider [halfExtents]="[x,y,z]" />`
- `<ballCollider [radius]="r" />`
- `<capsuleCollider />`, `<cylinderCollider />`, `<coneCollider />`

## Joints

- `<fixedJoint>`
- `<sphericalJoint>`

## Instanced Rigid Bodies

`<instancedRigidBody [maxCount]="N">` batches many bodies into an `InstancedMesh` while syncing transforms from child `<rigidBody>` components.

## PhysicsService

- `worldPromise`, `world$` for access
- `update(delta)`, `syncMeshes()` for render sync
- `setSimulatePhysics(bool)`, `setDebugState(bool)`
- Debug helpers and force visualization

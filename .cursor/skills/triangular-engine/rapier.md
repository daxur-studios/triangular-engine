# Rapier Physics Backend

## Imports and providers

```ts
import { EngineModule, EngineService } from 'triangular-engine';
import { RapierPhysicsModule, PhysicsService } from 'triangular-engine/rapier';
```

`PhysicsService` is not `providedIn: 'root'`; provide it explicitly:

```ts
providers: [
  ...EngineService.provide({ showFPS: true }),
  PhysicsService
]
```

## Minimal scene

```html
<scene>
  <camera [position]="[6, 6, 10]" [lookAt]="[0, 0, 0]" />
  <directionalLight [position]="[4, 8, 4]" />

  <physics [gravity]="[0, -9.81, 0]" [debug]="false" [paused]="false">
    <rigidBody [rigidBodyType]="1">
      <cuboidCollider [halfExtents]="[10, 0.5, 10]" />
      <mesh [position]="[0, -0.5, 0]">
        <boxGeometry [params]="[20, 1, 20]" />
        <meshStandardMaterial [params]="{ color: '#555' }" />
      </mesh>
    </rigidBody>

    <rigidBody [rigidBodyType]="0" [position]="[0, 3, 0]" [id]="'ballA'">
      <ballCollider [radius]="0.5" />
      <mesh>
        <sphereGeometry [params]="{ radius: 0.5, widthSegments: 24, heightSegments: 16 }" />
        <meshNormalMaterial />
      </mesh>
    </rigidBody>
  </physics>
</scene>
```

## Body types

| Value | Type |
| --- | --- |
| `0` | Dynamic |
| `1` | Fixed |
| `2` | KinematicPositionBased |
| `3` | KinematicVelocityBased |

## Collider selectors

`ballCollider`, `cuboidCollider`, `capsuleCollider`, `cylinderCollider`, `coneCollider`, `hullCollider`, `trimeshCollider`

## Joints

`fixedJoint`, `sphericalJoint`, `springJoint`

Accept `rigidBodies` as component refs or id strings (ids resolve via `PhysicsService.getRigidBodyById`).

## PhysicsService reference

- `worldPromise`, `world$`
- `beforeStep$`, `stepped$`
- `collisionEvents$`, `contactForceEvents$`
- `getRigidBodyById(id)`

## Failure modes

| Error | Fix |
| --- | --- |
| `NullInjectorError: No provider for PhysicsService` | Add `PhysicsService` to host component `providers` |
| Physics imports from root package | Import from `triangular-engine/rapier`, not `triangular-engine` |

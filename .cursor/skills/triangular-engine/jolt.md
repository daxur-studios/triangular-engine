# Jolt Physics Backend

## Imports

```ts
import { EngineModule, EngineService } from 'triangular-engine';
import {
  JoltPhysicsModule,
  provideJoltPhysicsInitializer
} from 'triangular-engine/jolt';
```

## Required initialization

Add at app bootstrap level:

```ts
bootstrapApplication(AppComponent, {
  providers: [provideJoltPhysicsInitializer()]
});
```

Alternative: use route-level guard `canActivateJoltPhysics` from `triangular-engine/jolt`.

## Minimal scene

```html
<scene>
  <camera [position]="[6, 6, 10]" [lookAt]="[0, 0, 0]" />
  <directionalLight [position]="[4, 8, 4]" />

  <jolt-physics [gravity]="[0, -9.81, 0]" [debug]="false" [paused]="false">
    <jolt-rigid-body [motionType]="0">
      <jolt-box-shape [params]="[20, 1, 20]"></jolt-box-shape>
      <mesh [position]="[0, -0.5, 0]">
        <boxGeometry [params]="[20, 1, 20]" />
        <meshStandardMaterial [params]="{ color: '#555' }" />
      </mesh>
    </jolt-rigid-body>

    <jolt-rigid-body [motionType]="2" [position]="[0, 3, 0]" [id]="'jBodyA'">
      <jolt-sphere-shape [radius]="0.5"></jolt-sphere-shape>
      <mesh>
        <sphereGeometry [params]="{ radius: 0.5, widthSegments: 24, heightSegments: 16 }" />
        <meshNormalMaterial />
      </mesh>
    </jolt-rigid-body>
  </jolt-physics>
</scene>
```

## Motion types

| Value | Type |
| --- | --- |
| `0` | Static |
| `1` | Kinematic |
| `2` | Dynamic |

Constraint: `jolt-mesh-shape` and `jolt-height-field-shape` require static bodies (`motionType = 0`).

## JoltPhysicsService reference

- `static load()` for WASM init
- `metaData$`, `metaDataPromise`
- `getRigidBodyById(id)`
- Body/constraint tracking for event routing

## Failure modes

| Error | Fix |
| --- | --- |
| `Vec3` / runtime init undefined | Add `provideJoltPhysicsInitializer()` at bootstrap or use `canActivateJoltPhysics` guard |
| Physics imports from root package | Import from `triangular-engine/jolt`, not `triangular-engine` |

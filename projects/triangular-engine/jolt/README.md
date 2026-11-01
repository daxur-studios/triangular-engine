# triangular-engine/jolt

Declarative Jolt Physics integration, including rigid bodies, shapes,
constraints, debug rendering, and single-precision positions; far worlds need the floating origin.

```ts
import {
  JoltPhysicsComponent,
  JoltRigidBodyComponent,
} from 'triangular-engine/jolt';
```

Install the optional peer when using this entry point:

```bash
npm i jolt-physics
```

## Guide


Jolt Physics is a high-performance physics engine integrated with the triangular engine.

## Multi-Shape Rigid Bodies

You can create rigid bodies with multiple collision shapes by adding multiple shape components as children of a `joltRigidBody`. Each shape can have its own position and rotation relative to the rigid body.

### Example: Compound Shape (Box + Sphere)

```html
<joltRigidBody [motionType]="2" [position]="[0, 5, 0]">
  <!-- Main box shape at the origin -->
  <joltBoxShape [params]="[1, 1, 1]"></joltBoxShape>

  <!-- Sphere shape offset to the right -->
  <joltSphereShape [params]="[0.5]" [position]="[1.5, 0, 0]"> </joltSphereShape>

  <!-- Another box rotated and positioned -->
  <joltBoxShape [params]="[0.5, 2, 0.5]" [position]="[0, 1, 0]" [rotation]="[0, 0, Math.PI/4]"> </joltBoxShape>

  <!-- Visual mesh -->
  <mesh>
    <boxGeometry [params]="[2, 2, 2]"></boxGeometry>
    <meshStandardMaterial [color]="'red'"></meshStandardMaterial>
  </mesh>
</joltRigidBody>
```

### Shape Position and Rotation

When shapes are part of a compound body (multiple shapes under one rigid body), you can use the `position` and `rotation` inputs to specify their local transform:

- `position`: `[x, y, z]` - Local position relative to the rigid body origin
- `rotation`: `[x, y, z]` - Euler angles in radians for local rotation

For single-shape bodies, these inputs are ignored since the shape fills the entire body.

### Supported Shapes

- `<joltBoxShape [params]="[width, height, depth]">`
- `<joltSphereShape [params]="[radius]">`
- `<joltCapsuleShape [params]="[halfHeightOfCylinder, radius]">`
- `<joltCylinderShape [params]="[halfHeight, radius]">`
- `<joltHullShape>` - Convex hull from points
- `<joltMeshShape>` - Triangle mesh (static bodies only)

### Physics World Setup

```html
<joltPhysics [gravity]="[0, -9.81, 0]" [debug]="true">
  <!-- Your rigid bodies here -->
</joltPhysics>
```

### Rigid Body Properties

```html
<joltRigidBody
  [motionType]="2"           <!-- 0=Static, 1=Kinematic, 2=Dynamic -->
  [position]="[x, y, z]"
  [rotation]="[x, y, z]"    <!-- Euler angles -->
  [velocity]="[vx, vy, vz]"
  [angularDamping]="0.1"
  [linearDamping]="0.1"
  [id]="'myBody'">
</joltRigidBody>
```

## Soft bodies

`<joltSoftBody>` creates a Jolt soft body from a particle mesh and keeps a Three.js mesh in
sync with it. The inputs mirror `SoftBodyCreationSettings`, so the official Jolt.js examples
can be reproduced directly:

```html
<joltSoftBody
  [vertices]="cloth.vertices"
  [faces]="cloth.faces"
  [pinnedVertices]="cloth.cornerVertexIndices"
  [edgeCompliance]="0.00001"
  [shearCompliance]="0.00001"
  [linearDamping]="0"
  [updatePosition]="false"
  [position]="[0, 10, 0]" />
```

| Input | Default | Jolt field |
|---|---|---|
| `vertices`, `faces` | empty | particle mesh; faces are triangle vertex indices |
| `pinnedVertices` | empty | vertices with `mInvMass = 0` |
| `edgeCompliance`, `shearCompliance`, `bendCompliance` | `1e-4`, `1e-4`, `1e-3` | constraint compliance |
| `bendType` | `'none'` | `'none' | 'distance' | 'dihedral'` |
| `solverIterations` | `5` | `mNumIterations` |
| `linearDamping` | `0` | `mLinearDamping` |
| `gravityFactor` | `1` | `mGravityFactor` |
| `pressure` | `0` | `mPressure` (`nRT`, see the pressure example) |
| `updatePosition` | `true` | `mUpdatePosition` (the official examples use `false`) |
| `friction`, `restitution` | `0.5`, `0` | `mFriction`, `mRestitution` |
| `vertexRadius` | `0` | `mVertexRadius` |
| `maxLinearVelocity` | Jolt default | `mMaxLinearVelocity` |
| `color` | `0x4fd6a8` | mesh material color |

`body$` / `body()` expose the live `Jolt.Body` after creation; `created` also carries it.
The demo page `/soft-body-lab` rebuilds `soft/soft_body.html` (pinned cloth with heavy
spheres) and `soft/soft_sphere_pressure.html` (eleven spheres, increasing pressure) with
this component and measures shape strain, volume and floor penetration.

## Floating origin and far worlds

Jolt in this package is the single-precision build (jolt-physics 1.0.1). A float32 position can
only hold values on a fixed grid, and the grid gets coarser with distance from zero. The spacing
is 1 m at 1e7 m and 0.5 m at Earth radius (6.371e6 m), so a body at 1e7 m cannot hold a 0.125 m
offset. Keep bodies near the physics origin instead: `JoltFloatingOrigin` moves the origin with a
rebase and shifts the bodies by the opposite amount, so the physics frame stays small.

### `float32UlpAt(valueM)`

Returns the float32 spacing in metres at a magnitude. Use it to judge whether a value far from the
origin is precise enough for the physics you need. The sign does not matter.

```ts
import { float32UlpAt } from 'triangular-engine/jolt';

float32UlpAt(1e7);      // 1
float32UlpAt(6.371e6);  // 0.5
```

### `JoltFloatingOrigin`

Create one per physics world from the `JoltPhysicsService` of that world:

```ts
import { inject } from '@angular/core';
import { FloatingOrigin } from 'triangular-engine';
import { JoltFloatingOrigin, JoltPhysicsService } from 'triangular-engine/jolt';
import type { Vector3Tuple } from 'three';

const physics = inject(JoltPhysicsService); // inside a component under <joltPhysics>
const origin = new JoltFloatingOrigin(physics, { thresholdM: 10_000 });

// Static colliders outside bodies$ (for example terrain) must be tracked by the caller.
origin.track(terrainBody); // consumer-owned Jolt.Body

// Once per frame, with the authoritative world position in metres.
const cameraWorldM: Vector3Tuple = [x, y, z]; // consumer-owned
const event = origin.update(cameraWorldM);
if (event) {
  // The helper does not move scene objects or cameras; shift them with the same event.
  for (const object of worldObjects) FloatingOrigin.shiftObject(object, event); // consumer-owned
}
```

- `new JoltFloatingOrigin(service, { thresholdM })`: `thresholdM` is the distance in metres from
  the physics origin at which `update` rebases. It defaults to the core `FloatingOrigin` default,
  10 000 m.
- `origin.origin`: the core `FloatingOrigin` that holds the current physics origin in world metres.
  Subscribe with `origin.origin.onRebase(listener)` to react to each rebase.
- `update(anchorWorldM)`: rebases when the anchor is further than the threshold, and returns the
  rebase event, or `undefined` when no rebase happened.
- `rebaseTo(anchorWorldM)`: rebases unconditionally and returns the rebase event.
- `track(body)` / `untrack(body)`: add or remove a body that is not in `JoltPhysicsService.bodies$`.
  `untrack` does not affect bodies in `bodies$`.
- `dispose()`: forgets every tracked body. The origin itself is kept.

What a rebase does:

- Every body in `JoltPhysicsService.bodies$` shifts automatically. Bodies outside `bodies$` shift
  only while they are tracked.
- Velocities are not changed, and bodies are not activated. A sleeping body stays asleep.
- Scene objects and cameras are not moved by the helper. Move them yourself, for example with
  `FloatingOrigin.shiftObject(object, event)`, or from an `origin.origin.onRebase` listener.
- `update` and `rebaseTo` throw an `Error` when Jolt is not initialised. The origin is unchanged in
  that case.

## Performance Notes

- Compound shapes are more expensive than single shapes
- Use the minimum number of shapes needed for your collision requirements
- Consider using simplified collision shapes that approximate your visual geometry

<!-- doc-section section-id="sec_4c6a72dc5409" path="projects/triangular-engine/jolt" baseline-tokens="50847" -->
High-performance Jolt physics integration providing compound rigid bodies, convex hulls, kinematic/dynamic motion types, and declarative collision shape components. Isolated as an optional secondary entry point (`triangular-engine/jolt`) to separate WASM memory management, debug renderers, and native collision pipelines from the lightweight core engine.
<!-- /doc-section -->

## Example scene


Wrap Jolt physics-enabled content in `<joltPhysics>`:

```html
<joltPhysics [gravity]="[0, -9.81, 0]" [debug]="false" [paused]="false">
  <!-- Ground (Static) -->
  <joltRigidBody [position]="[0, -0.5, 0]" [motionType]="0">
    <joltBoxShape [params]="[100, 1, 100]" />
    <mesh>
      <boxGeometry [params]="[100, 1, 100]" />
      <meshStandardMaterial [params]="{ color: '#666' }" />
    </mesh>
  </joltRigidBody>

  <!-- Falling Ball (Dynamic) -->
  <joltRigidBody [position]="[0, 5, 0]" [motionType]="2">
    <joltSphereShape [radius]="0.5" />
    <mesh>
      <sphereGeometry [params]="{ radius: 0.5 }" />
      <meshStandardMaterial [params]="{ color: 'springgreen' }" />
    </mesh>
  </joltRigidBody>
</joltPhysics>
```

Motion types: 0 Static, 1 Kinematic, 2 Dynamic.
See `skills/triangular-engine-jolt/SKILL.md` in the installed package for advanced Jolt controls, double precision coordinates, and joints/constraints (e.g. `<joltFixedConstraint>` or `<joltHingeConstraint>`).

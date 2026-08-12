---
name: triangular-engine-jolt
description: Guidance for using Jolt Physics in the triangular-engine library 'triangular-engine/jolt', including rigid bodies, colliders, constraints, contact listeners, double-precision coordinates, custom force controllers, and troubleshooting.
---

# Jolt Physics in Triangular Engine

This skill provides comprehensive documentation and patterns for using Jolt Physics within `triangular-engine`. Jolt is a high-performance physics engine suited for complex scenes, large coordinates, and advanced constraints.

## 1. Setup & Installation

To use Jolt Physics, install `jolt-physics` as an optional peer dependency in your project:

```bash
npm i jolt-physics
```

Jolt is provided out-of-the-box via the `JoltPhysicsModule`.

### Imports

In your Angular components, import Jolt modules, services, constants, and utilities from `triangular-engine/jolt`:

```typescript
import {
  JoltPhysicsModule,
  JoltPhysicsService,
  Jolt,
  wrapQuat,
  // Other Jolt exports like IJoltMetadata, LAYER_MOVING, etc.
} from "triangular-engine/jolt";
```

---

## 2. Basic Scene Structure

Wrap your physics-enabled components in `<joltPhysics>`. Every object inside this component that needs physical simulation should be defined inside a `<joltRigidBody>`.

```html
<scene>
  <orbitControls [cameraPosition]="[0, 5, 10]" [isActive]="true" />

  <joltPhysics [gravity]="[0, -9.81, 0]" [debug]="false" [paused]="false">
    <!-- Static Ground -->
    <joltRigidBody [position]="[0, -0.5, 0]" [motionType]="0">
      <joltBoxShape [params]="[100, 1, 100]" />
      <mesh>
        <boxGeometry [params]="[100, 1, 100]" />
        <meshStandardMaterial [params]="{ color: '#666' }" />
      </mesh>
    </joltRigidBody>

    <!-- Dynamic Falling Sphere -->
    <joltRigidBody [position]="[0, 5, 0]" [motionType]="2">
      <joltSphereShape [params]="[0.5]" />
      <mesh>
        <sphereGeometry [params]="{ radius: 0.5 }" />
        <meshStandardMaterial [params]="{ color: 'springgreen' }" />
      </mesh>
    </joltRigidBody>
  </joltPhysics>
</scene>
```

### Motion Types

- `0` — **Static**: Immovable, infinite mass (e.g., floors, terrain).
- `1` — **Kinematic**: Position/velocity controlled programmatically; ignores external forces.
- `2` — **Dynamic**: Responds to gravity, impulses, and collisions.

---

## 3. Shape Components

Jolt shapes must be nested inside `<joltRigidBody>` components.

| Component                | Description               | Example Parameters                                                     |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------- |
| `<joltBoxShape>`         | Box dimensions            | `[params]="[width, height, depth]"`                                    |
| `<joltSphereShape>`      | Sphere radius             | `[params]="[radius]"`                                                  |
| `<joltCapsuleShape>`     | Capsule properties        | `[params]="[halfHeight, radius]"`                                      |
| `<joltCylinderShape>`    | Cylinder properties       | `[params]="[halfHeight, radius]"`                                      |
| `<joltHullShape>`        | Convex hull from geometry | `[geometry]="meshGeometry.geometry()"`                                 |
| `<joltMeshShape>`        | Static arbitrary mesh     | `[geometry]="meshGeometry.geometry()"`                                 |
| `<joltHeightFieldShape>` | Heightmap terrain         | `[map]="path" [sampleCount]="50" [width]="w" [height]="h" [depth]="d"` |

### Convex Hull Example:

```html
<mesh #myMesh>
  <cylinderGeometry [params]="[1, 1, 3, 8, 1]" />
  <meshStandardMaterial />
</mesh>
<joltHullShape [geometry]="myMesh.geometry()" />
```

---

## 4. Double Precision (Large Coordinates)

For space simulations or large-scale environments, check if double-precision coordinates are enabled on Jolt's web assembly:

```typescript
const meta = await this.physicsComponent()?.metaDataPromise;
if (meta) {
  // RVec3 represents double precision vectors in Jolt Double Precision WASM builds
  const largePosition = new meta.Jolt.RVec3(1000000.0, 0.0, 0.0);
  console.log("Position type:", typeof largePosition.GetX()); // 'number' (double precision float)
}
```

---

## 5. Controlling Bodies programmatically (Impulses & Forces)

To apply manual forces/impulses to a `JoltRigidBodyComponent` (e.g. vessel propulsion or player movement), access its underlying `Jolt.Body` via the `body$` behavior subject:

```typescript
import { Component, HostListener, inject, input } from "@angular/core";
import { JoltRigidBodyComponent, Jolt, JoltPhysicsService, wrapQuat } from "triangular-engine/jolt";
import { Vector3 } from "three";

@Component({
  selector: "app-player-body",
  template: `
    <mesh><sphereGeometry [params]="{ radius: 1 }" /><meshStandardMaterial /></mesh>
    <joltSphereShape [params]="[1]" />
  `,
  providers: [provideJoltRigidBodyComponent(PlayerBodyComponent)],
})
export class PlayerBodyComponent extends JoltRigidBodyComponent {
  applyThrust() {
    const body = this.body$.value; // Jolt.Body
    if (!body) return;

    const rotation = wrapQuat(body.GetRotation()); // Three.js Quaternion
    const localThrust = new Vector3(0, 1000, 0);
    const worldThrust = localThrust.applyQuaternion(rotation);

    const impulse = new Jolt.Vec3(worldThrust.x, worldThrust.y, worldThrust.z);
    body.AddImpulse(impulse);
    Jolt.destroy(impulse);

    // Wake up the body if it was sleeping
    const meta = this.physicsService.metaData$.value;
    if (meta) {
      meta.bodyInterface.ActivateBody(body.GetID());
    }
  }
}
```

---

## 6. Constraints & Joints

Joints constrain the motion of multiple rigid bodies relative to one another. Body IDs are passed as the `[bodies]` array containing the string identifiers of the parent `JoltRigidBodyComponent` components.

### Fixed Constraint (No Relative Movement)

Prevents all rotation and translation between two bodies. Excellent for assembling multi-part structures like modular spaceships.

```html
<joltFixedConstraint [bodies]="[body1Id, body2Id]" />
```

### Hinge Constraint (Rotational Joint)

Restricts movement to a single rotational axis. Perfect for doors, wheels, or robotic joints.

```html
<joltHingeConstraint [bodies]="[parentBodyId, childBodyId]" [point]="[0, 0, 0]" [axis]="[0, 1, 0]" [limitsMin]="-1.57" [limitsMax]="1.57" />
```

---

## 7. Contact Listeners & Event Handling

Listen to contact events by subscribing to the `JoltEventEmitter` triggers or hooking into the physics service tick loop.

Contact hooks available on `JoltPhysicsService`:

- `contactAdded$`
- `contactPersisted$`
- `contactRemoved$`

Example of detecting landing or impacts:

```typescript
this.joltPhysicsService.contactAdded$.subscribe((event) => {
  const body1Id = event.body1.GetID();
  const body2Id = event.body2.GetID();
  console.log(`Collision detected between body ${body1Id} and ${body2Id}`);
});
```

### Identifying which compound child was struck

If a body's shape is a `CompoundShape`/`MutableCompoundShape` (e.g. a modular
vessel built from `AddShapeShape(pos, rot, shape, userData)` per part), a
contact event only gives you a `SubShapeID`, not the child index or userData
directly. Resolve it with `getCompoundSubShapeUserData` — **do not** call
`shape.GetSubShapeUserData(subShapeId)` for this; see the Troubleshooting
entry below for why it won't work.

```typescript
import { getCompoundSubShapeUserData, Jolt } from 'triangular-engine/jolt';

onContactAdded(body: Jolt.Body, event: IContactAddedEvent) {
  // The manifold's two sub-shape IDs are body1's and body2's respectively;
  // pick whichever one isn't event.otherSubShapeId to get your own body's.
  const ownSubShapeId =
    event.otherSubShapeId.GetValue() === event.manifold.mSubShapeID2.GetValue()
      ? event.manifold.mSubShapeID1
      : event.manifold.mSubShapeID2;

  const compoundShape = Jolt.castObject(body.GetShape(), Jolt.CompoundShape);
  const struckUserData = getCompoundSubShapeUserData(compoundShape, ownSubShapeId);
}
```

---

## 8. Troubleshooting

### Jolt faults never freeze the frame loop

- **Symptom**: A physics step throws (e.g. a WASM memory access out of bounds)
  or a `tick$`/`postTick$` subscriber throws, and the page freezes or the engine
  frame loop dies on other engines.
- **Cause**: `<joltPhysics>` steps the world through `JoltInterface.Step`. If
  that call throws, the WASM heap is left in an undefined state and stepping it
  again is unsafe; an uncaught subscriber throw can also interrupt the frame.
- **Fix**: The engine already catches it — `<joltPhysics>` wraps the Step and
  its surrounding phases. It emits `(physicsFaulted)` with
  `{ phase: 'tick$' | 'step' | 'postTick$', error }`, reports the same fault on
  `EngineService.error$` (phase `jolt:step`, etc.), and after a `step` fault it
  stops stepping that world permanently (degrade to "no physics", render loop
  alive). Consume it to surface a banner and rebuild/reset the world:

  ```html
  <joltPhysics (physicsFaulted)="onPhysicsFaulted($event)"></joltPhysics>
  ```

  ```typescript
  onPhysicsFaulted({ phase, error }: IJoltPhysicsFaultEvent) {
    console.error(`Jolt fault in ${phase}`, error);
  }
  ```

  If the page STILL hard-freezes with no `physicsFaulted` and no console error,
  that is a synchronous main-thread block (for example a WASM heap resize that
  copies the whole heap), which no try/catch can fix — bound/chunk that work
  instead.

  If `physicsFaulted` fires but the page still freezes, the trap happened after
  the guard's catch but inside a system the guard cannot contain (for example a
  Jolt worker thread smashing shared memory during the same step). Known: the
  guard's try/catch has never been observed to eliminate the freeze once a
  `step` trap has occurred; make the Jolt call chain that traps first
  fault-free instead.

### Long vessel structures wiggle or bend

- **Cause**: Multi-body physics chains connected via linear constraints naturally wobble under high forces.
- **Fix**: Provide cross-bracing constraints. Connect not only adjacent parts, but also every other part to create rigid triangulated networks (e.g. jointing index `i` with `i + 2` and `i + 3` where appropriate).

### Mesh Shape collisions not registering or throwing errors

- **Cause**: Mesh shape (`<joltMeshShape>`) is only supported for **Static** (`motionType="0"`) rigid bodies in Jolt.
- **Fix**: Use `<joltHullShape>` (convex hull) or primitive shapes (`box`, `sphere`) for dynamic/kinematic rigid bodies.

### Compound sub-shape user data always reads as 0

- **Symptom**: A contact on a `CompoundShape`/`MutableCompoundShape` body always resolves the struck child's userData to `0`, no matter which child was actually hit — often _silently_, because 0 can coincidentally be a valid ID for one shape and get misattributed rather than erroring.
- **Cause**: `Shape.GetSubShapeUserData(subShapeId)` is a stub that unconditionally returns 0. This holds even after `Jolt.castObject(shape, Jolt.CompoundShape)` — casting does not route the call to a working per-child lookup in this binding, despite `CompoundShapeSettings.AddShapeShape`'s 4th argument (`inUserData`) genuinely storing a distinct value per child.
- **Fix**: Use `getCompoundSubShapeUserData(compoundShape, subShapeId)` (exported from `triangular-engine/jolt`) instead — it decodes the child index from the `SubShapeID`'s low bits itself and reads `GetSubShape(idx).mUserData`, which does carry the real value.

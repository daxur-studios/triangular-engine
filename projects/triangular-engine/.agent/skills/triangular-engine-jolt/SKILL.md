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
} from 'triangular-engine/jolt';
```


---

## 2. Basic Scene Structure

Wrap your physics-enabled components in `<jolt-physics>`. Every object inside this component that needs physical simulation should be defined inside a `<jolt-rigid-body>`.

```html
<scene>
  <orbitControls [cameraPosition]="[0, 5, 10]" [isActive]="true" />
  
  <jolt-physics [gravity]="[0, -9.81, 0]" [debug]="false" [paused]="false">
    <!-- Static Ground -->
    <jolt-rigid-body [position]="[0, -0.5, 0]" [motionType]="0">
      <jolt-box-shape [params]="[100, 1, 100]" />
      <mesh>
        <boxGeometry [params]="[100, 1, 100]" />
        <meshStandardMaterial [params]="{ color: '#666' }" />
      </mesh>
    </jolt-rigid-body>

    <!-- Dynamic Falling Sphere -->
    <jolt-rigid-body [position]="[0, 5, 0]" [motionType]="2">
      <jolt-sphere-shape [params]="[0.5]" />
      <mesh>
        <sphereGeometry [params]="{ radius: 0.5 }" />
        <meshStandardMaterial [params]="{ color: 'springgreen' }" />
      </mesh>
    </jolt-rigid-body>
  </jolt-physics>
</scene>
```

### Motion Types
* `0` — **Static**: Immovable, infinite mass (e.g., floors, terrain).
* `1` — **Kinematic**: Position/velocity controlled programmatically; ignores external forces.
* `2` — **Dynamic**: Responds to gravity, impulses, and collisions.

---

## 3. Shape Components

Jolt shapes must be nested inside `<jolt-rigid-body>` components.

| Component | Description | Example Parameters |
| --- | --- | --- |
| `<jolt-box-shape>` | Box dimensions | `[params]="[width, height, depth]"` |
| `<jolt-sphere-shape>` | Sphere radius | `[params]="[radius]"` |
| `<jolt-capsule-shape>` | Capsule properties | `[params]="[halfHeight, radius]"` |
| `<jolt-cylinder-shape>` | Cylinder properties | `[params]="[halfHeight, radius]"` |
| `<jolt-hull-shape>` | Convex hull from geometry | `[geometry]="meshGeometry.geometry()"` |
| `<jolt-mesh-shape>` | Static arbitrary mesh | `[geometry]="meshGeometry.geometry()"` |
| `<jolt-height-field-shape>`| Heightmap terrain | `[map]="path" [sampleCount]="50" [width]="w" [height]="h" [depth]="d"` |

### Convex Hull Example:
```html
<mesh #myMesh>
  <cylinderGeometry [params]="[1, 1, 3, 8, 1]" />
  <meshStandardMaterial />
</mesh>
<jolt-hull-shape [geometry]="myMesh.geometry()" />
```

---

## 4. Double Precision (Large Coordinates)

For space simulations or large-scale environments, check if double-precision coordinates are enabled on Jolt's web assembly:

```typescript
const meta = await this.physicsComponent()?.metaDataPromise;
if (meta) {
  // RVec3 represents double precision vectors in Jolt Double Precision WASM builds
  const largePosition = new meta.Jolt.RVec3(1000000.0, 0.0, 0.0);
  console.log('Position type:', typeof largePosition.GetX()); // 'number' (double precision float)
}
```

---

## 5. Controlling Bodies programmatically (Impulses & Forces)

To apply manual forces/impulses to a `JoltRigidBodyComponent` (e.g. vessel propulsion or player movement), access its underlying `Jolt.Body` via the `body$` behavior subject:

```typescript
import { Component, HostListener, inject, input } from '@angular/core';
import { JoltRigidBodyComponent, Jolt, JoltPhysicsService, wrapQuat } from 'triangular-engine/jolt';
import { Vector3 } from 'three';


@Component({
  selector: 'app-player-body',
  template: `
    <mesh><sphereGeometry [params]="{radius: 1}"/><meshStandardMaterial /></mesh>
    <jolt-sphere-shape [params]="[1]" />
  `,
  providers: [provideJoltRigidBodyComponent(PlayerBodyComponent)]
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
<jolt-fixed-constraint [bodies]="[body1Id, body2Id]" />
```

### Hinge Constraint (Rotational Joint)
Restricts movement to a single rotational axis. Perfect for doors, wheels, or robotic joints.

```html
<jolt-hinge-constraint 
  [bodies]="[parentBodyId, childBodyId]" 
  [point]="[0, 0, 0]" 
  [axis]="[0, 1, 0]"
  [limitsMin]="-1.57" 
  [limitsMax]="1.57" 
/>
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

---

## 8. Troubleshooting

### Long vessel structures wiggle or bend
* **Cause**: Multi-body physics chains connected via linear constraints naturally wobble under high forces.
* **Fix**: Provide cross-bracing constraints. Connect not only adjacent parts, but also every other part to create rigid triangulated networks (e.g. jointing index `i` with `i + 2` and `i + 3` where appropriate).

### Mesh Shape collisions not registering or throwing errors
* **Cause**: Mesh shape (`<jolt-mesh-shape>`) is only supported for **Static** (`motionType="0"`) rigid bodies in Jolt.
* **Fix**: Use `<jolt-hull-shape>` (convex hull) or primitive shapes (`box`, `sphere`) for dynamic/kinematic rigid bodies.

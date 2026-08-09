# Jolt Physics Guide

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

## Performance Notes

- Compound shapes are more expensive than single shapes
- Use the minimum number of shapes needed for your collision requirements
- Consider using simplified collision shapes that approximate your visual geometry

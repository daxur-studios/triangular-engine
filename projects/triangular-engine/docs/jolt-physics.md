# Jolt Physics Guide

Jolt Physics is a high-performance physics engine integrated with the triangular engine.

## Multi-Shape Rigid Bodies

You can create rigid bodies with multiple collision shapes by adding multiple shape components as children of a `jolt-rigid-body`. Each shape can have its own position and rotation relative to the rigid body.

### Example: Compound Shape (Box + Sphere)

```html
<jolt-rigid-body [motionType]="2" [position]="[0, 5, 0]">
  <!-- Main box shape at the origin -->
  <jolt-box-shape [params]="[1, 1, 1]"></jolt-box-shape>

  <!-- Sphere shape offset to the right -->
  <jolt-sphere-shape
    [params]="[0.5]"
    [position]="[1.5, 0, 0]">
  </jolt-sphere-shape>

  <!-- Another box rotated and positioned -->
  <jolt-box-shape
    [params]="[0.5, 2, 0.5]"
    [position]="[0, 1, 0]"
    [rotation]="[0, 0, Math.PI/4]">
  </jolt-box-shape>

  <!-- Visual mesh -->
  <mesh>
    <boxGeometry [params]="[2, 2, 2]"></boxGeometry>
    <meshStandardMaterial [color]="'red'"></meshStandardMaterial>
  </mesh>
</jolt-rigid-body>
```

### Shape Position and Rotation

When shapes are part of a compound body (multiple shapes under one rigid body), you can use the `position` and `rotation` inputs to specify their local transform:

- `position`: `[x, y, z]` - Local position relative to the rigid body origin
- `rotation`: `[x, y, z]` - Euler angles in radians for local rotation

For single-shape bodies, these inputs are ignored since the shape fills the entire body.

### Supported Shapes

- `<jolt-box-shape [params]="[width, height, depth]">`
- `<jolt-sphere-shape [params]="[radius]">`
- `<jolt-capsule-shape [params]="[halfHeightOfCylinder, radius]">`
- `<jolt-cylinder-shape [params]="[halfHeight, radius]">`
- `<jolt-hull-shape>` - Convex hull from points
- `<jolt-mesh-shape>` - Triangle mesh (static bodies only)

### Physics World Setup

```html
<jolt-physics [gravity]="[0, -9.81, 0]" [debug]="true">
  <!-- Your rigid bodies here -->
</jolt-physics>
```

### Rigid Body Properties

```html
<jolt-rigid-body
  [motionType]="2"           <!-- 0=Static, 1=Kinematic, 2=Dynamic -->
  [position]="[x, y, z]"
  [rotation]="[x, y, z]"    <!-- Euler angles -->
  [velocity]="[vx, vy, vz]"
  [angularDamping]="0.1"
  [linearDamping]="0.1"
  [id]="'myBody'">
</jolt-rigid-body>
```

## Performance Notes

- Compound shapes are more expensive than single shapes
- Use the minimum number of shapes needed for your collision requirements
- Consider using simplified collision shapes that approximate your visual geometry

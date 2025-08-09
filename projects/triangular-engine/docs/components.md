# Components Guide

All components are standalone and can be nested inside `<scene>`.

## Scene

```html
<scene> ...children... </scene>
```

- Hosts the renderer canvas, handles resize, and drives the render loop.

## Core 3D Nodes

- `<group>`: logical container (extends Object3D)
- `<mesh>`: renderable mesh
- `<points>`: point cloud
- `<sprite>`: screen-aligned sprite
- Helpers: `<gridHelper>`, `<arrowHelper>`

Example:

```html
<mesh [position]="[0,1,0]" [castShadow]="true">
  <boxGeometry [params]="[1,1,1]" />
  <meshStandardMaterial [params]="{ color: '#88c' }" />
</mesh>
```

## Geometry

- `<boxGeometry>`, `<sphereGeometry>`, `<planeGeometry>`
- `<bufferGeometry>` for custom geometries

See also: src/lib/engine/components/geometry/GEOMETRY.md

## Materials

- `<meshStandardMaterial>`, `<meshNormalMaterial>`, `<meshBasicMaterial>`
- `<shaderMaterial>`, `<rawShaderMaterial>`
- `<pointsMaterial>`

See also: src/lib/engine/components/materials/MATERIAL.md

## Lights

- `<ambientLight [intensity]="1" [color]="'#fff'" />`
- `<directionalLight [position]="[3,5,2]" [castShadow]="true" />`
- `<pointLight />`

See also: src/lib/engine/components/light/LIGHT.md

## Camera & Controls

- `<camera [isActive]="true" [lookAt]="[0,0,0]" />`
- `<orbitControls [isActive]="true" [target]="[0,0,0]" [cameraPosition]="[0,2,5]" />`

## GLTF

```html
<gltf [gltfPath]="'assets/models/scene.glb'" [enableBVH]="true" />
```

- `enableBVH` computes per-mesh BVH for fast raycasting.

## CSS2D / CSS3D

- `<css2d>` and `<css3d>` overlay HTML elements in 3D

## Keyboard

- `<keyboardControls>` exposes a minimal keyboard control component

## Features

- Environment: `<skyBox>`, `<ocean>`
- Performance monitor: `<performanceMonitor>`

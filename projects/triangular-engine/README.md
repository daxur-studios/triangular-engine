# Triangular Engine

Angular-first 3D engine powered by Three.js and Rapier. Build interactive 3D scenes using ergonomic standalone Angular components for scenes, cameras, meshes, lights, materials, GLTF loading, physics, and more.

This README contains the full documentation needed to use the library on npm. No external links are required.

## Features

- Standalone Angular components: `scene`, `camera`, `mesh`, `materials`, `lights`, `gltf`, `physics`, `css2d/css3d`, and more
- Declarative Object3D graph with inputs for `position`, `rotation`, `scale`, and common options
- Rapier 3D physics integration: rigid bodies, colliders, joints, instanced rigid bodies
- GLTF loader with optional BVH acceleration for fast raycasts
- Engine UI helpers: stats overlay, scene tree, slots system
- Signals-based services: engine tick, inputs, camera switching

## Install

```bash
npm i triangular-engine three @dimforge/rapier3d-compat
```

Optional (recommended for raycast performance):

```bash
npm i three-mesh-bvh
```

### Peer Dependencies

These are expected to be provided by your app (see package.json for exact versions):

```json
{
  "@angular/common": "^20.3.3",
  "@angular/core": "^20.3.3",
  "three": "^0.178.0",
  "@dimforge/rapier3d-compat": "^0.18.0",
  "dexie": "^4.0.11"
}
```

Optional peers:

```json
{
  "three-mesh-bvh": "^0.9.1"
}
```

## Quick Start

Provide the engine per component/page that hosts a `<scene>` using the recommended helper:
`EngineService.provide(...)`. Then render a minimal scene.

```ts
import { Component } from "@angular/core";
import { EngineModule, EngineService } from "triangular-engine";

@Component({
  selector: "app-demo",
  standalone: true,
  imports: [EngineModule],
  template: `
    <scene>
      <camera [position]="[4, 3, 6]" [lookAt]="[0, 0, 0]" />
      <directionalLight [position]="[3, 5, 2]" />
      <mesh>
        <boxGeometry [params]="[2, 2, 2]" />
        <meshStandardMaterial />
      </mesh>
    </scene>
  `,
  providers: EngineService.provide({ showFPS: true }),
})
export class DemoComponent {}
```

## Configure Draco (GLTF)

If you load DRACO-compressed GLTF assets, add the decoder to your `angular.json` assets:

```json
{
  "glob": "**/*",
  "input": "node_modules/three/examples/jsm/libs/draco/",
  "output": "draco/"
}
```

## Engine Assets

Ensure you have the following in your `angular.json` assets:

```json
{
  "glob": "**/*",
  "input": "node_modules/triangular-engine/assets",
  "output": "triangular-engine"
}
```

## Components Overview

All components are standalone and can be nested inside `<scene>`.

- `scene`: hosts the renderer canvas, handles resize, and drives the render loop
- Core nodes: `group`, `mesh`, `points`, `sprite`, `gridHelper`, `arrowHelper`
- Geometry: `boxGeometry`, `sphereGeometry`, `planeGeometry`, `bufferGeometry`, `capsuleGeometry`, `bufferAttribute`
- Materials: `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`
- Lights: `ambientLight`, `directionalLight`, `pointLight`
- Camera & Controls: `camera`, `orbitControls`
- GLTF: `gltf`
- CSS: `css2d`, `css3d`
- Physics: `physics`, `rigidBody`, `collider` family, `fixedJoint`, `sphericalJoint`, `instancedRigidBody`
- Features & UI: `skyBox`, `ocean`, `performanceMonitor`, `sceneTree`, `engine-ui`, `engine-stats`, `[engineSlot]`, `[raycast]`

Example mesh:

```html
<mesh [position]="[0,1,0]" [castShadow]="true">
  <boxGeometry [params]="[1,1,1]" />
  <meshStandardMaterial [params]="{ color: '#88c' }" />
  <!-- or <meshStandardMaterial [map]="'assets/textures/wood.jpg'" /> -->
  <!-- or <meshNormalMaterial /> -->
  <!-- or <shaderMaterial /> -->
  <!-- or <rawShaderMaterial /> -->
  <!-- or <pointsMaterial /> -->
  <!-- or <spriteMaterial /> -->
</mesh>
```

## GLTF Loading

```html
<gltf [gltfPath]="'assets/models/thing.glb'" [enableBVH]="true" />
```

- `enableBVH`: builds per-mesh BVH using `three-mesh-bvh` (if installed) for faster raycasts
- Optional `cachePath`: custom key for the in-memory GLTF cache

## Physics (Rapier)

Wrap physics-enabled content in `<physics>`:

```html
<physics [gravity]="[0,-9.81,0]" [debug]="false">
  <rigidBody [rigidBodyType]="1">
    <cuboidCollider [halfExtents]="[50, 0.5, 50]" />
    <mesh [position]="[0, -0.5, 0]">
      <boxGeometry [params]="[100, 1, 100]" />
      <meshStandardMaterial [params]="{ color: '#666' }" />
    </mesh>
  </rigidBody>

  <rigidBody [rigidBodyType]="0" [position]="[0, 4, 0]">
    <ballCollider [radius]="0.5" />
    <mesh>
      <sphereGeometry [params]="{ radius: 0.5, widthSegments: 32, heightSegments: 16 }" />
      <meshNormalMaterial />
    </mesh>
  </rigidBody>
</physics>
```

Rigid body types: 0 Dynamic, 1 Fixed, 2 KinematicPositionBased, 3 KinematicVelocityBased.

## Services

Provide per component where you host `<scene>`:

```ts
providers: EngineService.provide({ showFPS: true });
```

- EngineService: `scene`, `renderer`, `tick$`, `elapsedTime$`, `setFPSLimit`, input streams (`keydown$`, `mousemove$`, `mousewheel$`, etc.), `camera$`, `switchCamera(camera)`, `requestSingleRender()`
- PhysicsService: creates and steps Rapier `World`, `beforeStep$`, `stepped$`, `setSimulatePhysics()`, `setDebugState()`
- LoaderService: `loadAndCacheGltf(path, cachePath?, force?)`, `loadAndCacheTexture(path)`; sets Draco path to `/draco/`; builds `userData.objectMap` for GLTF lookup
- EngineSettingsService: reactive settings (e.g., debug, auto-save)

## API: Selectors

List of selectors available in templates (not exhaustive):

- Core: `scene`, `group`, `mesh`, `points`, `sprite`, `primitive`, `gridHelper`, `arrowHelper`
- Camera & Controls: `camera`, `orbitControls`
- Geometry: `bufferGeometry`, `bufferAttribute`, `boxGeometry`, `sphereGeometry`, `planeGeometry`, `capsuleGeometry`
- Materials: `material`, `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`
- Lights: `light`, `ambientLight`, `directionalLight`, `pointLight`
- GLTF: `gltf`
- CSS Renderers: `css2d`, `css3d`
- Physics: `physics`, `rigidBody`, `collider` family, `cuboidCollider`, `ballCollider`, `capsuleCollider`, `cylinderCollider`, `coneCollider`, `fixedJoint`, `sphericalJoint`, `instancedRigidBody`
- Features & UI: `skyBox`, `ocean`, `performanceMonitor`, `sceneTree`, `engine-ui`, `engine-stats`, `[engineSlot]`, `[raycast]`

## Assets & Loading

- Textures: pass a `map` to `meshStandardMaterial` to auto-load a texture path

  ```html
  <meshStandardMaterial [map]="'assets/textures/wood.jpg'" />
  ```

- Direct loaders/exporters: access via `LoaderService` if you need `BufferGeometryLoader`, `ObjectLoader`, `SVGLoader`, `STLLoader`, `FBXLoader`, `GLTFExporter`

## Troubleshooting

### EngineService provider missing

Error: `NullInjectorError: No provider for _EngineService`

Fix: Provide `EngineService.provide(...)` in every component that hosts a `<scene>`.

### Working locally with npm link

If serving both `triangular-engine` and your app locally, link the package:

```bash
# in this repo
npm run link

# in your app
npm link triangular-engine
```

If changes are not reflected in the app, set `"preserveSymlinks": true` in your app's `angular.json` build options and add the following to your `tsconfig.json`:

```json
{
  "paths": {
    "triangular-engine": ["node_modules/triangular-engine"]
  }
}
```

## Example: Basic Scene with Physics

```ts
import { Component } from "@angular/core";
import { EngineModule, EngineService } from "triangular-engine";

@Component({
  selector: "app-basic",
  standalone: true,
  imports: [EngineModule],
  template: `
    <scene>
      <camera [position]="[4, 3, 6]" [lookAt]="[0, 0, 0]" />
      <directionalLight [position]="[3, 5, 2]" />

      <physics [gravity]="[0, -9.81, 0]" [debug]="false">
        <rigidBody [rigidBodyType]="1">
          <cuboidCollider [halfExtents]="[50, 0.5, 50]" />
          <mesh [position]="[0, -0.5, 0]">
            <boxGeometry [params]="[100, 1, 100]" />
            <meshStandardMaterial [params]="{ color: '#666' }" />
          </mesh>
        </rigidBody>

        <rigidBody [rigidBodyType]="0" [position]="[0, 4, 0]">
          <ballCollider [radius]="0.5" />
          <mesh>
            <sphereGeometry [params]="{ radius: 0.5, widthSegments: 32, heightSegments: 16 }" />
            <meshNormalMaterial />
          </mesh>
        </rigidBody>
      </physics>
    </scene>
  `,
  providers: EngineService.provide({ showFPS: true }),
})
export class BasicComponent {}
```

---

If anything is missing from this README, please open an issue or PR. This file is designed to render correctly on npm without relying on external docs.

# Triangular Engine

Angular-first 3D engine powered by Three.js and Rapier. Build interactive 3D scenes using ergonomic standalone Angular components for scenes, cameras, meshes, lights, materials, GLTF loading, physics, and more.

This README contains the full documentation needed to use the library on npm. No external links are required.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Compatibility

| Dependency      | Version  | Notes                                                          |
| --------------- | -------- | -------------------------------------------------------------- |
| Angular         | ^20.3.3  | Required - Angular 20.3.3 or higher                            |
| Three.js        | ^0.183.0 | Required                                                       |
| Dexie           | ^4.2.1   | Required                                                       |
| Rapier 3D       | ^0.18.0  | Optional - for physics support                                 |
| Jolt Physics    | ^0.38.0  | Optional - alternative physics engine                          |
| @pmndrs/vanilla | ^1.24.0  | Optional - Billboard and Sparkles (`triangular-engine/pmndrs`) |

## Features

- Standalone Angular components: `scene`, `camera`, `mesh`, `materials`, `lights`, `gltf`, `physics`, `css2d/css3d`, post-processing, and more
- Declarative Object3D graph with inputs for `position`, `rotation`, `scale`, and common options
- Rapier 3D physics integration: rigid bodies, colliders, joints, instanced rigid bodies
- GLTF loader with optional BVH acceleration for fast raycasts
- Engine UI helpers: stats overlay, scene tree, portal-based HUD overlay system
- Signals-based services: engine tick, inputs, camera switching, engine portal system
- Stacking overlays: support top, bottom, left sidebar, right sidebar, main, modal, and notification layers

## Install

```bash
npm i triangular-engine three three-mesh-bvh
```

(optionally add @dimforge/rapier3d-compat OR jolt-physics for physics, or @pmndrs/vanilla for billboard/sparkles)

### Peer Dependencies

These are expected to be provided by your app (see package.json for exact versions):

```json
{
  "@angular/common": "^20.3.3",
  "@angular/core": "^20.3.3",
  "three": "^0.183.0",
  "dexie": "^4.2.1"
}
```

Optional peer dependencies:

```json
{
  "@dimforge/rapier3d-compat": "^0.18.0",
  OR
  "jolt-physics": "^0.38.0",
  AND
  "@pmndrs/vanilla": "^1.24.0"
}
```

See [docs/pmndrs.md](docs/pmndrs.md) for Billboard and Sparkles usage.

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

Scene-local debug options can also be set declaratively:

```html
<scene [showFps]="true">
  <!-- scene content -->
</scene>
```

`showFps` overrides `EngineService.provide({ showFPS: ... })` for the engine
instance used by that scene. Omit it to retain the provider setting.

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
- Post-processing: `effect-composer`, `unrealBloomPass`, `glitchPass`, `outputPass`, `smaaPass`, `shaderPass`
- Geometry: `boxGeometry`, `sphereGeometry`, `planeGeometry`, `bufferGeometry`, `capsuleGeometry`, `bufferAttribute`
- Materials: `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`
- Lights: `ambientLight`, `directionalLight`, `pointLight`
- Camera & Controls: `camera`, `orbitControls`
- GLTF: `gltf`
- CSS: `css2d`, `css3d`
- Physics: `physics`, `rigidBody`, `collider` family, `fixedJoint`, `sphericalJoint`, `instancedRigidBody`
- Features & UI: `skyBox`, `ocean`, `performanceMonitor`, `sceneTree`, `engine-ui`, `engine-stats`, `engine-portal-outlet`, `[enginePortal]`, `[raycast]`

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

## Physics (Jolt)

Wrap Jolt physics-enabled content in `<jolt-physics>`:

```html
<jolt-physics [gravity]="[0, -9.81, 0]" [debug]="false" [paused]="false">
  <!-- Ground (Static) -->
  <jolt-rigid-body [position]="[0, -0.5, 0]" [motionType]="0">
    <jolt-box-shape [params]="[100, 1, 100]" />
    <mesh>
      <boxGeometry [params]="[100, 1, 100]" />
      <meshStandardMaterial [params]="{ color: '#666' }" />
    </mesh>
  </jolt-rigid-body>

  <!-- Falling Ball (Dynamic) -->
  <jolt-rigid-body [position]="[0, 5, 0]" [motionType]="2">
    <jolt-sphere-shape [params]="[0.5]" />
    <mesh>
      <sphereGeometry [params]="{ radius: 0.5 }" />
      <meshStandardMaterial [params]="{ color: 'springgreen' }" />
    </mesh>
  </jolt-rigid-body>
</jolt-physics>
```

Motion types: 0 Static, 1 Kinematic, 2 Dynamic.
See `.agent/skills/triangular-engine-jolt/SKILL.md` for advanced Jolt controls, double precision coordinates, and joints/constraints (e.g. `<jolt-fixed-constraint>` or `<jolt-hinge-constraint>`).

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
- Post-processing: `effect-composer`, `unrealBloomPass`, `glitchPass`, `outputPass`, `smaaPass`, `shaderPass`
- Camera & Controls: `camera`, `orbitControls`
- Geometry: `bufferGeometry`, `bufferAttribute`, `boxGeometry`, `sphereGeometry`, `planeGeometry`, `capsuleGeometry`
- Materials: `material`, `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`
- Lights: `light`, `ambientLight`, `directionalLight`, `pointLight`
- GLTF: `gltf`
- CSS Renderers: `css2d`, `css3d`
- Physics: `physics`, `rigidBody`, `collider` family, `cuboidCollider`, `ballCollider`, `capsuleCollider`, `cylinderCollider`, `coneCollider`, `fixedJoint`, `sphericalJoint`, `instancedRigidBody`
- Features & UI: `skyBox`, `ocean`, `performanceMonitor`, `sceneTree`, `engine-ui`, `engine-stats`, `engine-portal-outlet`, `[enginePortal]`, `[raycast]`

## Engine Portals (Dynamic UI Overlay System)

`triangular-engine` provides a portal-based UI stacking system (similar to `Daxur-Daemon`) allowing any component/page to register controls on top of the 3D HUD dynamically.

### How to use:

In any child component or page that lives inside the engine context, register templates using `<ng-template enginePortal="area">`. They will be automatically rendered in the appropriate zone and cleaned up on destroy.

```html
<!-- Inside a consumer component -->
<ng-template enginePortal="top" lane="content" [order]="1">
  <button (click)="doSomething()">My HUD Action</button>
</ng-template>

<ng-template enginePortal="left" lane="before">
  <div class="my-sidebar-list">
    <h3>Configuration</h3>
  </div>
</ng-template>
```

- **Areas**: `'top' | 'bottom' | 'left' | 'right' | 'main' | 'modal' | 'notification'`
- **Lanes**: `'before' | 'content' | 'after'` (governs sorting layout order within the area)
- **Order**: numerical sorting priority within the lane.

## Assets & Loading

- Textures: pass a `map` to `meshStandardMaterial` to auto-load a texture path

  ```html
  <meshStandardMaterial [map]="'assets/textures/wood.jpg'" />
  ```

- Direct loaders/exporters: access via `LoaderService` if you need `BufferGeometryLoader`, `ObjectLoader`, `SVGLoader`, `STLLoader`, `FBXLoader`, `GLTFExporter`

### Takram cloud textures

`<takram-clouds>` loads its weather, turbulence, shape, shape-detail, and STBN
defaults from `assetBaseUrl` (`/takram-clouds` by default). Applications using
those defaults must copy the `@takram/three-clouds` assets to that path.

Each texture can instead be supplied by the caller. Weather and turbulence
accept either a Three.js `Texture` or Takram `ProceduralTexture`; shape and
shape-detail accept either `Data3DTexture` or `Procedural3DTexture`. STBN accepts
`Data3DTexture`.

```ts
import { DestroyRef, inject } from '@angular/core';
import { LocalWeather } from '@takram/three-clouds';

readonly localWeather = new LocalWeather();

constructor() {
  inject(DestroyRef).onDestroy(() => this.localWeather.dispose());
}
```

```html
<takram-clouds [localWeatherTexture]="localWeather">
  <takram-cloud-layer channel="r" />
</takram-clouds>
```

Provided textures and procedural generators remain caller-owned and must be
disposed by the caller. Setting an input back to `undefined` restores the
component-owned default. The `/takram-clouds` demo shows default, custom
`DataTexture`, and Takram procedural weather sources.

### Takram atmosphere lights

Takram cloud shadows affect scene geometry through aerial-perspective
post-processing, not through Three.js shadow maps. For that composition mode,
render scene meshes as albedo with unlit materials, enable the composer's normal
pass, and enable aerial sun/sky lighting:

```html
<postprocessing-composer [enableNormalPass]="true">
  <takram-atmosphere>
    <mesh>
      <boxGeometry />
      <meshBasicMaterial [params]="{ color: '#b58b62' }" />
    </mesh>
    <takram-clouds [shadowCascadeCount]="1">
      <takram-cloud-layer channel="r" [shadow]="true" />
    </takram-clouds>
    <takram-aerial-perspective
      [sunLight]="true"
      [skyLight]="true"
      [cloudShadows]="true"
    />
  </takram-atmosphere>
</postprocessing-composer>
```

The composer supplies its view-space normal texture to effects that need it.
Disabling `cloudShadows` is a useful A/B check: direct illumination on the
geometry should brighten while the clouds remain visible.

Place the optional atmosphere-aware lights inside `<takram-atmosphere>` when
ordinary Three.js materials should receive the same sun and sky lighting as the
cloud and aerial-perspective effects:

```html
<takram-atmosphere>
  <takram-sun-light [intensity]="1.5" />
  <takram-sky-light [intensity]="0.7" />
  <!-- scene meshes, clouds, and aerial perspective -->
</takram-atmosphere>
```

`<takram-sun-light>` supports `intensity`, `distance`, `correctAltitude`, and
optional conventional Three.js `castShadow`. `<takram-sky-light>` supports
`intensity` and `correctAltitude`. Both use the enclosing atmosphere's lookup
textures, sun direction, and world/ECEF transform.

Do not combine these real lights with aerial `sunLight`/`skyLight` on the same
unmasked objects; that applies lighting twice. Conventional `castShadow` and
`receiveShadow` remain a separate Three.js shadow-map path and do not make
Takram's cloud-shadow texture affect a standard material.

The Takram cloud adapter rejects non-WebGL/WebGL1 renderers, non-perspective
cameras, more than four layers, and shadow cascade counts outside 1–4. A failed
default texture load is reported through `TakramCloudsComponent.assetError` and
logged with the failing asset URL.

## Troubleshooting

### 3D Canvas / Scene is 0 Height (Invisible)

**Symptom**: The 3D canvas is not displaying, or the container has a height of 0.

**Cause**: The `<scene>` element relies on a `ResizeObserver` observing a flexbox layout. If any of the parent elements/components wrapping the `<scene>` element are block elements without defined heights or are not participating in the flex layout, the layout collapses.

**Fix**: Ensure every parent component in the DOM tree, from the root application element down to the `<scene>` container, participates in a flexbox layout:

1. Register `host: { class: 'flex-page' }` on your parent components/directives.
2. In your global stylesheet (e.g., `styles.scss`), define the `.flex-page` helper class:
   ```css
   .flex-page {
     display: flex;
     flex-direction: column;
     flex: 1 1;
     overflow: auto;
   }
   ```
3. Make sure any intermediate wrapper `div` elements are styled as flex containers (e.g., `display: flex; flex-direction: column; flex: 1;`).

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

**Important**: Set `"preserveSymlinks": true` in your app's `angular.json` build options to avoid runtime injection errors (such as `_HighContrastModeDetector` token injection failures). Also add the following to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "triangular-engine": ["node_modules/triangular-engine"]
    }
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

## For Maintainers: Publishing to npm

1. Ensure you're logged in: `npm login`
2. Bump version in `projects/triangular-engine/package.json` if needed
3. From the workspace root: `npm run publish`

The publish script builds with development configuration (required for npm) and publishes from `dist/triangular-engine`. For local development with `jolt-physics`, the workspace uses a local file override in its `devDependencies`; the published package lists `jolt-physics` as an optional `^0.38.0` peer dependency.

---

If anything is missing from this README, please open an issue or PR. This file is designed to render correctly on npm without relying on external docs.

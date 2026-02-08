---
name: triangular-engine
description: >
  Use triangular-engine to build declarative 3D scenes in Angular apps with Three.js.
  Covers installation, angular.json asset setup, scene components, geometries, materials,
  lighting, GLTF loading, raycasting, and optional Rapier/Jolt physics backends.
  Use when creating or modifying Angular components that use triangular-engine,
  or when the user mentions 3D scenes, Three.js, or physics in Angular.
---

# Triangular Engine

Declarative 3D engine for Angular, built on Three.js.

## Public entry points

Use only these package entry points in consumer apps:

- Core: `triangular-engine`
- Rapier physics: `triangular-engine/rapier`
- Jolt physics: `triangular-engine/jolt`

Do not import from internal source paths.

## Compatibility

| Dependency | Version | Required |
| --- | --- | --- |
| Angular | `^20.3.3` | Yes |
| Three.js | `^0.181.0` | Yes |
| Dexie | `^4.2.1` | Yes |
| Rapier | `^0.18.0` | Optional |
| Jolt | `0.38.0` | Optional |

Target Angular 20.3.x and Three 0.181.x unless explicitly refactoring compatibility.

## Install

```bash
# Core (required)
npm i triangular-engine three dexie three-mesh-bvh

# Rapier physics (optional)
npm i @dimforge/rapier3d-compat

# Jolt physics (optional)
npm i jolt-physics
```

## Asset setup (angular.json)

Add both entries to the `assets` array in your app's build target:

```json
{
  "glob": "**/*",
  "input": "node_modules/three/examples/jsm/libs/draco/",
  "output": "draco/"
},
{
  "glob": "**/*",
  "input": "node_modules/triangular-engine/assets",
  "output": "triangular-engine"
}
```

## Minimum working example

```ts
import { Component } from '@angular/core';
import { EngineModule, EngineService } from 'triangular-engine';

@Component({
  selector: 'app-demo',
  standalone: true,
  imports: [EngineModule],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgl' // or 'webgpu'
  }),
  template: `
    <scene>
      <camera [position]="[4, 3, 6]" [lookAt]="[0, 0, 0]" />
      <directionalLight [position]="[3, 5, 2]" />

      <mesh>
        <boxGeometry [params]="[1, 1, 1]" />
        <meshStandardMaterial [params]="{ color: '#88aaff' }" />
      </mesh>
    </scene>
  `
})
export class DemoComponent {}
```

- `<scene>` auto-creates an `EngineService` if none is provided.
- Use explicit `EngineService.provide(...)` when the host component needs service access or non-default options.

## Core architecture

- `SceneComponent` (`<scene>`) owns the canvas, resize handling, and event forwarding.
- Renderable nodes derive from `Object3DComponent` with common inputs: `position`, `rotation`, `quaternion`, `scale`, `name`.
- `EngineService` owns renderer, scene, active camera, loop/tick streams, and input streams.
- Set `renderOnlyWhenThisIsTriggered` on `<scene>` to disable the animation loop; trigger frames with `requestSingleRender()`.

## Available selectors (via EngineModule)

**Scene/object graph:** `scene`, `group`, `mesh`, `instancedMesh`, `skinnedMesh`, `points`, `particleSystem`, `sprite`, `primitive`

**Cameras/controls:** `camera`, `orthographicCamera`, `orbitControls`, `cameraHelper`, `gridHelper`, `axesHelper`, `arrowHelper`

**Geometry:** `bufferGeometry`, `bufferAttribute`, `boxGeometry`, `sphereGeometry`, `planeGeometry`, `torusKnotGeometry`, `cylinderGeometry`, `capsuleGeometry`, `icosahedronGeometry`, `heightMapGeometry`

**Materials:** `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`, `lineBasicMaterial`

**Lighting:** `ambientLight`, `directionalLight`, `pointLight`

**GLTF:** `gltf`

**CSS overlays:** `css2d`, `css3d`

**Curves:** `line`, `ellipseCurve`

**Environment:** `skyBox`, `ocean`, `sceneTree`

**Utilities:** `[raycast]`, `[autoRotate]`, `[engineSlot]`, `keyboardControls`, `renderTarget`

Direct import only (not in EngineModule): `CanvasTargetComponent`, `EngineUiComponent`, `SceneSaverComponent`, `CurveComponent`

## GLTF and textures

Declarative GLTF:

```html
<gltf
  [gltfPath]="'assets/models/model.glb'"
  [cachePath]="'scene-main'"
  [enableBVH]="true"
  [castShadow]="true"
  [receiveShadow]="true"
/>
```

Texture on material:

```html
<meshStandardMaterial [map]="'assets/textures/albedo.jpg'" />
```

Programmatic loading via `LoaderService`:

- `loadAndCacheGltf(path, cachePath?, force?)`
- `loadAndCacheTexture(path)`

## Interaction

### Raycast

Attach `[raycast]` to any Object3D host (`mesh`, `group`, etc.):

- `rayClick`, `rayClickOutside`, `rayGroupClick`
- `rayMouseEnter`, `rayMouseLeave`

Use `raycastGroup` to resolve nearest hit across grouped targets.

### Camera switching

- `camera` and `orthographicCamera` support `isActive` and `switchCameraTrigger`.
- `orbitControls` owns an internal camera and switches when active.

## EngineService reference

- Scene/renderer/camera ownership
- Tick streams: `tick$`, `postTick$`, `elapsedTime$`, `setFPSLimit`, `setSpeedFactor`
- Input streams: `keydown$`, `keyup$`, `mousedown$`, `mouseup$`, `mousemove$`, `click$`, `wheel$`
- `switchCamera(camera)`, `requestSingleRender()`

## Physics backends

- **Rapier**: See [rapier.md](rapier.md) for setup, components, and collider reference.
- **Jolt**: See [jolt.md](jolt.md) for setup, initialization, and shape reference.

## Common failure modes

| Error | Fix |
| --- | --- |
| Draco 404 | Add Draco assets glob to `angular.json` (see Asset setup) |
| Engine asset 404 (`/triangular-engine/...`) | Add engine assets glob to `angular.json` (see Asset setup) |
| Physics imports from wrong entrypoint | Import from `triangular-engine/rapier` or `/jolt`, not `triangular-engine` |
| `NullInjectorError: PhysicsService` | Provide `PhysicsService` explicitly -- see [rapier.md](rapier.md) |
| Jolt `Vec3` undefined at runtime | Add `provideJoltPhysicsInitializer()` at bootstrap -- see [jolt.md](jolt.md) |
| Injector issues with linked packages | Set `preserveSymlinks: true` in build options and add tsconfig path mapping |

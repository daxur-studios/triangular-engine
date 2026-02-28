---
name: triangular-engine
description: Angular-first 3D engine powered by Three.js. Use this skill when creating, modifying, or debugging 3D scenes, physics simulations, GLTF loading, post-processing effects, or any code that uses the `triangular-engine` library.
---

# Triangular Engine Skill

This skill provides comprehensive guidance for working with the `triangular-engine` Angular library — an Angular-first 3D engine powered by Three.js with optional Rapier/Jolt physics.

**Use this skill whenever:**

- Creating or modifying 3D scenes in Angular
- Adding meshes, lights, cameras, materials, or geometry
- Setting up physics (Rapier or Jolt)
- Configuring post-processing effects
- Loading GLTF models or textures
- Debugging engine-related issues

---

## 1. Installation & Setup

### Install Dependencies

```bash
npm i triangular-engine three three-mesh-bvh dexie
```

Optional physics:

```bash
# Rapier (recommended)
npm i @dimforge/rapier3d-compat

# OR Jolt
npm i jolt-physics
```

### Peer Dependencies (must be in your app)

| Package           | Version    |
| ----------------- | ---------- |
| `@angular/common` | `^20.3.3`  |
| `@angular/core`   | `^20.3.3`  |
| `three`           | `^0.181.0` |
| `dexie`           | `^4.2.1`   |

### Configure `angular.json` Assets

Add the following to your project's `angular.json` → `architect.build.options.assets`:

```json
{
  "glob": "**/*",
  "input": "node_modules/triangular-engine/assets",
  "output": "triangular-engine"
}
```

For DRACO-compressed GLTF models, also add:

```json
{
  "glob": "**/*",
  "input": "node_modules/three/examples/jsm/libs/draco/",
  "output": "draco/"
}
```

### Local Development with `npm link`

When working with a locally-built version of the library:

```bash
# In the triangular-engine workspace
npm run link

# In your app
npm link triangular-engine
```

**Critical:** You MUST set `"preserveSymlinks": true` in your app's `angular.json` → `architect.build.options` to avoid `NullInjectorError` issues (e.g. `_HighContrastModeDetector` token failures).

Also add to your app's `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "triangular-engine": ["node_modules/triangular-engine"]
    }
  }
}
```

---

## 2. Core Pattern: Providing the Engine

Every component that hosts a `<scene>` **MUST** provide `EngineService`. Use the static helper:

```typescript
import { Component } from "@angular/core";
import { EngineModule, EngineService } from "triangular-engine";

@Component({
  selector: "app-my-scene",
  imports: [EngineModule],
  providers: EngineService.provide({ showFPS: true }),
  template: `
    <scene>
      <!-- 3D content here -->
    </scene>
  `,
})
export class MySceneComponent {}
```

### Engine Options

```typescript
EngineService.provide({
  showFPS: true, // Show FPS counter
  transparent: true, // Transparent canvas background
  preferredRenderer: "webgl", // 'webgl' | 'webgpu'
});
```

### Rules

- **One `<scene>` per component/viewport.** Do NOT nest multiple `<scene>` elements.
- Always import `EngineModule` — it re-exports all engine components.
- Provide `EngineService` at the component level, NOT at the root/module level.

---

## 3. Component Selectors Reference

All components are standalone. Import `EngineModule` for convenience.

### Core Nodes

| Selector      | Description                                      |
| ------------- | ------------------------------------------------ |
| `scene`       | Scene host — contains the canvas and render loop |
| `group`       | Logical container (Three.js `Group`)             |
| `mesh`        | Renderable mesh                                  |
| `points`      | Point cloud                                      |
| `sprite`      | Screen-aligned sprite                            |
| `primitive`   | Low-level Three.js object wrapper                |
| `gridHelper`  | Grid visualization                               |
| `arrowHelper` | Arrow visualization                              |

### Camera & Controls

| Selector        | Key Inputs                                                 |
| --------------- | ---------------------------------------------------------- |
| `camera`        | `position`, `lookAt`, `isActive`, `far`                    |
| `orbitControls` | `target`, `cameraPosition`, `isActive`, `follow`, `moveBy` |

### Geometry

| Selector          | Params                                                 |
| ----------------- | ------------------------------------------------------ |
| `boxGeometry`     | `[params]="[width, height, depth]"`                    |
| `sphereGeometry`  | `[params]="{ radius, widthSegments, heightSegments }"` |
| `planeGeometry`   | `[params]="[width, height]"`                           |
| `capsuleGeometry` | —                                                      |
| `bufferGeometry`  | Custom geometry with `bufferAttribute` children        |

### Materials

| Selector               | Key Inputs                                                             |
| ---------------------- | ---------------------------------------------------------------------- |
| `meshStandardMaterial` | `params` (color, emissive, roughness, metalness), `map` (texture path) |
| `meshNormalMaterial`   | —                                                                      |
| `meshBasicMaterial`    | `params`                                                               |
| `shaderMaterial`       | Custom GLSL shaders                                                    |
| `rawShaderMaterial`    | Custom raw GLSL shaders                                                |
| `pointsMaterial`       | For use with `<points>`                                                |
| `spriteMaterial`       | For use with `<sprite>`                                                |

### Lights

| Selector           | Key Inputs                                     |
| ------------------ | ---------------------------------------------- |
| `ambientLight`     | `intensity`, `color`                           |
| `directionalLight` | `position`, `castShadow`, `color`, `intensity` |
| `pointLight`       | `position`, `color`, `intensity`               |

### Post-Processing (WebGL only)

| Selector          | Key Inputs                        |
| ----------------- | --------------------------------- |
| `effect-composer` | Wraps pass components             |
| `unrealBloomPass` | `strength`, `radius`, `threshold` |
| `glitchPass`      | `goWild`                          |
| `smaaPass`        | —                                 |
| `outputPass`      | — (should be last)                |
| `shaderPass`      | Custom shader pass                |

### GLTF

| Selector | Key Inputs                           |
| -------- | ------------------------------------ |
| `gltf`   | `gltfPath`, `enableBVH`, `cachePath` |

### CSS Renderers

| Selector | Description                                  |
| -------- | -------------------------------------------- |
| `css2d`  | Overlay HTML in 3D (screen-aligned)          |
| `css3d`  | Overlay HTML in 3D (perspective-transformed) |

### Physics (Rapier)

| Selector             | Key Inputs                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `physics`            | `gravity`, `debug`, `paused`                                                                                         |
| `rigidBody`          | `rigidBodyType` (0=Dynamic, 1=Fixed, 2=KinematicPosition, 3=KinematicVelocity), `position`, `velocity`, `mass`, `id` |
| `cuboidCollider`     | `halfExtents`                                                                                                        |
| `ballCollider`       | `radius`                                                                                                             |
| `capsuleCollider`    | —                                                                                                                    |
| `cylinderCollider`   | —                                                                                                                    |
| `coneCollider`       | —                                                                                                                    |
| `fixedJoint`         | `anchor1`, `frame1`, `anchor2`, `frame2`                                                                             |
| `sphericalJoint`     | `anchor1`, `anchor2`                                                                                                 |
| `springJoint`        | `anchor1`, `anchor2`, `axis`, `stiffness`, `damping`, `target`                                                       |
| `instancedRigidBody` | `maxCount`                                                                                                           |

### Physics (Jolt)

| Selector              | Key Inputs                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `jolt-physics`        | `gravity`, `debug`                                                                        |
| `jolt-rigid-body`     | `motionType` (0=Static, 1=Kinematic, 2=Dynamic), `position`, `rotation`, `velocity`, `id` |
| `jolt-box-shape`      | `params` `[w, h, d]`                                                                      |
| `jolt-sphere-shape`   | `params` `[radius]`                                                                       |
| `jolt-capsule-shape`  | `params` `[halfHeight, radius]`                                                           |
| `jolt-cylinder-shape` | `params` `[halfHeight, radius]`                                                           |
| `jolt-hull-shape`     | Convex hull from points                                                                   |
| `jolt-mesh-shape`     | Triangle mesh (static only)                                                               |

### Features & UI

| Selector             | Description                  |
| -------------------- | ---------------------------- |
| `skyBox`             | Sky environment              |
| `ocean`              | Ocean surface                |
| `performanceMonitor` | FPS/performance overlay      |
| `sceneTree`          | Scene hierarchy viewer       |
| `engine-ui`          | UI shell with slots          |
| `engine-stats`       | Stats overlay                |
| `[engineSlot]`       | Slot directive for engine UI |
| `[raycast]`          | Raycast directive            |

---

## 4. Common Object3D Inputs

All 3D node components extend `Object3DComponent` and accept:

| Input           | Type                  | Description                  |
| --------------- | --------------------- | ---------------------------- |
| `position`      | `[x, y, z]`           | World/local position         |
| `rotation`      | `[x, y, z]`           | Euler rotation (radians)     |
| `scale`         | `number \| [x, y, z]` | Uniform or per-axis scale    |
| `name`          | `string`              | Name for the Three.js object |
| `castShadow`    | `boolean`             | Whether to cast shadows      |
| `receiveShadow` | `boolean`             | Whether to receive shadows   |

---

## 5. Services

### EngineService

Core rendering and control service. Inject it in components that host `<scene>`.

```typescript
private readonly engineService = inject(EngineService);
```

**Key APIs:**

- `scene` — The Three.js `Scene` instance
- `renderer` — The `WebGLRenderer` or `WebGPURenderer`
- `camera$` — `BehaviorSubject<Camera>` for the active camera
- `tick$` — `BehaviorSubject<number>` emitting delta time each frame
- `elapsedTime$` — `BehaviorSubject<number>` total elapsed time
- `switchCamera(camera)` — Switch active camera
- `requestSingleRender()` — Trigger a single render frame
- `setFPSLimit(fps)` — Limit rendering FPS
- `composer` — `EffectComposer | undefined` for post-processing
- Input streams: `keydown$`, `keyup$`, `mousemove$`, `mouseup$`, `mousedown$`, `click$`, `wheel$`, `contextmenu$`

### PhysicsService

Rapier physics world management.

- `world$`, `beforeStep$`, `stepped$`
- `getRigidBodyById(id)` — Look up a rigid body by its string ID
- `setSimulatePhysics(paused)` — Pause/resume physics
- `setDebugState(debug)` — Toggle debug visualization

### LoaderService

Asset loading with caching.

- `loadAndCacheGltf(path, cachePath?, force?)` — Load and cache GLTF
- `loadAndCacheTexture(path)` — Load and cache texture
- Sets Draco decoder path to `/draco/`

---

## 6. Code Examples

### Minimal Scene

```typescript
@Component({
  selector: "app-demo",
  imports: [EngineModule],
  providers: EngineService.provide({ showFPS: true }),
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
})
export class DemoComponent {}
```

### Mesh with Material

```html
<mesh [position]="[0, 1, 0]" [castShadow]="true">
  <boxGeometry [params]="[1, 1, 1]" />
  <meshStandardMaterial [params]="{ color: '#88c' }" />
</mesh>
```

### Texture Loading

```html
<meshStandardMaterial [map]="'assets/textures/wood.jpg'" />
```

### GLTF Model

```html
<gltf [gltfPath]="'assets/models/scene.glb'" [enableBVH]="true" />
```

### Post-Processing

```html
<scene>
  <camera [position]="[0, 0, 6]" [lookAt]="[0, 0, 0]" />
  <!-- scene content -->

  <effect-composer>
    <unrealBloomPass [strength]="1.2" [radius]="0.4" [threshold]="0.85" />
    <glitchPass [goWild]="false" />
    <smaaPass />
    <outputPass />
  </effect-composer>
</scene>
```

> **Note:** `outputPass` should always be the **last** pass. Post-processing requires `preferredRenderer: 'webgl'`.

### Physics Scene (Rapier)

```html
<scene>
  <camera [position]="[4, 3, 6]" [lookAt]="[0, 0, 0]" />
  <directionalLight [position]="[3, 5, 2]" />

  <physics [gravity]="[0, -9.81, 0]" [debug]="false">
    <!-- Ground (Fixed) -->
    <rigidBody [rigidBodyType]="1">
      <cuboidCollider [halfExtents]="[50, 0.5, 50]" />
      <mesh [position]="[0, -0.5, 0]">
        <boxGeometry [params]="[100, 1, 100]" />
        <meshStandardMaterial [params]="{ color: '#666' }" />
      </mesh>
    </rigidBody>

    <!-- Falling Ball (Dynamic) -->
    <rigidBody [rigidBodyType]="0" [position]="[0, 4, 0]">
      <ballCollider [radius]="0.5" />
      <mesh>
        <sphereGeometry [params]="{ radius: 0.5, widthSegments: 32, heightSegments: 16 }" />
        <meshNormalMaterial />
      </mesh>
    </rigidBody>
  </physics>
</scene>
```

### Animation via Tick

```typescript
export class AnimatedSceneComponent implements OnInit {
  private readonly engineService = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rotation = signal<[number, number, number]>([0, 0, 0]);

  ngOnInit(): void {
    this.engineService.elapsedTime$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const t = this.engineService.elapsedTime$.value;
      this.rotation.set([t * 0.3, t * 0.5, 0]);
    });
  }
}
```

### Orbit Controls

```html
<scene>
  <orbitControls [cameraPosition]="[0, 5, 10]" [target]="[0, 0, 0]" [isActive]="true" />
  <!-- scene content -->
</scene>
```

---

## 7. Troubleshooting

### `NullInjectorError: No provider for _EngineService`

**Cause:** Missing `EngineService.provide(...)` in the component hosting `<scene>`.

**Fix:** Add `providers: EngineService.provide({ ... })` to your `@Component`.

### Injection errors when using `npm link` (e.g. `_HighContrastModeDetector`)

**Cause:** Symlink resolution creates duplicate Angular instances.

**Fix:**

1. Set `"preserveSymlinks": true` in `angular.json` → build options
2. Add `"paths": { "triangular-engine": ["node_modules/triangular-engine"] }` to `tsconfig.json`

### Post-processing not working

**Cause:** Post-processing (`EffectComposer`) requires WebGL renderer.

**Fix:** Ensure `preferredRenderer: 'webgl'` in your engine options (this is the default).

### GLTF Draco decode failure

**Cause:** Draco decoder files not served.

**Fix:** Add the Draco asset glob to `angular.json` (see Setup section above).

---

## 8. Performance Tips

- Use `instancedRigidBody` or `InstancedMesh` for many similar objects
- Enable `enableBVH` on GLTF for faster raycasting on complex meshes
- Use `setFPSLimit()` to cap frame rate when full 60fps isn't needed
- Use `renderOnlyWhenThisIsTriggered` on `<scene>` for on-demand rendering (e.g., configurators)
- Prefer `meshBasicMaterial` for unlit objects — cheaper than `meshStandardMaterial`

---

## 9. Architecture Notes

- All engine components are **standalone** Angular components/directives
- The object graph uses Angular DI: children auto-attach to their parent `Object3DComponent`
- `EngineModule` is a convenience NgModule that re-exports all engine components
- `EngineService` is provided per-component (NOT singleton) — each `<scene>` gets its own engine instance
- Physics runs on the engine tick — `PhysicsService.update()` is called each frame
- Camera switching is handled via `EngineService.switchCamera()` or the `isActive` / `switchCameraTrigger` inputs on camera/orbit components

# Core Concepts

## EngineModule and Standalone Components

Import `EngineModule` in any standalone Angular component to gain access to engine components (scene, mesh, geometry, materials, lights, physics, gltf, etc.). Most engine pieces are standalone components/directives with `selector`s (see API Selectors).

## EngineService and Options

Provide `EngineService` per scene component or page. Configure via `provideEngineOptions`.

```ts
providers: [EngineService, provideEngineOptions({ showFPS: true, transparent: false })];
```

`EngineService` manages:

- Scene, renderer, composer (post-processing)
- Render loop (`tick$`, `elapsedTime$`, `setFPSLimit`)
- Input streams (`keydown$`, `mousemove$`, etc.)
- Camera switching (`switchCamera`)

## SceneComponent

`<scene>` hosts the canvas, attaches the Three renderer, wires resize, key bindings, and optional one-shot render with `renderOnlyWhenThisIsTriggered`.

Inputs:

- `keyBindings`: array of key bindings
- `userInterface`: UI layout options
- `renderOnlyWhenThisIsTriggered`: boolean | number | string to pause the loop and render on demand

## Object3DComponent Hierarchy

All 3D nodes extend `Object3DComponent` and expose Signals/Models:

- `position: [x,y,z]`, `rotation: [x,y,z]`, `scale: number | [x,y,z]`
- `name: string`

Children auto-attach to parent via dependency injection (`provideObject3DComponent`).

## Mesh, Geometry, Material Linking

- `<mesh>` holds `geometry` and `material` signals.
- Geometry components: `<boxGeometry>`, `<sphereGeometry>`, `<planeGeometry>`, `<bufferGeometry>`.
- Material components: `<meshStandardMaterial>`, `<meshNormalMaterial>`, `<shaderMaterial>`, `<rawShaderMaterial>`, `<meshBasicMaterial>`, `<pointsMaterial>`.
- Linking of geometry/material to parent is handled automatically.

## Cameras and Controls

- `<camera>`: perspective camera with `isActive`, `lookAt`, `far`, and `switchCameraTrigger` for switching.
- `<orbitControls>`: creates its own internal camera and can take over rendering when active (`switchCameraTrigger`). Supports `target`, `cameraPosition`, `moveBy`, `follow`, `upVector`.

## Features and UI

- Engine UI (`engine-ui`) provides slots and optional stats and scene tree.
- Environment features like `<skyBox>` and `<ocean>` are available in features modules.

## Frame-synchronous movement and camera follow

Angular template bindings and direct Three.js mutations are different update
paths. A signal change such as `[position]="renderPosition()"` first updates
the Angular component input; the component's effect then writes that value to
its `Object3D`. Code running in a physics or engine tick must not assume that
the Object3D already contains a position signal written earlier in that tick.

Do not mix a direct `object3D.position` mutation for one object with a
template-bound position for another object that must remain visually locked to
it. The direct object can reach the current Three.js frame while the bound
object is still showing the previous Angular frame, which appears as jitter.
Use one synchronized transform path for the whole visual assembly.

Ordinary `<orbitControls [follow]="object3D">` tracking works when the followed
Object3D is current by `postTick$`. Physics, time-warp, and floating-origin apps
often already know the authoritative local render position before Angular has
committed it. Those apps should push that same position in the simulation step:

```html
<orbitControls
  #controls
  [follow]="vessel.object3D()"
/>

<app-flight-controller
  (rebase)="controls.onFloatingOriginRebase($event)"
  (renderPosition)="controls.updateFollowPosition($event)"
/>

<group #vessel [position]="vesselPosition()">
  <!-- vessel visuals -->
</group>
```

Apply a rebase first, then push the authoritative position computed in the new
local frame. A push suppresses automatic Object3D readback for that frame, so a
still-stale template transform cannot undo the camera update. If pushes stop,
normal Object3D-based follow resumes on the next frame.

## Portal Layout (Dynamic UI Overlay System)

`triangular-engine` uses `@daxur-studios/portal-layout` for its UI stacking system. `EngineModule` exports the underlying `portalTarget` directive and `portalOutlet` component, so consumer templates use their library-native selector names.

### How to use:

In any child component or page that lives inside the engine context, register templates using `<ng-template portalTarget="area">`. They are rendered in the matching `<engine-ui>` outlet and cleaned up on destroy.

```html
<!-- Inside a consumer component -->
<ng-template portalTarget="toolbarTop" lane="content" [order]="1">
  <button (click)="doSomething()">My HUD Action</button>
</ng-template>

<ng-template portalTarget="leftSidebar" lane="content">
  <div class="my-sidebar-list">
    <h3>Configuration</h3>
  </div>
</ng-template>
```

- **Engine UI areas**: `'toolbarTop' | 'toolbarBottom' | 'leftSidebar' | 'rightSidebar' | 'main' | 'overlay' | 'modal' | 'notification'`
- **Sidebar/toolbar lanes**: use `'content'`; the overlay outlet additionally supports `'topStart' | 'topEnd' | 'topCenter' | 'center' | 'bottomStart' | 'bottomEnd' | 'bottomCenter'`
- **Order**: numerical sorting priority within the lane.

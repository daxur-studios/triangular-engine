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

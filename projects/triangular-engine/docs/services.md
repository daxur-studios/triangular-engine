# Services

## EngineService

Core rendering/control service.

Key properties:

- `scene`, `renderer`, optional `composer`/`renderPass`
- `camera$`, `switchCamera(camera)`
- `tick$`, `elapsedTime$`, `speedFactor$`
- `requestSingleRender()`, `startAnimationLoop()`, `stopLoop()`
- `setFPSLimit(fps)`
- Input streams: `keydown$`, `mousemove$`, `mouseup$`, `mousewheel$`, `contextmenu$`

Provide per component where you host `<scene>`:

```ts
providers: [EngineService, provideEngineOptions({ showFPS: true })];
```

## PhysicsService

- Creates and steps Rapier `World`
- `beforeStep$`, `stepped$`
- `setSimulatePhysics(paused)`, `setDebugState(debug)`
- `meshToBodyMap`, `getRigidBodyById(id)`
- Debug mesh management

## LoaderService

- `loadAndCacheGltf(path, cachePath?, force?)`
- `loadAndCacheTexture(path)`
- Sets Draco path `/draco/` and uses GLTF DRACO loader
- Adds `userData.objectMap` using `buildGraph` for node lookup

## EngineSettingsService

- `settingsForm` with `debug`/`autoSave` etc.
- Methods: `setDebugMode(debug)`

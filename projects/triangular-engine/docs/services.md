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

## ScreenshotService

High-quality screenshot capture and progressive anti-aliased rendering.

Key features:
- Instant frame snapshots: `capture(options)`
- Direct file download: `captureAndDownload(options)` / `download(blob, fileName)`
- System clipboard copy: `copyToClipboard(blob)`
- Progressive sub-pixel accumulation (SSAA) across $N$ frames with `samples: 16`
- Offscreen resolution scaling: `multiplier: 2` or `resolution: { width, height }`
- Automatic CSS2D / CSS3D DOM overlay marker hiding (`hideOverlays: true`)
- Custom preparation and quality elevation hooks (`prepare: () => ...`)
- Optional Web Worker image compression via the `triangular-engine/image-compression` adapter (`compress: { maxSizeMB: 2, quality: 0.85 }`). Core screenshot capture does not require `browser-image-compression`; when compression is requested without an adapter, it returns the uncompressed capture with a warning.

To enable the built-in adapter, install `browser-image-compression` and provide it in the application injector:

```ts
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';

providers: [provideBrowserImageCompression()]
```

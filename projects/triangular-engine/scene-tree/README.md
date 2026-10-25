# triangular-engine/scene-tree


The core package does not require Angular Material. To use its inspection panel:

```bash
npm install @angular/material@^20.2.14
```

Import `provideSceneTree` from `triangular-engine/scene-tree` and add it beside the engine provider on the component owning the scene:

```ts
import { EngineModule, EngineService } from 'triangular-engine';
import { provideSceneTree } from 'triangular-engine/scene-tree';

// In @Component:
// imports: [EngineModule],
// providers: [EngineService.provide({ showFPS: true }), provideSceneTree()],
```

Enable visibility with `<scene [userInterface]="{ showSceneTree: true }">...</scene>`. Without the provider, core UI has no inspection panel. For direct `<sceneTree />` use, import `SceneTreeComponent` from the same optional entry point. `EngineSceneTreeModule` imports/exports the component and provides the adapter; `EngineFeaturesModule` is its compatibility alias at this subpath.

Migration: `SceneTreeComponent` and `EngineFeaturesModule` are no longer root exports or included in `EngineModule`. Existing callers must opt into `triangular-engine/scene-tree`.

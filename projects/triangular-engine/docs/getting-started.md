# Getting Started

This page shows how to add Triangular Engine to an Angular app and render your first 3D scene. The [entry-point index](entry-points.md) lists every secondary entry and its guide.

## Compatibility

| Dependency      | Version  | Notes                                                          |
| --------------- | -------- | -------------------------------------------------------------- |
| Angular         | ^20.3.3  | Required - Angular 20.x, at least 20.3.3                       |
| Three.js        | ^0.186.0 | Required                                                       |
| Dexie           | ^4.2.1   | Required                                                       |
| Angular CDK     | ^20.2.14 | Required by Portal Layout                                      |
| Angular Forms   | ^20.3.3  | Required by engine settings                                     |
| Portal Layout   | ^0.0.1   | Required                                                       |
| three-mesh-bvh  | ^0.9.9   | Required                                                       |
| RxJS            | ^7.8.0   | Required                                                       |
| Angular Material | ^20.2.14 | Optional - Scene Tree inspection (`triangular-engine/scene-tree`) |
| Rapier 3D       | ^0.18.0  | Optional - for physics support                                 |
| Jolt Physics    | ^1.0.1   | Optional - use the Jolt capability's browser setup               |
| @pmndrs/vanilla | ^1.24.0  | Optional - Billboard and Sparkles (`triangular-engine/pmndrs`) |

## Install

For a standalone Angular app with a single application project and `src/app/app.routes.ts`, install and add a starter scene with:

```bash
ng add triangular-engine
```

The schematic installs the engine, creates `src/app/triangular-engine/engine-scene.component.*`, and adds a lazy `/triangular-engine` route. It configures packaged textures under `/triangular-engine/` and Three.js Draco decoders under `/draco/`. In a workspace with multiple app projects, select one with `--project <name>`. Use `--route=false` to generate the scene without editing routes.

Physics is off by default. Use `ng add triangular-engine --physics=jolt` to install the optional Jolt peer and configure its Node-only imports as external for an Angular application/esbuild browser build. This configures the backend; import `triangular-engine/jolt` and initialize it through its route guard or app initializer when adding a physics scene. The sample remains a core scene.

Choose the generated location and route with `ng add triangular-engine --path=pages/game --route-path=game`. Component paths are relative to the application's `src/app`; routes are inserted before a wildcard fallback, and collisions with another component are reported. These paths are configurable examples. In a game scaffold, routed pages compose reusable components and domain features; `features/` holds game-specific systems.

Generate additional standalone scene pages without rerunning package setup:

```bash
ng generate triangular-engine:scene-page pages/world
```

This creates `world.component.ts`, `.html`, and `.scss` under the selected application's `src/app`, with a camera, lights, sample mesh, `EngineService` provider, and `flex-page` host class. Route generation is opt-in: add `--route --route-path=world` to register a lazy route. Use `--project <name>` in a multi-application workspace. The generator does not install packages or select a physics backend; `ng add triangular-engine` handles initial package and asset setup.

The generated SCSS only makes the scene host relative for overlay positioning; it adds no viewport or scene sizing rules. Canvas sizing depends on the application's existing flex chain and global `.flex-page` utility, which routed scene hosts receive from the generated component. Keep the engine `SceneComponent` flex styles intact.

`@daxur-studios/portal-layout` is a required peer dependency and is available from the public npm registry as version `0.0.1`.

Manual installation remains available:

```bash
npm i triangular-engine @daxur-studios/portal-layout @angular/cdk @angular/forms three three-mesh-bvh dexie rxjs
```

(optionally add @dimforge/rapier3d-compat OR jolt-physics for physics, or @pmndrs/vanilla for billboard/sparkles)

### Required Peer Dependencies

These are the core package's required peers (see `package.json` for exact versions):

```json
{
  "@angular/cdk": "^20.2.14",
  "@angular/common": "^20.3.3",
  "@angular/core": "^20.3.3",
  "@angular/forms": "^20.3.3",
  "@daxur-studios/portal-layout": "^0.0.1",
  "three": "^0.186.0",
  "three-mesh-bvh": "^0.9.9",
  "dexie": "^4.2.1",
  "rxjs": "^7.8.0"
}
```

Optional integrations are installed only when used:

| Import | Additional peers |
| --- | --- |
| `triangular-engine/scene-tree` | `@angular/material` |
| `triangular-engine/jolt` | `jolt-physics` |
| `triangular-engine/rapier` | `@dimforge/rapier3d-compat` |
| `triangular-engine/pmndrs` | `@pmndrs/vanilla` |
| `triangular-engine/postprocessing` | `postprocessing` |
| `triangular-engine/meshoptimizer` | `meshoptimizer` |
| `triangular-engine/image-compression` | `browser-image-compression` |

`browser-image-compression` is only needed when using
`triangular-engine/image-compression`. Core engine consumers do not need to
install it.

See [../pmndrs/README.md](../pmndrs/README.md) for Billboard and Sparkles usage.

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

Wrap the whole scene in wireframe mode for geometry debugging:

```html
<scene [wireframe]="true">
  <!-- scene content -->
</scene>
```

When enabled, every mesh and line renders with a wireframe material; original
materials are restored when set back to `false`. Objects added to the scene
while wireframe is enabled are picked up automatically. Points and sprites are
skipped because they require their own material types.

`[wireframeMode]` picks the coloring when enabled:

- `'uniform'` (default): every object gets the same shared green material.
- `'name-hash'`: each object gets a deterministic color hashed from its `name`
  (or `uuid`), with one cached wireframe material per color — automatically
  distinct objects with zero per-scene setup.


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

## Add Physics

```html
<physics [gravity]="[0,-9.81,0]">
  <rigidBody [rigidBodyType]="0" [position]="[0,4,0]">
    <cuboidCollider [halfExtents]="[1,1,1]" />
    <mesh>
      <boxGeometry [params]="[2,2,2]" />
      <meshNormalMaterial />
    </mesh>
  </rigidBody>
</physics>
```

- rigidBodyType: 0 Dynamic, 1 Fixed, 2 KinematicPositionBased, 3 KinematicVelocityBased

## Next Steps

- [Core concepts](core-concepts.md)
- [Components](components.md)
- [Services](services.md)
- [Assets and loading](assets-and-loading.md)
- [Secondary entry points](entry-points.md) and their guides, indexed from the [package README](../README.md)

# Getting Started

This page shows how to add Triangular Engine to an Angular app and render your first 3D scene.

## Install

```bash
npm i triangular-engine three three-mesh-bvh dexie
```

Optional (physics): `@dimforge/rapier3d-compat` or `jolt-physics`

Peer versions (see package README for latest): Angular ^20.3.3, Three ^0.181, Dexie ^4.2.1.

## Configure Draco

Add the Draco decoder to your angular.json assets:

```json
{
  "glob": "**/*",
  "input": "node_modules/three/examples/jsm/libs/draco/",
  "output": "draco/"
}
```

## Minimal Scene

Provide the engine in a component and render a scene:

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

- Core Concepts: ./core-concepts.md
- Components: ./components.md
- Physics: ./physics.md
- Services: ./services.md

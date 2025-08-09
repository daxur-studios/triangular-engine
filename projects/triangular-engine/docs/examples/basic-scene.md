# Example: Basic Scene with Physics

```ts
import { Component } from "@angular/core";
import { EngineModule, EngineService, provideEngineOptions } from "triangular-engine";

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
  providers: [EngineService, provideEngineOptions({ showFPS: true })],
})
export class BasicComponent {}
```

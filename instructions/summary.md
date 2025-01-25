[back to Readme](../README.md)

**Triangular Engine** is a library that allows you to build 3D experiences in the browser using **Three.js** and **Angular**. It simplifies working with Three.js by providing a declarative Angular-based approach to creating and managing 3D scenes.

### Key Features:

1. **Declarative Syntax**:

   - You can create 3D objects, lights, cameras, and animations using Angular templates, making it more intuitive for Angular developers.
   - Example: `<mesh>` elements represent 3D objects like boxes or spheres.

2. **Reactivity**:

   - Angular's data binding and services can be used to dynamically update and interact with the 3D scene.

3. **Integration with Three.js**:

   - It fully integrates with Three.js, letting you access and extend any underlying Three.js functionality.

4. **Component-Based**:

   - You can encapsulate 3D logic into reusable components, just like Angular components for UI.

5. **Extensibility**:
   - Compatible with Three.js plugins and extensions, making it flexible for advanced use cases like physics and post-processing.

### Use Cases:

- Interactive 3D visualizations
- Games and simulations
- Virtual reality (VR) and augmented reality (AR) experiences
- Data visualization

### Example:

A simple 3D spinning box in Triangular Engine:

```typescript
import { Component, ElementRef, OnInit, ViewChild } from "@angular/core";
import { Canvas, Object3DComponent, provideObject3DComponent, TriangularEngineModule } from "triangular-engine";

@Component({
  selector: "app-box",
  template: `
    <mesh (click)="onClick()">
      <boxGeometry [args]="[1, 1, 1]"></boxGeometry>
      <meshStandardMaterial [color]="'orange'"></meshStandardMaterial>
    </mesh>
  `,
  providers: [provideObject3DComponent(BoxComponent)],
  standalone: true,
  imports: [TriangularEngineModule],
})
export class BoxComponent extends Object3DComponent implements OnInit {
  ngOnInit() {}

  onClick() {
    console.log("Clicked!");
  }
}
```

```typescript
import { EngineModule, EngineService, provideEngineOptions } from "triangular-engine";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterModule, EngineModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.scss",
  providers: [
    EngineService,
    provideEngineOptions({
      showFPS: true,
    }),
  ],
  host: {
    class: "flex-page",
  },
})
export class AppComponent {
  readonly engineService = inject(EngineService);
}
```

Triangular Engine bridges the gap between Angular's declarative nature and the powerful 3D rendering capabilities of Three.js, making it a great choice for Angular developers interested in 3D graphics.

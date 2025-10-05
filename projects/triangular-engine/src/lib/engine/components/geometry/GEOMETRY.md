[Back](../COMPONENTS.md)

# Geometry Components

## Overview

Angular components serving as a wrapper for Three.js geometries.

Can be placed in a `<mesh>` component to serve as the geometry of the mesh.

## How to add a new geometry component

1. Create a new file in the `src/app/engine/components/geometry` directory with the name of the new geometry type.
2. May extend BufferGeometryComponent to inherit the basic functionality.

```typescript
@Component({
  selector: "bufferGeometry",
})
export class BufferGeometryComponent implements OnDestroy {
  readonly params = input<any>();

  readonly geometry: WritableSignal<BufferGeometry> = signal(new BufferGeometry());
  previousGeometry: BufferGeometry | undefined;

  constructor() {
    effect(() => {
      if (this.params()) this.updateParameters(this.params());
    });
  }

  /**
   * Create a new geometry instance with the given parameters when the parameters change.
   */
  createGeometry(parameters: any): BufferGeometry;

  private updateParameters(parameters: any) {
    if (this.previousGeometry) {
      this.previousGeometry.dispose();
    }

    const geometry = this.createGeometry(parameters);
    this.geometry.set(geometry);

    this.previousGeometry = geometry;
  }

  ngOnDestroy(): void {
    this.geometry()?.dispose();
  }
}
```

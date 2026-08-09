import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineModule, EngineService } from 'triangular-engine';
import { DecimalPipe } from '@angular/common';
import { JoltPhysicsModule, JoltSoftBodyComponent } from 'triangular-engine/jolt';

function createSphereMesh(): {
  readonly vertices: ReadonlyArray<readonly [number, number, number]>;
  readonly faces: ReadonlyArray<readonly [number, number, number]>;
} {
  const segments = 20;
  const rings = 10;
  const vertices: Array<readonly [number, number, number]> = [];
  const faces: Array<readonly [number, number, number]> = [];
  const radius = 1.8;
  const vertexIndex = (ring: number, segment: number): number => {
    if (ring === 0) return 0;
    if (ring === rings - 1) return 1;
    return 2 + (ring - 1) * segments + (segment % segments);
  };
  vertices.push([0, radius, 0], [0, -radius, 0]);
  for (let ring = 1; ring < rings - 1; ring++) {
    const phi = (Math.PI * ring) / (rings - 1);
    for (let segment = 0; segment < segments; segment++) {
      const theta = (2 * Math.PI * segment) / segments;
      vertices.push([
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius,
        Math.sin(phi) * Math.sin(theta) * radius,
      ]);
    }
  }
  for (let segment = 0; segment < segments; segment++) {
    for (let ring = 0; ring < rings - 2; ring++) {
      faces.push(
        [vertexIndex(ring, segment), vertexIndex(ring + 1, segment), vertexIndex(ring + 1, segment + 1)],
      );
      if (ring > 0) {
        faces.push([
          vertexIndex(ring + 1, segment + 1),
          vertexIndex(ring, segment + 1),
          vertexIndex(ring, segment),
        ]);
      }
    }
    faces.push([vertexIndex(rings - 2, segment + 1), vertexIndex(rings - 2, segment), vertexIndex(rings - 1, 0)]);
  }
  return { vertices, faces };
}

const SOFT_SPHERE = createSphereMesh();

function createCubeMesh(): {
  readonly vertices: ReadonlyArray<readonly [number, number, number]>;
  readonly faces: ReadonlyArray<readonly [number, number, number]>;
} {
  const divisions = 4;
  const vertices: Array<readonly [number, number, number]> = [];
  const faces: Array<readonly [number, number, number]> = [];
  const vertexIds = new Map<string, number>();
  const vertex = (point: readonly [number, number, number]): number => {
    const key = point.join(',');
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.push(point) - 1;
    vertexIds.set(key, id);
    return id;
  };
  const coordinate = (value: number) => -1.8 + (3.6 * value) / divisions;
  const addFace = (axis: 0 | 1 | 2, side: -1 | 1): void => {
    const point = (u: number, v: number): readonly [number, number, number] => {
      const a = coordinate(u);
      const b = coordinate(v);
      if (axis === 0) return [coordinate(side === 1 ? divisions : 0), a, b];
      if (axis === 1) return [a, coordinate(side === 1 ? divisions : 0), b];
      return [a, b, coordinate(side === 1 ? divisions : 0)];
    };
    for (let v = 0; v < divisions; v++) {
      for (let u = 0; u < divisions; u++) {
        const a = vertex(point(u, v));
        const b = vertex(point(u + 1, v));
        const c = vertex(point(u + 1, v + 1));
        const d = vertex(point(u, v + 1));
        faces.push([a, c, b], [a, d, c]);
      }
    }
  };
  addFace(0, -1); addFace(0, 1); addFace(1, -1); addFace(1, 1); addFace(2, -1); addFace(2, 1);
  return { vertices, faces };
}

const SOFT_CUBE = createCubeMesh();

const CLOTH = (() => {
  const width = 12;
  const height = 12;
  const vertices: Array<readonly [number, number, number]> = [];
  const faces: Array<readonly [number, number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) vertices.push([(x - 5.5) * 0.45, 0, (y - 5.5) * 0.45]);
  }
  const index = (x: number, y: number) => x + y * width;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      faces.push([index(x, y), index(x, y + 1), index(x + 1, y + 1)], [index(x, y), index(x + 1, y + 1), index(x + 1, y)]);
    }
  }
  return { vertices, faces };
})();

type SoftBodyShape = 'sphere' | 'cube' | 'cloth';

/** Small research page for validating the public declarative Jolt soft-body API. */
@Component({
  selector: 'app-soft-body-poc-page',
  imports: [DecimalPipe, RouterLink, EngineModule, JoltPhysicsModule, JoltSoftBodyComponent],
  templateUrl: './soft-body-poc-page.component.html',
  styleUrl: './soft-body-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SoftBodyPocPageComponent {
  readonly vertices = SOFT_SPHERE.vertices;
  readonly faces = SOFT_SPHERE.faces;
  readonly softBodyColor = 0x4fd6a8;
  readonly shape = signal<SoftBodyShape>('sphere');
  readonly solverIterations = signal(5);
  readonly linearDamping = signal(0.1);
  readonly edgeCompliance = signal(0.0001);
  readonly shearCompliance = signal(0.0001);
  readonly bendCompliance = signal(0.001);
  readonly gravity = signal(-9.81);
  readonly pressure = signal(0);
  readonly showBody = signal(true);

  setShape(value: string): void { this.shape.set(value as SoftBodyShape); this.reset(); }
  setNumber(target: 'solverIterations' | 'linearDamping' | 'edgeCompliance' | 'shearCompliance' | 'bendCompliance' | 'gravity' | 'pressure', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this[target].set(value);
    this.reset();
  }
  reset(): void {
    this.showBody.set(false);
    window.setTimeout(() => this.showBody.set(true), 0);
  }

  get activeMesh() {
    return this.shape() === 'cloth' ? CLOTH : this.shape() === 'cube' ? SOFT_CUBE : SOFT_SPHERE;
  }
}

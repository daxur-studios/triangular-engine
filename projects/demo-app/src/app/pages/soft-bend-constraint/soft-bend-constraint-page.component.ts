import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule, JoltSoftBodyComponent, JoltSoftBodyBendType } from 'triangular-engine/jolt';

type MeshData = { readonly vertices: ReadonlyArray<readonly [number, number, number]>; readonly faces: ReadonlyArray<readonly [number, number, number]> };

function xorshift32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0xffffffff;
  };
}

function clothMesh(): MeshData & { readonly pinnedVertices: number[] } {
  const n = 10, spacing = 0.5;
  const vertices: Array<readonly [number, number, number]> = [], faces: Array<readonly [number, number, number]> = [];
  const random = xorshift32(1234);
  const randomFloat = () => 0.2 * random() - 0.1;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    vertices.push([(x - 4.5) * spacing + randomFloat(), z & 1 ? 0.1 : -0.1, (z - 4.5) * spacing + randomFloat()]);
  }
  const index = (x: number, z: number) => x + z * n;
  for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
    const a = index(x, z), b = index(x + 1, z), c = index(x + 1, z + 1), d = index(x, z + 1);
    faces.push([a, d, c], [a, c, b]);
  }
  return { vertices, faces, pinnedVertices: Array.from({ length: n * 2 }, (_, i) => i) };
}

function sphereMesh(): MeshData {
  const segments = 20, rings = 10, radius = 1;
  const vertices: Array<readonly [number, number, number]> = [[0, radius, 0], [0, -radius, 0]];
  const faces: Array<readonly [number, number, number]> = [];
  const index = (ring: number, segment: number) => ring === 0 ? 0 : ring === rings - 1 ? 1 : 2 + (ring - 1) * segments + segment % segments;
  for (let ring = 1; ring < rings - 1; ring++) for (let segment = 0; segment < segments; segment++) {
    const phi = Math.PI * ring / (rings - 1), theta = 2 * Math.PI * segment / segments;
    vertices.push([Math.sin(phi) * Math.cos(theta) * radius, Math.cos(phi) * radius, Math.sin(phi) * Math.sin(theta) * radius]);
  }
  for (let segment = 0; segment < segments; segment++) for (let ring = 0; ring < rings - 2; ring++) {
    faces.push([index(ring, segment), index(ring + 1, segment), index(ring + 1, segment + 1)]);
    if (ring > 0) faces.push([index(ring + 1, segment + 1), index(ring, segment + 1), index(ring, segment)]);
  }
  return { vertices, faces };
}

const CLOTH = clothMesh();
const SPHERE = sphereMesh();

@Component({
  selector: 'app-soft-bend-constraint-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule, JoltSoftBodyComponent],
  templateUrl: './soft-bend-constraint-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SoftBendConstraintPageComponent {
  readonly cloth = CLOTH;
  readonly sphere = SPHERE;
  readonly bends: ReadonlyArray<JoltSoftBodyBendType> = ['none', 'distance', 'dihedral'];
  readonly colors: Record<JoltSoftBodyBendType, number> = { none: 0xaa0000, distance: 0x00aa00, dihedral: 0x0000aa };
}

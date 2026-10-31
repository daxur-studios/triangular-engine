import { Vector3 } from 'three';

export type SoftMeshVertex = readonly [number, number, number];
export type SoftMeshFace = readonly [number, number, number];

export interface SoftBodyMesh {
  readonly vertices: ReadonlyArray<SoftMeshVertex>;
  readonly faces: ReadonlyArray<SoftMeshFace>;
}

export interface RestEdge {
  readonly a: number;
  readonly b: number;
  readonly length: number;
}

export interface MeshRestShape {
  /** Unique undirected edges of the rest mesh, used for the shape-retention metric. */
  readonly edges: ReadonlyArray<RestEdge>;
  /** Signed mesh volume at rest (absolute, m^3); meaningful only for a closed mesh. */
  readonly volume: number;
}

/** Builds the rest-shape reference once per generated mesh. */
export function meshRestShape(vertices: ReadonlyArray<SoftMeshVertex>, faces: ReadonlyArray<SoftMeshFace>): MeshRestShape {
  const seen = new Set<string>();
  const edges: RestEdge[] = [];
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    const [ax, ay, az] = vertices[a];
    const [bx, by, bz] = vertices[b];
    edges.push({ a, b, length: Math.hypot(bx - ax, by - ay, bz - az) });
  };
  for (const [a, b, c] of faces) {
    add(a, b); add(b, c); add(c, a);
  }
  return { edges, volume: Math.abs(meshVolume(vertices, faces)) };
}

export function meshVolume(vertices: ReadonlyArray<ReadonlyArray<number>>, faces: ReadonlyArray<SoftMeshFace>): number {
  let sum = 0;
  for (const [a, b, c] of faces) {
    const [ax, ay, az] = vertices[a];
    const [bx, by, bz] = vertices[b];
    const [cx, cy, cz] = vertices[c];
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

/**
 * The 40 x 40 cloth from Jolt.js `soft/soft_body.html` (spacing 0.5 m, corners pinned).
 * Vertex order and triangulation are the ones its inline script builds.
 */
export function createClothMesh(gridSize = 40, spacing = 0.5): SoftBodyMesh & {
  readonly cornerVertexIndices: ReadonlyArray<number>;
} {
  const offset = -0.5 * spacing * (gridSize - 1);
  const vertices: SoftMeshVertex[] = [];
  for (let z = 0; z < gridSize; z++) {
    for (let x = 0; x < gridSize; x++) {
      vertices.push([offset + x * spacing, 0, offset + z * spacing]);
    }
  }
  const index = (x: number, z: number) => x + z * gridSize;
  const faces: SoftMeshFace[] = [];
  for (let z = 0; z < gridSize - 1; z++) {
    for (let x = 0; x < gridSize - 1; x++) {
      const a = index(x, z);
      faces.push([a, index(x, z + 1), index(x + 1, z + 1)]);
      faces.push([a, index(x + 1, z + 1), index(x + 1, z)]);
    }
  }
  const last = gridSize - 1;
  return {
    vertices,
    faces,
    cornerVertexIndices: [index(0, 0), index(last, 0), index(0, last), index(last, last)],
  };
}

/**
 * Port of Jolt.js `SoftBodyCreator.CreateSphere` (polar coordinates, uneven triangles on
 * purpose so the pressure solver is exercised). Defaults are the ones
 * `soft/soft_sphere_pressure.html` uses with a radius of 2 m.
 */
export function createSoftSphereMesh(radius = 1, numTheta = 10, numPhi = 20): SoftBodyMesh {
  const vertices: SoftMeshVertex[] = [];
  const point = new Vector3();
  const push = (phi: number, theta: number) => {
    point.setFromSphericalCoords(radius, phi, theta);
    vertices.push([point.x, point.y, point.z]);
  };
  push(0, 0);
  push(Math.PI, 0);
  for (let theta = 1; theta < numTheta - 1; theta++) {
    for (let phi = 0; phi < numPhi; phi++) {
      push((Math.PI * theta) / (numTheta - 1), (2 * Math.PI * phi) / numPhi);
    }
  }
  const index = (theta: number, phi: number): number => {
    if (theta === 0) return 0;
    if (theta === numTheta - 1) return 1;
    return 2 + (theta - 1) * numPhi + (phi % numPhi);
  };
  const faces: SoftMeshFace[] = [];
  for (let phi = 0; phi < numPhi; phi++) {
    for (let theta = 0; theta < numTheta - 2; theta++) {
      faces.push([index(theta, phi), index(theta + 1, phi), index(theta + 1, phi + 1)]);
      if (theta > 0) faces.push([index(theta, phi), index(theta + 1, phi + 1), index(theta, phi + 1)]);
    }
    faces.push([index(numTheta - 2, phi + 1), index(numTheta - 2, phi), index(numTheta - 1, 0)]);
  }
  return { vertices, faces };
}

/** xorshift32, so a test run drops the same ten spheres as the previous run. */
export function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0xffffffff;
  };
}

/** The ten 100 kg spheres `soft_body.html` drops on the cloth, with a repeatable seed. */
export function clothDropSpheres(seed: number, count = 10, radius = 0.75): ReadonlyArray<{
  readonly position: [number, number, number];
  readonly radius: number;
  readonly massKg: number;
}> {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, (_, index) => ({
    position: [2 * random(), 15 + 2 * radius * index, 2 * random()] as [number, number, number],
    radius,
    massKg: 100,
  }));
}


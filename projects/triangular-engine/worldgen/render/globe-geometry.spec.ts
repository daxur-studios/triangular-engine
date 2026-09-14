import { IPlanetSurfaceSampler, IVec3, cross, dot, normalize, sub } from 'triangular-engine/worldgen';
import {
  buildPlanetGlobeGeometry,
  IPlanetGlobeGeometry,
  writePlanetGlobeNormals,
  writePlanetGlobePositions,
} from './globe-geometry';

/**
 * Deterministic, framework-free fake surface — the adapter only depends on the sampler contract,
 * so these tests stay fast and isolate geometry/topology from world generation.
 */
const sampler: IPlanetSurfaceSampler = {
  sample(direction: IVec3) {
    const unit = normalize(direction);
    const elevation = 0.2 * unit.y + 0.05 * Math.cos(2 * unit.x) - 0.03 * unit.z;
    return {
      baseElevation: elevation,
      ridgeRelief: 0,
      riverCarve: 0,
      elevation,
      seaLevel: 0.02,
      isLand: elevation >= 0.02,
    };
  },
};

function directionAt(latitude: number, longitude: number): IVec3 {
  const cosLatitude = Math.cos(latitude);
  return normalize({
    x: cosLatitude * Math.cos(longitude),
    y: Math.sin(latitude),
    z: cosLatitude * Math.sin(longitude),
  });
}

function vertexAt(values: Float32Array, index: number): IVec3 {
  const o = index * 3;
  return { x: values[o], y: values[o + 1], z: values[o + 2] };
}

function expectRuntimeEqual(actual: Float32Array | Uint8Array | Int32Array | Uint32Array, expected: Float32Array | Uint8Array | Int32Array | Uint32Array): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

function nonDegenerateTriangles(geometry: IPlanetGlobeGeometry): number {
  let count = 0;
  for (let t = 0; t < geometry.indices.length; t += 3) {
    const a = vertexAt(geometry.positions, geometry.indices[t]);
    const b = vertexAt(geometry.positions, geometry.indices[t + 1]);
    const c = vertexAt(geometry.positions, geometry.indices[t + 2]);
    const faceNormal = cross(sub(b, a), sub(c, a));
    if (Math.hypot(faceNormal.x, faceNormal.y, faceNormal.z) > 1e-12) count++;
  }
  return count;
}

function undirectedEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function edgeUseCounts(geometry: IPlanetGlobeGeometry): Map<string, number> {
  const counts = new Map<string, number>();
  for (let t = 0; t < geometry.indices.length; t += 3) {
    const a = geometry.indices[t];
    const b = geometry.indices[t + 1];
    const c = geometry.indices[t + 2];
    for (const key of [undirectedEdgeKey(a, b), undirectedEdgeKey(b, c), undirectedEdgeKey(c, a)]) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

describe('buildPlanetGlobeGeometry', () => {
  it('is deterministic for identical generation inputs', () => {
    const first = buildPlanetGlobeGeometry({ sampler, longitudeSegments: 12, latitudeRings: 5 });
    const second = buildPlanetGlobeGeometry({ sampler, longitudeSegments: 12, latitudeRings: 5 });

    expect(first.vertexCount).toBe(second.vertexCount);
    expect(first.triangleCount).toBe(second.triangleCount);
    expectRuntimeEqual(first.positions, second.positions);
    expectRuntimeEqual(first.normals, second.normals);
    expectRuntimeEqual(first.directions, second.directions);
    expectRuntimeEqual(first.elevations, second.elevations);
    expectRuntimeEqual(first.landMask, second.landMask);
    expectRuntimeEqual(first.cellIds, second.cellIds);
    expectRuntimeEqual(first.indices, second.indices);
  });

  it('shares one antimeridian column so +PI and -PI sample the same value', () => {
    const segments = 8;
    const rings = 4;
    const geometry = buildPlanetGlobeGeometry({
      sampler,
      longitudeSegments: segments,
      latitudeRings: rings,
    });

    // A per-column seam would add one extra column; this is the shared-column count.
    expect(geometry.vertexCount).toBe(2 + (rings - 1) * segments);

    for (let ring = 1; ring <= rings - 1; ring++) {
      const latitude = Math.PI / 2 - (ring * Math.PI) / rings;
      const seamIndex = 1 + (ring - 1) * segments;
      const seamDirection = vertexAt(geometry.directions, seamIndex);
      const negative = directionAt(latitude, -Math.PI);
      const positive = directionAt(latitude, +Math.PI);

      // Directions/elevations are stored as Float32, so compare at Float32 precision.
      expect(seamDirection.x).toBeCloseTo(negative.x, 5);
      expect(seamDirection.y).toBeCloseTo(negative.y, 5);
      expect(seamDirection.z).toBeCloseTo(negative.z, 5);
      expect(seamDirection.x).toBeCloseTo(positive.x, 5);
      expect(seamDirection.y).toBeCloseTo(positive.y, 5);
      expect(seamDirection.z).toBeCloseTo(positive.z, 5);

      const sampledNegative = sampler.sample(negative).elevation;
      const sampledPositive = sampler.sample(positive).elevation;
      expect(geometry.elevations[seamIndex]).toBeCloseTo(sampledNegative, 5);
      expect(geometry.elevations[seamIndex]).toBeCloseTo(sampledPositive, 5);
    }
  });

  it('puts one finite, radial vertex at each pole with no degenerate triangles', () => {
    const radius = 1;
    const heightScale = 0.1;
    const geometry = buildPlanetGlobeGeometry({
      sampler,
      radius,
      heightScale,
      longitudeSegments: 10,
      latitudeRings: 4,
    });

    const north = vertexAt(geometry.directions, 0);
    const south = vertexAt(geometry.directions, geometry.vertexCount - 1);
    expect(north.x).toBeCloseTo(0, 12);
    expect(north.y).toBeCloseTo(1, 12);
    expect(north.z).toBeCloseTo(0, 12);
    expect(south.x).toBeCloseTo(0, 12);
    expect(south.y).toBeCloseTo(-1, 12);
    expect(south.z).toBeCloseTo(0, 12);

    const northLength = Math.hypot(geometry.positions[0], geometry.positions[1], geometry.positions[2]);
    expect(northLength).toBeCloseTo(radius + geometry.elevations[0] * heightScale, 6);
    const southOffset = (geometry.vertexCount - 1) * 3;
    const southLength = Math.hypot(
      geometry.positions[southOffset],
      geometry.positions[southOffset + 1],
      geometry.positions[southOffset + 2],
    );
    expect(southLength).toBeCloseTo(radius + geometry.elevations[geometry.vertexCount - 1] * heightScale, 6);

    expect(nonDegenerateTriangles(geometry)).toBe(geometry.triangleCount);

    for (let i = 0; i < geometry.vertexCount; i++) {
      const o = i * 3;
      expect(Number.isFinite(geometry.positions[o])).toBeTrue();
      expect(Number.isFinite(geometry.positions[o + 1])).toBeTrue();
      expect(Number.isFinite(geometry.positions[o + 2])).toBeTrue();
      expect(Number.isFinite(geometry.normals[o])).toBeTrue();
      expect(Number.isFinite(geometry.normals[o + 1])).toBeTrue();
      expect(Number.isFinite(geometry.normals[o + 2])).toBeTrue();
    }
  });

  it('allocates and uses the complete closed sphere index buffer', () => {
    const segments = 10;
    const rings = 4;
    const geometry = buildPlanetGlobeGeometry({ sampler, longitudeSegments: segments, latitudeRings: rings });

    expect(geometry.triangleCount).toBe(2 * segments * (rings - 1));
    expect(geometry.indices.length).toBe(geometry.triangleCount * 3);

    const referenced = new Set<number>(Array.from(geometry.indices));
    expect(referenced.size).toBe(geometry.vertexCount);

    const edges = edgeUseCounts(geometry);
    expect(edges.size).toBe(geometry.indices.length / 2);
    for (const uses of edges.values()) expect(uses).toBe(2);
  });

  it('winds every triangle outward and derives outward vertex normals', () => {
    const geometry = buildPlanetGlobeGeometry({
      sampler,
      heightScale: 0.08,
      longitudeSegments: 9,
      latitudeRings: 5,
    });

    for (let t = 0; t < geometry.indices.length; t += 3) {
      const a = vertexAt(geometry.positions, geometry.indices[t]);
      const b = vertexAt(geometry.positions, geometry.indices[t + 1]);
      const c = vertexAt(geometry.positions, geometry.indices[t + 2]);
      const faceNormal = cross(sub(b, a), sub(c, a));
      const centroid = {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
      };
      expect(dot(faceNormal, centroid)).toBeGreaterThan(0);
    }

    for (let i = 0; i < geometry.vertexCount; i++) {
      const normal = vertexAt(geometry.normals, i);
      const direction = vertexAt(geometry.directions, i);
      expect(dot(normal, direction)).toBeGreaterThan(0.25);
    }
  });

  it('evaluates an optional cell-id lookup once per vertex', () => {
    let calls = 0;
    const geometry = buildPlanetGlobeGeometry({
      sampler,
      longitudeSegments: 6,
      latitudeRings: 3,
      cellIdAt: (direction) => {
        calls++;
        return Math.floor((direction.y + 1) * 100);
      },
    });

    expect(calls).toBe(geometry.vertexCount);
    for (let i = 0; i < geometry.vertexCount; i++) {
      expect(geometry.cellIds[i]).toBe(Math.floor((geometry.directions[i * 3 + 1] + 1) * 100));
    }
  });

  it('clamps invalid resolutions and rejects invalid radius', () => {
    expect(() => buildPlanetGlobeGeometry({ sampler, radius: 0 })).toThrowError(RangeError);
    expect(() => buildPlanetGlobeGeometry({ sampler, radius: -2 })).toThrowError(RangeError);
    expect(() => buildPlanetGlobeGeometry({ sampler, heightScale: Number.NaN })).toThrowError(RangeError);

    const clamped = buildPlanetGlobeGeometry({ sampler, longitudeSegments: 2, latitudeRings: 1 });
    expect(clamped.longitudeSegments).toBe(3);
    expect(clamped.latitudeRings).toBe(2);
  });
});

describe('writePlanetGlobePositions', () => {
  it('re-displaces from directions/elevations without resampling', () => {
    const geometry = buildPlanetGlobeGeometry({ sampler, longitudeSegments: 10, latitudeRings: 4 });
    const scaledHeight = 0.5;

    writePlanetGlobePositions(geometry.positions, geometry.directions, geometry.elevations, geometry.radius, scaledHeight);

    for (let i = 0; i < geometry.vertexCount; i++) {
      const o = i * 3;
      const expectedRadius = geometry.radius + geometry.elevations[i] * scaledHeight;
      expect(geometry.positions[o]).toBeCloseTo(geometry.directions[o] * expectedRadius, 5);
      expect(geometry.positions[o + 1]).toBeCloseTo(geometry.directions[o + 1] * expectedRadius, 5);
      expect(geometry.positions[o + 2]).toBeCloseTo(geometry.directions[o + 2] * expectedRadius, 5);
    }
  });

  it('rejects mismatched array lengths', () => {
    expect(() =>
      writePlanetGlobePositions(new Float32Array(6), new Float32Array(9), new Float32Array(2), 1, 0.1),
    ).toThrowError(RangeError);
  });
});

describe('writePlanetGlobeNormals', () => {
  it('rejects out/index shape mismatches', () => {
    expect(() => writePlanetGlobeNormals(new Float32Array(3), new Float32Array(6), [0, 1, 2])).toThrowError(
      RangeError,
    );
    expect(() => writePlanetGlobeNormals(new Float32Array(6), new Float32Array(6), [0, 1])).toThrowError(
      RangeError,
    );
  });
});

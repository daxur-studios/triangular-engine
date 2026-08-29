import { buildColliderPatch, colliderPatchIndices } from './collider-patch';
import { buildPlanetGraphCore } from './planet-graph';
import { dot, sub } from './vec3';
import { sampleElevation } from './sample-elevation';
import { buildPlanetTectonics } from './tectonics';

describe('buildColliderPatch', () => {
  it('every vertex direction lands on the unit sphere', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 4 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 4 });
    const patch = buildColliderPatch(graph, tectonics.elevation, graph.cells[0].center, {
      angularHalfWidth: 0.05,
      sampleCount: 9,
    });

    for (let i = 0; i < patch.sampleCount * patch.sampleCount; i++) {
      const x = patch.directions[i * 3];
      const y = patch.directions[i * 3 + 1];
      const z = patch.directions[i * 3 + 2];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it('the center vertex (odd sampleCount) matches sampleElevation at the query center exactly', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 4 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 4 });
    const center = graph.cells[17].corners[0];
    const sampleCount = 9;
    const patch = buildColliderPatch(graph, tectonics.elevation, center, {
      angularHalfWidth: 0.03,
      sampleCount,
    });

    const mid = Math.floor(sampleCount / 2);
    const centerIdx = mid * sampleCount + mid;
    const expected = sampleElevation(graph, tectonics.elevation, center);
    expect(patch.elevations[centerIdx]).toBeCloseTo(expected, 6);

    const dx = patch.directions[centerIdx * 3] - patch.center.x;
    const dy = patch.directions[centerIdx * 3 + 1] - patch.center.y;
    const dz = patch.directions[centerIdx * 3 + 2] - patch.center.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(0, 6);
  });

  it('produces a resolution independent of cellCount — a tiny patch on a coarse graph still returns the requested sampleCount', () => {
    const graph = buildPlanetGraphCore({ cellCount: 40, seed: 2 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 4, seed: 2 });
    const patch = buildColliderPatch(graph, tectonics.elevation, graph.cells[0].center, {
      angularHalfWidth: 0.02,
      sampleCount: 33,
    });

    expect(patch.sampleCount).toBe(33);
    expect(patch.directions.length).toBe(33 * 33 * 3);
    expect(patch.elevations.length).toBe(33 * 33);
  });

  it('every vertex stays within the requested angular half-width of center (with gnomonic slack)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 4 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 4 });
    const angularHalfWidth = 0.1;
    const patch = buildColliderPatch(graph, tectonics.elevation, graph.cells[0].center, {
      angularHalfWidth,
      sampleCount: 11,
    });

    // Gnomonic projection maps a square on the tangent plane, so a corner vertex's true angular
    // distance is slightly larger than angularHalfWidth (it also picks up the diagonal offset) —
    // bound it loosely rather than asserting the exact projection formula.
    const bound = Math.acos(Math.cos(angularHalfWidth) * Math.cos(angularHalfWidth)) * 1.5;
    for (let i = 0; i < patch.sampleCount * patch.sampleCount; i++) {
      const d = { x: patch.directions[i * 3], y: patch.directions[i * 3 + 1], z: patch.directions[i * 3 + 2] };
      const angle = Math.acos(Math.min(1, Math.max(-1, dot(d, patch.center))));
      expect(angle).toBeLessThanOrEqual(bound + 1e-6);
    }
  });

  it('is deterministic for the same graph/elevation/center', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 8 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 5, seed: 8 });
    const center = graph.cells[10].center;

    const a = buildColliderPatch(graph, tectonics.elevation, center, { angularHalfWidth: 0.05, sampleCount: 13 });
    const b = buildColliderPatch(graph, tectonics.elevation, center, { angularHalfWidth: 0.05, sampleCount: 13 });

    expect(Array.from(a.elevations)).toEqual(Array.from(b.elevations));
    expect(Array.from(a.directions)).toEqual(Array.from(b.directions));
  });

  it('throws for a degenerate sampleCount or angularHalfWidth', () => {
    const graph = buildPlanetGraphCore({ cellCount: 60, seed: 1 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 4, seed: 1 });
    const center = graph.cells[0].center;

    expect(() => buildColliderPatch(graph, tectonics.elevation, center, { angularHalfWidth: 0.05, sampleCount: 1 })).toThrow();
    expect(() => buildColliderPatch(graph, tectonics.elevation, center, { angularHalfWidth: 0 })).toThrow();
    expect(() => buildColliderPatch(graph, tectonics.elevation, center, { angularHalfWidth: Math.PI })).toThrow();
  });
});

describe('colliderPatchIndices', () => {
  it('returns 2 triangles per grid quad, all indices in bounds', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 6 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 5, seed: 6 });
    const sampleCount = 9;
    const patch = buildColliderPatch(graph, tectonics.elevation, graph.cells[0].center, {
      angularHalfWidth: 0.04,
      sampleCount,
    });
    const indices = colliderPatchIndices(patch);

    const quadsPerSide = sampleCount - 1;
    expect(indices.length).toBe(quadsPerSide * quadsPerSide * 6);
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(sampleCount * sampleCount);
    }
  });

  it('every triangle winds outward (face normal points away from the planet center)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 6 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 5, seed: 6 });
    const sampleCount = 9;
    const patch = buildColliderPatch(graph, tectonics.elevation, graph.cells[0].center, {
      angularHalfWidth: 0.04,
      sampleCount,
    });
    const indices = colliderPatchIndices(patch);

    const posAt = (i: number) => ({
      x: patch.directions[i * 3],
      y: patch.directions[i * 3 + 1],
      z: patch.directions[i * 3 + 2],
    });

    for (let t = 0; t < indices.length; t += 3) {
      const a = posAt(indices[t]);
      const b = posAt(indices[t + 1]);
      const c = posAt(indices[t + 2]);
      const ab = sub(b, a);
      const ac = sub(c, a);
      const faceNormal = {
        x: ab.y * ac.z - ab.z * ac.y,
        y: ab.z * ac.x - ab.x * ac.z,
        z: ab.x * ac.y - ab.y * ac.x,
      };
      expect(dot(faceNormal, patch.center)).toBeGreaterThan(0);
    }
  });
});

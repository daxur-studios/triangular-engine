import { BufferAttribute, Vector3 } from 'three';
import { IPlanetSurfaceSampler, IVec3 } from 'triangular-engine/worldgen';
import {
  buildOceanMorphGeometry,
  buildPlanetMorphGeometry,
  evaluateSurfaceTransform,
} from './planet-morph-geometry';
import { MAP_PROJECTIONS } from './map-projections';

describe('PlanetMorphGeometry', () => {
  const dummySampler: IPlanetSurfaceSampler = {
    sample: () => ({
      elevation: 0.2,
      baseElevation: 0.2,
      ridgeRelief: 0,
      riverCarve: 0,
      seaLevel: 0,
      isLand: true,
    }),
  };

  it('builds non-indexed geometry with aOtherDir1 and aOtherDir2 attributes', () => {
    const segments = 16;
    const rings = 8;
    const data = buildPlanetMorphGeometry({
      sampler: dummySampler,
      longitudeSegments: segments,
      latitudeRings: rings,
    });

    expect(data.geometry).toBeDefined();
    expect(data.geometry.index).toBeNull(); // Non-indexed

    const expectedTriangles = segments * rings * 2;
    const expectedVertices = expectedTriangles * 3;
    expect(data.triangleCount).toBe(expectedTriangles);
    expect(data.vertexCount).toBe(expectedVertices);

    const pos = data.geometry.getAttribute('position') as BufferAttribute;
    const aSpherePos = data.geometry.getAttribute('aSpherePos') as BufferAttribute;
    const aFlatPos = data.geometry.getAttribute('aFlatPos') as BufferAttribute;
    const aSphereNorm = data.geometry.getAttribute('aSphereNorm') as BufferAttribute;
    const aFlatNorm = data.geometry.getAttribute('aFlatNorm') as BufferAttribute;
    const aOtherDir1 = data.geometry.getAttribute('aOtherDir1') as BufferAttribute;
    const aOtherDir2 = data.geometry.getAttribute('aOtherDir2') as BufferAttribute;
    const color = data.geometry.getAttribute('color') as BufferAttribute;
    const uv = data.geometry.getAttribute('uv') as BufferAttribute;

    expect(pos.count).toBe(expectedVertices);
    expect(aSpherePos.count).toBe(expectedVertices);
    expect(aFlatPos.count).toBe(expectedVertices);
    expect(aSphereNorm.count).toBe(expectedVertices);
    expect(aFlatNorm.count).toBe(expectedVertices);
    expect(aOtherDir1.count).toBe(expectedVertices);
    expect(aOtherDir2.count).toBe(expectedVertices);
    expect(color.count).toBe(expectedVertices);
    expect(uv.count).toBe(expectedVertices);
  });

  it('binds cyclic triangle counterpart directions for every triangle', () => {
    const segments = 12;
    const rings = 6;
    const data = buildPlanetMorphGeometry({
      sampler: dummySampler,
      longitudeSegments: segments,
      latitudeRings: rings,
    });

    const norm = data.geometry.getAttribute('aSphereNorm') as BufferAttribute;
    const o1 = data.geometry.getAttribute('aOtherDir1') as BufferAttribute;
    const o2 = data.geometry.getAttribute('aOtherDir2') as BufferAttribute;

    for (let t = 0; t < data.triangleCount; t++) {
      const v0 = t * 3;
      const v1 = v0 + 1;
      const v2 = v0 + 2;

      const d0 = new Vector3(norm.getX(v0), norm.getY(v0), norm.getZ(v0));
      const d1 = new Vector3(norm.getX(v1), norm.getY(v1), norm.getZ(v1));
      const d2 = new Vector3(norm.getX(v2), norm.getY(v2), norm.getZ(v2));

      // v0: other1 should be d1, other2 should be d2
      expect(o1.getX(v0)).toBeCloseTo(d1.x, 5);
      expect(o1.getY(v0)).toBeCloseTo(d1.y, 5);
      expect(o1.getZ(v0)).toBeCloseTo(d1.z, 5);
      expect(o2.getX(v0)).toBeCloseTo(d2.x, 5);
      expect(o2.getY(v0)).toBeCloseTo(d2.y, 5);
      expect(o2.getZ(v0)).toBeCloseTo(d2.z, 5);

      // v1: other1 should be d2, other2 should be d0
      expect(o1.getX(v1)).toBeCloseTo(d2.x, 5);
      expect(o1.getY(v1)).toBeCloseTo(d2.y, 5);
      expect(o1.getZ(v1)).toBeCloseTo(d2.z, 5);
      expect(o2.getX(v1)).toBeCloseTo(d0.x, 5);
      expect(o2.getY(v1)).toBeCloseTo(d0.y, 5);
      expect(o2.getZ(v1)).toBeCloseTo(d0.z, 5);

      // v2: other1 should be d0, other2 should be d1
      expect(o1.getX(v2)).toBeCloseTo(d0.x, 5);
      expect(o1.getY(v2)).toBeCloseTo(d0.y, 5);
      expect(o1.getZ(v2)).toBeCloseTo(d0.z, 5);
      expect(o2.getX(v2)).toBeCloseTo(d1.x, 5);
      expect(o2.getY(v2)).toBeCloseTo(d1.y, 5);
      expect(o2.getZ(v2)).toBeCloseTo(d1.z, 5);
    }
  });

  it('mathematically identifies seam-crossing triangles under rotated dynamic tracking basis', () => {
    const segments = 16;
    const rings = 8;
    const data = buildPlanetMorphGeometry({
      sampler: dummySampler,
      longitudeSegments: segments,
      latitudeRings: rings,
    });

    const norm = data.geometry.getAttribute('aSphereNorm') as BufferAttribute;
    const o1 = data.geometry.getAttribute('aOtherDir1') as BufferAttribute;
    const o2 = data.geometry.getAttribute('aOtherDir2') as BufferAttribute;

    // Track meridian at 45 degrees East: forward = (sin(pi/4), 0, cos(pi/4)), right = (cos(pi/4), 0, -sin(pi/4))
    const angle = Math.PI / 4;
    const fwd = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const right = new Vector3(Math.cos(angle), 0, -Math.sin(angle));

    let seamTrianglesCount = 0;
    let normalTrianglesCount = 0;

    for (let t = 0; t < data.triangleCount; t++) {
      const v0 = t * 3;
      const v1 = v0 + 1;
      const v2 = v0 + 2;

      const evalCull = (idx: number) => {
        const selfDir = new Vector3(norm.getX(idx), norm.getY(idx), norm.getZ(idx));
        const o1Dir = new Vector3(o1.getX(idx), o1.getY(idx), o1.getZ(idx));
        const o2Dir = new Vector3(o2.getX(idx), o2.getY(idx), o2.getZ(idx));

        const pLon = Math.atan2(selfDir.dot(right), selfDir.dot(fwd));
        const oLon1 = Math.atan2(o1Dir.dot(right), o1Dir.dot(fwd));
        const oLon2 = Math.atan2(o2Dir.dot(right), o2Dir.dot(fwd));

        return (
          Math.abs(pLon - oLon1) > Math.PI ||
          Math.abs(pLon - oLon2) > Math.PI ||
          Math.abs(oLon1 - oLon2) > Math.PI
        );
      };

      const c0 = evalCull(v0);
      const c1 = evalCull(v1);
      const c2 = evalCull(v2);

      // All 3 vertices in a triangle MUST evaluate to the exact same cull decision
      expect(c0).toBe(c1);
      expect(c1).toBe(c2);

      if (c0) {
        seamTrianglesCount++;
      } else {
        normalTrianglesCount++;
      }
    }

    // A strip of triangles straddling the antimeridian should be detected as seam triangles
    expect(seamTrianglesCount).toBeGreaterThan(0);
    expect(normalTrianglesCount).toBeGreaterThan(0);
  });

  it('builds ocean morph geometry with matching attributes', () => {
    const ocean = buildOceanMorphGeometry(2.0, 0.15, 0, 'equalEarth', 16, 8);
    expect(ocean.geometry.index).toBeNull();
    expect(ocean.geometry.getAttribute('aOtherDir1')).toBeDefined();
    expect(ocean.geometry.getAttribute('aOtherDir2')).toBeDefined();
    expect(ocean.triangleCount).toBe(16 * 8 * 2);
  });

  it('evaluates surface transform for static and dynamic projection tracking', () => {
    const dir: IVec3 = { x: 0, y: 0, z: 1 };
    const proj = MAP_PROJECTIONS['equalEarth'];
    const transformStatic = evaluateSurfaceTransform(dir, 0.1, 2.0, 0.15, proj, 12.56, 6.28, 1.0);
    expect(transformStatic.position.z).toBeCloseTo(0.1 * 0.15, 4);

    const basis = {
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
      right: { x: 1, y: 0, z: 0 },
    };
    const transformDynamic = evaluateSurfaceTransform(dir, 0.1, 2.0, 0.15, proj, 12.56, 6.28, 1.0, basis);
    expect(transformDynamic.position.x).toBeCloseTo(transformStatic.position.x, 3);
    expect(transformDynamic.position.y).toBeCloseTo(transformStatic.position.y, 3);
  });
});

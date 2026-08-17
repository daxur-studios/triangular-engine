import type { TerrainVector3 } from 'triangular-engine/terrain';

import { computeScatterHorizonFade01, computeScatterViewConeFade01 } from './scatter-view-cull';

describe('computeScatterViewConeFade01', () => {
  const viewpoint: TerrainVector3 = [0, 0, 0];
  const forward: TerrainVector3 = [0, 0, -1];
  const coneHalfAngleRad = Math.PI / 4; // 45deg

  it('accepts a candidate straight ahead', () => {
    expect(computeScatterViewConeFade01([0, 0, -10], viewpoint, forward, coneHalfAngleRad)).toBe(1);
  });

  it('rejects a candidate directly behind', () => {
    expect(computeScatterViewConeFade01([0, 0, 10], viewpoint, forward, coneHalfAngleRad)).toBe(0);
  });

  it('produces a symmetric circle on a plane below a straight-down camera', () => {
    const down: TerrainVector3 = [0, -1, 0];
    const camera: TerrainVector3 = [0, 10, 0];
    const insideRadiusM = 10 * Math.tan(coneHalfAngleRad) * 0.5;
    const outsideRadiusM = 10 * Math.tan(coneHalfAngleRad) * 1.5;
    expect(computeScatterViewConeFade01([insideRadiusM, 0, 0], camera, down, coneHalfAngleRad)).toBe(1);
    expect(computeScatterViewConeFade01([outsideRadiusM, 0, 0], camera, down, coneHalfAngleRad)).toBe(0);
  });

  it('accepts a candidate right at the boundary angle', () => {
    const distM = 10;
    const x = distM * Math.sin(coneHalfAngleRad);
    const z = -distM * Math.cos(coneHalfAngleRad);
    expect(computeScatterViewConeFade01([x, 0, z], viewpoint, forward, coneHalfAngleRad)).toBe(1);
  });

  it('a wider objectRadiusM recovers a candidate just past the boundary', () => {
    const distM = 10;
    const pastBoundaryRad = coneHalfAngleRad + 0.05;
    const x = distM * Math.sin(pastBoundaryRad);
    const z = -distM * Math.cos(pastBoundaryRad);
    expect(computeScatterViewConeFade01([x, 0, z], viewpoint, forward, coneHalfAngleRad)).toBe(0);
    expect(computeScatterViewConeFade01([x, 0, z], viewpoint, forward, coneHalfAngleRad, 5)).toBe(1);
  });

  it('never throws on a degenerate (near-zero-distance) candidate', () => {
    expect(computeScatterViewConeFade01([0, 0, 0.0000001], viewpoint, forward, coneHalfAngleRad)).toBe(1);
  });
});

describe('computeScatterHorizonFade01', () => {
  const center: TerrainVector3 = [0, 0, 0];
  const curvatureRadiusM = 25;
  const camera: TerrainVector3 = [0, curvatureRadiusM + 4, 0]; // standing at the pole

  it('accepts a nearby candidate well within the horizon', () => {
    const nearby: TerrainVector3 = [5, curvatureRadiusM - 0.1, 0];
    expect(computeScatterHorizonFade01(nearby, camera, center, curvatureRadiusM)).toBe(1);
  });

  it('rejects a candidate on the far side, past the horizon', () => {
    const farSide: TerrainVector3 = [0, -curvatureRadiusM, 0];
    expect(computeScatterHorizonFade01(farSide, camera, center, curvatureRadiusM)).toBe(0);
  });

  it('a wider objectRadiusM recovers a candidate just past the horizon margin', () => {
    const horizonAngleRad = Math.acos(curvatureRadiusM / distanceFromCenter(camera));
    const justPastRad = horizonAngleRad + 0.12 + 0.02;
    const candidate: TerrainVector3 = [
      curvatureRadiusM * Math.sin(justPastRad),
      curvatureRadiusM * Math.cos(justPastRad),
      0,
    ];
    expect(computeScatterHorizonFade01(candidate, camera, center, curvatureRadiusM)).toBe(0);
    expect(computeScatterHorizonFade01(candidate, camera, center, curvatureRadiusM, 50)).toBe(1);
  });

  it('never throws when the camera sits at the curvature center', () => {
    expect(computeScatterHorizonFade01([1, 0, 0], center, center, curvatureRadiusM)).toBe(1);
  });
});

function distanceFromCenter(p: TerrainVector3): number {
  return Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
}

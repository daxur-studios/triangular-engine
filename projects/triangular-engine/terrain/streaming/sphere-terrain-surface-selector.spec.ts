import {
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type ISphereTerrainPatchAddress,
} from '../domains/sphere-terrain-domain';
import { createSphereTerrainSurfaceSelector } from './sphere-terrain-surface-selector';

const domain = new SphereTerrainDomain(600_000);
const roots: readonly ISphereTerrainPatchAddress[] = SPHERE_TERRAIN_FACES.map(
  (face) => ({ face, level: 0, x: 0, y: 0 }),
);

function createRequest(cameraWorldM: readonly [number, number, number]) {
  return {
    domain,
    roots,
    cameraWorldM,
    getLevel: (address: ISphereTerrainPatchAddress) => address.level,
    getKey: (address: ISphereTerrainPatchAddress) =>
      `${address.face}:${address.level}:${address.x}:${address.y}`,
    maxLevel: 8,
    refinementDistanceM: 0,
    hysteresis: 0,
    wasRefined: () => false,
  };
}

describe('createSphereTerrainSurfaceSelector', () => {
  it('returns a deterministic sphere cut through the TerrainSurface contract', () => {
    const selector = createSphereTerrainSurfaceSelector({
      radiusM: 600_000,
      minElevationM: -1_000,
      maxElevationM: 8_000,
      patchResolution: 32,
      splitErrorPx: 16,
      mergeErrorPx: 6,
      screenSpaceErrorFactorPx: 700,
    });

    const first = selector.select(createRequest([608_510, 0, 0]));
    const second = selector.select(createRequest([608_510, 0, 0]));

    expect(first.length).toBeGreaterThan(6);
    expect(second).toEqual(first);
  });

  it('clears hysteresis state when reset is called', () => {
    const selector = createSphereTerrainSurfaceSelector({
      radiusM: 600_000,
      minElevationM: -1_000,
      maxElevationM: 8_000,
      patchResolution: 32,
      splitErrorPx: 16,
      mergeErrorPx: 6,
      screenSpaceErrorFactorPx: 700,
    });

    const request = createRequest([608_510, 0, 0]);
    const cold = selector.select(request);
    selector.select(request);
    selector.reset();

    expect(selector.select(request)).toEqual(cold);
  });
});

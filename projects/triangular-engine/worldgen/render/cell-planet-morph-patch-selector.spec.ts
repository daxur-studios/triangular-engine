import { LatLonTerrainDomain, type ITerrainSurfaceSelectionRequest, type ILatLonTerrainPatchAddress } from 'triangular-engine/terrain';
import { createCellPlanetMorphSurfaceSelector } from './cell-planet-morph-patch-selector';

const RADIUS_M = 1_000;
const domain = new LatLonTerrainDomain(RADIUS_M, 4, 2);
const roots = domain.createLevelZeroRoots();

function createRequest(
  cameraWorldM: readonly [number, number, number],
  overrides: Partial<ITerrainSurfaceSelectionRequest<ILatLonTerrainPatchAddress>> = {},
): ITerrainSurfaceSelectionRequest<ILatLonTerrainPatchAddress> {
  return {
    domain,
    roots,
    cameraWorldM,
    getLevel: (address) => address.level,
    getKey: (address) => `${address.level}:${address.x}:${address.y}`,
    maxLevel: 6,
    refinementDistanceM: 0,
    hysteresis: 0,
    wasRefined: () => false,
    ...overrides,
  };
}

describe('createCellPlanetMorphSurfaceSelector', () => {
  it('returns exactly the root cut when the camera is far away', () => {
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
    });

    const result = selector.select(createRequest([0, 0, RADIUS_M * 50]));
    expect(result.length).toBe(roots.length);
  });

  it('refines toward a nearby camera up to maxLevel', () => {
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
    });

    const result = selector.select(
      createRequest([RADIUS_M * 1.05, 0, 0], { maxLevel: 3 }),
    );

    expect(result.length).toBeGreaterThan(roots.length);
    expect(Math.max(...result.map((address) => address.level))).toBeLessThanOrEqual(3);
  });

  it('is deterministic and repeatable for the same camera position', () => {
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0.3,
      projectionKind: () => 'equalEarth',
    });

    const request = createRequest([RADIUS_M * 1.2, 0, 0]);
    const first = selector.select(request);
    const second = selector.select(request);
    expect(second).toEqual(first);
  });

  it('measures relevance in the morphed (blended) position, not just the sphere', () => {
    const sphereSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
    });
    const flatSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 1,
      projectionKind: () => 'equalEarth',
    });

    // A camera positioned where the flat map's edge would be is close to the flat-map
    // projection of a root patch but far from that root's sphere position - the two morph
    // states should therefore disagree on how much to refine it.
    const farFlatCamera: readonly [number, number, number] = [
      Math.PI * RADIUS_M * 1.05,
      0,
      1,
    ];
    const sphereResult = sphereSelector.select(
      createRequest(farFlatCamera, { maxLevel: 4 }),
    );
    const flatResult = flatSelector.select(createRequest(farFlatCamera, { maxLevel: 4 }));

    expect(flatResult).not.toEqual(sphereResult);
  });

  it('clears hysteresis state when reset is called', () => {
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
    });

    const request = createRequest([RADIUS_M * 1.05, 0, 0], { maxLevel: 3 });
    const cold = selector.select(request);
    selector.select(request);
    selector.reset();

    expect(selector.select(request)).toEqual(cold);
  });
});

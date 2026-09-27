import { PerspectiveCamera } from 'three';
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

  it('restricts refinement to visible view cone and front-facing horizon when camera is supplied', () => {
    // Camera is near the planet surface at [0, 0, 1100], looking East (+X).
    // Terrain behind the camera (West, -X) should not be refined.
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(0, 0, RADIUS_M * 1.1);
    camera.lookAt(RADIUS_M, 0, RADIUS_M * 1.1);
    camera.updateMatrixWorld();

    const coneSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
    });
    const omniSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
    });

    const request = createRequest([0, 0, RADIUS_M * 1.1], { maxLevel: 4 });
    const coneResult = coneSelector.select(request);
    const omniResult = omniSelector.select(request);

    // Omni-directional selector refines in all 360-degree directions including behind the camera
    expect(omniResult.length).toBeGreaterThan(roots.length);
    // Cone selector refines significantly fewer patches by skipping terrain behind the camera
    expect(coneResult.length).toBeLessThan(omniResult.length);

    // Verify patches behind the camera (facing West, -X) remain coarse
    const behindPatches = coneResult.filter((addr) => {
      const b = domain.getPatchBounds(addr);
      const dir = domain.getFieldPosition(addr, (b.minU + b.maxU) * 0.5, (b.minV + b.maxV) * 0.5);
      return dir[0] < -0.1;
    });
    expect(behindPatches.length).toBeGreaterThan(0);
    // Patches directly behind the camera should not refine, staying at level 0 (strictly < 2)
    expect(Math.max(...behindPatches.map((p) => p.level))).toBeLessThan(2);

    // Verify patches in the look direction (East, +X) reach high refinement
    const forwardPatches = coneResult.filter((addr) => {
      const b = domain.getPatchBounds(addr);
      const dir = domain.getFieldPosition(addr, (b.minU + b.maxU) * 0.5, (b.minV + b.maxV) * 0.5);
      return dir[0] > 0.5;
    });
    expect(forwardPatches.length).toBeGreaterThan(0);
    expect(Math.max(...forwardPatches.map((p) => p.level))).toBeGreaterThanOrEqual(3);
  });

  it('allows disabling frustum culling via frustumCulling option', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 100_000);
    camera.position.set(0, 0, RADIUS_M * 2.5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const disabledSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
      frustumCulling: () => false,
    });
    const omniSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
    });

    const request = createRequest([0, 0, RADIUS_M * 2.5], { maxLevel: 3 });
    expect(disabledSelector.select(request)).toEqual(omniSelector.select(request));
  });

  it('refines visible terrain across the longitude seam', () => {
    for (const sign of [-1, 1]) {
      const result = selectVisibleTarget({
        cameraLon: sign * 179.9,
        cameraLat: 0.1,
        targetLon: -sign * 179.9,
        targetLat: 0.1,
        heightScaleM: 1_000,
      });
      expect(result.targetLevel).toBe(7);
      expect(result.count).toBeLessThanOrEqual(220);
    }
  });

  it('keeps directly visible terrain inside bounds with the default safety margin', () => {
    const result = selectVisibleTarget({
      cameraLon: 0.1,
      cameraLat: 0.1,
      targetLon: 0.1,
      targetLat: 0.1,
      far: 5_000,
      horizonCulling: false,
    });
    expect(result.targetLevel).toBe(7);
  });
});

function selectVisibleTarget(options: {
  cameraLon: number;
  cameraLat: number;
  targetLon: number;
  targetLat: number;
  heightScaleM?: number;
  far?: number;
  horizonCulling?: boolean;
}): { targetLevel: number | undefined; count: number } {
  const radius = 600_000;
  const targetDomain = new LatLonTerrainDomain(radius, 4, 2);
  const targetRoots = targetDomain.createLevelZeroRoots();
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const point = (lon: number, lat: number, distance: number) =>
    targetDomain.getFieldPosition(targetRoots[0], radians(lon), radians(lat))
      .map((coordinate) => coordinate * distance) as [number, number, number];
  const camera = new PerspectiveCamera(45, 1, 1, options.far ?? 2_000_000);
  camera.position.set(...point(options.cameraLon, options.cameraLat, radius + 100));
  camera.lookAt(...point(options.targetLon, options.targetLat, radius));
  camera.updateMatrixWorld(true);
  const selector = createCellPlanetMorphSurfaceSelector({
    domain: () => targetDomain,
    radiusM: () => radius,
    morph: () => 0,
    projectionKind: () => 'equalEarth',
    camera: () => camera,
    heightScaleM: () => options.heightScaleM ?? 0,
    horizonCulling: () => options.horizonCulling ?? true,
  });
  const selected = selector.select(createRequest(
    camera.position.toArray() as [number, number, number],
    { domain: targetDomain, roots: targetRoots, maxLevel: 7, maxPatches: 220 },
  ));
  const lon = radians(options.targetLon);
  const lat = radians(options.targetLat);
  const target = selected.find((address) => {
    const bounds = targetDomain.getPatchBounds(address);
    return lon > bounds.minU && lon < bounds.maxU &&
      lat > bounds.minV && lat < bounds.maxV;
  });
  return { targetLevel: target?.level, count: selected.length };
}

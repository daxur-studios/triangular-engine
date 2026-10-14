import { PerspectiveCamera } from 'three';
import {
  LatLonTerrainDomain,
  type ILatLonTerrainPatchAddress,
  type ITerrainPatchMesh,
  type ITerrainSurfaceSelectionRequest,
} from 'triangular-engine/terrain';
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
    // Camera is near the planet surface at [0, 0, 1100], looking East (+X) and down at the
    // ground 15 degrees away (looking level, it would only see sky above the horizon).
    // Terrain behind the camera (West, -X) should not be refined.
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(0, 0, RADIUS_M * 1.1);
    camera.lookAt(Math.sin(Math.PI / 12) * RADIUS_M, 0, Math.cos(Math.PI / 12) * RADIUS_M);
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

    // Verify patches in the look direction (East, +X, short of the horizon) reach high refinement
    const forwardPatches = coneResult.filter((addr) => {
      const b = domain.getPatchBounds(addr);
      const dir = domain.getFieldPosition(addr, (b.minU + b.maxU) * 0.5, (b.minV + b.maxV) * 0.5);
      return dir[0] > 0.1 && dir[2] > 0.9;
    });
    expect(forwardPatches.length).toBeGreaterThan(0);
    expect(Math.max(...forwardPatches.map((p) => p.level))).toBeGreaterThanOrEqual(3);
  });

  it('hides meshed patches behind the camera or the horizon from drawing', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(0, 0, RADIUS_M * 1.1);
    // Looking east and down at the ground 15 degrees away.
    const target = [Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)];
    camera.lookAt(target[0] * RADIUS_M, 0, target[2] * RADIUS_M);
    camera.updateMatrixWorld();
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
    });
    selector.select(createRequest([0, 0, RADIUS_M * 1.1], { maxLevel: 3 }));

    const isDrawn = (address: ILatLonTerrainPatchAddress) =>
      selector.patchVisibility.isVisible(
        address,
        selector.patchVisibility.measure(address, meshPatch(address)),
      );
    const level = 3;
    const count = 2 ** level;
    const centreDirection = (address: ILatLonTerrainPatchAddress) => {
      const b = domain.getPatchBounds(address);
      return domain.getFieldPosition(address, (b.minU + b.maxU) / 2, (b.minV + b.maxV) / 2);
    };
    const patches: ILatLonTerrainPatchAddress[] = [];
    for (let x = 0; x < 4 * count; x++) {
      for (let y = 0; y < 2 * count; y++) patches.push({ level, x, y });
    }
    // Around the point the camera looks at: drawn.
    const ahead = patches.filter((address) => {
      const [dx, dy, dz] = centreDirection(address);
      return dx * target[0] + dy * target[1] + dz * target[2] > 0.99;
    });
    expect(ahead.length).toBeGreaterThan(0);
    expect(ahead.every(isDrawn)).toBeTrue();
    // The far side of the planet, behind the horizon: hidden.
    const farSide = patches.filter((address) => centreDirection(address)[2] < -0.5);
    expect(farSide.length).toBeGreaterThan(0);
    expect(farSide.some(isDrawn)).toBeFalse();
    // Behind the camera, still on the near side: outside the view.
    const behind = patches.filter((address) => {
      const [dx, , dz] = centreDirection(address);
      return dx < -0.4 && dz > 0.6;
    });
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.some(isDrawn)).toBeFalse();
  });

  it('estimates a patch is hidden before it is meshed when it is behind the camera or the horizon', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(0, 0, RADIUS_M * 1.1);
    const target = [Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)];
    camera.lookAt(target[0] * RADIUS_M, 0, target[2] * RADIUS_M);
    camera.updateMatrixWorld();
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
    });
    selector.select(createRequest([0, 0, RADIUS_M * 1.1], { maxLevel: 3 }));
    const estimate = selector.patchVisibility.estimate!;

    const level = 3;
    const count = 2 ** level;
    const centreDirection = (address: ILatLonTerrainPatchAddress) => {
      const b = domain.getPatchBounds(address);
      return domain.getFieldPosition(address, (b.minU + b.maxU) / 2, (b.minV + b.maxV) / 2);
    };
    const patches: ILatLonTerrainPatchAddress[] = [];
    for (let x = 0; x < 4 * count; x++) {
      for (let y = 0; y < 2 * count; y++) patches.push({ level, x, y });
    }
    const ahead = patches.filter((address) => {
      const [dx, dy, dz] = centreDirection(address);
      return dx * target[0] + dy * target[1] + dz * target[2] > 0.99;
    });
    expect(ahead.length).toBeGreaterThan(0);
    expect(ahead.every(estimate)).toBeTrue();
    const farSide = patches.filter((address) => centreDirection(address)[2] < -0.5);
    expect(farSide.length).toBeGreaterThan(0);
    expect(farSide.some(estimate)).toBeFalse();
    const behind = patches.filter((address) => {
      const [dx, , dz] = centreDirection(address);
      return dx < -0.4 && dz > 0.6;
    });
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.some(estimate)).toBeFalse();

    // Never stricter than the draw test on the mesh that follows.
    for (const address of patches) {
      const drawn = selector.patchVisibility.isVisible(
        address,
        selector.patchVisibility.measure(address, meshPatch(address)),
      );
      expect(!drawn || estimate(address)).toBeTrue();
    }
    // Coarser patches that cover the view are estimated visible too.
    expect(roots.some(estimate)).toBeTrue();
  });

  it('estimates every patch may be visible when frustum culling is off', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(0, 0, RADIUS_M * 1.1);
    camera.lookAt(RADIUS_M, 0, RADIUS_M * 1.1);
    camera.updateMatrixWorld();
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
      frustumCulling: () => false,
    });
    selector.select(createRequest([0, 0, RADIUS_M * 1.1], { maxLevel: 3 }));
    for (const root of roots) expect(selector.patchVisibility.estimate!(root)).toBeTrue();
  });

  it('draws every patch when frustum culling is off', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(0, 0, RADIUS_M * 1.1);
    camera.lookAt(RADIUS_M, 0, RADIUS_M * 1.1);
    camera.updateMatrixWorld();
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
      frustumCulling: () => false,
    });
    selector.select(createRequest([0, 0, RADIUS_M * 1.1], { maxLevel: 3 }));
    for (const root of roots) {
      const bounds = selector.patchVisibility.measure(root, meshPatch(root));
      expect(selector.patchVisibility.isVisible(root, bounds)).toBeTrue();
    }
  });

  it('splits visible patches forceRefine asks for, past maxLevel and outside maxPatches', () => {
    const target = roots[0];
    const insideTarget = (address: ILatLonTerrainPatchAddress) => {
      const bounds = domain.getPatchBounds(address);
      const outer = domain.getPatchBounds(target);
      return bounds.minU >= outer.minU && bounds.maxU <= outer.maxU &&
        bounds.minV >= outer.minV && bounds.maxV <= outer.maxV;
    };
    const selector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      forceRefine: (address) => insideTarget(address) && address.level < 3,
    });

    const result = selector.select(
      createRequest([0, 0, RADIUS_M * 50], { maxLevel: 1, maxPatches: roots.length }),
    );

    expect(result.filter(insideTarget).every((address) => address.level === 3)).toBeTrue();
    expect(result.filter(insideTarget).length).toBe(64);
    expect(result.length).toBe(roots.length - 1 + 64);
  });

  it('runs the frustum test from bodyCenterSceneM when the planet is off the scene origin', () => {
    const offset: [number, number, number] = [5_000_000, -2_000_000, 300_000];
    const camera = new PerspectiveCamera(45, 1, 1, 10_000);
    camera.position.set(offset[0], offset[1], offset[2] + RADIUS_M * 1.1);
    camera.lookAt(offset[0] + RADIUS_M, offset[1], offset[2] + RADIUS_M * 1.1);
    camera.updateMatrixWorld();
    const centred = new PerspectiveCamera(45, 1, 1, 10_000);
    centred.position.set(0, 0, RADIUS_M * 1.1);
    centred.lookAt(RADIUS_M, 0, RADIUS_M * 1.1);
    centred.updateMatrixWorld();

    const offsetSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => camera,
      bodyCenterSceneM: () => offset,
    });
    const centredSelector = createCellPlanetMorphSurfaceSelector({
      domain: () => domain,
      radiusM: () => RADIUS_M,
      morph: () => 0,
      projectionKind: () => 'equalEarth',
      camera: () => centred,
    });

    const request = createRequest([0, 0, RADIUS_M * 1.1], { maxLevel: 4 });
    expect(offsetSelector.select(request)).toEqual(centredSelector.select(request));
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

/** A sea-level globe mesh of the patch with the morph mesher's `aSpherePos` attribute. */
function meshPatch(address: ILatLonTerrainPatchAddress): ITerrainPatchMesh<ILatLonTerrainPatchAddress> {
  const bounds = domain.getPatchBounds(address);
  const steps = 4;
  const sphere: number[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const direction = domain.getFieldPosition(
        address,
        bounds.minU + (bounds.maxU - bounds.minU) * i / steps,
        bounds.minV + (bounds.maxV - bounds.minV) * j / steps,
      );
      sphere.push(direction[0] * RADIUS_M, direction[1] * RADIUS_M, direction[2] * RADIUS_M);
    }
  }
  const positions = new Float32Array(sphere);
  return {
    address,
    resolution: steps,
    centerWorldM: [0, 0, 0],
    geometricErrorM: 0,
    surface: {
      positions,
      normals: new Float32Array(positions.length),
      uvs: new Float32Array((positions.length / 3) * 2),
      indices: new Uint32Array(0),
      attributes: { aSpherePos: positions },
    },
  };
}

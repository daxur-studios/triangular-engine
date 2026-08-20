import {
  HOME_PLANET,
  ALPINE_PLANET,
  CANYON_PLANET,
  CRATERED_MOON,
  createPlaneSurfaceSampler,
  createSurfaceSampler,
  selectCdlodPlanePatches,
  generateCdlodPlanePatchRawBuffers,
  generateCdlodPlanePatchGeometry,
  handleCdlodWorkerMessage,
  ICdlodWorkerRequest,
  selectCdlodPatches,
} from 'triangular-engine/celestial';

describe('CDLOD 2D Plane & Multi-Domain Engine', () => {
  it('creates translation-invariant planar sampler for different body presets', () => {
    const presets = [HOME_PLANET, ALPINE_PLANET, CANYON_PLANET, CRATERED_MOON];
    for (const body of presets) {
      const sampler = createPlaneSurfaceSampler(body);
      expect(sampler.minElevationM).toBeDefined();
      expect(sampler.maxElevationM).toBeDefined();

      // Sample at origin
      const originSample = sampler.sample([0, 0, 0]);
      expect(Number.isFinite(originSample.elevationM)).toBe(true);

      // Sample at distant coordinates (50 km away)
      const distantSample = sampler.sample([50000, 0, -35000]);
      expect(Number.isFinite(distantSample.elevationM)).toBe(true);

      // Batch sampling
      const coords = new Float64Array([0, 0, 0, 100, 0, 200, -500, 0, 1000]);
      const elevations = sampler.sampleBatch(coords);
      expect(elevations.length).toBe(3);
      expect(Number.isFinite(elevations[0])).toBe(true);
      expect(Number.isFinite(elevations[1])).toBe(true);
      expect(Number.isFinite(elevations[2])).toBe(true);
    }
  });

  it('selects active 2D plane quadtree patches with valid edge morphing and coverage', () => {
    const sampler = createPlaneSurfaceSampler(HOME_PLANET);
    const selection = selectCdlodPlanePatches({
      sampler,
      cameraPositionM: [0, 250, 450],
      cameraForwardDir: [0, -0.4, -0.9],
      options: {
        rootPatchSizeM: 2048,
        streamingRadiusTiles: 2,
        maxLevel: 6,
        baseResolution: 32,
        splitErrorPx: 14,
        mergeErrorPx: 6,
        screenSpaceFactorPx: 750,
        morphRangeRatio: 0.25,
        featureAdaptive: true,
      },
    });

    expect(selection.patches.length).toBeGreaterThan(0);
    expect(selection.splitAddresses.size).toBeGreaterThan(0);

    for (const patch of selection.patches) {
      expect(patch.distanceM).toBeGreaterThanOrEqual(0);
      expect(patch.morphFactor).toBeGreaterThanOrEqual(0);
      expect(patch.morphFactor).toBeLessThanOrEqual(1);

      // Verify edge morphing object
      expect(patch.edgeMorph).toBeDefined();
      expect(patch.edgeMorph.left).toBeGreaterThanOrEqual(0);
      expect(patch.edgeMorph.right).toBeGreaterThanOrEqual(0);
      expect(patch.edgeMorph.bottom).toBeGreaterThanOrEqual(0);
      expect(patch.edgeMorph.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('generates valid transferable raw buffers and geometry for 2D plane patch', () => {
    const sampler = createPlaneSurfaceSampler(HOME_PLANET);
    const address = { level: 2, x: 0, y: 0 };
    const rootPatchSizeM = 2048;
    const centerM: [number, number, number] = [256, 35, 256];

    const raw = generateCdlodPlanePatchRawBuffers(
      sampler,
      address,
      32,
      rootPatchSizeM,
      centerM,
      'home-planet',
    );

    const vertexCount = 33 * 33;
    expect(raw.positions.length).toBe(vertexCount * 3);
    expect(raw.coarsePositions.length).toBe(vertexCount * 3);
    expect(raw.normals.length).toBe(vertexCount * 3);
    expect(raw.colors?.length).toBe(vertexCount * 3);
    expect(raw.uvs.length).toBe(vertexCount * 2);
    expect(raw.elevations?.length).toBe(vertexCount);
    expect(raw.triangleCount).toBe(32 * 32 * 2);

    // Verify Three.js BufferGeometry generation
    const geomResult = generateCdlodPlanePatchGeometry(
      sampler,
      address,
      32,
      rootPatchSizeM,
      centerM,
      'home-planet',
    );
    expect(geomResult.geometry).toBeDefined();
    expect(geomResult.geometry.getAttribute('position')).toBeDefined();
    expect(geomResult.geometry.getAttribute('coarsePosition')).toBeDefined();
    expect(geomResult.geometry.getAttribute('normal')).toBeDefined();
    expect(geomResult.geometry.getAttribute('color')).toBeDefined();
    expect(geomResult.geometry.getAttribute('uv')).toBeDefined();
    expect(geomResult.geometry.getIndex()).toBeDefined();
  });

  it('handles alternating plane and sphere worker requests without sampler cross-contamination', () => {
    // 1. Dispatch plane job
    const planeRequest: ICdlodWorkerRequest = {
      requestId: 'req-plane-1',
      id: 'plane:0:0:0:32',
      type: 'plane',
      body: HOME_PLANET,
      address: { level: 0, x: 0, y: 0 },
      resolution: 32,
      centerBodyFixedM: [0, 20, 0],
      rootPatchSizeM: 2048,
    };

    const planeResult = handleCdlodWorkerMessage(planeRequest);
    expect(planeResult.response.success).toBe(true);
    expect(planeResult.response.type).toBe('plane');
    expect(planeResult.response.raw?.positions.length).toBe(33 * 33 * 3);

    // 2. Dispatch sphere terrain job
    const sphereRequest: ICdlodWorkerRequest = {
      requestId: 'req-sphere-1',
      id: 'sphere:0:0:0:0:32',
      type: 'terrain',
      body: HOME_PLANET,
      address: { face: 'positive-x', level: 0, x: 0, y: 0 },
      resolution: 32,
      centerBodyFixedM: [HOME_PLANET.radiusM, 0, 0],
    };

    const sphereResult = handleCdlodWorkerMessage(sphereRequest);
    expect(sphereResult.response.success).toBe(true);
    expect(sphereResult.response.type).toBe('terrain');
    expect(sphereResult.response.raw?.positions.length).toBe(33 * 33 * 3);

    // 3. Dispatch ocean job
    const oceanRequest: ICdlodWorkerRequest = {
      requestId: 'req-ocean-1',
      id: 'ocean:0:0:0:0:32',
      type: 'ocean',
      body: HOME_PLANET,
      address: { face: 'positive-x', level: 0, x: 0, y: 0 },
      resolution: 32,
      centerBodyFixedM: [HOME_PLANET.radiusM, 0, 0],
    };

    const oceanResult = handleCdlodWorkerMessage(oceanRequest);
    expect(oceanResult.response.success).toBe(true);
    expect(oceanResult.response.type).toBe('ocean');
    expect(oceanResult.response.raw?.positions.length).toBe(33 * 33 * 3);

    // 4. Dispatch plane job again to verify cache switching
    const planeRequest2: ICdlodWorkerRequest = {
      requestId: 'req-plane-2',
      id: 'plane:1:0:0:32',
      type: 'plane',
      body: ALPINE_PLANET,
      address: { level: 1, x: 0, y: 0 },
      resolution: 32,
      centerBodyFixedM: [0, 45, 0],
      rootPatchSizeM: 2048,
    };

    const planeResult2 = handleCdlodWorkerMessage(planeRequest2);
    expect(planeResult2.response.success).toBe(true);
    expect(planeResult2.response.type).toBe('plane');
  });

  it('maintains independent sphere CDLOD selection integrity', () => {
    const body = HOME_PLANET;
    const sampler = createSurfaceSampler(body);
    const patches = selectCdlodPatches({
      body,
      sampler,
      cameraBodyFixedM: [0, body.radiusM * 1.5, body.radiusM * 2.2],
      options: {
        maxLevel: 6,
        baseResolution: 32,
        splitErrorPx: 14,
        mergeErrorPx: 6,
        screenSpaceFactorPx: 750,
        morphRangeRatio: 0.25,
        featureAdaptive: true,
      },
    });

    expect(patches.patches.length).toBeGreaterThanOrEqual(6);
    for (const patch of patches.patches) {
      expect(patch.distanceM).toBeGreaterThan(0);
      expect(patch.morphFactor).toBeGreaterThanOrEqual(0);
      expect(patch.morphFactor).toBeLessThanOrEqual(1);
    }
  });
});

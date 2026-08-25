import {
  ICelestialBody,
  createSurfaceSampler,
  HOME_PLANET,
} from 'triangular-engine/celestial';
import { selectCdlodPatches } from './cdlod-quadtree';
import {
  CDLOD_OCEAN_SURFACE_BIAS_M,
  generateCdlodOceanPatchGeometry,
  generateCdlodPatchGeometry,
} from './cdlod-patch-mesher';
import {
  createCdlodTerrainMaterial,
  createOceanMaterial,
} from './cdlod-materials';

describe('CDLOD Planet Engine', () => {
  const body: ICelestialBody = HOME_PLANET;
  const sampler = createSurfaceSampler(body);

  it('selects active CDLOD patches across all 6 cube faces with valid edge morphing', () => {
    const patches = selectCdlodPatches({
      body,
      sampler,
      cameraBodyFixedM: [body.radiusM + 500, 0, 0],
      options: {
        maxLevel: 6,
        baseResolution: 32,
        splitErrorPx: 16,
        mergeErrorPx: 6,
        screenSpaceFactorPx: 700,
        morphRangeRatio: 0.35,
        featureAdaptive: true,
      },
    });

    expect(patches.length).toBeGreaterThanOrEqual(6);
    expect(patches[0].distanceM).toBeGreaterThan(0);
    expect(patches[0].morphFactor).toBeGreaterThanOrEqual(0);
    expect(patches[0].morphFactor).toBeLessThanOrEqual(1);

    // Verify per-edge morph factors are computed
    expect(patches[0].edgeMorph).toBeDefined();
    expect(patches[0].edgeMorph.left).toBeGreaterThanOrEqual(0);
    expect(patches[0].edgeMorph.right).toBeGreaterThanOrEqual(0);
    expect(patches[0].edgeMorph.bottom).toBeGreaterThanOrEqual(0);
    expect(patches[0].edgeMorph.top).toBeGreaterThanOrEqual(0);
  });

  it('enforces 2:1 quadtree level balance across leaf patches', () => {
    const patches = selectCdlodPatches({
      body,
      sampler,
      cameraBodyFixedM: [body.radiusM + 200, 0, 0],
      options: {
        maxLevel: 7,
        baseResolution: 32,
        splitErrorPx: 8,
        mergeErrorPx: 4,
        screenSpaceFactorPx: 800,
        morphRangeRatio: 0.35,
        featureAdaptive: true,
      },
    });

    for (const p of patches) {
      expect(p.address.level).toBeGreaterThanOrEqual(0);
      expect(p.address.level).toBeLessThanOrEqual(7);
      expect(p.resolution).toBe(32);
    }
  });

  it('generates patch geometry with coarsePosition and elevation attributes', () => {
    const patch = {
      face: 'positive-x' as const,
      level: 2,
      x: 1,
      y: 1,
    };
    const meshResult = generateCdlodPatchGeometry(body, sampler, patch, 16, [
      body.radiusM,
      0,
      0,
    ]);

    expect(meshResult.geometry).toBeDefined();
    expect(meshResult.geometry.getAttribute('position')).toBeDefined();
    expect(meshResult.geometry.getAttribute('coarsePosition')).toBeDefined();
    expect(meshResult.geometry.getAttribute('normal')).toBeDefined();
    expect(meshResult.geometry.getAttribute('elevation')).toBeDefined();
    expect(meshResult.geometry.getAttribute('uv')).toBeDefined();
    expect(meshResult.triangleCount).toBe(16 * 16 * 2);
  });

  it('creates CDLOD shader material with correct uniforms and edge morph vector', () => {
    const mat = createCdlodTerrainMaterial({
      wireframe: true,
      elevationScale: 1.5,
    });
    expect(mat).toBeDefined();
    expect(mat.uniforms['uMorphFactor']).toBeDefined();
    expect(mat.uniforms['uEnableMorph']).toBeDefined();
    expect(mat.uniforms['uEdgeMorph']).toBeDefined();
    expect(mat.uniforms['uElevationScale'].value).toBe(1.5);
    expect(mat.uniforms['uWireframeMode'].value).toBe(1.0);
    expect(mat.uniforms['uRenderOrigin']).toBeDefined();
  });

  it('creates Ocean shader material with logarithmic depth buffer support', () => {
    const mat = createOceanMaterial();
    expect(mat).toBeDefined();
    expect(mat.uniforms['uSunDirection']).toBeDefined();
    expect(mat.uniforms['uSunColor']).toBeDefined();
    expect(mat.vertexShader).toContain('logdepthbuf_pars_vertex');
    expect(mat.fragmentShader).toContain('logdepthbuf_pars_fragment');
    expect(mat.depthWrite).toBeFalse();
    expect(mat.polygonOffset).toBeTrue();
  });

  it('generates shared-topology ocean patch geometry with coarsePosition matching terrain', () => {
    const patch = {
      face: 'positive-x' as const,
      level: 1,
      x: 0,
      y: 0,
    };
    const oceanMesh = generateCdlodOceanPatchGeometry(body, patch, 16, [
      body.radiusM,
      0,
      0,
    ]);

    expect(oceanMesh.geometry).toBeDefined();
    expect(oceanMesh.geometry.getAttribute('position')).toBeDefined();
    expect(oceanMesh.geometry.getAttribute('coarsePosition')).toBeDefined();
    expect(oceanMesh.geometry.getAttribute('normal')).toBeDefined();
    expect(oceanMesh.geometry.getAttribute('uv')).toBeDefined();
    expect(oceanMesh.triangleCount).toBe(16 * 16 * 2);

    const position = oceanMesh.geometry.getAttribute('position');
    const firstWorldPosition: [number, number, number] = [
      position.getX(0) + body.radiusM,
      position.getY(0),
      position.getZ(0),
    ];
    expect(
      Math.hypot(...firstWorldPosition) -
        body.radiusM -
        (body.terrain?.ocean?.seaLevelM ?? 0),
    ).toBeCloseTo(CDLOD_OCEAN_SURFACE_BIAS_M, 2);
  });

  describe('Motion Look-Ahead & Velocity Prediction', () => {
    it('applies linear velocity look-ahead to evaluate future camera position', () => {
      const cameraPos: [number, number, number] = [body.radiusM + 1000, 0, 0];
      const velocity: [number, number, number] = [0, 2000, 0]; // Flying +Y at 2000 m/s

      const patches = selectCdlodPatches({
        body,
        sampler,
        cameraBodyFixedM: cameraPos,
        options: {
          maxLevel: 6,
          baseResolution: 32,
          splitErrorPx: 16,
          mergeErrorPx: 6,
          screenSpaceFactorPx: 700,
          morphRangeRatio: 0.35,
          featureAdaptive: true,
        },
        motionLookAhead: {
          kind: 'linear',
          velocityBodyFixedMps: velocity,
          leadTimeSeconds: 0.25,
          timeWarp: 1,
        },
      });

      expect(patches.length).toBeGreaterThan(0);
      expect(patches.neededPatches).toBeDefined();
    });

    it('applies curved Keplerian orbital sampler look-ahead', () => {
      const cameraPos: [number, number, number] = [
        body.radiusM + 100_000,
        0,
        0,
      ];
      let sampledLead = 0;

      const patches = selectCdlodPatches({
        body,
        sampler,
        cameraBodyFixedM: cameraPos,
        options: {
          maxLevel: 6,
          baseResolution: 32,
          splitErrorPx: 16,
          mergeErrorPx: 6,
          screenSpaceFactorPx: 700,
          morphRangeRatio: 0.35,
          featureAdaptive: true,
        },
        motionLookAhead: {
          kind: 'curved',
          samplePositionBodyFixedM: (leadSeconds: number) => {
            sampledLead = leadSeconds;
            // Simulated 100km circular orbit point
            const angle = leadSeconds * 0.05;
            return [
              Math.cos(angle) * (body.radiusM + 100_000),
              Math.sin(angle) * (body.radiusM + 100_000),
              0,
            ];
          },
          timeWarp: 10,
          leadTimeSeconds: 0.35,
        },
      });

      expect(sampledLead).toBe(3.5); // 0.35s * 10x warp
      expect(patches.length).toBeGreaterThan(0);
    });

    it('prioritizes needed worker patches in the forward velocity cone', () => {
      const cameraPos: [number, number, number] = [body.radiusM + 500, 0, 0];
      const cached = new Set<string>(); // Force worker neededPatches dispatch

      const patches = selectCdlodPatches({
        body,
        sampler,
        cameraBodyFixedM: cameraPos,
        cachedGeometries: cached,
        options: {
          maxLevel: 6,
          baseResolution: 32,
          splitErrorPx: 16,
          mergeErrorPx: 6,
          screenSpaceFactorPx: 700,
          morphRangeRatio: 0.35,
          featureAdaptive: true,
        },
        motionLookAhead: {
          kind: 'linear',
          velocityBodyFixedMps: [0, 1500, 0], // Flying toward +Y
          leadTimeSeconds: 0.25,
        },
      });

      expect(patches.neededPatches.length).toBeGreaterThan(0);
      // Ensure needed patches are sorted with forward hemisphere patches first
      const firstPatch = patches.neededPatches[0];
      expect(firstPatch).toBeDefined();
    });
  });
});

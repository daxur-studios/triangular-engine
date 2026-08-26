import { HOME_PLANET, createSurfaceSampler } from '../../../celestial/public-api';
import { PlanetaryFeaturePyramid } from './planetary-feature-pyramid';
import { CdlodV3Selector } from './cdlod-v3-selector';
import { faceUvToDirection } from '../cdlod-quadtree';
import { Vec3d } from 'triangular-engine/celestial';

function runSelectorTests() {
  console.log('--- Testing CdlodV3Selector on HOME_PLANET ---');

  const sampler = createSurfaceSampler(HOME_PLANET);
  const pyramid = new PlanetaryFeaturePyramid(HOME_PLANET, sampler, {
    maxLevel: 6,
    samplesPerSide: 5,
  });
  const selector = new CdlodV3Selector(HOME_PLANET, pyramid, sampler);

  // Scenario 1: Surface over Deep Ocean
  // Search pyramid for a pure deep ocean tile (Level 4, >60km wide)
  let oceanDir: Vec3d = [0, -1, 0];
  let found = false;
  for (let lvl = 4; lvl <= 5 && !found; lvl++) {
    const dim = 1 << lvl;
    for (let f = 0; f < 6 && !found; f++) {
      const face = ([
        'positive-x',
        'negative-x',
        'positive-y',
        'negative-y',
        'positive-z',
        'negative-z',
      ] as const)[f];
      for (let y = 0; y < dim && !found; y++) {
        for (let x = 0; x < dim && !found; x++) {
          const maxE = pyramid.getMaxElevationM(face, lvl, x, y);
          if (maxE < -2000) {
            const span = 2.0 / dim;
            const u = -1.0 + (x + 0.5) * span;
            const v = -1.0 + (y + 0.5) * span;
            oceanDir = faceUvToDirection(face, u, v);
            found = true;
          }
        }
      }
    }
  }

  const r = HOME_PLANET.radiusM;
  const oceanPos: Vec3d = [oceanDir[0] * (r + 50), oceanDir[1] * (r + 50), oceanDir[2] * (r + 50)];

  const oceanPatches = selector.selectPatches(oceanPos, {
    splitErrorPx: 4.0,
    viewportHeightPx: 1080,
    fovRad: (60 * Math.PI) / 180,
    maxLevel: 10,
    baseResolution: 32,
  });

  console.log(`\n[Scenario 1: Surface Over Pure Ocean (h=50m)]`);
  console.log(`✓ Active leaf patches: ${oceanPatches.length}`);
  const levelCounts: Record<number, number> = {};
  for (const p of oceanPatches) {
    levelCounts[p.address.level] = (levelCounts[p.address.level] || 0) + 1;
  }
  console.log('✓ Patch distribution by level:', levelCounts);

  if (oceanPatches.length > 200) {
    throw new Error(`Ocean patches should be <= 200 near coastal mountain view, got ${oceanPatches.length}`);
  }

  // Scenario 2: Ground Camera in Mountain Range (Altitude = 100m)
  const mountainPos: Vec3d = [0, 0, r + 100];
  const mountainPatches = selector.selectPatches(mountainPos, {
    splitErrorPx: 3.5,
    viewportHeightPx: 1080,
    fovRad: (60 * Math.PI) / 180,
    maxLevel: 10,
    baseResolution: 32,
    silhouetteBoost: 2.0,
  });

  console.log(`\n[Scenario 2: Mountain Ridge & Horizon (h=100m)]`);
  console.log(`✓ Active leaf patches: ${mountainPatches.length}`);
  const mountainLevelCounts: Record<number, number> = {};
  let coastlinePatchCount = 0;
  for (const p of mountainPatches) {
    mountainLevelCounts[p.address.level] = (mountainLevelCounts[p.address.level] || 0) + 1;
    if (p.isCoastline) coastlinePatchCount++;
  }
  console.log('✓ Patch distribution by level:', mountainLevelCounts);

  // Scenario 3: High Altitude Orbit (Altitude = 200km)
  const orbitPos: Vec3d = [0, 0, r + 200000];
  const orbitPatches = selector.selectPatches(orbitPos, {
    splitErrorPx: 4.0,
    viewportHeightPx: 1080,
    fovRad: (60 * Math.PI) / 180,
    maxLevel: 10,
    baseResolution: 32,
  });

  console.log(`\n[Scenario 3: Orbit View (h=200km)]`);
  console.log(`✓ Active leaf patches: ${orbitPatches.length}`);

  // Scenario 4: Benchmark selection time (1,000 frames)
  const benchStart = performance.now();
  const frameCount = 1000;
  for (let f = 0; f < frameCount; f++) {
    const angle = (f / frameCount) * Math.PI * 2;
    const testPos: Vec3d = [Math.cos(angle) * (r + 100), 0, Math.sin(angle) * (r + 100)];
    selector.selectPatches(testPos, {
      splitErrorPx: 4.0,
      viewportHeightPx: 1080,
      fovRad: (60 * Math.PI) / 180,
      maxLevel: 10,
      baseResolution: 32,
    });
  }
  const benchDurationMs = performance.now() - benchStart;
  const msPerFrame = benchDurationMs / frameCount;
  console.log(`\n✓ Benchmark: 1,000 frame reselects in ${benchDurationMs.toFixed(2)} ms (${msPerFrame.toFixed(3)} ms/frame)`);

  if (msPerFrame > 5.0) {
    throw new Error(`Reselect should take < 5ms/frame, took ${msPerFrame.toFixed(3)} ms`);
  }

  console.log('\n✓ All CdlodV3Selector tests passed!');
}

runSelectorTests();

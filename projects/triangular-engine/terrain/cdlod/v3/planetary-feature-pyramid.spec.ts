import { HOME_PLANET, createSurfaceSampler } from '../../../celestial/public-api';
import {
  PlanetaryFeaturePyramid,
  PYRAMID_FLAG_COASTLINE,
  PYRAMID_FLAG_OCEAN_ONLY,
  PYRAMID_FLAG_LAND_ONLY,
} from './planetary-feature-pyramid';

function runPyramidTests() {
  console.log('Testing PlanetaryFeaturePyramid on HOME_PLANET...');
  const sampler = createSurfaceSampler(HOME_PLANET);

  const startTime = performance.now();
  const pyramid = new PlanetaryFeaturePyramid(HOME_PLANET, sampler, {
    maxLevel: 6,
    samplesPerSide: 5,
  });
  const buildDurationMs = performance.now() - startTime;

  console.log(`✓ Feature pyramid built in ${buildDurationMs.toFixed(2)} ms`);
  console.log(`✓ Memory footprint: ${(pyramid.byteLength / 1024).toFixed(1)} KB`);

  // Test root node (Level 0)
  const rootNode = pyramid.getNode({ face: 'positive-z', level: 0, x: 0, y: 0 });
  if (!rootNode) throw new Error('Root node should not be null');
  console.log('Root node (+Z):', {
    minElev: rootNode.minElevationM.toFixed(1),
    maxElev: rootNode.maxElevationM.toFixed(1),
    variance: rootNode.varianceM.toFixed(1),
    flags: rootNode.flags,
    boundingRadiusM: rootNode.boundingRadiusM.toFixed(1),
  });

  if (rootNode.minElevationM >= rootNode.maxElevationM) {
    throw new Error('Root min elevation should be < max elevation');
  }

  // Test deep leaf node (Level 6)
  const leafNode = pyramid.getNode({ face: 'positive-x', level: 6, x: 30, y: 40 });
  if (!leafNode) throw new Error('Leaf node should not be null');
  console.log('Leaf node (+X, L6):', {
    minElev: leafNode.minElevationM.toFixed(1),
    maxElev: leafNode.maxElevationM.toFixed(1),
    variance: leafNode.varianceM.toFixed(1),
    flags: leafNode.flags,
    boundingRadiusM: leafNode.boundingRadiusM.toFixed(1),
  });

  // Benchmark query speed
  const queryStart = performance.now();
  let dummy = 0;
  const iterations = 100000;
  for (let i = 0; i < iterations; i++) {
    const lvl = i % 7;
    const dim = 1 << lvl;
    const x = (i * 7) % dim;
    const y = (i * 13) % dim;
    dummy += pyramid.getVarianceM('positive-x', lvl, x, y);
  }
  const queryDurationMs = performance.now() - queryStart;
  const nsPerQuery = (queryDurationMs / iterations) * 1e6;
  console.log(`✓ 100,000 queries completed in ${queryDurationMs.toFixed(2)} ms (${nsPerQuery.toFixed(2)} ns/query)`);

  // Check coastline flags across the planet
  let coastlineCount = 0;
  let oceanOnlyCount = 0;
  let landOnlyCount = 0;
  const gridDim = 1 << 6; // Level 6
  for (let f = 0; f < 6; f++) {
    const face = ([
      'positive-x',
      'negative-x',
      'positive-y',
      'negative-y',
      'positive-z',
      'negative-z',
    ] as const)[f];
    for (let y = 0; y < gridDim; y++) {
      for (let x = 0; x < gridDim; x++) {
        const flags = pyramid.getFlags(face, 6, x, y);
        if (flags & PYRAMID_FLAG_COASTLINE) coastlineCount++;
        if (flags & PYRAMID_FLAG_OCEAN_ONLY) oceanOnlyCount++;
        if (flags & PYRAMID_FLAG_LAND_ONLY) landOnlyCount++;
      }
    }
  }
  const totalL6Nodes = 6 * gridDim * gridDim;
  console.log(`✓ Level 6 node distribution (Total: ${totalL6Nodes}):`);
  console.log(`  - Coastline nodes: ${coastlineCount} (${((coastlineCount / totalL6Nodes) * 100).toFixed(1)}%)`);
  console.log(`  - Pure Ocean nodes: ${oceanOnlyCount} (${((oceanOnlyCount / totalL6Nodes) * 100).toFixed(1)}%)`);
  console.log(`  - Pure Land nodes: ${landOnlyCount} (${((landOnlyCount / totalL6Nodes) * 100).toFixed(1)}%)`);

  if (coastlineCount === 0) throw new Error('Planet with ocean should have coastline nodes');
  if (oceanOnlyCount === 0) throw new Error('Planet with ocean should have pure ocean nodes');

  console.log('✓ All PlanetaryFeaturePyramid tests passed!');
}

runPyramidTests();

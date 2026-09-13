import { buildPlanetEcology } from './ecology';
import { buildPlanetGraphCore } from './planet-graph';
import { createPlanetSurfaceSampler } from './planet-surface';
import { buildPlanetTectonics } from './tectonics';
import { normalize } from './vec3';

describe('createPlanetSurfaceSampler', () => {
  it('is deterministic and projection-independent', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 61 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 61 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const direction = normalize({ x: 0.31, y: 0.72, z: -0.41 });

    const a = createPlanetSurfaceSampler(graph, tectonics, ecology).sample(direction);
    const b = createPlanetSurfaceSampler(graph, tectonics, ecology).sample({
      x: direction.x * 7,
      y: direction.y * 7,
      z: direction.z * 7,
    });

    expect(b).toEqual(a);
  });

  it('adds relief on a ridge and keeps river channels below the uncarved surface', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const ecology = buildPlanetEcology(graph, tectonics, {
      riverDetail: { levels: 0 },
      ridges: { ridgeDetail: { stationCount: 2 } },
    });
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      ridgeWidthRadians: 0.2,
      riverWidthRadians: 0.2,
    });

    const ridgePoint = ecology.ridgePaths[0]?.[0] ?? ecology.ridgePeaks[0];
    expect(ridgePoint).toBeDefined();
    if (ridgePoint) {
      const ridge = sampler.sample(ridgePoint);
      expect(ridge.ridgeRelief).toBeGreaterThan(0);
      expect(ridge.elevation).toBeGreaterThanOrEqual(ridge.baseElevation);
    }

    const riverPoint = ecology.riverPaths[0]?.[0];
    expect(riverPoint).toBeDefined();
    if (riverPoint) {
      const river = sampler.sample(riverPoint);
      if (river.isLand) expect(river.riverCarve).toBeGreaterThan(0);
      expect(river.elevation).toBeGreaterThanOrEqual(river.seaLevel);
    }
  });
});

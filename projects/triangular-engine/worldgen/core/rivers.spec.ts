import { buildCornerGraph } from './corner-graph';
import { computeClimate } from './climate';
import { buildPlanetGraphCore } from './planet-graph';
import { traceRivers } from './rivers';
import { buildPlanetTectonics } from './tectonics';
import { classifyWaterBodies } from './water-bodies';
import { add, IVec3, normalize, scale, sub } from './vec3';

// Matches rivers.ts's IRiverParams.frozenTemperatureThreshold default (and biomes.ts's
// coldTemperatureThreshold, which the two are meant to line up with by default).
const FROZEN_THRESHOLD = -0.35;

describe('traceRivers', () => {
  it('every river terminates at the coast, a lake, or the ice line — never in the middle of nowhere', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );

    const corners = buildCornerGraph(graph);
    const cornerElevation = new Map<IVec3, number>();
    const cornerTemperature = new Map<IVec3, number>();
    const cornerTouchesWater = new Map<IVec3, boolean>();
    corners.position.forEach((pos, i) => {
      const [a, b, c] = corners.cellIds[i];
      cornerElevation.set(pos, (tectonics.elevation[a] + tectonics.elevation[b] + tectonics.elevation[c]) / 3);
      cornerTemperature.set(
        pos,
        (climate.temperature[a] + climate.temperature[b] + climate.temperature[c]) / 3,
      );
      cornerTouchesWater.set(pos, [a, b, c].some((cellId) => !tectonics.isLand[cellId]));
    });
    const lakeSet = new Set(rivers.lakeCorners);

    expect(rivers.riverPaths.length).toBeGreaterThan(0);
    for (const path of rivers.riverPaths) {
      const end = path[path.length - 1];
      if (lakeSet.has(end)) continue; // dead-ended (or spilled from) a lake pit

      const isRawCorner = corners.position.includes(end);
      if (isRawCorner) {
        // Ended on a raw graph corner rather than an interpolated sea-level crossing: valid
        // either because it directly touches an actual water cell (a shore corner with no
        // viable interpolated crossing among its neighbors — see traceRivers()'s "water-cell
        // awareness" note), because the walk stopped one step short of frozen ground/water
        // (the ice line) instead of routing across it, or because it merged into another
        // already-traced river at this exact corner (see `riverParent`).
        const touchesWater = cornerTouchesWater.get(end) === true;
        const endTemp = cornerTemperature.get(end);
        const isFrozen = endTemp !== undefined && endTemp <= FROZEN_THRESHOLD;
        const idx = corners.position.indexOf(end);
        const nextToFrozen = corners.neighbors[idx].some((n) => {
          const t = cornerTemperature.get(corners.position[n]);
          return t !== undefined && t <= FROZEN_THRESHOLD;
        });
        const isMergePoint = rivers.riverParent.some(
          (parent, i) => parent !== null && rivers.riverPaths[i][rivers.riverPaths[i].length - 1] === end,
        );
        expect(touchesWater || isFrozen || nextToFrozen || isMergePoint).toBe(true);
        continue;
      }

      // Otherwise this is a fresh sea-level crossing point interpolated between the last land
      // corner and one of its neighbors — not itself a graph corner. Verify some neighbor of the
      // last land corner actually explains it, rather than assuming any particular
      // neighbor-selection order.
      const secondToLast = path[path.length - 2];
      expect(cornerElevation.get(secondToLast)).toBeGreaterThanOrEqual(tectonics.seaLevelElevation);

      const idx = corners.position.indexOf(secondToLast);
      const matchesSomeNeighbor = corners.neighbors[idx].some((n) => {
        const from = secondToLast;
        const to = corners.position[n];
        const eFrom = cornerElevation.get(from)!;
        const eTo = cornerElevation.get(to)!;
        if (eFrom === eTo) return false;
        const t = (tectonics.seaLevelElevation - eFrom) / (eTo - eFrom);
        if (t < 0 || t > 1) return false;
        const expected = normalize(add(from, scale(sub(to, from), t)));
        return (
          Math.abs(expected.x - end.x) < 1e-9 &&
          Math.abs(expected.y - end.y) < 1e-9 &&
          Math.abs(expected.z - end.z) < 1e-9
        );
      });
      expect(matchesSomeNeighbor).toBe(true);
    }
  });

  it('every step of every river strictly descends, except across a recorded lake spill', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );

    const corners = buildCornerGraph(graph);
    const cornerElevation = new Map<IVec3, number>();
    corners.position.forEach((pos, i) => {
      const [a, b, c] = corners.cellIds[i];
      cornerElevation.set(pos, (tectonics.elevation[a] + tectonics.elevation[b] + tectonics.elevation[c]) / 3);
    });
    // A path's last point may be a fresh sea-level crossing point rather than a graph
    // corner (see the "terminates at the coast or a lake" test above) — its elevation
    // is exactly seaLevelElevation by construction.
    const elevationOf = (p: IVec3): number => cornerElevation.get(p) ?? tectonics.seaLevelElevation;
    // A pit the walk spilled over (see traceRivers()'s "local pits spill" note) pools up to its
    // rim before flowing out the other side, so the one step immediately after a recorded lake
    // corner is allowed to rise — every other step must still strictly descend.
    const lakeSet = new Set(rivers.lakeCorners);

    for (const path of rivers.riverPaths) {
      for (let i = 1; i < path.length; i++) {
        if (lakeSet.has(path[i - 1])) continue;
        expect(elevationOf(path[i])).toBeLessThan(elevationOf(path[i - 1]));
      }
    }
  });

  it('never routes a river onto frozen ground or frozen water', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );

    const corners = buildCornerGraph(graph);
    const cornerTemperature = new Map<IVec3, number>();
    corners.position.forEach((pos, i) => {
      const [a, b, c] = corners.cellIds[i];
      cornerTemperature.set(
        pos,
        (climate.temperature[a] + climate.temperature[b] + climate.temperature[c]) / 3,
      );
    });

    for (const path of rivers.riverPaths) {
      // Only raw graph corners have a blended temperature on record — the final entry may be a
      // fresh interpolated crossing point, which is never frozen by construction.
      for (const point of path) {
        const t = cornerTemperature.get(point);
        if (t !== undefined) expect(t).toBeGreaterThan(FROZEN_THRESHOLD);
      }
    }
  });

  it('flow is at least 1 everywhere, never decreases going downstream, and records real confluences', () => {
    const graph = buildPlanetGraphCore({ cellCount: 3000, seed: 12 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 12 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
    // 3000 cells/seed 12 is verified (throwaway tsx sweep, not committed) to actually exercise a
    // real confluence at the default sourceCount — otherwise this test wouldn't be checking what
    // it claims to.
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );

    expect(rivers.riverFlow.length).toBe(rivers.riverPaths.length);
    for (let p = 0; p < rivers.riverPaths.length; p++) {
      const path = rivers.riverPaths[p];
      const flow = rivers.riverFlow[p];
      expect(flow.length).toBe(path.length);
      for (let i = 0; i < flow.length; i++) {
        expect(flow[i]).toBeGreaterThanOrEqual(1);
        if (i > 0) expect(flow[i]).toBeGreaterThanOrEqual(flow[i - 1]);
      }
    }

    // At least one real confluence should occur at this scale — otherwise the merge-trimming
    // logic (`riverParent`/`riverBasin`) isn't actually being exercised by this test.
    const mergedRivers = rivers.riverParent.filter((parent) => parent !== null);
    expect(mergedRivers.length).toBeGreaterThan(0);

    // Every basin is its own root (no parent), and every basin index is a river that actually
    // reaches its own terminus rather than merging further.
    for (let i = 0; i < rivers.riverPaths.length; i++) {
      expect(rivers.riverParent[rivers.riverBasin[i]]).toBeNull();
    }

    // A merged river's last recorded point is the exact corner shared with its parent's path —
    // the confluence itself, not an approximation.
    for (let i = 0; i < rivers.riverPaths.length; i++) {
      const parent = rivers.riverParent[i];
      if (parent === null) continue;
      const mergePoint = rivers.riverPaths[i][rivers.riverPaths[i].length - 1];
      expect(rivers.riverPaths[parent]).toContain(mergePoint);
    }
  });

  it('minNavigableFlow sits within the planet\'s actual observed river-flow range', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );

    const flows = rivers.riverFlow.flat();
    const maxFlow = Math.max(...flows);
    expect(rivers.minNavigableFlow).toBeGreaterThan(0);
    expect(rivers.minNavigableFlow).toBeLessThanOrEqual(maxFlow);
    // The threshold should actually split the planet's rivers into both categories — a threshold
    // that classifies everything (or nothing) as navigable isn't doing its job.
    expect(flows.some((f) => f < rivers.minNavigableFlow)).toBe(true);
    expect(flows.some((f) => f >= rivers.minNavigableFlow)).toBe(true);
  });

  it('is deterministic', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 12 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 12 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
    const a = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );
    const b = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      climate.temperature,
      waterBodies.waterBodyKind,
    );
    expect(a).toEqual(b);
  });
});

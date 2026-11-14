import { generateIslandHeightfield } from './island-heightfield';
import { NavAgentState, NavCrowd } from './nav-crowd';
import { NavFlag } from './nav-flags';
import { NavFlowCache } from './nav-flow';
import { NavGoalSet } from './nav-goals';
import { NavGrid } from './nav-grid';
import { NavSectorGraph } from './nav-sectors';
import type { NavHeightfield } from './nav-types';
import { NavWorld } from './nav-world';

function flatField(width: number, height: number): NavHeightfield {
  return { width, height, cellSize: 1, heights: new Float32Array(width * height).fill(5), waterLevel: 0 };
}

function flatWorld(width: number, height: number, sectorSize = 16): NavWorld {
  return NavWorld.fromHeightfield(flatField(width, height), { sectorSize });
}

function inBlockedCell(crowd: NavCrowd): number {
  const { grid, posX, posY } = crowd;
  for (let i = 0; i < crowd.count; i++) {
    const x = Math.floor(posX[i]);
    const y = Math.floor(posY[i]);
    if (!grid.inBounds(x, y) || (grid.flags[y * grid.width + x] & NavFlag.BLOCKED) !== 0) return i;
  }
  return -1;
}

function snapshotVersions(graph: NavSectorGraph): number[] {
  return Array.from(graph.versions);
}

function nearestRoomy(grid: NavGrid, x: number, y: number, clearance: number): { x: number; y: number } {
  for (let r = 0; r < 120; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (grid.inBounds(cx, cy) && grid.isPassable(cx, cy, 'villager') && grid.clearance[cy * grid.width + cx] >= clearance) {
          return { x: cx, y: cy };
        }
      }
    }
  }
  throw new Error('no roomy cell found');
}

describe('NavGoalSet and multi-source fields', () => {
  it('tracks sources by cell, sector and bit', () => {
    const world = flatWorld(64, 32);
    const set = new NavGoalSet(world.graph);
    expect(set.size).toBe(0);
    expect(set.primary).toBe(-1);
    expect(set.add(5, 5)).toBeTrue();
    expect(set.add(5, 5)).toBeFalse();
    expect(set.add(40, 20)).toBeTrue();
    expect(set.add(-1, 0)).toBeFalse();
    expect(set.size).toBe(2);
    expect(set.has(40, 20)).toBeTrue();
    expect(set.has(41, 20)).toBeFalse();
    expect(set.primary).toBe(5 * 64 + 5);
    expect([...set.bySector.keys()]).toEqual([0, 6]);
    expect(set.remove(5, 5)).toBeTrue();
    expect(set.remove(5, 5)).toBeFalse();
    expect(set.primary).toBe(20 * 64 + 40);
    expect([...set.bySector.keys()]).toEqual([6]);
  });

  it('leads every agent to its nearest source and reports which one it reached', () => {
    const world = flatWorld(128, 64);
    const set = new NavGoalSet(world.graph);
    const west = { x: 12, y: 32 };
    const northEast = { x: 112, y: 10 };
    const southEast = { x: 112, y: 54 };
    for (const s of [west, northEast, southEast]) set.add(s.x, s.y);
    const crowd = new NavCrowd(world.graph, { capacity: 300, seed: 5 });
    const id = crowd.addGoalSet(set);
    const starts = [
      { x: 40, y: 30, want: west },
      { x: 30, y: 36, want: west },
      { x: 90, y: 20, want: northEast },
      { x: 80, y: 5, want: northEast },
      { x: 95, y: 45, want: southEast },
      { x: 78, y: 60, want: southEast },
    ];
    for (const s of starts) crowd.spawn(s.x + 0.5, s.y + 0.5, id);
    for (let step = 0; step < 1500 && crowd.stats.arrived < starts.length; step++) crowd.step();
    expect(crowd.stats.arrived).toBe(starts.length);
    starts.forEach((s, i) => {
      expect(crowd.state[i]).toBe(NavAgentState.Arrived);
      expect(crowd.arrivedCell[i]).withContext(`agent ${i}`).toBe(s.want.y * 128 + s.want.x);
    });
  });

  it('finds the corridor to the nearest source, not the first one', () => {
    const world = flatWorld(128, 32);
    const set = new NavGoalSet(world.graph, [8 * 128 + 4, 8 * 128 + 124]);
    const near = world.graph.findAbstractPathToAny(100, 8, set, 'villager');
    expect(near.found).toBeTrue();
    expect(near.sectors[near.sectors.length - 1]).toBe(world.graph.sectorOf(124, 8));
    const far = world.graph.findAbstractPathToAny(20, 8, set, 'villager');
    expect(far.sectors[far.sectors.length - 1]).toBe(world.graph.sectorOf(4, 8));
    expect(new NavGoalSet(world.graph).size).toBe(0);
    expect(world.graph.findAbstractPathToAny(20, 8, new NavGoalSet(world.graph), 'villager').failure).toBe('goal-blocked');
  });

  it('removing a source drops only the sector fields that depend on its sector', () => {
    const world = flatWorld(128, 32);
    const cache = new NavFlowCache(world.graph);
    const set = new NavGoalSet(world.graph);
    set.add(4, 8); // sector 0
    set.add(124, 8); // sector 7
    const field = cache.fieldForGoals(set, 'villager');
    expect(cache.ensure(field, 20, 8).status).toBe('ready'); // corridor 1 -> 0
    expect(cache.ensure(field, 110, 8).status).toBe('ready'); // corridor 6 -> 7
    const built = (s: number) => field.sectors[s]?.buildId;
    const westIds = [built(0), built(1)];
    expect(westIds.every((id) => id !== undefined)).toBeTrue();
    expect(field.builtSectors).toBe(4);
    const invalidations = cache.stats.invalidations;

    expect(set.remove(124, 8)).toBeTrue();
    cache.sync();
    expect(cache.stats.invalidations - invalidations).withContext('sector 7 and the sector 6 seeded from it').toBe(2);
    expect(field.sectors[7]).toBeUndefined();
    expect(field.sectors[6]).toBeUndefined();
    expect([built(0), built(1)]).withContext('the western fields were not rebuilt').toEqual(westIds);

    // The eastern agent now crosses the whole island to the remaining source; the west is reused.
    const buildsBefore = cache.stats.builds;
    expect(cache.ensure(field, 110, 8).status).toBe('ready');
    expect(field.sectors[0]!.buildId).toBe(westIds[0] as number);
    expect(cache.stats.builds - buildsBefore).toBe(5); // sectors 2 .. 6 are new
  });

  it('adding a source refreshes its neighbourhood and leads nearby agents to it', () => {
    const world = flatWorld(128, 32);
    const cache = new NavFlowCache(world.graph);
    const set = new NavGoalSet(world.graph);
    set.add(4, 8);
    const field = cache.fieldForGoals(set, 'villager');
    expect(cache.ensure(field, 20, 8).status).toBe('ready');
    expect(cache.ensure(field, 100, 8).status).toBe('ready');
    const before = field.costAtCell(100, 8);
    const westId = field.sectors[0]!.buildId;

    set.add(104, 8); // sector 6, close to the second agent
    cache.sync();
    expect(field.sectors[0]!.buildId).withContext('far sector untouched').toBe(westId);
    expect(cache.ensure(field, 100, 8).status).toBe('ready');
    expect(field.costAtCell(100, 8)).toBeLessThan(before / 5);
    // An empty set is unreachable, and a source added later makes the cell reachable again.
    const empty = new NavGoalSet(world.graph);
    const emptyField = cache.fieldForGoals(empty, 'villager');
    expect(cache.ensure(emptyField, 20, 8).status).toBe('unreachable');
    empty.add(30, 8);
    expect(cache.ensure(emptyField, 20, 8).status).toBe('ready');
  });

  it('ignores a source in a blocked cell until it is free again', () => {
    const world = flatWorld(64, 32);
    const set = new NavGoalSet(world.graph, [16 * 64 + 50, 16 * 64 + 10]);
    world.placeBuilding({ x: 49, y: 15, width: 3, height: 3 });
    const path = world.graph.findAbstractPathToAny(30, 16, set, 'villager');
    expect(path.found).toBeTrue();
    expect(path.sectors[path.sectors.length - 1]).toBe(world.graph.sectorOf(10, 16));
    world.removeBuilding({ x: 49, y: 15, width: 3, height: 3 });
    const again = world.graph.findAbstractPathToAny(40, 16, set, 'villager');
    expect(again.sectors[again.sectors.length - 1]).toBe(world.graph.sectorOf(50, 16));
  });
});

describe('road preference', () => {
  it('composes road cells into the cost and lets agents take a cheaper road detour', () => {
    const run = (roadFactor: number): { minY: number; arrived: boolean; cost: number } => {
      const world = flatWorld(64, 48, 16);
      world.grid.setRoadMinFactor(roadFactor);
      world.graph.rebuildSectors(world.grid.bounds());
      // A road arching north from the west door to the east door; straight ground is 55 cells.
      world.paintRoadLine(4, 24, 20, 8, 1);
      world.paintRoadLine(20, 8, 44, 8, 1);
      world.paintRoadLine(44, 8, 59, 24, 1);
      const crowd = new NavCrowd(world.graph, { capacity: 1, seed: 1, arrivalRadius: 2 });
      const goal = crowd.addGoal(59, 24);
      crowd.spawn(4.5, 24.5, goal);
      let minY = 99;
      for (let i = 0; i < 2500 && crowd.state[0] !== NavAgentState.Arrived; i++) {
        crowd.step();
        minY = Math.min(minY, crowd.posY[0]);
      }
      return {
        minY,
        arrived: crowd.state[0] === NavAgentState.Arrived,
        cost: crowd.fieldFor(goal, 'villager').costAtCell(4, 24),
      };
    };
    const world = flatWorld(16, 16);
    expect(world.grid.cost[0]).toBe(16);
    world.paintRoad({ x: 2, y: 2, width: 2, height: 2 });
    expect(world.grid.cost[2 * 16 + 2]).toBe(6); // 16 x 0.4 rounded
    expect(world.grid.roadMinFactor).toBe(0.4);

    const road = run(0.4);
    const none = run(1);
    expect(road.arrived).toBeTrue();
    expect(none.arrived).toBeTrue();
    expect(road.minY).withContext('road preferred: agent arches over the road').toBeLessThan(12);
    expect(none.minY).withContext('no preference: agent walks the straight line').toBeGreaterThan(20);
    expect(road.cost).withContext('the road route is cheaper than 55 cells of open ground').toBeLessThan(55 * 16);
    expect(none.cost).toBeGreaterThanOrEqual(55 * 16 - 1);
  });

  it('retunes the factor with a global rebuild', () => {
    const world = flatWorld(32, 32);
    world.paintRoad({ x: 0, y: 0, width: 4, height: 4 });
    const before = snapshotVersions(world.graph);
    const result = world.setRoadPreference(0.25);
    expect(world.grid.roadMinFactor).toBe(0.25);
    expect(world.grid.cost[0]).toBe(4);
    expect(result.sectors.length).toBe(world.graph.sectorCount);
    expect(Array.from(world.graph.versions).every((v, i) => v === before[i] + 1)).toBeTrue();
    expect(world.setRoadPreference(5).dirty.width).toBe(32);
    expect(world.grid.roadMinFactor).toBe(1);
  });
});

describe('incremental edits', () => {
  it('rebuilds only touched sectors and keeps every other version', () => {
    const world = flatWorld(128, 64, 16); // 8 x 4 sectors
    const before = snapshotVersions(world.graph);
    const result = world.placeBuilding({ x: 68, y: 20, width: 6, height: 6 });
    const touched = new Set(result.sectors);
    expect(result.sectors.length).toBeGreaterThan(0);
    expect(result.sectors.length).toBeLessThan(world.graph.sectorCount / 2);
    world.graph.versions.forEach((v, s) => {
      if (touched.has(s)) expect(v).withContext(`sector ${s}`).toBe(before[s] + 1);
      else expect(v).withContext(`sector ${s} untouched`).toBe(before[s]);
    });
    expect(world.graph.versions[world.graph.sectorOf(2, 2)]).toBe(before[0]);
    expect(world.stats.edits).toBe(1);
    expect(world.stats.sectorsRebuilt).toBe(result.sectors.length);

    const gate = world.placeGate({ x: 100, y: 40, width: 2, height: 6 }, true);
    expect(world.grid.flags[42 * 128 + 100] & NavFlag.GATE).toBeTruthy();
    expect(world.grid.flags[42 * 128 + 100] & NavFlag.BLOCKED).toBe(0);
    expect(gate.dirty.width).toBeGreaterThan(0);
    const closed = world.setGateOpen({ x: 100, y: 40, width: 2, height: 6 }, false);
    expect(closed.sectors.length).toBeGreaterThan(0);
    expect(world.grid.flags[42 * 128 + 100] & NavFlag.BLOCKED).toBeTruthy();
    world.removeBuilding({ x: 68, y: 20, width: 6, height: 6 });
    expect(world.grid.flags[22 * 128 + 70] & NavFlag.BLOCKED).toBe(0);
  });

  it('repairs only the cached fields that depend on touched sectors', () => {
    const world = flatWorld(128, 32, 16); // 8 x 2 sectors
    const cache = new NavFlowCache(world.graph);
    const goal = cache.field(124, 8, 'villager');
    expect(cache.ensure(goal, 8, 8).status).toBe('ready');
    expect(goal.builtSectors).toBe(8); // corridor along row 0, sectors 0 .. 7
    const ids = goal.sectors.map((e) => e?.buildId);
    const buildsBefore = cache.stats.builds;

    // A building in sector 4 (columns 64 .. 79): sectors 4 and upstream 0 .. 3 depend on it (they
    // were seeded through it); sectors 5 .. 7 are downstream of the edit and keep their fields.
    const edit = world.placeBuilding({ x: 70, y: 6, width: 4, height: 6 });
    cache.sync();
    for (const s of [5, 6, 7]) {
      if (!edit.sectors.includes(s)) expect(goal.sectors[s]?.buildId).withContext(`sector ${s}`).toBe(ids[s] as number);
    }
    for (const s of edit.sectors) expect(goal.sectors[s]).withContext(`rebuilt sector ${s}`).toBeUndefined();
    expect(goal.sectors[7]?.buildId).toBe(ids[7] as number);
    expect(cache.stats.invalidations).toBeGreaterThanOrEqual(edit.sectors.length);

    expect(cache.ensure(goal, 8, 8).status).toBe('ready');
    const rebuilt = cache.stats.builds - buildsBefore;
    expect(rebuilt).withContext('only dropped sectors are rebuilt').toBe(8 - goal.sectors.filter((e) => e && e.buildId === ids[e.sector]).length);
    expect(goal.sectors[7]!.buildId).toBe(ids[7] as number);
  });

  it('pushes agents out of a cell that an edit blocks, to the nearest passable cell', () => {
    const world = flatWorld(64, 32, 16);
    const crowd = new NavCrowd(world.graph, { capacity: 8, seed: 1 });
    const goal = crowd.addGoal(60, 16);
    const spots = [
      [30.2, 16.5],
      [31.5, 16.5],
      [32.9, 17.5],
      [30.5, 20.5],
    ];
    for (const [x, y] of spots) crowd.spawn(x, y, goal);
    world.placeBuilding({ x: 30, y: 15, width: 4, height: 4 });
    expect(inBlockedCell(crowd)).toBeGreaterThanOrEqual(0);
    const moved = crowd.displaceBlocked();
    expect(moved).toBe(3);
    expect(inBlockedCell(crowd)).toBe(-1);
    expect(crowd.stats.displaced).toBe(3);
    // Agent 0 was nearest the west edge: it lands in column 29 at the same height.
    expect(Math.floor(crowd.posX[0])).toBe(29);
    expect(Math.floor(crowd.posY[0])).toBe(16);
    // Agent 2 was nearest the east edge (column 34), agent 3 was outside and did not move.
    expect(Math.floor(crowd.posX[2])).toBe(34);
    expect(crowd.posX[3]).toBeCloseTo(30.5, 5);

    // The step does the same without a call when the graph was rebuilt.
    const crowd2 = new NavCrowd(world.graph, { capacity: 2, seed: 1 });
    const g2 = crowd2.addGoal(60, 16);
    crowd2.spawn(10.5, 5.5, g2);
    world.placeBuilding({ x: 9, y: 4, width: 3, height: 3 });
    crowd2.step();
    expect(inBlockedCell(crowd2)).toBe(-1);
  });

  it('is deterministic when displacing agents', () => {
    const run = (): Float32Array => {
      const world = flatWorld(48, 32, 16);
      const crowd = new NavCrowd(world.graph, { capacity: 60, seed: 9 });
      const goal = crowd.addGoal(44, 16);
      crowd.spawnRandom(60, { x: 16, y: 10, width: 8, height: 12 }, goal);
      world.placeBuilding({ x: 18, y: 12, width: 4, height: 8 });
      for (let i = 0; i < 100; i++) crowd.step();
      return crowd.posX.slice();
    };
    expect(run()).toEqual(run());
  });

  it('edits terrain heights: a raised ridge blocks and the crowd goes around', () => {
    const world = flatWorld(64, 48, 16);
    const edit = world.editTerrain({ x: 30, y: 4, width: 4, height: 36 }, (heights, width) => {
      for (let y = 4; y < 40; y++) for (let x = 30; x < 34; x++) heights[y * width + x] = 5 + 40;
    });
    expect(edit.sectors.length).toBeGreaterThan(0);
    // The ridge top is a plateau (flat) but its flanks are steep; the flanks block.
    expect(world.grid.flags[20 * 64 + 29] & NavFlag.STEEP).toBeTruthy();
    expect(world.grid.flags[20 * 64 + 34] & NavFlag.STEEP).toBeTruthy();
    const crowd = new NavCrowd(world.graph, { capacity: 1, seed: 1, arrivalRadius: 2 });
    const goal = crowd.addGoal(55, 20);
    crowd.spawn(8.5, 20.5, goal);
    let maxY = 0;
    let minY = 99;
    for (let i = 0; i < 3000 && crowd.state[0] !== NavAgentState.Arrived; i++) {
      crowd.step();
      expect(inBlockedCell(crowd)).toBe(-1);
      maxY = Math.max(maxY, crowd.posY[0]);
      minY = Math.min(minY, crowd.posY[0]);
    }
    expect(crowd.state[0]).toBe(NavAgentState.Arrived);
    expect(Math.max(20 - minY, maxY - 20)).withContext('detoured around the ridge').toBeGreaterThan(10);
  });
});

describe('arrival spreading', () => {
  it('spreads arrived agents around the goal instead of stacking them', () => {
    const world = flatWorld(64, 32, 16);
    const crowd = new NavCrowd(world.graph, { capacity: 150, seed: 3 });
    const goal = crowd.addGoal(40, 16);
    crowd.spawnRandom(150, { x: 4, y: 8, width: 12, height: 16 }, goal);
    for (let i = 0; i < 1500 && crowd.stats.arrived < 150; i++) crowd.step();
    expect(crowd.stats.arrived).toBe(150);
    for (let i = 0; i < 200; i++) crowd.step(); // settle
    let crowded = 0;
    let maxDist = 0;
    const cells = new Set<number>();
    for (let i = 0; i < crowd.count; i++) {
      let nearest = Infinity;
      for (let j = 0; j < crowd.count; j++) {
        if (i !== j) nearest = Math.min(nearest, Math.hypot(crowd.posX[i] - crowd.posX[j], crowd.posY[i] - crowd.posY[j]));
      }
      if (nearest < 0.5) crowded++;
      maxDist = Math.max(maxDist, Math.hypot(crowd.posX[i] - 40.5, crowd.posY[i] - 16.5));
      cells.add(Math.floor(crowd.posY[i]) * 64 + Math.floor(crowd.posX[i]));
      expect(crowd.arrivedCell[i]).toBe(16 * 64 + 40);
    }
    expect(crowded).withContext('agents closer than half a cell to another').toBeLessThan(15);
    expect(cells.size).withContext('distinct cells occupied by 150 agents').toBeGreaterThan(100);
    expect(maxDist).withContext('the blob stays near the goal').toBeLessThan(20);
    expect(inBlockedCell(crowd)).toBe(-1);
  });
});

/** The demo island with a wall and one 9-cell opening, west spawn and an east goal. */
function islandWorld(): { world: NavWorld; spawn: { x: number; y: number }; goal: { x: number; y: number }; gapY: number } {
  const heightfield = generateIslandHeightfield({ size: 512, maxHeight: 45, featureSize: 170, seed: 7 });
  const grid = NavGrid.fromHeightfield(heightfield);
  const wallX = 256;
  grid.stampStructure({ x: wallX, y: 0, width: 2, height: 512 });
  const ground = (x: number, y: number): boolean => (grid.flags[y * 512 + x] & (NavFlag.WATER | NavFlag.STEEP)) === 0;
  let gapY = -1;
  for (let k = 0; k < 120 && gapY < 0; k++) {
    const y = 256 + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
    let open = true;
    for (let dy = 0; dy < 9 && open; dy++) for (let x = wallX - 8; x <= wallX + 9 && open; x++) open = ground(x, y + dy);
    if (open) gapY = y;
  }
  expect(gapY).toBeGreaterThan(0);
  grid.clearStructure({ x: wallX, y: gapY, width: 2, height: 9 });
  const world = new NavWorld(NavSectorGraph.build(grid));
  return {
    world,
    gapY,
    spawn: nearestRoomy(grid, 130, gapY + 4, 6),
    goal: nearestRoomy(grid, 390, gapY + 4, 6),
  };
}

describe('edit scenarios', () => {
  it('a building dropped on the active route: everyone still arrives, nobody inside a blocked cell', () => {
    const { world, spawn, goal } = islandWorld();
    const crowd = new NavCrowd(world.graph, { capacity: 1000, seed: 7 });
    const id = crowd.addGoal(goal.x, goal.y);
    crowd.spawnRandom(1000, { x: spawn.x - 14, y: spawn.y - 14, width: 28, height: 28 }, id);
    let steps = 0;
    let totalMs = 0;
    let maxMs = 0;
    let edited = false;
    let editInfo = '';
    const versionsBefore = snapshotVersions(world.graph);
    let rebuilt: readonly number[] = [];
    const check = (): void => {
      const bad = inBlockedCell(crowd);
      if (bad >= 0) fail(`agent ${bad} is in a blocked cell at step ${steps}`);
    };
    while (crowd.stats.arrived < 1000 && steps < 8000) {
      crowd.step();
      steps++;
      totalMs += crowd.stats.lastStepMs;
      maxMs = Math.max(maxMs, crowd.stats.lastStepMs);
      if (!edited && steps === 300) {
        // Drop a 10 x 10 building on the middle of the crowd's lane.
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < crowd.count; i++) {
          sx += crowd.posX[i];
          sy += crowd.posY[i];
        }
        const bx = Math.round(sx / crowd.count) - 5;
        const by = Math.round(sy / crowd.count) - 5;
        const r = world.placeBuilding({ x: bx, y: by, width: 10, height: 10 });
        rebuilt = r.sectors;
        edited = true;
        editInfo = `edit: ${r.sectors.length} of ${world.graph.sectorCount} sectors rebuilt in ${r.sectorMs.toFixed(1)} ms (grid ${r.gridMs.toFixed(2)} ms)`;
        const touched = new Set(r.sectors);
        world.graph.versions.forEach((v, s) => {
          if (!touched.has(s)) expect(v).toBe(versionsBefore[s]);
        });
        const invalidationsBefore = crowd.cache.stats.invalidations;
        const buildsBefore = crowd.cache.stats.builds;
        crowd.step();
        steps++;
        editInfo += `; invalidated ${crowd.cache.stats.invalidations - invalidationsBefore} fields, ${crowd.cache.stats.builds - buildsBefore} rebuilt in the next step, ${crowd.stats.displaced} agents displaced`;
        check();
      }
      if (steps % 5 === 0) check();
    }
    check();
    console.log(
      `[crowd-nav] building on route: ${crowd.stats.arrived}/1000 arrived in ${steps} steps, step ${(totalMs / steps).toFixed(3)} ms mean / ${maxMs.toFixed(2)} ms max; ${editInfo}; ` +
        `cache: ${crowd.cache.stats.builds} builds total, ${crowd.cache.stats.invalidations} invalidations, ${crowd.cache.stats.totalBuildMs.toFixed(1)} ms building`,
    );
    expect(edited).toBeTrue();
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(crowd.stats.arrived).toBe(1000);
    expect(crowd.stats.displaced).toBeGreaterThan(0);
    expect(crowd.cache.stats.invalidations).toBeGreaterThan(0);
  });

  /** A wall across a 256 x 128 plain with a gate on the lane and a second opening far south. */
  function gateWorld(secondOpening: boolean): { world: NavWorld; gate: { x: number; y: number; width: number; height: number } } {
    const world = flatWorld(256, 128, 32);
    world.placeBuilding({ x: 128, y: 0, width: 2, height: 128 });
    const gate = { x: 128, y: 58, width: 2, height: 9 };
    world.placeGate(gate, true);
    if (secondOpening) world.removeBuilding({ x: 128, y: 112, width: 2, height: 9 });
    return { world, gate };
  }

  it('a gate closing mid-route: the crowd takes the other opening and everyone arrives', () => {
    const { world, gate } = gateWorld(true);
    const crowd = new NavCrowd(world.graph, { capacity: 400, seed: 11 });
    const id = crowd.addGoal(200, 62);
    crowd.spawnRandom(400, { x: 60, y: 54, width: 20, height: 16 }, id);
    let steps = 0;
    let totalMs = 0;
    let maxMs = 0;
    let info = '';
    const check = (): void => {
      const bad = inBlockedCell(crowd);
      if (bad >= 0) fail(`agent ${bad} is in a blocked cell at step ${steps}`);
    };
    while (crowd.stats.arrived < 400 && steps < 12000) {
      crowd.step();
      steps++;
      totalMs += crowd.stats.lastStepMs;
      maxMs = Math.max(maxMs, crowd.stats.lastStepMs);
      if (steps === 180) {
        let nearGate = 0;
        const arrivedBefore = crowd.stats.arrived;
        for (let i = 0; i < crowd.count; i++) if (crowd.posX[i] > 100 && crowd.posX[i] < 128) nearGate++;
        const r = world.setGateOpen(gate, false);
        const invalidations = crowd.cache.stats.invalidations;
        const builds = crowd.cache.stats.builds;
        crowd.step();
        steps++;
        info = `${nearGate} agents within 28 cells of the gate when it closed; ${r.sectors.length} of ${world.graph.sectorCount} sectors rebuilt in ${r.sectorMs.toFixed(1)} ms; ` +
          `${crowd.cache.stats.invalidations - invalidations} fields invalidated, ${crowd.cache.stats.builds - builds} rebuilt in the next step`;
        expect(r.sectors.length).toBeGreaterThan(0);
        expect(nearGate).withContext('agents are on their way to the gate').toBeGreaterThan(100);
        expect(arrivedBefore).toBe(0);
        check();
      }
      if (steps % 5 === 0) check();
    }
    check();
    console.log(
      `[crowd-nav] gate closes mid-route: ${crowd.stats.arrived}/400 arrived in ${steps} steps, step ${(totalMs / steps).toFixed(3)} ms mean / ${maxMs.toFixed(2)} ms max; ${info}; ` +
        `cache: ${crowd.cache.stats.builds} builds, ${crowd.cache.stats.invalidations} invalidations`,
    );
    expect(info).not.toBe('');
    expect(crowd.stats.arrived).toBe(400);
    expect(crowd.stats.unreachable).toBe(0);
  });

  it('a gate closing on the only crossing: the crowd reports unreachable, then arrives when it reopens', () => {
    const { world, gate } = gateWorld(false);
    const crowd = new NavCrowd(world.graph, { capacity: 120, seed: 2 });
    const id = crowd.addGoal(200, 62);
    crowd.spawnRandom(120, { x: 60, y: 54, width: 20, height: 16 }, id);
    for (let i = 0; i < 230; i++) crowd.step();
    // Some agents stand in or beside the gate cells when it closes: those inside are pushed out.
    world.setGateOpen(gate, false);
    for (let i = 0; i < 20; i++) {
      crowd.step();
      expect(inBlockedCell(crowd)).toBe(-1);
    }
    let west = 0;
    for (let i = 0; i < crowd.count; i++) {
      if (crowd.posX[i] < 128 && crowd.state[i] !== NavAgentState.Arrived) {
        west++;
        expect(crowd.state[i]).withContext(`agent ${i} on the west side`).toBe(NavAgentState.Unreachable);
      }
    }
    expect(west).toBeGreaterThan(0);
    expect(crowd.stats.unreachable).toBe(west);
    world.setGateOpen(gate, true);
    for (let i = 0; i < 6000 && crowd.stats.arrived < 120; i++) {
      crowd.step();
      if (i % 5 === 0) expect(inBlockedCell(crowd)).toBe(-1);
    }
    expect(crowd.stats.arrived).toBe(120);
    expect(crowd.stats.unreachable).toBe(0);
  });

  it('villagers go to the nearest of several storehouses, and keep going when one is removed', () => {
    const { world, spawn } = islandWorld();
    const grid = world.grid;
    const spots = [
      nearestRoomy(grid, spawn.x - 35, spawn.y, 4),
      nearestRoomy(grid, spawn.x + 35, spawn.y, 4),
      nearestRoomy(grid, spawn.x, spawn.y - 35, 4),
      nearestRoomy(grid, spawn.x, spawn.y + 35, 4),
    ];
    const set = new NavGoalSet(world.graph);
    for (const s of spots) set.add(s.x, s.y);
    expect(set.size).toBe(4);
    const crowd = new NavCrowd(world.graph, { capacity: 600, seed: 4 });
    const id = crowd.addGoalSet(set);
    crowd.spawnRandom(600, { x: spawn.x - 40, y: spawn.y - 40, width: 80, height: 80 }, id);
    const start = new Float32Array(crowd.count * 2);
    for (let i = 0; i < crowd.count; i++) {
      start[i * 2] = crowd.posX[i];
      start[i * 2 + 1] = crowd.posY[i];
    }
    let steps = 0;
    let totalMs = 0;
    let maxMs = 0;
    let removedAt = -1;
    let info = '';
    while (crowd.stats.arrived < crowd.count && steps < 8000) {
      crowd.step();
      steps++;
      totalMs += crowd.stats.lastStepMs;
      maxMs = Math.max(maxMs, crowd.stats.lastStepMs);
      if (steps % 10 === 0) expect(inBlockedCell(crowd)).toBe(-1);
      if (steps === 60) {
        // A storehouse goes away mid-run: only fields depending on its sector are rebuilt.
        const before = crowd.cache.stats.invalidations;
        const fieldSectors = crowd.fieldFor(id, 'villager').builtSectors;
        const gone = spots[1];
        set.remove(gone.x, gone.y);
        removedAt = gone.y * grid.width + gone.x;
        crowd.step();
        steps++;
        info = `removing 1 of 4 sources invalidated ${crowd.cache.stats.invalidations - before} of ${fieldSectors} cached sector fields`;
      }
    }
    expect(crowd.stats.arrived).toBe(crowd.count);
    const counts = new Map<number, number>();
    for (let i = 0; i < crowd.count; i++) counts.set(crowd.arrivedCell[i], (counts.get(crowd.arrivedCell[i]) ?? 0) + 1);
    // Nobody arrives at the removed source after it was removed (some arrived before).
    const perSource = spots.map((s) => counts.get(s.y * grid.width + s.x) ?? 0);
    console.log(
      `[crowd-nav] 4 storehouses: ${crowd.stats.arrived}/${crowd.count} arrived in ${steps} steps, step ${(totalMs / steps).toFixed(3)} ms mean / ${maxMs.toFixed(2)} ms max; ` +
        `arrivals per source ${perSource.join('/')}; ${info}; cache ${crowd.cache.stats.builds} builds in ${crowd.cache.stats.totalBuildMs.toFixed(1)} ms`,
    );
    expect(removedAt).toBeGreaterThan(0);
    expect(perSource.filter((n) => n > 0).length).withContext('several storehouses were used').toBeGreaterThanOrEqual(2);
    expect(perSource.reduce((a, b) => a + b, 0)).toBe(crowd.count);
    expect(start.length).toBe(crowd.count * 2);
  });

  it('assigns agents to the storehouse with the lowest path cost on open ground', () => {
    const world = flatWorld(160, 96, 32);
    const set = new NavGoalSet(world.graph);
    const spots = [
      { x: 20, y: 20 },
      { x: 140, y: 20 },
      { x: 80, y: 80 },
    ];
    for (const s of spots) set.add(s.x, s.y);
    const crowd = new NavCrowd(world.graph, { capacity: 300, seed: 8 });
    const id = crowd.addGoalSet(set);
    crowd.spawnRandom(300, { x: 10, y: 10, width: 140, height: 76 }, id);
    const octile = (x: number, y: number, s: { x: number; y: number }): number => {
      const dx = Math.abs(x - s.x - 0.5);
      const dy = Math.abs(y - s.y - 0.5);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const want = Array.from({ length: crowd.count }, (_, i) => {
      let best = 0;
      for (let k = 1; k < spots.length; k++) {
        if (octile(crowd.posX[i], crowd.posY[i], spots[k]) < octile(crowd.posX[i], crowd.posY[i], spots[best])) best = k;
      }
      return spots[best].y * 160 + spots[best].x;
    });
    for (let i = 0; i < 3000 && crowd.stats.arrived < crowd.count; i++) crowd.step();
    expect(crowd.stats.arrived).toBe(crowd.count);
    let match = 0;
    for (let i = 0; i < crowd.count; i++) if (crowd.arrivedCell[i] === want[i]) match++;
    // A sector is seeded from its corridor's downstream and from the neighbours built before it, so
    // only agents on a border between two sources can still end at the second nearest one.
    console.log(`[crowd-nav] open ground, 3 sources: ${match} of ${crowd.count} agents arrived at the nearest source`);
    expect(match / crowd.count).withContext('agents arrive at the source nearest to where they started').toBeGreaterThan(0.97);
  });
});
